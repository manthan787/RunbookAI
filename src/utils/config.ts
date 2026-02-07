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
const LLMConfigSchema = z.object({
  provider: z.enum(['anthropic', 'openai']).default('anthropic'),
  model: z.string().default('claude-sonnet-4-20250514'),
  apiKey: z.string().optional(),
});

const AWSConfigSchema = z.object({
  enabled: z.boolean().default(true),
  regions: z.array(z.string()).default(['us-east-1']),
  profile: z.string().optional(),
});

const PagerDutyConfigSchema = z.object({
  enabled: z.boolean().default(false),
  apiKey: z.string().optional(),
});

const SlackConfigSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().optional(),
});

const IncidentConfigSchema = z.object({
  pagerduty: PagerDutyConfigSchema.default({}),
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

  // Check LLM API key
  if (!config.llm.apiKey && !process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    errors.push('No LLM API key configured. Set llm.apiKey or ANTHROPIC_API_KEY environment variable.');
  }

  // Check AWS if enabled
  if (config.providers.aws.enabled) {
    // AWS SDK will use default credential chain, so we don't require explicit config
  }

  // Check PagerDuty if enabled
  if (config.incident.pagerduty.enabled && !config.incident.pagerduty.apiKey) {
    errors.push('PagerDuty enabled but no API key configured.');
  }

  return errors;
}
