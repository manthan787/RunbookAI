/**
 * Parallel Tool Executor
 *
 * Executes independent tool calls concurrently with configurable
 * concurrency limits and timeouts.
 */

import type { Tool, ToolCall } from './types';

export interface ParallelExecutorConfig {
  /** Maximum number of concurrent tool executions */
  maxConcurrent: number;
  /** Timeout for individual tool execution in milliseconds */
  timeoutMs: number;
}

export interface ToolExecutionResult {
  toolCall: ToolCall;
  result?: unknown;
  error?: string;
  durationMs: number;
  timedOut: boolean;
  batchId: string;
}

export interface ExecutionBatch {
  batchId: string;
  toolCalls: Array<{ call: ToolCall; tool: Tool }>;
  startTime: number;
}

const DEFAULT_CONFIG: ParallelExecutorConfig = {
  maxConcurrent: 5,
  timeoutMs: 30000, // 30 seconds
};

/**
 * Generate a unique batch ID
 */
function generateBatchId(): string {
  return `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Parallel executor for tool calls
 */
export class ParallelToolExecutor {
  private config: ParallelExecutorConfig;
  private activeBatches: Map<string, ExecutionBatch>;

  constructor(config: Partial<ParallelExecutorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.activeBatches = new Map();
  }

  /**
   * Execute multiple tool calls in parallel with concurrency limit
   *
   * @param toolCalls Array of tool calls with their tool definitions
   * @param onComplete Callback fired when each tool completes (for streaming events)
   * @returns Array of execution results in completion order
   */
  async executeAll(
    toolCalls: Array<{ call: ToolCall; tool: Tool }>,
    onComplete?: (result: ToolExecutionResult) => void
  ): Promise<ToolExecutionResult[]> {
    if (toolCalls.length === 0) {
      return [];
    }

    const batchId = generateBatchId();
    const batch: ExecutionBatch = {
      batchId,
      toolCalls,
      startTime: Date.now(),
    };
    this.activeBatches.set(batchId, batch);

    const results: ToolExecutionResult[] = [];
    const pending = [...toolCalls];
    const executing: Promise<void>[] = [];

    const executeNext = async (): Promise<void> => {
      while (pending.length > 0 && executing.length < this.config.maxConcurrent) {
        const item = pending.shift();
        if (!item) break;

        const executionPromise = this.executeOne(item, batchId)
          .then((result) => {
            results.push(result);
            if (onComplete) {
              onComplete(result);
            }
          })
          .finally(() => {
            const idx = executing.indexOf(executionPromise);
            if (idx >= 0) {
              executing.splice(idx, 1);
            }
          });

        executing.push(executionPromise);
      }

      if (executing.length > 0) {
        await Promise.race(executing);
        await executeNext();
      }
    };

    await executeNext();

    // Wait for all remaining executions
    await Promise.all(executing);

    this.activeBatches.delete(batchId);
    return results;
  }

  /**
   * Execute a single tool call with timeout
   */
  private async executeOne(
    item: { call: ToolCall; tool: Tool },
    batchId: string
  ): Promise<ToolExecutionResult> {
    const { call, tool } = item;
    const startTime = Date.now();

    try {
      const result = await this.withTimeout(
        tool.execute(call.args),
        this.config.timeoutMs,
        `Tool ${call.name} timed out after ${this.config.timeoutMs}ms`
      );

      return {
        toolCall: call,
        result,
        durationMs: Date.now() - startTime,
        timedOut: false,
        batchId,
      };
    } catch (error) {
      const isTimeout = error instanceof Error && error.message.includes('timed out');
      return {
        toolCall: call,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
        timedOut: isTimeout,
        batchId,
      };
    }
  }

  /**
   * Wrap a promise with a timeout
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(message));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      return result;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Execute tools sequentially (for comparison or fallback)
   */
  async executeSequential(
    toolCalls: Array<{ call: ToolCall; tool: Tool }>,
    onComplete?: (result: ToolExecutionResult) => void
  ): Promise<ToolExecutionResult[]> {
    const batchId = generateBatchId();
    const results: ToolExecutionResult[] = [];

    for (const item of toolCalls) {
      const result = await this.executeOne(item, batchId);
      results.push(result);
      if (onComplete) {
        onComplete(result);
      }
    }

    return results;
  }

  /**
   * Get currently active batches
   */
  getActiveBatches(): string[] {
    return Array.from(this.activeBatches.keys());
  }

  /**
   * Check if any batch is currently executing
   */
  isExecuting(): boolean {
    return this.activeBatches.size > 0;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ParallelExecutorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): ParallelExecutorConfig {
    return { ...this.config };
  }
}

/**
 * Analyze tool calls for dependencies to determine which can run in parallel
 *
 * This is a simple heuristic - tools that query the same service/resource
 * are considered potentially dependent and should run sequentially.
 */
export function analyzeToolDependencies(toolCalls: Array<{ call: ToolCall; tool: Tool }>): {
  parallel: Array<Array<{ call: ToolCall; tool: Tool }>>;
} {
  // Group by "resource signature" - tools accessing the same resource should be sequential
  const groups = new Map<string, Array<{ call: ToolCall; tool: Tool }>>();

  for (const item of toolCalls) {
    const signature = getResourceSignature(item.call);
    const existing = groups.get(signature) || [];
    existing.push(item);
    groups.set(signature, existing);
  }

  // Each group can run in parallel, but items within a group are sequential
  return {
    parallel: Array.from(groups.values()),
  };
}

/**
 * Get a signature representing the resource a tool call accesses
 */
function getResourceSignature(call: ToolCall): string {
  const { name, args } = call;

  // Extract service/resource identifiers from common argument patterns
  const identifiers: string[] = [name];

  if (args.service) identifiers.push(String(args.service));
  if (args.services && Array.isArray(args.services)) {
    identifiers.push(...args.services.map(String).sort());
  }
  if (args.log_group) identifiers.push(String(args.log_group));
  if (args.cluster) identifiers.push(String(args.cluster));
  if (args.namespace) identifiers.push(String(args.namespace));
  if (args.region) identifiers.push(String(args.region));

  return identifiers.join(':');
}

/**
 * Create a parallel executor instance
 */
export function createParallelExecutor(
  config?: Partial<ParallelExecutorConfig>
): ParallelToolExecutor {
  return new ParallelToolExecutor(config);
}
