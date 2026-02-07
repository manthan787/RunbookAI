/**
 * Skill Types
 *
 * Defines the structure of skills - reusable workflows for common SRE tasks.
 */

export interface SkillParameter {
  name: string;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'array';
  required: boolean;
  default?: unknown;
  enum?: string[];
}

export interface SkillStep {
  id: string;
  name: string;
  description: string;
  // Tool to use or 'prompt' for LLM decision
  action: string;
  // Parameters for the action
  parameters?: Record<string, unknown>;
  // Condition to run this step (references previous step results)
  condition?: string;
  // Whether to wait for approval before this step
  requiresApproval?: boolean;
  // Error handling
  onError?: 'continue' | 'abort' | 'retry';
  maxRetries?: number;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  tags?: string[];
  // Input parameters
  parameters: SkillParameter[];
  // Steps to execute
  steps: SkillStep[];
  // Services this skill applies to
  applicableServices?: string[];
  // Risk level of this skill
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
}

export interface SkillExecutionContext {
  skillId: string;
  parameters: Record<string, unknown>;
  startedAt: Date;
  stepResults: Map<string, SkillStepResult>;
  currentStepIndex: number;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
}

export interface SkillStepResult {
  stepId: string;
  status: 'success' | 'failed' | 'skipped';
  result?: unknown;
  error?: string;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
}

export interface SkillExecutionResult {
  skillId: string;
  status: 'completed' | 'failed' | 'cancelled';
  parameters: Record<string, unknown>;
  stepResults: SkillStepResult[];
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  error?: string;
}
