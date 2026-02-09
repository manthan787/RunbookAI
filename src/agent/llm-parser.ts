/**
 * LLM Response Parser
 *
 * Parses structured outputs from the LLM for hypothesis generation,
 * evidence evaluation, and investigation conclusions.
 */

import { z } from 'zod';
import type {
  InvestigationHypothesis,
  EvidenceEvaluation,
  Conclusion,
  TriageResult,
  RemediationStep,
} from './state-machine';
import type { CausalQuery } from './causal-query';

/**
 * Schema for a single hypothesis from LLM
 */
export const HypothesisSchema = z.object({
  statement: z.string().describe('Clear statement of what might be causing the issue'),
  category: z.enum([
    'infrastructure',
    'application',
    'dependency',
    'configuration',
    'capacity',
    'unknown',
  ]),
  priority: z.number().min(1).max(5).describe('1 = highest priority, 5 = lowest'),
  confirmingEvidence: z.string().describe('What evidence would confirm this hypothesis'),
  refutingEvidence: z.string().describe('What evidence would refute this hypothesis'),
  queries: z
    .array(
      z.object({
        type: z.enum(['metrics', 'logs', 'traces', 'config', 'status']),
        description: z.string(),
        service: z
          .string()
          .nullable()
          .optional()
          .transform((value) => value ?? undefined),
      })
    )
    .describe('Queries to run to test this hypothesis'),
});

export type HypothesisInput = z.infer<typeof HypothesisSchema>;

/**
 * Schema for hypothesis generation response
 */
export const HypothesisGenerationSchema = z.object({
  hypotheses: z.array(HypothesisSchema).min(1).max(5),
  reasoning: z.string().describe('Overall reasoning for these hypotheses'),
});

export type HypothesisGeneration = z.infer<typeof HypothesisGenerationSchema>;

/**
 * Schema for evidence evaluation response
 */
export const EvidenceEvaluationSchema = z.object({
  hypothesisId: z.string(),
  evidenceStrength: z.enum(['strong', 'weak', 'none', 'contradicting', 'pending']),
  confidence: z.number().min(0).max(100),
  reasoning: z
    .string()
    .describe('Explanation of how the evidence supports or refutes the hypothesis'),
  action: z
    .enum(['branch', 'prune', 'confirm', 'continue'])
    .describe(
      'branch = create sub-hypotheses, prune = eliminate hypothesis, confirm = root cause found, continue = need more data'
    ),
  findings: z.array(z.string()).describe('Key findings from the evidence'),
  subHypotheses: z
    .array(HypothesisSchema)
    .optional()
    .describe('Sub-hypotheses if action is branch'),
});

export type EvidenceEvaluationInput = z.infer<typeof EvidenceEvaluationSchema>;

/**
 * Schema for triage response
 */
export const TriageResponseSchema = z.object({
  summary: z.string().describe('Brief summary of the incident'),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  affectedServices: z.array(z.string()),
  symptoms: z.array(z.string()).describe('Observable symptoms'),
  errorMessages: z.array(z.string()).describe('Key error messages'),
  timeWindow: z.object({
    start: z.string().describe('ISO timestamp for when the issue started'),
    end: z.string().describe('ISO timestamp for current time or when issue ended'),
  }),
  initialHypotheses: z.array(z.string()).optional().describe('Initial guesses based on symptoms'),
});

export type TriageResponse = z.infer<typeof TriageResponseSchema>;

/**
 * Schema for conclusion response
 */
export const ConclusionSchema = z.object({
  rootCause: z.string().describe('The identified root cause'),
  confidence: z.enum(['high', 'medium', 'low']),
  confirmedHypothesisId: z.string(),
  affectedServices: z
    .union([z.array(z.string()), z.string()])
    .optional()
    .transform((value) => {
      if (!value) return undefined;
      return Array.isArray(value) ? value : [value];
    })
    .describe('Canonical service identifiers most directly impacted'),
  evidenceChain: z.array(
    z.object({
      finding: z.string(),
      source: z.string(),
      strength: z.enum(['strong', 'weak', 'none', 'contradicting', 'pending']),
    })
  ),
  alternativeExplanations: z
    .union([z.array(z.string()), z.string()])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .describe("Other possible explanations that weren't confirmed"),
  unknowns: z
    .union([z.array(z.string()), z.string()])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .describe("What we still don't know"),
});

export type ConclusionInput = z.infer<typeof ConclusionSchema>;

/**
 * Schema for remediation plan response
 */
export const RemediationPlanSchema = z.object({
  steps: z.array(
    z.object({
      action: z.string().describe('What to do'),
      description: z.string().describe('Detailed description'),
      command: z
        .string()
        .nullable()
        .optional()
        .transform((value) => value ?? undefined)
        .describe('CLI command to execute'),
      rollbackCommand: z
        .string()
        .nullable()
        .optional()
        .transform((value) => value ?? undefined)
        .describe('Command to undo this step'),
      riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
      requiresApproval: z.boolean(),
      matchingSkill: z
        .string()
        .nullable()
        .optional()
        .transform((value) => value ?? undefined)
        .describe('Skill that can execute this'),
      matchingRunbook: z
        .string()
        .nullable()
        .optional()
        .transform((value) => value ?? undefined)
        .describe('Runbook that matches this step'),
    })
  ),
  estimatedRecoveryTime: z.string().optional().describe('How long until service is restored'),
  monitoring: z.array(z.string()).describe('What to monitor after remediation'),
});

export type RemediationPlanInput = z.infer<typeof RemediationPlanSchema>;

/**
 * Schema for log analysis response
 */
export const LogAnalysisSchema = z.object({
  patterns: z.array(
    z.object({
      pattern: z.string().describe('The recurring pattern found'),
      count: z.number().describe('How many times it occurred'),
      severity: z.enum(['info', 'warning', 'error', 'critical']),
      firstSeen: z.string().describe('Timestamp of first occurrence'),
      lastSeen: z.string().describe('Timestamp of last occurrence'),
      examples: z.array(z.string()).max(3).describe('Example log lines'),
    })
  ),
  anomalies: z.array(
    z.object({
      description: z.string(),
      timestamp: z.string(),
      relevance: z.enum(['high', 'medium', 'low']),
    })
  ),
  summary: z.string().describe('Overall summary of the log analysis'),
  suggestedHypotheses: z.array(z.string()).describe('Hypotheses suggested by the logs'),
});

export type LogAnalysis = z.infer<typeof LogAnalysisSchema>;

/**
 * Parse JSON from LLM response, handling markdown code blocks
 */
export function extractJSON(text: string): string {
  // Try to find JSON in markdown code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try to find raw JSON object or array
  const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }

  return text.trim();
}

/**
 * Parse LLM response into structured hypothesis generation
 */
export function parseHypothesisGeneration(text: string): HypothesisGeneration {
  const json = extractJSON(text);
  const parsed = JSON.parse(json);
  return HypothesisGenerationSchema.parse(parsed);
}

/**
 * Parse LLM response into structured evidence evaluation
 */
export function parseEvidenceEvaluation(text: string): EvidenceEvaluationInput {
  const json = extractJSON(text);
  const parsed = JSON.parse(json);
  return EvidenceEvaluationSchema.parse(parsed);
}

/**
 * Parse LLM response into structured triage result
 */
export function parseTriageResponse(text: string): TriageResponse {
  const json = extractJSON(text);
  const parsed = JSON.parse(json);
  return TriageResponseSchema.parse(parsed);
}

/**
 * Parse LLM response into structured conclusion
 */
export function parseConclusion(text: string): ConclusionInput {
  const json = extractJSON(text);
  const parsed = JSON.parse(json);
  return ConclusionSchema.parse(parsed);
}

/**
 * Parse LLM response into structured remediation plan
 */
export function parseRemediationPlan(text: string): RemediationPlanInput {
  const json = extractJSON(text);
  const parsed = JSON.parse(json);
  return RemediationPlanSchema.parse(parsed);
}

/**
 * Parse LLM response into structured log analysis
 */
export function parseLogAnalysis(text: string): LogAnalysis {
  const json = extractJSON(text);
  const parsed = JSON.parse(json);
  return LogAnalysisSchema.parse(parsed);
}

/**
 * Convert parsed triage response to TriageResult
 */
export function toTriageResult(response: TriageResponse, incidentId?: string): TriageResult {
  return {
    incidentId,
    summary: response.summary,
    affectedServices: response.affectedServices,
    symptoms: response.symptoms,
    errorMessages: response.errorMessages,
    severity: response.severity,
    timeWindow: {
      start: new Date(response.timeWindow.start),
      end: new Date(response.timeWindow.end),
    },
  };
}

/**
 * Simple query definition from LLM (not the full CausalQuery)
 */
export interface SimpleQuery {
  type: 'metrics' | 'logs' | 'traces' | 'config' | 'status';
  description: string;
  service?: string;
}

/**
 * Convert parsed hypothesis to InvestigationHypothesis input
 *
 * Note: The queries array is left empty because the causal query builder
 * (generateQueriesForHypothesis) will generate proper CausalQuery objects
 * based on the hypothesis statement and context.
 */
export function toHypothesisInput(
  hypothesis: HypothesisInput,
  parentId?: string
): Omit<
  InvestigationHypothesis,
  | 'id'
  | 'status'
  | 'evidenceStrength'
  | 'confidence'
  | 'queryResults'
  | 'children'
  | 'createdAt'
  | 'updatedAt'
> {
  return {
    statement: hypothesis.statement,
    category: hypothesis.category,
    priority: hypothesis.priority,
    confirmingEvidence: hypothesis.confirmingEvidence,
    refutingEvidence: hypothesis.refutingEvidence,
    // Empty queries - will be generated by causal query builder
    queries: [],
    parentId,
  };
}

/**
 * Convert parsed evidence evaluation to EvidenceEvaluation
 */
export function toEvidenceEvaluation(input: EvidenceEvaluationInput): EvidenceEvaluation {
  return {
    hypothesisId: input.hypothesisId,
    evidenceStrength: input.evidenceStrength,
    confidence: input.confidence,
    reasoning: input.reasoning,
    action: input.action,
    findings: input.findings,
  };
}

/**
 * Convert parsed conclusion to Conclusion
 */
export function toConclusionResult(input: ConclusionInput): Conclusion {
  return {
    rootCause: input.rootCause,
    confidence: input.confidence,
    confirmedHypothesisId: input.confirmedHypothesisId,
    affectedServices: input.affectedServices,
    evidenceChain: input.evidenceChain,
    alternativeExplanations: input.alternativeExplanations,
    unknowns: input.unknowns,
  };
}

/**
 * Convert parsed remediation plan to RemediationStep[]
 */
export function toRemediationSteps(input: RemediationPlanInput): RemediationStep[] {
  return input.steps.map((step, index) => ({
    id: `step_${index + 1}`,
    action: step.action,
    description: step.description,
    command: step.command,
    rollbackCommand: step.rollbackCommand,
    riskLevel: step.riskLevel,
    requiresApproval: step.requiresApproval,
    status: 'pending' as const,
    matchingSkill: step.matchingSkill,
    matchingRunbook: step.matchingRunbook,
  }));
}

/**
 * Prompt templates for structured outputs
 */
export const PROMPTS = {
  triage: `Analyze the following incident information and provide a structured triage assessment.

Incident Context:
{context}

Respond with a JSON object matching this schema:
- summary: Brief summary of the incident
- severity: "low" | "medium" | "high" | "critical"
- affectedServices: Array of affected service names
- symptoms: Array of observable symptoms
- errorMessages: Array of key error messages
- timeWindow: { start: ISO timestamp, end: ISO timestamp }
- initialHypotheses: Optional array of initial guesses

Respond ONLY with the JSON object, no additional text.`,

  generateHypotheses: `Based on the triage results, generate hypotheses about the root cause.

Triage Summary:
{triageSummary}

Symptoms:
{symptoms}

Error Messages:
{errorMessages}

Affected Services:
{services}

Respond with a JSON object matching this schema:
- hypotheses: Array of 3-5 hypotheses, each with:
  - statement: Clear statement of what might be causing the issue
  - category: "infrastructure" | "application" | "dependency" | "configuration" | "capacity" | "unknown"
  - priority: 1-5 (1 = most likely)
  - confirmingEvidence: What evidence would confirm this
  - refutingEvidence: What evidence would refute this
  - queries: Array of queries to test this hypothesis
    - type: "metrics" | "logs" | "traces" | "config" | "status"
    - description: What to query
    - service: Optional service name
- reasoning: Overall reasoning for these hypotheses

Respond ONLY with the JSON object, no additional text.`,

  evaluateEvidence: `Evaluate the evidence gathered for this hypothesis.

Hypothesis:
{hypothesis}

Expected Confirming Evidence:
{confirmingEvidence}

Expected Refuting Evidence:
{refutingEvidence}

Gathered Evidence:
{evidence}

Respond with a JSON object matching this schema:
- hypothesisId: The hypothesis ID
- evidenceStrength: "strong" | "weak" | "none" | "contradicting" | "pending"
- confidence: 0-100 percentage
- reasoning: Explanation of how evidence supports/refutes hypothesis
- action: "branch" | "prune" | "confirm" | "continue"
  - branch: Create more specific sub-hypotheses
  - prune: Eliminate this hypothesis
  - confirm: This is the root cause
  - continue: Need more evidence
- findings: Array of key findings
- subHypotheses: Optional array of sub-hypotheses if action is "branch"

Respond ONLY with the JSON object, no additional text.`,

  generateConclusion: `Based on the investigation, provide a conclusion about the root cause.

Confirmed Hypothesis:
{hypothesis}

Evidence Chain:
{evidence}

Alternative Hypotheses Considered:
{alternatives}

Respond with a JSON object matching this schema:
- rootCause: The identified root cause
- confidence: "high" | "medium" | "low"
- confirmedHypothesisId: ID of the confirmed hypothesis
- affectedServices: Array of canonical service IDs that are impacted (must not be empty if any service is known)
- evidenceChain: Array of { finding, source, strength }
- alternativeExplanations: Other possible explanations not confirmed
- unknowns: What we still don't know

Respond ONLY with the JSON object, no additional text.`,

  generateRemediation: `Generate a remediation plan for the identified root cause.

Root Cause:
{rootCause}

Affected Services:
{services}

Available Skills:
{skills}

Available Runbooks:
{runbooks}

Respond with a JSON object matching this schema:
- steps: Array of remediation steps, each with:
  - action: What to do
  - description: Detailed description
  - command: Optional CLI command
  - rollbackCommand: Optional rollback command
  - riskLevel: "low" | "medium" | "high" | "critical"
  - requiresApproval: boolean
  - matchingSkill: Optional skill that can execute this
  - matchingRunbook: Optional runbook that matches this
- estimatedRecoveryTime: How long until service is restored
- monitoring: Array of things to monitor after remediation

Respond ONLY with the JSON object, no additional text.`,

  analyzeLogs: `Analyze the following logs and extract patterns and anomalies.

Log Lines:
{logs}

Time Range: {startTime} to {endTime}

Respond with a JSON object matching this schema:
- patterns: Array of recurring patterns:
  - pattern: The pattern description
  - count: Number of occurrences
  - severity: "info" | "warning" | "error" | "critical"
  - firstSeen: Timestamp
  - lastSeen: Timestamp
  - examples: Up to 3 example log lines
- anomalies: Array of unusual events:
  - description: What's anomalous
  - timestamp: When it occurred
  - relevance: "high" | "medium" | "low"
- summary: Overall summary
- suggestedHypotheses: Hypotheses suggested by the logs

Respond ONLY with the JSON object, no additional text.`,
};

/**
 * Fill in a prompt template with values
 */
export function fillPrompt(template: string, values: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}
