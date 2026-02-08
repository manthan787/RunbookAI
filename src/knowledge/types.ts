/**
 * Knowledge System Types
 *
 * Defines the schema for organizational knowledge including runbooks,
 * post-mortems, architecture docs, and known issues.
 */

export type KnowledgeType =
  | 'runbook'
  | 'postmortem'
  | 'architecture'
  | 'ownership'
  | 'known_issue'
  | 'environment'
  | 'playbook'
  | 'faq';

export type SourceType =
  | 'filesystem'
  | 'confluence'
  | 'google_drive'
  | 'notion'
  | 'github'
  | 'pagerduty'
  | 'api';

/**
 * A knowledge document (e.g., a runbook or post-mortem)
 */
export interface KnowledgeDocument {
  id: string;
  source: KnowledgeSource;
  type: KnowledgeType;

  // Content
  title: string;
  content: string;
  chunks: KnowledgeChunk[];

  // Metadata for retrieval
  services: string[];
  tags: string[];
  severityRelevance: Array<'sev1' | 'sev2' | 'sev3'>;
  symptoms?: string[];

  // Temporal
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;

  // Provenance
  author?: string;
  sourceUrl?: string;
  lastValidated?: string;
}

/**
 * A chunk of a knowledge document for embedding/retrieval
 */
export interface KnowledgeChunk {
  id: string;
  documentId: string;
  content: string;
  embedding?: number[];

  // Chunk-level metadata
  sectionTitle?: string;
  chunkType: 'procedure' | 'context' | 'decision' | 'reference' | 'command';
  lineStart?: number;
  lineEnd?: number;
}

/**
 * Configuration for a knowledge source
 */
export interface KnowledgeSource {
  type: SourceType;
  name: string;
  config: KnowledgeSourceConfig;
  syncSchedule?: string;
  lastSyncedAt?: string;
}

export type KnowledgeSourceConfig =
  | FilesystemSourceConfig
  | ConfluenceSourceConfig
  | GoogleDriveSourceConfig
  | NotionSourceConfig
  | GitHubSourceConfig
  | ApiSourceConfig;

export interface FilesystemSourceConfig {
  type: 'filesystem';
  path: string;
  filePatterns: string[];
  watch?: boolean;
}

export interface ConfluenceSourceConfig {
  type: 'confluence';
  baseUrl: string;
  spaceKey: string;
  labels?: string[];
  auth: {
    email: string;
    apiToken: string;
  };
  lastSyncTime?: string;
}

export interface GoogleDriveSourceConfig {
  type: 'google_drive';
  folderIds: string[];
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  mimeTypes?: string[];
  includeSubfolders?: boolean;
  lastSyncTime?: string;
}

export interface NotionSourceConfig {
  type: 'notion';
  databaseId: string;
  filter?: Record<string, unknown>;
  apiKey: string;
}

export interface GitHubSourceConfig {
  type: 'github';
  repo: string;
  branch: string;
  path: string;
  token?: string;
}

export interface ApiSourceConfig {
  type: 'api';
  endpoint: string;
  auth?: {
    type: 'bearer' | 'basic' | 'header';
    value: string;
  };
}

/**
 * Runbook frontmatter schema
 */
export interface RunbookFrontmatter {
  type: 'runbook';
  title?: string;
  services: string[];
  symptoms?: string[];
  severity?: 'sev1' | 'sev2' | 'sev3';
  tags?: string[];
  author?: string;
  lastValidated?: string;
  expiresAt?: string;
}

/**
 * Post-mortem frontmatter schema
 */
export interface PostmortemFrontmatter {
  type: 'postmortem';
  title?: string;
  incidentId: string;
  incidentDate: string;
  services: string[];
  rootCause: string;
  severity: 'sev1' | 'sev2' | 'sev3';
  duration: string;
  author?: string;
  actionItems?: string[];
}

/**
 * Known issue frontmatter schema
 */
export interface KnownIssueFrontmatter {
  type: 'known_issue';
  title?: string;
  services: string[];
  symptoms: string[];
  workaround?: string;
  ticketUrl?: string;
  severity: 'sev1' | 'sev2' | 'sev3';
  discoveredAt: string;
  resolvedAt?: string;
}

/**
 * Service ownership information
 */
export interface ServiceOwnership {
  service: string;
  team: string;
  slackChannel: string;
  pagerdutyServiceId?: string;
  oncallSchedule?: string;
  repository?: string;
  tier: 'critical' | 'high' | 'medium' | 'low';
  sloTarget?: number;
}

/**
 * Service dependency graph
 */
export interface ServiceGraph {
  nodes: ServiceNode[];
  edges: ServiceEdge[];
}

export interface ServiceNode {
  name: string;
  type: 'service' | 'database' | 'cache' | 'queue' | 'external';
  ownership?: ServiceOwnership;
  environments: Record<string, EnvironmentConfig>;
}

export interface EnvironmentConfig {
  cluster?: string;
  replicas?: number;
  resources?: {
    cpu: string;
    memory: string;
  };
  configOverrides?: Record<string, string>;
}

export interface ServiceEdge {
  from: string;
  to: string;
  type: 'calls' | 'publishes' | 'subscribes' | 'reads' | 'writes';
  protocol: 'http' | 'grpc' | 'kafka' | 'sqs' | 'redis' | 'postgres' | 'mysql';
  isCritical: boolean;
}

/**
 * Retrieved knowledge for injection into prompts
 */
export interface RetrievedKnowledge {
  runbooks: RetrievedChunk[];
  postmortems: RetrievedChunk[];
  architecture: RetrievedChunk[];
  knownIssues: RetrievedChunk[];
  ownership?: ServiceOwnership[];
}

export interface RetrievedChunk {
  id: string;
  documentId: string;
  title: string;
  content: string;
  type: KnowledgeType;
  services: string[];
  score: number;
  sourceUrl?: string;
}

/**
 * Knowledge update suggestion (from learning system)
 */
export interface KnowledgeSuggestion {
  type: 'new_runbook' | 'update_runbook' | 'new_known_issue' | 'postmortem_draft';
  confidence: number;
  content: string;
  reasoning: string;
  relatedIncidentId?: string;
  relatedDocumentId?: string;
}
