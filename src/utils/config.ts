/**
 * Configuration loading and validation
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/**
 * Configuration schema
 */
// Providers supported by @mariozechner/pi-ai
const LLMConfigSchema = z.object({
  provider: z
    .enum([
      'openai',
      'anthropic',
      'google',
      'mistral',
      'groq',
      'xai',
      'openrouter',
      'bedrock',
      'azure',
      'vertex',
      'cerebras',
      'github',
      'ollama',
    ])
    .default('openai'),
  model: z.string().default('gpt-4o'),
  apiKey: z.string().optional(),
});

const AWSConfigSchema = z.object({
  enabled: z.boolean().default(true),
  regions: z.array(z.string()).default(['us-east-1']),
  profile: z.string().optional(),
});

const KubernetesConfigSchema = z.object({
  enabled: z.boolean().default(false),
  context: z.string().optional(),
  namespace: z.string().optional(),
  kubeconfig: z.string().optional(),
});

const GitHubConfigSchema = z.object({
  enabled: z.boolean().default(false),
  token: z.string().optional(),
  repository: z.string().optional(),
  baseUrl: z.string().default('https://api.github.com'),
  timeoutMs: z.number().int().min(250).max(120000).default(5000),
});

const GitLabConfigSchema = z.object({
  enabled: z.boolean().default(false),
  token: z.string().optional(),
  project: z.string().optional(),
  baseUrl: z.string().default('https://gitlab.com/api/v4'),
  timeoutMs: z.number().int().min(250).max(120000).default(5000),
});

const OperabilityContextConfigSchema = z.object({
  enabled: z.boolean().default(false),
  adapter: z.enum(['none', 'sourcegraph', 'entireio', 'runbook_context', 'custom']).default('none'),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  timeoutMs: z.number().int().min(250).max(120000).default(5000),
  requestHeaders: z.record(z.string()).default({}),
});

const PagerDutyConfigSchema = z.object({
  enabled: z.boolean().default(false),
  apiKey: z.string().optional(),
});

const OpsGenieConfigSchema = z.object({
  enabled: z.boolean().default(false),
  apiKey: z.string().optional(),
});

const SlackConfigSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().optional(),
  appToken: z.string().optional(),
  signingSecret: z.string().optional(),
  defaultChannel: z.string().optional(),
  events: z
    .object({
      enabled: z.boolean().default(false),
      mode: z.enum(['http', 'socket']).default('http'),
      port: z.number().int().min(1).max(65535).default(3001),
      alertChannels: z.array(z.string()).default([]),
      allowedUsers: z.array(z.string()).default([]),
      requireThreadedMentions: z.boolean().default(false),
    })
    .default({}),
});

const IncidentConfigSchema = z.object({
  pagerduty: PagerDutyConfigSchema.default({}),
  opsgenie: OpsGenieConfigSchema.default({}),
  slack: SlackConfigSchema.default({}),
});

const KnowledgeSourceSchema = z.object({
  type: z.enum(['filesystem', 'confluence', 'google_drive', 'notion', 'github', 'api']),
  path: z.string().optional(),
  watch: z.boolean().optional(),
  syncSchedule: z.string().optional(),
  // Additional type-specific fields
  repo: z.string().optional(),
  branch: z.string().optional(),
  spaceKey: z.string().optional(),
  labels: z.array(z.string()).optional(),
  databaseId: z.string().optional(),
  endpoint: z.string().optional(),
  // Confluence fields
  baseUrl: z.string().optional(),
  auth: z
    .object({
      email: z.string(),
      apiToken: z.string(),
    })
    .optional(),
  // Google Drive fields
  folderIds: z.array(z.string()).optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  refreshToken: z.string().optional(),
  mimeTypes: z.array(z.string()).optional(),
  includeSubfolders: z.boolean().optional(),
  lastSyncTime: z.string().optional(),
});

const KnowledgeStoreSchema = z.object({
  type: z.enum(['local', 'pinecone', 'weaviate', 'qdrant']).default('local'),
  path: z.string().default('.runbook/knowledge.db'),
  embeddingModel: z.string().default('text-embedding-3-small'),
});

const KnowledgeRetrievalSchema = z.object({
  topK: z.number().default(10),
  rerank: z.boolean().default(true),
});

const KnowledgeConfigSchema = z.object({
  sources: z.array(KnowledgeSourceSchema).default([]),
  store: KnowledgeStoreSchema.default({}),
  retrieval: KnowledgeRetrievalSchema.default({}),
});

const SafetyConfigSchema = z.object({
  requireApproval: z
    .array(z.enum(['low_risk', 'high_risk', 'low', 'medium', 'high', 'critical']))
    .default(['low_risk', 'high_risk', 'critical']),
  maxMutationsPerSession: z.number().default(10),
  cooldownBetweenCriticalMs: z.number().default(60000),
});

const AgentConfigSchema = z.object({
  maxIterations: z.number().default(10),
  maxHypothesisDepth: z.number().default(4),
  contextThresholdTokens: z.number().default(100000),
});

const ClaudeSessionStorageS3Schema = z.object({
  bucket: z.string().optional(),
  prefix: z.string().default('runbook/hooks/claude'),
  region: z.string().optional(),
  endpoint: z.string().optional(),
  forcePathStyle: z.boolean().default(false),
});

const ClaudeSessionStorageSchema = z.object({
  backend: z.enum(['local', 's3']).default('local'),
  mirrorLocal: z.boolean().default(true),
  localBaseDir: z.string().default('.runbook/hooks/claude'),
  s3: ClaudeSessionStorageS3Schema.default({}),
});

const ClaudeIntegrationSchema = z.object({
  sessionStorage: ClaudeSessionStorageSchema.default({}),
});

const IntegrationsConfigSchema = z.object({
  claude: ClaudeIntegrationSchema.default({}),
});

const ConfigSchema = z.object({
  llm: LLMConfigSchema.default({}),
  providers: z
    .object({
      aws: AWSConfigSchema.default({}),
      kubernetes: KubernetesConfigSchema.default({}),
      github: GitHubConfigSchema.default({}),
      gitlab: GitLabConfigSchema.default({}),
      operabilityContext: OperabilityContextConfigSchema.default({}),
    })
    .default({}),
  incident: IncidentConfigSchema.default({}),
  knowledge: KnowledgeConfigSchema.default({}),
  safety: SafetyConfigSchema.default({}),
  agent: AgentConfigSchema.default({}),
  integrations: IntegrationsConfigSchema.default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: Config = ConfigSchema.parse({});

/**
 * Load configuration from file
 */
export async function loadConfig(configPath?: string): Promise<Config> {
  // Try multiple config locations
  const configLocations = configPath
    ? [configPath]
    : [
        '.runbook/config.yaml',
        '.runbook/config.yml',
        join(process.env.HOME || '', '.runbook/config.yaml'),
        join(process.env.HOME || '', '.runbook/config.yml'),
      ];

  for (const location of configLocations) {
    if (existsSync(location)) {
      try {
        const content = await readFile(location, 'utf-8');
        const parsed = parseYaml(content);
        const config = ConfigSchema.parse(parsed);

        // Resolve environment variables
        return resolveEnvVars(config);
      } catch (error) {
        console.error(`Error loading config from ${location}:`, error);
      }
    }
  }

  return DEFAULT_CONFIG;
}

/**
 * Resolve environment variable references in config
 */
function resolveEnvVars(config: Config): Config {
  const resolved = JSON.parse(JSON.stringify(config));

  // Helper to resolve ${VAR} patterns
  const resolve = (obj: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
        const envVar = value.slice(2, -1);
        obj[key] = process.env[envVar] || '';
      } else if (typeof value === 'object' && value !== null) {
        resolve(value as Record<string, unknown>);
      }
    }
  };

  resolve(resolved);
  return resolved;
}

/**
 * Get a specific config value with dot notation
 */
export function getConfigValue<T>(config: Config, path: string): T | undefined {
  const parts = path.split('.');
  let current: unknown = config;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current as T;
}

/**
 * Validate that required configuration is present
 */
export function validateConfig(config: Config): string[] {
  const errors: string[] = [];

  // Check LLM API key based on provider
  const providerEnvKeys: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    google: 'GOOGLE_API_KEY',
    mistral: 'MISTRAL_API_KEY',
    groq: 'GROQ_API_KEY',
    xai: 'XAI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    azure: 'AZURE_OPENAI_API_KEY',
    cerebras: 'CEREBRAS_API_KEY',
    github: 'GITHUB_TOKEN',
    // These use different auth mechanisms
    bedrock: 'AWS_ACCESS_KEY_ID',
    vertex: 'GOOGLE_APPLICATION_CREDENTIALS',
    ollama: '', // No API key needed
  };

  const envKey = providerEnvKeys[config.llm.provider];
  if (envKey && !config.llm.apiKey && !process.env[envKey]) {
    errors.push(
      `AI model not configured. Run \`runbook init\` to set up your LLM provider, or set the ${envKey} environment variable.`
    );
  }

  // Check AWS if enabled
  if (config.providers.aws.enabled) {
    // AWS SDK will use default credential chain, so we don't require explicit config
  }

  // Check PagerDuty if enabled
  if (config.incident.pagerduty.enabled && !config.incident.pagerduty.apiKey) {
    errors.push('PagerDuty enabled but no API key configured.');
  }

  // Check Operability Context provider wiring if enabled
  if (config.providers.operabilityContext.enabled) {
    const adapter = config.providers.operabilityContext.adapter;
    const baseUrl =
      config.providers.operabilityContext.baseUrl || process.env.RUNBOOK_OPERABILITY_CONTEXT_URL;
    const apiKey =
      config.providers.operabilityContext.apiKey || process.env.RUNBOOK_OPERABILITY_CONTEXT_API_KEY;

    if (adapter === 'none') {
      errors.push(
        'Operability Context is enabled but adapter is "none". Choose sourcegraph, entireio, runbook_context, or custom.'
      );
    }

    if (!baseUrl) {
      errors.push(
        'Operability Context is enabled but no base URL configured. Set providers.operabilityContext.baseUrl or RUNBOOK_OPERABILITY_CONTEXT_URL.'
      );
    }

    if (adapter !== 'custom' && !apiKey) {
      errors.push(
        'Operability Context is enabled but no API key configured. Set providers.operabilityContext.apiKey or RUNBOOK_OPERABILITY_CONTEXT_API_KEY.'
      );
    }
  }

  if (config.providers.github.enabled) {
    const token =
      config.providers.github.token || process.env.RUNBOOK_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
    const repository = config.providers.github.repository || process.env.RUNBOOK_GITHUB_REPOSITORY;

    if (!token) {
      errors.push(
        'GitHub provider is enabled but no token is configured. Set providers.github.token, RUNBOOK_GITHUB_TOKEN, or GITHUB_TOKEN.'
      );
    }
    if (!repository) {
      errors.push(
        'GitHub provider is enabled but no repository is configured. Set providers.github.repository (owner/repo) or RUNBOOK_GITHUB_REPOSITORY.'
      );
    }
  }

  if (config.providers.gitlab.enabled) {
    const token =
      config.providers.gitlab.token || process.env.RUNBOOK_GITLAB_TOKEN || process.env.GITLAB_TOKEN;
    const project = config.providers.gitlab.project || process.env.RUNBOOK_GITLAB_PROJECT;

    if (!token) {
      errors.push(
        'GitLab provider is enabled but no token is configured. Set providers.gitlab.token, RUNBOOK_GITLAB_TOKEN, or GITLAB_TOKEN.'
      );
    }
    if (!project) {
      errors.push(
        'GitLab provider is enabled but no project is configured. Set providers.gitlab.project (project ID or full path) or RUNBOOK_GITLAB_PROJECT.'
      );
    }
  }

  // Check OpsGenie if enabled
  if (config.incident.opsgenie.enabled && !config.incident.opsgenie.apiKey) {
    errors.push('OpsGenie enabled but no API key configured.');
  }

  // Check Slack if enabled
  if (config.incident.slack.enabled && !config.incident.slack.botToken) {
    errors.push('Slack enabled but no bot token configured.');
  }

  // Check Slack events gateway config
  if (config.incident.slack.events.enabled) {
    if (!config.incident.slack.botToken) {
      errors.push('Slack events enabled but no bot token configured.');
    }

    if (config.incident.slack.events.mode === 'http' && !config.incident.slack.signingSecret) {
      errors.push('Slack HTTP events mode enabled but no signing secret configured.');
    }

    if (config.incident.slack.events.mode === 'socket' && !config.incident.slack.appToken) {
      errors.push('Slack Socket Mode enabled but no app token configured.');
    }
  }

  if (
    config.integrations.claude.sessionStorage.backend === 's3' &&
    !config.integrations.claude.sessionStorage.s3.bucket
  ) {
    errors.push('Claude session storage backend is s3 but no bucket is configured.');
  }

  return errors;
}
