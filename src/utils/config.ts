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
  provider: z.enum([
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
  ]).default('openai'),
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
  type: z.enum(['filesystem', 'confluence', 'notion', 'github', 'api']),
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
    .array(z.enum(['low_risk', 'high_risk', 'critical']))
    .default(['low_risk', 'high_risk', 'critical']),
  maxMutationsPerSession: z.number().default(10),
  cooldownBetweenCriticalMs: z.number().default(60000),
});

const AgentConfigSchema = z.object({
  maxIterations: z.number().default(10),
  maxHypothesisDepth: z.number().default(4),
  contextThresholdTokens: z.number().default(100000),
});

const ConfigSchema = z.object({
  llm: LLMConfigSchema.default({}),
  providers: z
    .object({
      aws: AWSConfigSchema.default({}),
      kubernetes: KubernetesConfigSchema.default({}),
    })
    .default({}),
  incident: IncidentConfigSchema.default({}),
  knowledge: KnowledgeConfigSchema.default({}),
  safety: SafetyConfigSchema.default({}),
  agent: AgentConfigSchema.default({}),
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
    errors.push(`AI model not configured. Run \`runbook init\` to set up your LLM provider, or set the ${envKey} environment variable.`);
  }

  // Check AWS if enabled
  if (config.providers.aws.enabled) {
    // AWS SDK will use default credential chain, so we don't require explicit config
  }

  // Check PagerDuty if enabled
  if (config.incident.pagerduty.enabled && !config.incident.pagerduty.apiKey) {
    errors.push('PagerDuty enabled but no API key configured.');
  }

  // Check OpsGenie if enabled
  if (config.incident.opsgenie.enabled && !config.incident.opsgenie.apiKey) {
    errors.push('OpsGenie enabled but no API key configured.');
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

  return errors;
}
