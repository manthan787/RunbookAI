/**
 * Scratchpad: Single source of truth for all agent work
 *
 * Persists as JSONL for auditability and implements graceful limits
 * to prevent retry loops without blocking the agent.
 */

import { mkdir, appendFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { ScratchpadEntry, ToolResultEntry } from './types';

interface ToolUsageStats {
  callCount: number;
  queries: string[];
}

interface ToolLimitResult {
  allowed: boolean;
  warning?: string;
}

export class Scratchpad {
  private entries: ScratchpadEntry[] = [];
  private toolUsage: Map<string, ToolUsageStats> = new Map();
  private filePath: string;
  private initialized = false;

  constructor(
    private readonly baseDir: string,
    private readonly sessionId: string,
    private readonly toolLimits: Record<string, number> = {}
  ) {
    this.filePath = join(baseDir, `${sessionId}.jsonl`);
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    // Ensure directory exists
    if (!existsSync(this.baseDir)) {
      await mkdir(this.baseDir, { recursive: true });
    }

    this.initialized = true;
  }

  /**
   * Append an entry to the scratchpad
   */
  async append(entry: Omit<ScratchpadEntry, 'timestamp'>): Promise<void> {
    await this.init();

    const fullEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    } as ScratchpadEntry;

    this.entries.push(fullEntry);

    // Track tool usage for limits
    if (fullEntry.type === 'tool_result') {
      this.trackToolUsage(fullEntry as ToolResultEntry);
    }

    // Persist to JSONL
    await appendFile(this.filePath, JSON.stringify(fullEntry) + '\n');
  }

  /**
   * Track tool usage for graceful limits
   */
  private trackToolUsage(entry: ToolResultEntry): void {
    const stats = this.toolUsage.get(entry.tool) || { callCount: 0, queries: [] };
    stats.callCount++;

    // Extract query-like args for similarity detection
    const queryArg =
      entry.args.query || entry.args.search || entry.args.filter || JSON.stringify(entry.args);
    if (typeof queryArg === 'string') {
      stats.queries.push(queryArg);
    }

    this.toolUsage.set(entry.tool, stats);
  }

  /**
   * Check if a tool call should proceed (graceful limits)
   *
   * Always returns allowed: true, but may include warnings
   */
  canCallTool(toolName: string, query?: string): ToolLimitResult {
    const limit = this.toolLimits[toolName] || 5; // Default limit
    const stats = this.toolUsage.get(toolName);

    if (!stats) {
      return { allowed: true };
    }

    // Check if over suggested limit
    if (stats.callCount >= limit) {
      return {
        allowed: true, // Never block, only warn
        warning: `Tool "${toolName}" has been called ${stats.callCount} times (suggested limit: ${limit}). Consider if additional calls are necessary.`,
      };
    }

    // Check for similar queries (potential retry loop)
    if (query && stats.queries.length > 0) {
      const similarity = this.maxSimilarity(query, stats.queries);
      if (similarity > 0.8) {
        return {
          allowed: true,
          warning: `Query appears similar to a previous "${toolName}" call (${Math.round(similarity * 100)}% similarity). This might be a retry loop.`,
        };
      }
    }

    // Approaching limit warning
    if (stats.callCount === limit - 1) {
      return {
        allowed: true,
        warning: `Approaching suggested limit for "${toolName}" (${stats.callCount + 1}/${limit} calls).`,
      };
    }

    return { allowed: true };
  }

  /**
   * Calculate Jaccard similarity between query and previous queries
   */
  private maxSimilarity(query: string, previousQueries: string[]): number {
    const queryWords = new Set(query.toLowerCase().split(/\s+/));
    let maxSim = 0;

    for (const prev of previousQueries) {
      const prevWords = new Set(prev.toLowerCase().split(/\s+/));
      const intersection = new Set([...queryWords].filter((w) => prevWords.has(w)));
      const union = new Set([...queryWords, ...prevWords]);
      const similarity = intersection.size / union.size;
      maxSim = Math.max(maxSim, similarity);
    }

    return maxSim;
  }

  /**
   * Get all tool results for context building
   */
  getToolResults(): ToolResultEntry[] {
    return this.entries.filter((e): e is ToolResultEntry => e.type === 'tool_result');
  }

  /**
   * Get recent tool results (for context window management)
   */
  getRecentToolResults(count: number): ToolResultEntry[] {
    const toolResults = this.getToolResults();
    return toolResults.slice(-count);
  }

  /**
   * Clear oldest tool results (keep in JSONL, remove from memory)
   * Returns count of cleared entries
   */
  clearOldestToolResults(keepCount: number): number {
    const toolResults = this.getToolResults();
    const clearCount = Math.max(0, toolResults.length - keepCount);

    if (clearCount > 0) {
      // Mark entries as cleared in memory (JSONL is never modified)
      let cleared = 0;
      this.entries = this.entries.filter((entry) => {
        if (entry.type === 'tool_result' && cleared < clearCount) {
          cleared++;
          return false;
        }
        return true;
      });
    }

    return clearCount;
  }

  /**
   * Get tool usage status for prompt injection
   */
  getToolUsageStatus(): string {
    const lines: string[] = [];

    for (const [tool, stats] of this.toolUsage) {
      const limit = this.toolLimits[tool] || 5;
      const status = stats.callCount >= limit ? '(at limit)' : '';
      lines.push(`- ${tool}: ${stats.callCount}/${limit} calls ${status}`);
    }

    return lines.length > 0 ? lines.join('\n') : 'No tools called yet.';
  }

  /**
   * Get all entries (for investigation summary)
   */
  getAllEntries(): ScratchpadEntry[] {
    return [...this.entries];
  }

  /**
   * Load existing scratchpad from file
   */
  async load(): Promise<void> {
    await this.init();

    if (!existsSync(this.filePath)) {
      return;
    }

    const content = await readFile(this.filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as ScratchpadEntry;
        this.entries.push(entry);

        if (entry.type === 'tool_result') {
          this.trackToolUsage(entry);
        }
      } catch {
        // Skip malformed lines
      }
    }
  }

  /**
   * Get the file path for this scratchpad
   */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Generate a unique session ID
   */
  static generateSessionId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}_${random}`;
  }
}
