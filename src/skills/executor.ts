/**
 * Skill Executor
 *
 * Executes skill workflows step by step, handling:
 * - Parameter substitution
 * - Conditional steps
 * - Approval flows
 * - Error handling
 * - Progress tracking
 */

import type {
  SkillDefinition,
  SkillStep,
  SkillExecutionContext,
  SkillStepResult,
  SkillExecutionResult,
} from './types';
import { toolRegistry } from '../tools/registry';
import type { LLMClient } from '../model/llm';

export interface SkillExecutorOptions {
  llm: LLMClient;
  onStepStart?: (step: SkillStep, context: SkillExecutionContext) => void;
  onStepComplete?: (step: SkillStep, result: SkillStepResult, context: SkillExecutionContext) => void;
  onApprovalRequired?: (step: SkillStep, context: SkillExecutionContext) => Promise<boolean>;
  onProgress?: (message: string, context: SkillExecutionContext) => void;
}

export class SkillExecutor {
  private llm: LLMClient;
  private options: SkillExecutorOptions;

  constructor(options: SkillExecutorOptions) {
    this.llm = options.llm;
    this.options = options;
  }

  /**
   * Execute a skill with given parameters
   */
  async execute(
    skill: SkillDefinition,
    parameters: Record<string, unknown>
  ): Promise<SkillExecutionResult> {
    const startedAt = new Date();

    // Validate required parameters
    for (const param of skill.parameters) {
      if (param.required && !(param.name in parameters)) {
        throw new Error(`Missing required parameter: ${param.name}`);
      }
      // Apply defaults
      if (!(param.name in parameters) && param.default !== undefined) {
        parameters[param.name] = param.default;
      }
    }

    // Create execution context
    const context: SkillExecutionContext = {
      skillId: skill.id,
      parameters,
      startedAt,
      stepResults: new Map(),
      currentStepIndex: 0,
      status: 'running',
    };

    const stepResults: SkillStepResult[] = [];

    try {
      // Execute each step
      for (let i = 0; i < skill.steps.length; i++) {
        const step = skill.steps[i];
        context.currentStepIndex = i;

        // Check condition
        if (step.condition && !this.evaluateCondition(step.condition, context)) {
          const skippedResult: SkillStepResult = {
            stepId: step.id,
            status: 'skipped',
            startedAt: new Date(),
            completedAt: new Date(),
            durationMs: 0,
          };
          stepResults.push(skippedResult);
          context.stepResults.set(step.id, skippedResult);
          continue;
        }

        // Check for approval
        if (step.requiresApproval && this.options.onApprovalRequired) {
          const approved = await this.options.onApprovalRequired(step, context);
          if (!approved) {
            context.status = 'cancelled';
            break;
          }
        }

        // Execute step
        this.options.onStepStart?.(step, context);
        const stepResult = await this.executeStep(step, context);
        stepResults.push(stepResult);
        context.stepResults.set(step.id, stepResult);
        this.options.onStepComplete?.(step, stepResult, context);

        // Handle errors
        if (stepResult.status === 'failed') {
          if (step.onError === 'abort') {
            context.status = 'failed';
            break;
          } else if (step.onError === 'retry' && step.maxRetries) {
            // Retry logic
            let retries = 0;
            while (retries < step.maxRetries && stepResult.status === 'failed') {
              retries++;
              this.options.onProgress?.(`Retrying step ${step.id} (${retries}/${step.maxRetries})`, context);
              const retryResult = await this.executeStep(step, context);
              if (retryResult.status === 'success') {
                stepResults[stepResults.length - 1] = retryResult;
                context.stepResults.set(step.id, retryResult);
                break;
              }
            }
          }
          // 'continue' - just move on
        }
      }

      if (context.status === 'running') {
        context.status = 'completed';
      }
    } catch (error) {
      context.status = 'failed';
      return {
        skillId: skill.id,
        status: 'failed',
        parameters,
        stepResults,
        startedAt,
        completedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const completedAt = new Date();
    return {
      skillId: skill.id,
      status: context.status === 'cancelled' ? 'cancelled' : context.status === 'failed' ? 'failed' : 'completed',
      parameters,
      stepResults,
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    };
  }

  /**
   * Execute a single step
   */
  private async executeStep(step: SkillStep, context: SkillExecutionContext): Promise<SkillStepResult> {
    const startedAt = new Date();

    try {
      // Substitute parameters in step
      const resolvedParams = this.resolveParameters(step.parameters || {}, context);

      let result: unknown;

      if (step.action === 'prompt') {
        // Use LLM to generate response
        const instruction = this.resolveTemplate(
          (step.parameters?.instruction as string) || '',
          context
        );
        const response = await this.llm.chat(
          'You are an SRE assistant executing a workflow step.',
          instruction
        );
        result = response.content;
      } else {
        // Execute tool
        const tool = toolRegistry.get(step.action);
        if (!tool) {
          throw new Error(`Unknown tool: ${step.action}`);
        }
        result = await tool.execute(resolvedParams);
      }

      const completedAt = new Date();
      return {
        stepId: step.id,
        status: 'success',
        result,
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      };
    } catch (error) {
      const completedAt = new Date();
      return {
        stepId: step.id,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      };
    }
  }

  /**
   * Resolve template strings with context values
   */
  private resolveTemplate(template: string, context: SkillExecutionContext): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      const value = this.getValueByPath(path.trim(), context);
      if (value === undefined) {
        return match; // Keep original if not found
      }
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
    });
  }

  /**
   * Resolve all parameters in an object
   */
  private resolveParameters(
    params: Record<string, unknown>,
    context: SkillExecutionContext
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') {
        resolved[key] = this.resolveTemplate(value, context);
      } else if (typeof value === 'object' && value !== null) {
        resolved[key] = this.resolveParameters(value as Record<string, unknown>, context);
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }

  /**
   * Get value by dot-separated path
   */
  private getValueByPath(path: string, context: SkillExecutionContext): unknown {
    const parts = path.split('.');

    // Handle special prefixes
    if (parts[0] === 'steps') {
      const stepId = parts[1];
      const stepResult = context.stepResults.get(stepId);
      if (!stepResult) return undefined;

      if (parts.length === 2) return stepResult;

      let value: unknown = stepResult;
      for (let i = 2; i < parts.length; i++) {
        if (value === null || value === undefined) return undefined;
        value = (value as Record<string, unknown>)[parts[i]];
      }
      return value;
    }

    // Handle parameters
    if (parts[0] in context.parameters) {
      let value: unknown = context.parameters[parts[0]];
      for (let i = 1; i < parts.length; i++) {
        if (value === null || value === undefined) return undefined;
        value = (value as Record<string, unknown>)[parts[i]];
      }
      return value;
    }

    // Direct parameter lookup
    return context.parameters[path];
  }

  /**
   * Evaluate a condition expression
   */
  private evaluateCondition(condition: string, context: SkillExecutionContext): boolean {
    // Simple condition evaluation
    // Supports: steps.stepId.status === 'success', steps.stepId.result.count > 0
    try {
      const resolved = this.resolveTemplate(condition, context);
      // Basic evaluation (for safety, only support simple comparisons)
      if (resolved.includes('===')) {
        const [left, right] = resolved.split('===').map((s) => s.trim().replace(/['"]/g, ''));
        return left === right;
      }
      if (resolved.includes('!==')) {
        const [left, right] = resolved.split('!==').map((s) => s.trim().replace(/['"]/g, ''));
        return left !== right;
      }
      if (resolved.includes('>')) {
        const [left, right] = resolved.split('>').map((s) => parseFloat(s.trim()));
        return left > right;
      }
      if (resolved.includes('<')) {
        const [left, right] = resolved.split('<').map((s) => parseFloat(s.trim()));
        return left < right;
      }
      return Boolean(resolved);
    } catch {
      return true; // Default to true if can't evaluate
    }
  }
}
