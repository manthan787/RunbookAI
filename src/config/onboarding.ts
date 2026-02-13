/**
 * Onboarding Flow
 *
 * Interactive setup wizard to configure Runbook for the user's infrastructure.
 */

import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  ServiceConfig,
  DEFAULT_SERVICE_CONFIG,
  EXAMPLE_CONFIGS,
  type ComputeService,
  type DatabaseService,
  type AWSAccount,
} from './services';

export interface OnboardingAnswers {
  // LLM Provider
  llmProvider?: 'anthropic' | 'openai' | 'ollama';
  llmApiKey?: string;

  // Account setup
  accountSetup: 'single' | 'multi' | 'skip';
  accounts?: AWSAccount[];

  // Compute
  computeServices: Array<
    'ecs' | 'ec2' | 'lambda' | 'eks' | 'fargate' | 'apprunner' | 'amplify' | 'none'
  >;

  // Databases
  databaseServices: Array<'rds' | 'dynamodb' | 'elasticache' | 'documentdb' | 'aurora' | 'none'>;

  // Observability
  useCloudWatch: boolean;
  useKubernetes: boolean;
  logGroups?: string[];

  // Incidents
  incidentProvider: 'pagerduty' | 'opsgenie' | 'none';
  pagerdutyApiKey?: string;

  // Slack gateway
  useSlackGateway?: boolean;
  slackMode?: 'http' | 'socket';
  slackAlertChannels?: string[];
  slackAllowedUsers?: string[];
  slackRequireThreadedMentions?: boolean;
}

/**
 * Generate service config from onboarding answers
 */
export function generateConfig(answers: OnboardingAnswers): ServiceConfig {
  const config: ServiceConfig = {
    ...DEFAULT_SERVICE_CONFIG,
    version: 1,
  };

  // AWS accounts
  if (answers.accountSetup !== 'skip' && answers.accounts) {
    config.aws.accounts = answers.accounts;
    if (answers.accounts.length > 0) {
      config.aws.defaultRegion = answers.accounts[0].regions[0] || 'us-east-1';
    }
  }

  // Compute services
  if (!answers.computeServices.includes('none')) {
    config.compute = answers.computeServices
      .filter((s) => s !== 'none')
      .map((type) => ({ type, enabled: true })) as ComputeService[];
  }

  // Database services
  if (!answers.databaseServices.includes('none')) {
    config.databases = answers.databaseServices
      .filter((s) => s !== 'none')
      .map((type) => ({ type, enabled: true })) as DatabaseService[];
  }

  // Observability
  config.observability.cloudwatch.enabled = answers.useCloudWatch;
  if (answers.logGroups && answers.logGroups.length > 0) {
    config.observability.cloudwatch.logGroups = answers.logGroups;
  }

  // Incidents
  if (answers.incidentProvider === 'pagerduty') {
    config.incidents.pagerduty = {
      enabled: true,
      apiKey: answers.pagerdutyApiKey,
    };
  } else if (answers.incidentProvider === 'opsgenie') {
    config.incidents.opsgenie = { enabled: true };
  }

  return config;
}

/**
 * Save configuration to file
 */
export async function saveConfig(
  config: ServiceConfig,
  configDir: string = '.runbook',
  llmConfig?: { provider: string; apiKey?: string },
  options?: {
    enableKubernetes?: boolean;
    enableSlackGateway?: boolean;
    slackMode?: 'http' | 'socket';
    slackAlertChannels?: string[];
    slackAllowedUsers?: string[];
    slackRequireThreadedMentions?: boolean;
  }
): Promise<string> {
  // Ensure directory exists
  if (!existsSync(configDir)) {
    await mkdir(configDir, { recursive: true });
  }

  const configPath = join(configDir, 'services.yaml');
  const yaml = stringifyYaml(config, { indent: 2 });

  await writeFile(configPath, yaml, 'utf-8');

  // Also save main config.yaml with LLM and AWS settings
  const mainConfigPath = join(configDir, 'config.yaml');

  // Use models supported by pi-ai
  const llmModel =
    llmConfig?.provider === 'anthropic'
      ? 'claude-sonnet-4-20250514'
      : llmConfig?.provider === 'openai'
        ? 'gpt-4o'
        : 'llama3.1';

  // Get regions from the service config
  const regions = config.aws.accounts?.[0]?.regions || ['us-east-1'];
  const hasEksService = config.compute.some((service) => service.type === 'eks' && service.enabled);
  const kubernetesEnabled = options?.enableKubernetes ?? hasEksService;
  const slackGatewayEnabled = options?.enableSlackGateway ?? false;
  const slackMode = options?.slackMode ?? 'socket';
  const slackAlertChannels = options?.slackAlertChannels ?? [];
  const slackAllowedUsers = options?.slackAllowedUsers ?? [];
  const slackRequireThreadedMentions = options?.slackRequireThreadedMentions ?? false;
  const pagerdutyEnabled = !!config.incidents.pagerduty.enabled;
  const opsgenieEnabled = !!config.incidents.opsgenie.enabled;

  // Use camelCase to match the config schema
  const mainConfig: Record<string, unknown> = {
    llm: llmConfig
      ? {
          provider: llmConfig.provider,
          model: llmModel,
          apiKey: llmConfig.apiKey || undefined,
        }
      : {
          provider: 'openai',
          model: 'gpt-4o',
        },
    providers: {
      aws: {
        enabled: true,
        regions: regions,
      },
      kubernetes: {
        enabled: kubernetesEnabled,
      },
      operabilityContext: {
        enabled: false,
        adapter: 'none',
      },
    },
    incident: {
      pagerduty: {
        enabled: pagerdutyEnabled,
        apiKey: pagerdutyEnabled ? '${PAGERDUTY_API_KEY}' : undefined,
      },
      opsgenie: {
        enabled: opsgenieEnabled,
        apiKey: opsgenieEnabled ? '${OPSGENIE_API_KEY}' : undefined,
      },
      slack: {
        enabled: slackGatewayEnabled,
        botToken: slackGatewayEnabled ? '${SLACK_BOT_TOKEN}' : undefined,
        appToken: slackGatewayEnabled && slackMode === 'socket' ? '${SLACK_APP_TOKEN}' : undefined,
        signingSecret:
          slackGatewayEnabled && slackMode === 'http' ? '${SLACK_SIGNING_SECRET}' : undefined,
        events: {
          enabled: slackGatewayEnabled,
          mode: slackMode,
          port: 3001,
          alertChannels: slackAlertChannels,
          allowedUsers: slackAllowedUsers,
          requireThreadedMentions: slackRequireThreadedMentions,
        },
      },
    },
    agent: {
      maxIterations: 10,
      maxHypothesisDepth: 4,
      contextThresholdTokens: 100000,
    },
    safety: {
      requireApproval: ['high_risk', 'critical'],
      maxMutationsPerSession: 5,
      cooldownBetweenCriticalMs: 60000,
    },
  };

  // Remove apiKey if not provided (will fall back to env var)
  if (llmConfig && !llmConfig.apiKey) {
    delete (mainConfig.llm as Record<string, unknown>).apiKey;
  }

  const mainYaml = stringifyYaml(mainConfig, { indent: 2 });
  await writeFile(mainConfigPath, mainYaml, 'utf-8');

  return configPath;
}

/**
 * Load configuration from file
 */
export async function loadServiceConfig(
  configDir: string = '.runbook'
): Promise<ServiceConfig | null> {
  const configPath = join(configDir, 'services.yaml');

  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const { readFile } = await import('fs/promises');
    const content = await readFile(configPath, 'utf-8');
    const parsed = parseYaml(content);
    return parsed as ServiceConfig;
  } catch {
    return null;
  }
}

/**
 * Quick setup from template
 */
export async function quickSetup(
  template: 'ecs-rds' | 'serverless' | 'enterprise',
  regions: string[] = ['us-east-1'],
  configDir: string = '.runbook'
): Promise<string> {
  let config: ServiceConfig;

  switch (template) {
    case 'ecs-rds':
      config = { ...EXAMPLE_CONFIGS.ecsRds };
      break;
    case 'serverless':
      config = { ...EXAMPLE_CONFIGS.serverless };
      break;
    case 'enterprise':
      config = { ...EXAMPLE_CONFIGS.enterprise };
      break;
    default:
      config = DEFAULT_SERVICE_CONFIG;
  }

  // Apply regions
  if (config.aws.accounts.length > 0) {
    config.aws.accounts[0].regions = regions;
  } else {
    config.aws.accounts = [{ name: 'default', regions, isDefault: true }];
  }
  config.aws.defaultRegion = regions[0];

  return saveConfig(config, configDir);
}

/**
 * Generate onboarding prompts for CLI
 */
export const ONBOARDING_PROMPTS = {
  welcome: `
Welcome to Runbook! Let's configure your infrastructure.

This wizard will help you set up:
• AWS accounts and regions
• Compute services (ECS, Lambda, EC2, etc.)
• Databases (RDS, DynamoDB, ElastiCache, etc.)
• Observability (CloudWatch, Datadog)
• Incident management (PagerDuty, OpsGenie)
• Slack gateway for @runbookAI alert-channel mentions
`,

  accountSetup: {
    question: 'How are your AWS accounts organized?',
    options: [
      { value: 'single', label: 'Single account', description: 'All resources in one AWS account' },
      {
        value: 'multi',
        label: 'Multiple accounts',
        description: 'Separate accounts for prod/staging/dev',
      },
      { value: 'skip', label: 'Skip for now', description: 'Configure manually later' },
    ],
  },

  computeServices: {
    question: 'Which compute services do you use?',
    options: [
      { value: 'ecs', label: 'ECS', description: 'Elastic Container Service' },
      { value: 'lambda', label: 'Lambda', description: 'Serverless functions' },
      { value: 'ec2', label: 'EC2', description: 'Virtual machines' },
      { value: 'eks', label: 'EKS', description: 'Kubernetes' },
      { value: 'fargate', label: 'Fargate', description: 'Serverless containers' },
      { value: 'apprunner', label: 'App Runner', description: 'Managed containers' },
      { value: 'amplify', label: 'Amplify', description: 'Full-stack web apps' },
      { value: 'none', label: 'None / Other', description: 'Skip compute configuration' },
    ],
    multiSelect: true,
  },

  databaseServices: {
    question: 'Which database services do you use?',
    options: [
      { value: 'rds', label: 'RDS', description: 'Relational databases (MySQL, Postgres, etc.)' },
      { value: 'aurora', label: 'Aurora', description: 'Aurora MySQL/PostgreSQL' },
      { value: 'dynamodb', label: 'DynamoDB', description: 'NoSQL key-value' },
      { value: 'elasticache', label: 'ElastiCache', description: 'Redis/Memcached' },
      { value: 'documentdb', label: 'DocumentDB', description: 'MongoDB-compatible' },
      { value: 'none', label: 'None / Other', description: 'Skip database configuration' },
    ],
    multiSelect: true,
  },

  observability: {
    question: 'Do you use CloudWatch for logs and metrics?',
    options: [
      { value: true, label: 'Yes', description: 'Enable CloudWatch integration' },
      { value: false, label: 'No', description: 'Skip CloudWatch' },
    ],
  },

  kubernetes: {
    question: 'Is Kubernetes part of your production stack?',
    options: [
      { value: true, label: 'Yes', description: 'Enable Kubernetes tools in agent runtime' },
      { value: false, label: 'No', description: 'Do not load Kubernetes tools' },
    ],
  },

  slackGateway: {
    question: 'Enable Slack alert-channel gateway for @runbookAI mentions?',
    options: [
      { value: true, label: 'Yes', description: 'Enable Slack events gateway and mention routing' },
      { value: false, label: 'No', description: 'Skip Slack gateway setup for now' },
    ],
  },

  slackMode: {
    question: 'Which Slack gateway mode do you want?',
    options: [
      {
        value: 'socket',
        label: 'Socket Mode',
        description: 'Best for local development; no public URL required',
      },
      {
        value: 'http',
        label: 'HTTP Events API',
        description: 'Use public Slack Request URL + signing secret',
      },
    ],
  },

  incidentProvider: {
    question: 'Which incident management platform do you use?',
    options: [
      { value: 'pagerduty', label: 'PagerDuty', description: 'Connect to PagerDuty incidents' },
      { value: 'opsgenie', label: 'OpsGenie', description: 'Connect to OpsGenie alerts' },
      { value: 'none', label: 'None', description: 'Skip incident management' },
    ],
  },

  complete: `
Configuration complete! Your settings have been saved to .runbook/services.yaml

You can edit this file directly or run 'runbook config' to modify settings.

Next steps:
• Run 'runbook ask "what's running in prod"' to test your setup
• Add runbooks to .runbook/runbooks/
• Set up knowledge sync with 'runbook knowledge sync'
`,
};
