/**
 * Operability Context provider contract.
 *
 * This contract is intentionally provider-agnostic so RunbookAI can consume
 * context from mature external systems (for example Sourcegraph/checkpoints)
 * without coupling investigation logic to a single backend.
 */

export type ChangeRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type AgentKind = 'claude' | 'codex' | 'cursor' | 'copilot' | 'cline' | 'custom';

export type VerificationSource =
  | 'agent_session'
  | 'git_diff'
  | 'ast'
  | 'ci'
  | 'webhook'
  | 'runtime'
  | 'incident_system'
  | 'manual';

export type OperabilityContextCapability =
  | 'session_ingest'
  | 'service_context'
  | 'incident_context'
  | 'diff_blast_radius'
  | 'operability_gaps'
  | 'similar_incidents'
  | 'rollout_rollback'
  | 'pr_validation'
  | 'claim_fact_reconciliation';

export interface ConfidenceFactor {
  name: string;
  weight: number;
  score: number;
  notes?: string;
}

export interface ConfidenceScore {
  /** 0..1 confidence value */
  value: number;
  rationale?: string;
  factors?: ConfidenceFactor[];
}

export interface ContextProvenance {
  providerId: string;
  source: VerificationSource;
  recordId: string;
  observedAt: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface ChangeSessionReference {
  sessionId: string;
  agent: AgentKind;
  repository: string;
  branch: string;
  baseSha: string;
  headSha?: string;
  startedAt: string;
  actor?: string;
}

export interface AgentChangeClaim {
  session: ChangeSessionReference;
  capturedAt: string;
  checkpointId?: string;
  intentSummary?: string;
  filesTouchedClaimed: string[];
  servicesClaimed: string[];
  riskClaimed?: ChangeRiskLevel;
  rolloutPlanClaimed?: string;
  rollbackPlanClaimed?: string;
  testsRunClaimed: string[];
  unknowns: string[];
  metadata?: Record<string, unknown>;
}

export interface BlastRadius {
  directlyImpactedServices: string[];
  downstreamServices: string[];
  externalDependencies: string[];
  severity: ChangeRiskLevel;
  rationale: string[];
}

export interface OperabilityGap {
  code: string;
  title: string;
  severity: ChangeRiskLevel;
  description: string;
  service?: string;
  file?: string;
  remediationHint?: string;
  provenance?: ContextProvenance[];
}

export interface VerifiedChangeFact {
  changeId: string;
  repository: string;
  branch: string;
  baseSha: string;
  headSha: string;
  verifiedAt: string;
  filesTouchedVerified: string[];
  symbolsTouchedVerified: string[];
  servicesVerified: string[];
  riskVerified: ChangeRiskLevel;
  blastRadius: BlastRadius;
  operabilityGaps: OperabilityGap[];
  rolloutPlanPresent: boolean;
  rollbackPlanPresent: boolean;
  testsRunVerified: string[];
  provenance: ContextProvenance[];
}

export interface ClaimFactDelta {
  filesMissingInClaim: string[];
  filesMissingInFact: string[];
  servicesMissingInClaim: string[];
  servicesMissingInFact: string[];
  testsMissingInClaim: string[];
  testsMissingInFact: string[];
  unknownsNotCovered: string[];
  riskMismatch?: {
    claimed: ChangeRiskLevel;
    verified: ChangeRiskLevel;
  };
  rolloutMismatch: boolean;
  rollbackMismatch: boolean;
}

export interface ReconciledChangeSummary {
  sessionId: string;
  claim: AgentChangeClaim;
  fact: VerifiedChangeFact;
  delta: ClaimFactDelta;
  /** 0..1 trust score derived from claim-vs-fact deltas */
  trustScore: number;
  confidence: ConfidenceScore;
  generatedAt: string;
}

export interface ServiceContextQuery {
  service: string;
  environment?: string;
  at?: string;
  includeRecentChanges?: boolean;
  limit?: number;
}

export interface ServiceContextRecord {
  service: string;
  environment?: string;
  owners: string[];
  repos: string[];
  runbooks: string[];
  alerts: string[];
  dependencies: string[];
  recentChanges: Array<{
    changeId: string;
    summary: string;
    risk: ChangeRiskLevel;
    timestamp: string;
  }>;
  provenance: ContextProvenance[];
}

export interface IncidentContextQuery {
  incidentId: string;
  environment?: string;
  relatedServices?: string[];
}

export interface IncidentContextRecord {
  incidentId: string;
  title?: string;
  services: string[];
  relatedChanges: Array<{
    changeId: string;
    risk: ChangeRiskLevel;
    distanceHours: number;
    summary?: string;
  }>;
  similarIncidents: Array<{
    incidentId: string;
    similarity: number;
    summary: string;
    rootCause?: string;
  }>;
  likelyRunbooks: string[];
  provenance: ContextProvenance[];
}

export interface DiffBlastRadiusQuery {
  repository: string;
  baseSha: string;
  headSha: string;
  files?: string[];
}

export interface DiffBlastRadiusResult {
  changeId: string;
  impactedFiles: string[];
  impactedServices: string[];
  blastRadius: BlastRadius;
  provenance: ContextProvenance[];
}

export interface OperabilityGapsQuery {
  repository: string;
  baseSha: string;
  headSha: string;
  files?: string[];
  services?: string[];
}

export interface OperabilityGapsResult {
  changeId: string;
  score: number;
  gaps: OperabilityGap[];
  provenance: ContextProvenance[];
}

export interface SimilarIncidentsQuery {
  services?: string[];
  errorText?: string;
  limit?: number;
}

export interface SimilarIncidentsResult {
  incidents: Array<{
    incidentId: string;
    summary: string;
    similarity: number;
    rootCause?: string;
    resolvedAt?: string;
  }>;
  provenance: ContextProvenance[];
}

export interface RolloutRollbackQuery {
  repository: string;
  baseSha: string;
  headSha: string;
  services: string[];
  risk?: ChangeRiskLevel;
}

export interface RolloutRollbackSuggestion {
  rolloutPlan: string[];
  rollbackPlan: string[];
  guardrails: string[];
  provenance: ContextProvenance[];
}

export interface PROperabilityValidationQuery {
  repository: string;
  pullRequest: number | string;
  baseSha: string;
  headSha: string;
  agentSessionId?: string;
}

export interface PROperabilityValidationResult {
  changeId: string;
  score: number;
  status: 'pass' | 'warn' | 'fail';
  summary: string;
  gaps: OperabilityGap[];
  trustScore?: number;
  requiredActions: string[];
  provenance: ContextProvenance[];
}

export interface PullRequestIngestEvent {
  repository: string;
  pullRequest: number | string;
  baseSha: string;
  headSha: string;
  branch?: string;
  author?: string;
  openedAt?: string;
  mergedAt?: string;
  filesTouched?: string[];
  metadata?: Record<string, unknown>;
}

export type ProviderHealthStatus = 'healthy' | 'degraded' | 'unavailable';

export interface ProviderHealth {
  status: ProviderHealthStatus;
  checkedAt: string;
  message?: string;
  details?: Record<string, unknown>;
}

export interface ProviderAck {
  accepted: boolean;
  receiptId: string;
  observedAt: string;
  warnings?: string[];
  provenance?: ContextProvenance[];
}

export interface ProviderResult<T> {
  data: T;
  confidence: ConfidenceScore;
  provenance: ContextProvenance[];
}

/**
 * Provider contract implemented by each external operability context adapter.
 */
export interface OperabilityContextProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: OperabilityContextCapability[];

  healthcheck(): Promise<ProviderHealth>;

  ingestChangeSessionStart(input: AgentChangeClaim): Promise<ProviderAck>;
  ingestChangeCheckpoint(input: AgentChangeClaim): Promise<ProviderAck>;
  ingestChangeSessionEnd(input: AgentChangeClaim): Promise<ProviderAck>;
  ingestPullRequestEvent?(input: PullRequestIngestEvent): Promise<ProviderAck>;

  getServiceContext?(query: ServiceContextQuery): Promise<ProviderResult<ServiceContextRecord>>;
  getIncidentContext?(query: IncidentContextQuery): Promise<ProviderResult<IncidentContextRecord>>;
  getDiffBlastRadius?(query: DiffBlastRadiusQuery): Promise<ProviderResult<DiffBlastRadiusResult>>;
  getOperabilityGaps?(query: OperabilityGapsQuery): Promise<ProviderResult<OperabilityGapsResult>>;
  findSimilarIncidents?(
    query: SimilarIncidentsQuery
  ): Promise<ProviderResult<SimilarIncidentsResult>>;
  suggestRolloutRollback?(
    query: RolloutRollbackQuery
  ): Promise<ProviderResult<RolloutRollbackSuggestion>>;
  validatePROperability?(
    query: PROperabilityValidationQuery
  ): Promise<ProviderResult<PROperabilityValidationResult>>;
  reconcileClaimWithFact?(
    claim: AgentChangeClaim,
    fact: VerifiedChangeFact
  ): Promise<ProviderResult<ReconciledChangeSummary>>;
}

export function providerSupportsCapability(
  provider: OperabilityContextProvider,
  capability: OperabilityContextCapability
): boolean {
  return provider.capabilities.includes(capability);
}
