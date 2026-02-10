/**
 * Core types for the Runbook agent
 */

// Event types emitted by the agent during execution
export type AgentEvent =
  | ThinkingEvent
  | ToolStartEvent
  | ToolProgressEvent
  | ToolEndEvent
  | ToolErrorEvent
  | ToolLimitEvent
  | HypothesisFormedEvent
  | HypothesisPrunedEvent
  | HypothesisConfirmedEvent
  | EvidenceGatheredEvent
  | ContextClearedEvent
  | KnowledgeRetrievedEvent
  | AnswerStartEvent
  | DoneEvent;

export interface ThinkingEvent {
  type: 'thinking';
  content: string;
}

export interface ToolStartEvent {
  type: 'tool_start';
  tool: string;
  args: Record<string, unknown>;
}

export interface ToolProgressEvent {
  type: 'tool_progress';
  tool: string;
  message: string;
}

export interface ToolEndEvent {
  type: 'tool_end';
  tool: string;
  result: unknown;
  durationMs: number;
}

export interface ToolErrorEvent {
  type: 'tool_error';
  tool: string;
  error: string;
}

export interface ToolLimitEvent {
  type: 'tool_limit';
  tool: string;
  warning: string;
}

export interface HypothesisFormedEvent {
  type: 'hypothesis_formed';
  hypothesisId: string;
  statement: string;
  parentId: string | null;
  depth: number;
}

export interface HypothesisPrunedEvent {
  type: 'hypothesis_pruned';
  hypothesisId: string;
  reason: string;
}

export interface HypothesisConfirmedEvent {
  type: 'hypothesis_confirmed';
  hypothesisId: string;
  rootCause: string;
  confidence: ConfidenceLevel;
}

export interface EvidenceGatheredEvent {
  type: 'evidence_gathered';
  hypothesisId: string;
  query: string;
  strength: EvidenceStrength;
  reasoning: string;
}

export interface ContextClearedEvent {
  type: 'context_cleared';
  clearedCount: number;
  keptCount: number;
}

export interface KnowledgeRetrievedEvent {
  type: 'knowledge_retrieved';
  documentCount: number;
  types: string[];
}

export interface AnswerStartEvent {
  type: 'answer_start';
}

export interface DoneEvent {
  type: 'done';
  answer: string;
  investigationId?: string;
}

// Evidence and confidence types
export type EvidenceStrength = 'strong' | 'weak' | 'none' | 'contradicting' | 'pending';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

// Hypothesis tree types
export interface Hypothesis {
  id: string;
  parentId: string | null;
  depth: number;
  statement: string;
  evidenceQuery: string | null;
  evidenceStrength: EvidenceStrength;
  evidenceData: unknown;
  reasoning: string | null;
  children: Hypothesis[];
  status: 'active' | 'pruned' | 'confirmed';
  createdAt: string;
}

export interface InvestigationContext {
  query?: string;
  incidentId?: string;
  services: string[];
  symptoms: string[];
  errorMessages: string[];
  currentHypothesis?: string;
  timeWindow: {
    start: string;
    end: string;
  };
}

// Tool types
export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
}

export interface ToolParameterProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolParameterProperty;
  properties?: Record<string, ToolParameterProperty>;
  required?: string[];
}

// Scratchpad entry types
export type ScratchpadEntry =
  | InitEntry
  | ToolResultEntry
  | ThinkingEntry
  | HypothesisEntry
  | EvidenceEntry
  | RemediationEntry;

export interface InitEntry {
  type: 'init';
  query: string;
  incidentId?: string;
  timestamp: string;
}

export interface ToolResultEntry {
  type: 'tool_result';
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  durationMs: number;
  timestamp: string;
}

export interface ThinkingEntry {
  type: 'thinking';
  content: string;
  timestamp: string;
}

export interface HypothesisEntry {
  type: 'hypothesis_formed' | 'hypothesis_pruned' | 'hypothesis_confirmed';
  hypothesisId: string;
  statement?: string;
  parentId?: string | null;
  depth?: number;
  reason?: string;
  rootCause?: string;
  confidence?: ConfidenceLevel;
  timestamp: string;
}

export interface EvidenceEntry {
  type: 'evidence_gathered';
  hypothesisId: string;
  query: string;
  data: unknown;
  strength: EvidenceStrength;
  reasoning: string;
  timestamp: string;
}

export interface RemediationEntry {
  type: 'remediation_suggested' | 'remediation_approved' | 'remediation_executed';
  action: string;
  command?: string;
  approvedBy?: string;
  result?: unknown;
  timestamp: string;
}

// Agent configuration
export interface AgentConfig {
  maxIterations: number;
  maxHypothesisDepth: number;
  contextThresholdTokens: number;
  keepToolUses: number;
  toolLimits: Record<string, number>;
}

// Provider types
export interface CloudProvider {
  name: string;
  isConfigured(): Promise<boolean>;
  getTools(): Tool[];
}

// Knowledge types (simplified, full version in knowledge/types.ts)
export interface RetrievedKnowledge {
  runbooks: KnowledgeChunk[];
  postmortems: KnowledgeChunk[];
  architecture: KnowledgeChunk[];
  knownIssues: KnowledgeChunk[];
}

export interface KnowledgeChunk {
  id: string;
  documentId: string;
  title: string;
  content: string;
  type: string;
  services: string[];
  score: number;
  sourceUrl?: string;
}
