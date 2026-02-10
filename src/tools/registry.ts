/**
 * Tool Registry
 *
 * Central registry for all available tools. Tools are organized by category
 * and can be selectively enabled based on configuration.
 */

import type { Tool } from '../agent/types';
import { getActiveAlarms, filterLogEvents } from './aws/cloudwatch';
import {
  getIncident,
  getIncidentAlerts,
  listIncidents,
  addIncidentNote,
} from './incident/pagerduty';
import {
  isSlackConfigured,
  postMessage,
  postInvestigationUpdate,
  postRootCauseIdentified,
  getChannelMessages,
  findChannel,
} from './incident/slack';
import {
  isOpsGenieConfigured,
  getAlert as getOpsGenieAlert,
  listAlerts as listOpsGenieAlerts,
  getIncident as getOpsGenieIncident,
  listIncidents as listOpsGenieIncidents,
  addAlertNote as addOpsGenieAlertNote,
  acknowledgeAlert as acknowledgeOpsGenieAlert,
  closeAlert as closeOpsGenieAlert,
} from './incident/opsgenie';
import {
  queryMetrics,
  searchLogs,
  searchTraces,
  getTriggeredMonitors,
  getEvents,
  getDatadogSummary,
  isDatadogConfigured,
} from './observability/datadog';
import {
  isPrometheusConfigured,
  instantQuery,
  rangeQuery,
  getFiringAlerts,
  getTargetHealth,
  getQuickHealthCheck,
  COMMON_QUERIES,
} from './observability/prometheus';
import { createRetriever } from '../knowledge/retriever';
import {
  AWS_SERVICES,
  getServiceById,
  getAllServiceIds,
  CATEGORY_DESCRIPTIONS,
} from '../providers/aws/services';
import { executeMultiServiceQuery, getInstalledServices } from '../providers/aws/executor';
import {
  classifyRisk,
  requestApprovalWithOptions,
  generateMutationId,
  checkCooldown,
  checkMutationLimit,
  recordApprovedMutation,
  normalizeApprovalRiskLevels,
  type MutationRequest,
  type RiskLevel,
  type ApprovalPolicyRisk,
} from '../agent/approval';
import { loadConfig } from '../utils/config';
import { createKubernetesClient } from '../providers/kubernetes/client';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Cached config for getting default regions
let cachedDefaultRegion: string | null = null;
const ALL_RISK_LEVELS: RiskLevel[] = ['low', 'medium', 'high', 'critical'];

async function getDefaultRegion(): Promise<string> {
  if (cachedDefaultRegion) return cachedDefaultRegion;
  try {
    const config = await loadConfig();
    cachedDefaultRegion = config.providers.aws.regions[0] || 'us-east-1';
  } catch {
    cachedDefaultRegion = 'us-east-1';
  }
  return cachedDefaultRegion;
}

async function getSafetySettings() {
  const config = await loadConfig();
  const requiredApprovalRisks = normalizeApprovalRiskLevels(
    config.safety.requireApproval as ApprovalPolicyRisk[]
  );
  const autoApproveRisks = ALL_RISK_LEVELS.filter((risk) => !requiredApprovalRisks.includes(risk));

  return {
    config,
    autoApproveRisks,
  };
}

export interface ToolCategory {
  name: string;
  description: string;
  tools: Tool[];
}

class ToolRegistry {
  private categories: Map<string, ToolCategory> = new Map();
  private allTools: Map<string, Tool> = new Map();

  /**
   * Register a tool in a category
   */
  register(categoryName: string, tool: Tool): void {
    // Add to category
    let category = this.categories.get(categoryName);
    if (!category) {
      category = {
        name: categoryName,
        description: '',
        tools: [],
      };
      this.categories.set(categoryName, category);
    }
    category.tools.push(tool);

    // Add to global map
    this.allTools.set(tool.name, tool);
  }

  /**
   * Register multiple tools in a category
   */
  registerCategory(name: string, description: string, tools: Tool[]): void {
    this.categories.set(name, { name, description, tools });
    for (const tool of tools) {
      this.allTools.set(tool.name, tool);
    }
  }

  /**
   * Get a tool by name
   */
  get(name: string): Tool | undefined {
    return this.allTools.get(name);
  }

  /**
   * Get all tools
   */
  getAll(): Tool[] {
    return Array.from(this.allTools.values());
  }

  /**
   * Get tools by category
   */
  getByCategory(categoryName: string): Tool[] {
    return this.categories.get(categoryName)?.tools || [];
  }

  /**
   * Get all categories
   */
  getCategories(): ToolCategory[] {
    return Array.from(this.categories.values());
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.allTools.has(name);
  }

  /**
   * Get tools filtered by enabled providers
   */
  getEnabled(enabledCategories: string[]): Tool[] {
    const tools: Tool[] = [];
    for (const category of enabledCategories) {
      const categoryTools = this.getByCategory(category);
      tools.push(...categoryTools);
    }
    return tools;
  }
}

// Singleton instance
export const toolRegistry = new ToolRegistry();

/**
 * Helper to create a tool definition
 */
export function defineTool(
  name: string,
  description: string,
  parameters: Tool['parameters'],
  execute: Tool['execute']
): Tool {
  return { name, description, parameters, execute };
}

// Build dynamic service list for description
const serviceList = getAllServiceIds().join(', ');
const categoryList = Object.entries(CATEGORY_DESCRIPTIONS)
  .map(([k, v]) => `  ${k}: ${v}`)
  .join('\n');

interface AwsCliFallbackSpec {
  serviceId: string;
  cliService: string;
  cliOperation: string;
  buildArgs: (region: string, limit: number) => string[];
  resultPath: string;
  idField?: string;
  nameField?: string;
  statusField?: string;
}

const AWS_CLI_FALLBACK_SPECS: AwsCliFallbackSpec[] = [
  {
    serviceId: 'elb',
    cliService: 'elbv2',
    cliOperation: 'describe-load-balancers',
    buildArgs: (region) => ['--region', region],
    resultPath: 'LoadBalancers',
    idField: 'LoadBalancerArn',
    nameField: 'LoadBalancerName',
    statusField: 'State.Code',
  },
  {
    serviceId: 'apigateway',
    cliService: 'apigateway',
    cliOperation: 'get-rest-apis',
    buildArgs: (region, limit) => ['--region', region, '--limit', String(limit)],
    resultPath: 'items',
    idField: 'id',
    nameField: 'name',
  },
  {
    serviceId: 'apigwv2',
    cliService: 'apigatewayv2',
    cliOperation: 'get-apis',
    buildArgs: (region, limit) => ['--region', region, '--max-results', String(limit)],
    resultPath: 'Items',
    idField: 'ApiId',
    nameField: 'Name',
  },
  {
    serviceId: 'ecr',
    cliService: 'ecr',
    cliOperation: 'describe-repositories',
    buildArgs: (region, limit) => ['--region', region, '--max-items', String(limit)],
    resultPath: 'repositories',
    idField: 'repositoryArn',
    nameField: 'repositoryName',
  },
  {
    serviceId: 'secretsmanager',
    cliService: 'secretsmanager',
    cliOperation: 'list-secrets',
    buildArgs: (region, limit) => [
      '--region',
      region,
      '--max-results',
      String(Math.min(limit, 100)),
    ],
    resultPath: 'SecretList',
    idField: 'ARN',
    nameField: 'Name',
  },
  {
    serviceId: 'sqs',
    cliService: 'sqs',
    cliOperation: 'list-queues',
    buildArgs: (region) => ['--region', region],
    resultPath: 'QueueUrls',
    idField: '',
  },
];

function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function normalizeAwsCliResource(item: unknown, spec: AwsCliFallbackSpec): Record<string, unknown> {
  if (typeof item === 'string') {
    return { id: item };
  }
  if (typeof item !== 'object' || item === null) {
    return { id: String(item) };
  }

  const obj = item as Record<string, unknown>;
  const id = spec.idField ? getNestedValue(obj, spec.idField) : undefined;
  const resource: Record<string, unknown> = {
    id: id || JSON.stringify(item),
  };

  if (spec.nameField) {
    const name = getNestedValue(obj, spec.nameField);
    if (name !== undefined) resource.name = name;
  }
  if (spec.statusField) {
    const status = getNestedValue(obj, spec.statusField);
    if (status !== undefined) resource.status = status;
  }

  // Keep original payload available for deeper answers.
  resource.raw = obj;
  return resource;
}

async function runAwsCliFallback(
  serviceId: string,
  region: string,
  limit: number
): Promise<{
  source: 'aws_cli_fallback';
  command: string;
  resources: Array<Record<string, unknown>>;
  count: number;
} | null> {
  const spec = AWS_CLI_FALLBACK_SPECS.find((entry) => entry.serviceId === serviceId);
  if (!spec) return null;

  const args = [
    spec.cliService,
    spec.cliOperation,
    ...spec.buildArgs(region, limit),
    '--output',
    'json',
  ];

  const { stdout } = await execFileAsync('aws', args, {
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  const parsed = JSON.parse(stdout) as Record<string, unknown>;
  const rawResults = getNestedValue(parsed, spec.resultPath);
  const resultArray = Array.isArray(rawResults) ? rawResults : [];
  const resources = resultArray.slice(0, limit).map((item) => normalizeAwsCliResource(item, spec));

  return {
    source: 'aws_cli_fallback',
    command: `aws ${args.join(' ')}`,
    resources,
    count: resources.length,
  };
}

/**
 * AWS Query Tool - Dynamic meta-router for read-only AWS operations
 * Supports 40+ AWS services dynamically loaded from service definitions
 */
export const awsQueryTool = defineTool(
  'aws_query',
  `Query AWS infrastructure state. Supports 40+ AWS services dynamically.

   Supported services: ${serviceList}

   Categories:
${categoryList}

   Use for:
   - "What EC2 instances are running?"
   - "Show me all S3 buckets"
   - "List Lambda functions"
   - "What load balancers exist?"
   - "Show me all secrets in Secrets Manager"

   Do NOT use for mutations - use aws_mutate instead.`,
  {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language query about AWS infrastructure',
      },
      services: {
        type: 'array',
        description: `Services to query. Options: ${serviceList}, or 'all' for everything`,
        items: { type: 'string' },
      },
      category: {
        type: 'string',
        description: 'Query all services in a category',
        enum: [
          'compute',
          'database',
          'storage',
          'networking',
          'security',
          'analytics',
          'integration',
          'devtools',
          'ml',
          'management',
        ],
      },
      region: {
        type: 'string',
        description: 'AWS region (uses configured default if not specified)',
      },
      account: {
        type: 'string',
        description: 'AWS account name (from service config, defaults to default account)',
      },
      limit: {
        type: 'number',
        description: 'Max resources per service (default: 100)',
      },
    },
    required: ['query'],
  },
  async (args) => {
    const defaultRegion = await getDefaultRegion();
    const region = (args.region as string | undefined) || defaultRegion;
    const accountName = args.account as string | undefined;
    const limit = (args.limit as number) || 100;
    const requestedServices = args.services as string[] | undefined;
    const category = args.category as string | undefined;

    try {
      // Determine which services to query
      let servicesToQuery = AWS_SERVICES;

      if (requestedServices && requestedServices.length > 0) {
        if (requestedServices.includes('all')) {
          // Query all services - but limit to installed ones
          servicesToQuery = await getInstalledServices(AWS_SERVICES);
        } else {
          // Query specific services
          servicesToQuery = requestedServices
            .map((id) => getServiceById(id))
            .filter((s): s is NonNullable<typeof s> => s !== undefined);
        }
      } else if (category) {
        // Query by category
        servicesToQuery = AWS_SERVICES.filter((s) => s.category === category);
      } else {
        // Default: query commonly used services
        const defaultServices = ['ec2', 'ecs', 'lambda', 'rds', 's3', 'dynamodb'];
        servicesToQuery = defaultServices
          .map((id) => getServiceById(id))
          .filter((s): s is NonNullable<typeof s> => s !== undefined);
      }

      // Execute queries in parallel
      const results = await executeMultiServiceQuery(servicesToQuery, {
        accountName,
        region,
        limit,
      });

      // Format output
      const output: Record<string, unknown> = {};
      let totalResources = 0;
      const errors: string[] = [];
      const fallbacks: Array<{ service: string; source: string; command: string }> = [];

      for (const [serviceId, result] of Object.entries(results)) {
        if (result.error) {
          if (result.error.includes('Failed to import')) {
            try {
              const fallbackResult = await runAwsCliFallback(serviceId, region, limit);
              if (fallbackResult) {
                output[serviceId] = {
                  count: fallbackResult.count,
                  resources: fallbackResult.resources,
                  source: fallbackResult.source,
                };
                totalResources += fallbackResult.count;
                fallbacks.push({
                  service: serviceId,
                  source: fallbackResult.source,
                  command: fallbackResult.command,
                });
                continue;
              }
            } catch (fallbackError) {
              errors.push(
                `${serviceId}: SDK unavailable and aws_cli fallback failed: ${
                  fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
                }`
              );
              continue;
            }
          }

          errors.push(`${serviceId}: ${result.error}`);
        } else if (result.count > 0) {
          output[serviceId] = {
            count: result.count,
            resources: result.resources,
          };
          totalResources += result.count;
        }
      }

      return {
        totalResources,
        servicesQueried: Object.keys(results).length,
        results: output,
        errors: errors.length > 0 ? errors : undefined,
        fallbacks: fallbacks.length > 0 ? fallbacks : undefined,
        _meta: {
          region: region,
          account: accountName || 'default',
        },
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown error querying AWS',
        hint: 'Make sure AWS credentials are configured and SDK packages are installed',
      };
    }
  }
);

/**
 * AWS Mutate Tool - State-changing AWS operations (requires approval)
 */
export const awsMutateTool = defineTool(
  'aws_mutate',
  `Execute state-changing AWS operations. Requires explicit approval.

   Use for:
   - Scaling services (ecs:UpdateService, lambda:UpdateFunctionConfiguration)
   - Updating deployments
   - Restarting instances (ec2:RebootInstances)
   - Modifying configurations

   Always provide rollback instructions.`,
  {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        description: 'The AWS operation to perform (e.g., ecs:UpdateService, ec2:RebootInstances)',
      },
      resource: {
        type: 'string',
        description: 'The resource identifier being modified (e.g., service name, instance ID)',
      },
      parameters: {
        type: 'object',
        description: 'Parameters for the operation',
      },
      description: {
        type: 'string',
        description: 'Human-readable description of what this change does',
      },
      rollbackCommand: {
        type: 'string',
        description: 'Command or instructions to rollback this change',
      },
      estimatedImpact: {
        type: 'string',
        description: 'Estimated impact of this operation (e.g., "5 min downtime")',
      },
    },
    required: ['operation', 'resource', 'parameters', 'description'],
  },
  async (args) => {
    const operation = args.operation as string;
    const resource = args.resource as string;
    const parameters = args.parameters as Record<string, unknown>;
    const description = args.description as string;
    const rollbackCommand = args.rollbackCommand as string | undefined;
    const estimatedImpact = args.estimatedImpact as string | undefined;
    const { config, autoApproveRisks } = await getSafetySettings();

    // Classify risk level
    const riskLevel = classifyRisk(operation, resource);

    // Check mutation budget
    const limit = checkMutationLimit(config.safety.maxMutationsPerSession);
    if (!limit.allowed) {
      return {
        status: 'blocked',
        reason: `Session mutation limit reached (${config.safety.maxMutationsPerSession}).`,
        riskLevel,
      };
    }

    // Check cooldown for critical operations
    if (riskLevel === 'critical') {
      const cooldown = checkCooldown(operation, config.safety.cooldownBetweenCriticalMs);
      if (!cooldown.allowed) {
        const remainingSecs = Math.ceil(cooldown.remainingMs / 1000);
        return {
          status: 'blocked',
          reason: `Cooldown active. Please wait ${remainingSecs} seconds before another critical operation.`,
          riskLevel,
        };
      }
    }

    // Create mutation request
    const request: MutationRequest = {
      id: generateMutationId(),
      operation,
      resource,
      description,
      riskLevel,
      parameters,
      rollbackCommand,
      estimatedImpact,
    };

    // Request approval based on configured safety policy
    const approval = await requestApprovalWithOptions(request, {
      useSlack: config.incident.slack.enabled,
      autoApprove: autoApproveRisks,
    });

    if (!approval.approved) {
      return {
        status: 'rejected',
        reason: 'Operation rejected by user',
        mutationId: request.id,
        riskLevel,
      };
    }

    // Record mutation for policy tracking
    recordApprovedMutation(riskLevel);

    // Execute the operation
    try {
      const result = await executeAwsMutation(operation, resource, parameters);
      return {
        status: 'success',
        mutationId: request.id,
        operation,
        resource,
        result,
        approvedAt: approval.approvedAt?.toISOString(),
        rollbackCommand,
      };
    } catch (error) {
      return {
        status: 'error',
        mutationId: request.id,
        operation,
        resource,
        error: error instanceof Error ? error.message : 'Unknown error',
        rollbackCommand,
      };
    }
  }
);

/**
 * Execute an AWS mutation operation
 */
async function executeAwsMutation(
  operation: string,
  resource: string,
  parameters: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const [service, action] = operation.split(':');

  switch (service.toLowerCase()) {
    case 'ecs': {
      const { ECSClient, UpdateServiceCommand } = await import('@aws-sdk/client-ecs');
      const client = new ECSClient({ region: (parameters.region as string) || 'us-east-1' });

      if (action === 'UpdateService') {
        const command = new UpdateServiceCommand({
          cluster: parameters.cluster as string,
          service: resource,
          desiredCount: parameters.desiredCount as number | undefined,
          forceNewDeployment: parameters.forceNewDeployment as boolean | undefined,
        });
        const response = await client.send(command);
        return {
          serviceName: response.service?.serviceName,
          desiredCount: response.service?.desiredCount,
          runningCount: response.service?.runningCount,
          status: response.service?.status,
        };
      }
      break;
    }

    case 'ec2': {
      const { EC2Client, RebootInstancesCommand, StopInstancesCommand, StartInstancesCommand } =
        await import('@aws-sdk/client-ec2');
      const client = new EC2Client({ region: (parameters.region as string) || 'us-east-1' });

      if (action === 'RebootInstances') {
        const command = new RebootInstancesCommand({
          InstanceIds: [resource],
        });
        await client.send(command);
        return { instanceId: resource, action: 'rebooting' };
      }

      if (action === 'StopInstances') {
        const command = new StopInstancesCommand({
          InstanceIds: [resource],
        });
        const response = await client.send(command);
        return {
          instanceId: resource,
          previousState: response.StoppingInstances?.[0]?.PreviousState?.Name,
          currentState: response.StoppingInstances?.[0]?.CurrentState?.Name,
        };
      }

      if (action === 'StartInstances') {
        const command = new StartInstancesCommand({
          InstanceIds: [resource],
        });
        const response = await client.send(command);
        return {
          instanceId: resource,
          previousState: response.StartingInstances?.[0]?.PreviousState?.Name,
          currentState: response.StartingInstances?.[0]?.CurrentState?.Name,
        };
      }
      break;
    }

    case 'lambda': {
      const { LambdaClient, UpdateFunctionConfigurationCommand } =
        await import('@aws-sdk/client-lambda');
      const client = new LambdaClient({ region: (parameters.region as string) || 'us-east-1' });

      if (action === 'UpdateFunctionConfiguration') {
        const command = new UpdateFunctionConfigurationCommand({
          FunctionName: resource,
          MemorySize: parameters.memorySize as number | undefined,
          Timeout: parameters.timeout as number | undefined,
          Environment: parameters.environment as { Variables?: Record<string, string> } | undefined,
        });
        const response = await client.send(command);
        return {
          functionName: response.FunctionName,
          memorySize: response.MemorySize,
          timeout: response.Timeout,
          lastModified: response.LastModified,
        };
      }
      break;
    }

    default:
      throw new Error(
        `Unsupported operation: ${operation}. Supported: ecs:UpdateService, ec2:RebootInstances, ec2:StopInstances, ec2:StartInstances, lambda:UpdateFunctionConfiguration`
      );
  }

  throw new Error(`Unknown action ${action} for service ${service}`);
}

// Global retriever instance
let retriever: ReturnType<typeof createRetriever> | null = null;

function getRetriever() {
  if (!retriever) {
    retriever = createRetriever();
  }
  return retriever;
}

/**
 * Knowledge Search Tool
 */
export const searchKnowledgeTool = defineTool(
  'search_knowledge',
  `Search organizational knowledge base for runbooks, post-mortems,
   architecture docs, and known issues.

   Use when:
   - You need a runbook for a specific procedure
   - Looking for past incidents similar to current issue
   - Need to understand service architecture
   - Checking for known issues or workarounds`,
  {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language search query',
      },
      type_filter: {
        type: 'array',
        description: 'Filter by knowledge type',
        items: {
          type: 'string',
          enum: ['runbook', 'postmortem', 'architecture', 'known_issue'],
        },
      },
      service_filter: {
        type: 'array',
        description: 'Filter by related services',
        items: { type: 'string' },
      },
    },
    required: ['query'],
  },
  async (args) => {
    try {
      const r = getRetriever();
      const results = await r.search(args.query as string, {
        typeFilter: args.type_filter as
          | Array<'runbook' | 'postmortem' | 'architecture' | 'known_issue'>
          | undefined,
        serviceFilter: args.service_filter as string[] | undefined,
        limit: 5,
      });

      const total =
        results.runbooks.length +
        results.postmortems.length +
        results.architecture.length +
        results.knownIssues.length;

      if (total === 0) {
        return { message: 'No matching documents found', documentCount: 0 };
      }

      return {
        documentCount: total,
        runbooks: results.runbooks.map((r) => ({ title: r.title, content: r.content })),
        postmortems: results.postmortems.map((r) => ({ title: r.title, content: r.content })),
        knownIssues: results.knownIssues.map((r) => ({ title: r.title, content: r.content })),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
);

/**
 * CloudWatch Alarms Tool
 */
export const cloudwatchAlarmsTool = defineTool(
  'cloudwatch_alarms',
  `Get CloudWatch alarms status. Use to check for active alerts or alarm history.`,
  {
    type: 'object',
    properties: {
      state: {
        type: 'string',
        description: 'Filter by alarm state',
        enum: ['OK', 'ALARM', 'INSUFFICIENT_DATA', 'all'],
      },
      region: {
        type: 'string',
        description: 'AWS region',
      },
    },
  },
  async (args) => {
    try {
      const state = args.state as string;
      const region = args.region as string | undefined;

      let alarms;
      if (state === 'all' || !state) {
        alarms = await getActiveAlarms(region);
      } else {
        const allAlarms = await getActiveAlarms(region);
        alarms = allAlarms.filter((a) => a.stateValue === state);
      }

      return {
        alarms,
        count: alarms.length,
        visualizationHint:
          alarms.length > 0
            ? 'ALARM DATA: You MUST call visualize_metrics to display this data. Use chart_type="sparkline" with the recentDatapoints values, or chart_type="gauge" for current state. Do this BEFORE providing text.'
            : undefined,
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
);

/**
 * CloudWatch Logs Tool
 */
export const cloudwatchLogsTool = defineTool(
  'cloudwatch_logs',
  `Search CloudWatch logs for errors or specific patterns.`,
  {
    type: 'object',
    properties: {
      log_group: {
        type: 'string',
        description: 'Log group name (e.g., /ecs/my-service)',
      },
      filter_pattern: {
        type: 'string',
        description: 'Filter pattern (e.g., ERROR, Exception, timeout)',
      },
      minutes_back: {
        type: 'number',
        description: 'How many minutes back to search (default: 15)',
      },
      region: {
        type: 'string',
        description: 'AWS region',
      },
    },
    required: ['log_group'],
  },
  async (args) => {
    try {
      const logGroup = args.log_group as string;
      const pattern = (args.filter_pattern as string) || 'ERROR';
      const minutesBack = (args.minutes_back as number) || 15;
      const region = args.region as string | undefined;

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - minutesBack * 60 * 1000);

      const events = await filterLogEvents(logGroup, pattern, startTime, endTime, 50, region);
      return {
        events: events.map((e) => ({
          timestamp: new Date(e.timestamp).toISOString(),
          message: e.message.slice(0, 500), // Truncate long messages
        })),
        count: events.length,
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
);

/**
 * PagerDuty Get Incident Tool
 */
export const pagerdutyGetIncidentTool = defineTool(
  'pagerduty_get_incident',
  `Fetch details about a PagerDuty incident including status, assignees, and alerts.`,
  {
    type: 'object',
    properties: {
      incident_id: {
        type: 'string',
        description: 'PagerDuty incident ID',
      },
    },
    required: ['incident_id'],
  },
  async (args) => {
    try {
      const incidentId = args.incident_id as string;
      const [incident, alerts] = await Promise.all([
        getIncident(incidentId),
        getIncidentAlerts(incidentId),
      ]);

      return {
        incident: {
          id: incident.id,
          number: incident.incidentNumber,
          title: incident.title,
          status: incident.status,
          urgency: incident.urgency,
          service: incident.service.name,
          createdAt: incident.createdAt,
          assignees: incident.assignees.map((a) => a.name),
        },
        alerts: alerts.map((a) => ({
          summary: a.summary,
          severity: a.severity,
          createdAt: a.createdAt,
        })),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
);

/**
 * PagerDuty List Incidents Tool
 */
export const pagerdutyListIncidentsTool = defineTool(
  'pagerduty_list_incidents',
  `List PagerDuty incidents, optionally filtered by status.`,
  {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: 'Filter by status',
        enum: ['triggered', 'acknowledged', 'resolved', 'active'],
      },
      limit: {
        type: 'number',
        description: 'Max incidents to return (default: 10)',
      },
    },
  },
  async (args) => {
    try {
      const status = args.status as string | undefined;
      const limit = (args.limit as number) || 10;

      let statuses: Array<'triggered' | 'acknowledged' | 'resolved'> | undefined;
      if (status === 'active') {
        statuses = ['triggered', 'acknowledged'];
      } else if (status) {
        statuses = [status as 'triggered' | 'acknowledged' | 'resolved'];
      }

      const incidents = await listIncidents({ statuses, limit });

      return {
        incidents: incidents.map((i) => ({
          id: i.id,
          number: i.incidentNumber,
          title: i.title,
          status: i.status,
          urgency: i.urgency,
          service: i.service.name,
          createdAt: i.createdAt,
        })),
        count: incidents.length,
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
);

/**
 * Skill Invocation Tool
 */
export const skillTool = defineTool(
  'skill',
  `Invoke a specialized skill/workflow.

   Available skills:
   - investigate-incident: Hypothesis-driven incident investigation
   - deploy-service: Safe deployment with pre/post checks
   - scale-service: Scale ECS/Lambda/EKS with safety checks
   - troubleshoot-service: Diagnose and fix service issues
   - rollback-deployment: Quick and safe rollback

   Use 'list' as the skill name to see all available skills.`,
  {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name of the skill to invoke (or "list" to see available skills)',
      },
      args: {
        type: 'object',
        description: 'Arguments for the skill (varies by skill)',
      },
    },
    required: ['name'],
  },
  async (args) => {
    const { skillRegistry } = await import('../skills/registry');
    const { SkillExecutor } = await import('../skills/executor');
    const { createLLMClient } = await import('../model/llm');
    const skillName = args.name as string;
    const skillArgs = (args.args as Record<string, unknown>) || {};
    const config = await loadConfig();

    // Load user skills so runtime reflects .runbook/skills.
    await skillRegistry.loadUserSkills();

    // List skills
    if (skillName === 'list') {
      const summaries = skillRegistry.getSummaries();
      return {
        availableSkills: summaries,
        count: summaries.length,
        hint: 'Use skill name with args to invoke a skill',
      };
    }

    // Get skill
    const skill = skillRegistry.get(skillName);
    if (!skill) {
      return {
        error: `Unknown skill: ${skillName}`,
        availableSkills: skillRegistry.getSummaries().map((s) => s.id),
      };
    }

    // Validate required parameters
    const missingParams = skill.parameters
      .filter((p) => p.required && !(p.name in skillArgs))
      .map((p) => p.name);

    if (missingParams.length > 0) {
      return {
        error: `Missing required parameters: ${missingParams.join(', ')}`,
        skill: {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          parameters: skill.parameters.map((p) => ({
            name: p.name,
            description: p.description,
            type: p.type,
            required: p.required,
            default: p.default,
          })),
        },
      };
    }

    const llm = createLLMClient({
      provider: config.llm.provider,
      model: config.llm.model,
      apiKey: config.llm.apiKey,
    });
    const safetyRequiredRisks = normalizeApprovalRiskLevels(
      config.safety.requireApproval as ApprovalPolicyRisk[]
    );
    const safetyAutoApproveRisks = ALL_RISK_LEVELS.filter(
      (risk) => !safetyRequiredRisks.includes(risk)
    );

    const executor = new SkillExecutor({
      llm,
      onApprovalRequired: async (step) => {
        const riskLevel = skill.riskLevel || classifyRisk(step.action, skill.id);
        const limit = checkMutationLimit(config.safety.maxMutationsPerSession);
        if (!limit.allowed) {
          return false;
        }
        if (riskLevel === 'critical') {
          const cooldown = checkCooldown(step.action, config.safety.cooldownBetweenCriticalMs);
          if (!cooldown.allowed) {
            return false;
          }
        }
        const request: MutationRequest = {
          id: generateMutationId(),
          operation: step.action,
          resource: skill.id,
          description: `${skill.name}: ${step.name}`,
          riskLevel,
          parameters: step.parameters || {},
          estimatedImpact: step.description,
        };

        const approval = await requestApprovalWithOptions(request, {
          useSlack: config.incident.slack.enabled,
          autoApprove: safetyAutoApproveRisks,
        });
        if (approval.approved) {
          recordApprovedMutation(riskLevel);
        }
        return approval.approved;
      },
    });

    const execution = await executor.execute(skill, { ...skillArgs });

    return {
      skill: {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        riskLevel: skill.riskLevel || 'medium',
      },
      parameters: execution.parameters,
      execution: {
        status: execution.status,
        startedAt: execution.startedAt.toISOString(),
        completedAt: execution.completedAt.toISOString(),
        durationMs: execution.durationMs,
        steps: execution.stepResults.map((stepResult) => ({
          stepId: stepResult.stepId,
          status: stepResult.status,
          durationMs: stepResult.durationMs,
          error: stepResult.error,
          result: stepResult.result,
        })),
        error: execution.error,
      },
      message: `Skill "${skill.name}" execution ${execution.status}.`,
    };
  }
);

/**
 * Datadog Observability Tool
 */
export const datadogTool = defineTool(
  'datadog',
  `Query Datadog for metrics, logs, traces, and alerts.

   Use for:
   - "Show me triggered Datadog monitors"
   - "Search Datadog logs for errors in checkout-service"
   - "Get CPU metrics for the last hour"
   - "Find slow traces in the API"

   Requires DD_API_KEY and DD_APP_KEY environment variables or config.`,
  {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action to perform',
        enum: ['monitors', 'logs', 'metrics', 'traces', 'events', 'summary'],
      },
      query: {
        type: 'string',
        description: 'Search query (for logs, metrics, traces)',
      },
      service: {
        type: 'string',
        description: 'Filter by service name',
      },
      from_minutes: {
        type: 'number',
        description: 'How many minutes back to search (default: 60)',
      },
      limit: {
        type: 'number',
        description: 'Max results to return (default: 50)',
      },
    },
    required: ['action'],
  },
  async (args) => {
    const action = args.action as string;
    const query = args.query as string | undefined;
    const service = args.service as string | undefined;
    const fromMinutes = (args.from_minutes as number) || 60;
    const limit = (args.limit as number) || 50;

    // Check if Datadog is configured
    const configured = await isDatadogConfigured();
    if (!configured) {
      return {
        error: 'Datadog not configured',
        hint: 'Set DD_API_KEY and DD_APP_KEY environment variables, or configure in .runbook/services.yaml',
      };
    }

    try {
      switch (action) {
        case 'summary': {
          const summary = await getDatadogSummary();
          return summary || { error: 'Failed to get Datadog summary' };
        }

        case 'monitors': {
          const monitors = await getTriggeredMonitors();
          return {
            triggeredMonitors: monitors.map((m) => ({
              id: m.id,
              name: m.name,
              state: m.overallState,
              type: m.type,
              priority: m.priority,
            })),
            count: monitors.length,
          };
        }

        case 'logs': {
          if (!query) {
            return { error: 'Query is required for log search' };
          }
          const now = new Date();
          const from = new Date(now.getTime() - fromMinutes * 60 * 1000);
          const result = await searchLogs(query, {
            from: from.toISOString(),
            to: now.toISOString(),
            limit,
          });
          return result || { error: 'Failed to search logs' };
        }

        case 'metrics': {
          if (!query) {
            return { error: 'Query is required for metrics (e.g., "avg:system.cpu.user{*}")' };
          }
          const result = await queryMetrics(query, fromMinutes * 60, 0);
          if (!result) {
            return { error: 'Failed to query metrics' };
          }
          return {
            query: result.query,
            series: result.series.map((s) => ({
              metric: s.metric,
              scope: s.scope,
              points: s.pointlist.length,
              lastValue: s.pointlist.length > 0 ? s.pointlist[s.pointlist.length - 1][1] : null,
            })),
          };
        }

        case 'traces': {
          const result = await searchTraces(query || '*', {
            from: Math.floor(Date.now() / 1000) - fromMinutes * 60,
            limit,
            service,
          });
          if (!result) {
            return { error: 'Failed to search traces' };
          }
          return {
            spans: result.spans.map((s) => ({
              traceId: s.traceId,
              service: s.service,
              resource: s.resource,
              duration: s.duration,
              error: s.error,
            })),
            count: result.spans.length,
          };
        }

        case 'events': {
          const events = await getEvents({
            start: Math.floor(Date.now() / 1000) - fromMinutes * 60,
          });
          return {
            events: events.map((e) => ({
              id: e.id,
              title: e.title,
              priority: e.priority,
              alertType: e.alertType,
              source: e.source,
            })),
            count: events.length,
          };
        }

        default:
          return { error: `Unknown action: ${action}` };
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
);

/**
 * Cross-platform date helper for CLI commands
 *
 * Replaces shell date expressions with actual dates calculated in JavaScript.
 * Handles both GNU date syntax (Linux) and BSD date syntax (macOS).
 */
function preprocessDateExpressions(command: string): string {
  let processedCommand = command;

  // Helper to format date as YYYY-MM-DD
  const formatDate = (date: Date): string => {
    return date.toISOString().split('T')[0];
  };

  // Pattern: $(date -d '30 days ago' +%Y-%m-%d) or $(date -d "30 days ago" +%Y-%m-%d)
  // GNU date syntax
  const gnuDatePattern =
    /\$\(date\s+-d\s+['"]?(\d+)\s+(day|days|week|weeks|month|months)\s+ago['"]?\s+\+%Y-%m-%d\)/gi;
  processedCommand = processedCommand.replace(gnuDatePattern, (_, amount, unit) => {
    const date = new Date();
    const num = parseInt(amount, 10);
    if (unit.startsWith('day')) {
      date.setDate(date.getDate() - num);
    } else if (unit.startsWith('week')) {
      date.setDate(date.getDate() - num * 7);
    } else if (unit.startsWith('month')) {
      date.setMonth(date.getMonth() - num);
    }
    return formatDate(date);
  });

  // Pattern: $(date -v-30d +%Y-%m-%d) - BSD/macOS date syntax
  const bsdDatePattern = /\$\(date\s+-v-(\d+)([dwmy])\s+\+%Y-%m-%d\)/gi;
  processedCommand = processedCommand.replace(bsdDatePattern, (_, amount, unit) => {
    const date = new Date();
    const num = parseInt(amount, 10);
    switch (unit.toLowerCase()) {
      case 'd':
        date.setDate(date.getDate() - num);
        break;
      case 'w':
        date.setDate(date.getDate() - num * 7);
        break;
      case 'm':
        date.setMonth(date.getMonth() - num);
        break;
      case 'y':
        date.setFullYear(date.getFullYear() - num);
        break;
    }
    return formatDate(date);
  });

  // Pattern: $(date +%Y-%m-%d) - current date
  const currentDatePattern = /\$\(date\s+\+%Y-%m-%d\)/gi;
  processedCommand = processedCommand.replace(currentDatePattern, () => {
    return formatDate(new Date());
  });

  // Pattern: $(date -d 'yesterday' +%Y-%m-%d)
  const yesterdayPattern = /\$\(date\s+-d\s+['"]?yesterday['"]?\s+\+%Y-%m-%d\)/gi;
  processedCommand = processedCommand.replace(yesterdayPattern, () => {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return formatDate(date);
  });

  // Pattern: $(date -d 'last month' +%Y-%m-%d)
  const lastMonthPattern = /\$\(date\s+-d\s+['"]?last\s+month['"]?\s+\+%Y-%m-%d\)/gi;
  processedCommand = processedCommand.replace(lastMonthPattern, () => {
    const date = new Date();
    date.setMonth(date.getMonth() - 1);
    return formatDate(date);
  });

  // Pattern: $(date -d 'first day of last month' +%Y-%m-%d)
  const firstDayLastMonthPattern =
    /\$\(date\s+-d\s+['"]?first\s+day\s+of\s+last\s+month['"]?\s+\+%Y-%m-%d\)/gi;
  processedCommand = processedCommand.replace(firstDayLastMonthPattern, () => {
    const date = new Date();
    date.setMonth(date.getMonth() - 1);
    date.setDate(1);
    return formatDate(date);
  });

  return processedCommand;
}

const READ_ONLY_AWS_CLI_PREFIXES = [
  'get',
  'list',
  'describe',
  'batch-get',
  'head',
  'lookup',
  'search',
  'query',
  'scan',
  'select',
  'tail',
];

const READ_ONLY_AWS_CLI_EXACT = new Set(['ls', 'help']);

function tokenizeCliCommand(command: string): string[] {
  const matches = command.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  return matches
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => token.replace(/^['"]|['"]$/g, ''));
}

function hasDangerousShellOperators(command: string): boolean {
  return (
    command.includes(';') ||
    command.includes('|') ||
    command.includes('&&') ||
    command.includes('$(') ||
    command.includes('`') ||
    command.includes('\n') ||
    command.includes('\r')
  );
}

function parseAwsCliServiceAndOperation(command: string): { service?: string; operation?: string } {
  const tokens = tokenizeCliCommand(command);
  if (tokens.length < 3 || tokens[0] !== 'aws') {
    return {};
  }

  let index = 1;
  while (index < tokens.length && tokens[index].startsWith('-')) {
    const flag = tokens[index];
    const next = tokens[index + 1];
    if (!flag.startsWith('--no-') && next && !next.startsWith('-')) {
      index += 2;
      continue;
    }
    index += 1;
  }

  const service = tokens[index];
  const operation = tokens[index + 1];
  return { service, operation };
}

function isReadOnlyAwsCliOperation(operation: string): boolean {
  const normalized = operation.toLowerCase().trim();
  if (!normalized) {
    return false;
  }
  if (READ_ONLY_AWS_CLI_EXACT.has(normalized)) {
    return true;
  }
  return READ_ONLY_AWS_CLI_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}-`)
  );
}

/**
 * AWS CLI Fallback Tool
 *
 * When SDK-based tools don't support a specific operation,
 * this tool allows running AWS CLI commands directly.
 */
export const awsCliTool = defineTool(
  'aws_cli',
  `Execute AWS CLI commands directly. Use this as a FALLBACK when aws_query doesn't support the specific operation you need.

   Examples:
   - "aws amplify list-jobs --app-id abc123 --branch-name main --region us-east-1"
   - "aws ecs describe-tasks --cluster my-cluster --tasks arn:aws:ecs:..."
   - "aws logs get-log-events --log-group-name /aws/lambda/my-func --log-stream-name ..."

   IMPORTANT:
   - Only use for READ operations (list, describe, get)
   - Do NOT use for mutations (create, update, delete, put) - use aws_mutate instead
   - Read-only commands run without approval
   - Always include --region flag`,
  {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The full AWS CLI command to execute (must start with "aws")',
      },
      reason: {
        type: 'string',
        description: 'Why this CLI command is needed (helps user understand the request)',
      },
    },
    required: ['command', 'reason'],
  },
  async (args) => {
    const rawCommand = args.command as string;
    const reason = args.reason as string;

    // Validate command starts with 'aws'
    if (!rawCommand.trim().startsWith('aws ')) {
      return { error: 'Command must start with "aws"' };
    }

    // Preprocess date expressions for cross-platform compatibility
    const command = preprocessDateExpressions(rawCommand);

    // Block shell control operators to keep aws_cli scoped to a single AWS command.
    if (hasDangerousShellOperators(command)) {
      return {
        error:
          'Shell control operators are not allowed in aws_cli commands. Provide a single plain AWS CLI command.',
      };
    }

    // Block mutation commands
    const mutationKeywords = [
      'create',
      'update',
      'delete',
      'put',
      'terminate',
      'stop',
      'start',
      'modify',
      'remove',
      'set',
    ];
    const commandLower = command.toLowerCase();
    for (const keyword of mutationKeywords) {
      if (commandLower.includes(` ${keyword}-`) || commandLower.includes(` ${keyword} `)) {
        return {
          error: `Mutation commands are not allowed via aws_cli. Use aws_mutate instead.`,
          blockedKeyword: keyword,
        };
      }
    }

    const { operation } = parseAwsCliServiceAndOperation(command);
    if (!operation || !isReadOnlyAwsCliOperation(operation)) {
      return {
        error:
          'Only read-only AWS CLI operations are allowed via aws_cli. Use aws_mutate for state-changing actions.',
        command,
      };
    }

    // Execute the command
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 30000, // 30 second timeout
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      // Try to parse as JSON for better formatting
      let result: unknown;
      try {
        result = JSON.parse(stdout);
      } catch {
        result = stdout.trim();
      }

      // Auto-generate visualization for cost data
      let autoVisualization: string | undefined;
      const resultStr = JSON.stringify(result);

      if (
        command.includes('ce get-cost') ||
        resultStr.includes('BlendedCost') ||
        resultStr.includes('UnblendedCost')
      ) {
        // Extract cost values and generate chart automatically
        try {
          const costResult = result as {
            ResultsByTime?: Array<{
              TimePeriod: { Start: string };
              Total: { BlendedCost?: { Amount: string }; UnblendedCost?: { Amount: string } };
            }>;
          };
          if (costResult.ResultsByTime && costResult.ResultsByTime.length > 0) {
            const values = costResult.ResultsByTime.map((r) => {
              const amount = r.Total.BlendedCost?.Amount || r.Total.UnblendedCost?.Amount || '0';
              return parseFloat(amount);
            });
            const labels = costResult.ResultsByTime.map((r) => {
              const date = new Date(r.TimePeriod.Start);
              return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            });

            // Generate the chart
            const chart = generateLineChart(values, { title: 'AWS Monthly Cost (USD)' });
            autoVisualization = `\n## Cost Visualization\n\n${chart}\n\nMonths: ${labels.join(' → ')}`;
          }
        } catch {
          // If visualization fails, continue without it
        }
      }

      return {
        success: true,
        command,
        originalCommand: rawCommand !== command ? rawCommand : undefined,
        datePreprocessed: rawCommand !== command,
        reason,
        output: result,
        stderr: stderr || undefined,
        autoVisualization,
      };
    } catch (error) {
      const execError = error as { message: string; stderr?: string; code?: number };
      return {
        error: execError.message,
        stderr: execError.stderr,
        exitCode: execError.code,
        command,
        originalCommand: rawCommand !== command ? rawCommand : undefined,
        hint: 'Make sure AWS CLI is installed and configured with valid credentials',
      };
    }
  }
);

/**
 * Kubernetes Query Tool - read-only Kubernetes cluster operations
 */
export const kubernetesQueryTool = defineTool(
  'kubernetes_query',
  `Query Kubernetes cluster state (read-only).

   Use for:
   - Cluster availability and context inspection
   - Listing pods, deployments, nodes, namespaces, and events
   - Resource usage with top pods/nodes

   This tool is read-only in this phase.`,
  {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Kubernetes query action to perform',
        enum: [
          'status',
          'contexts',
          'namespaces',
          'pods',
          'deployments',
          'nodes',
          'events',
          'top_pods',
          'top_nodes',
        ],
      },
      context: {
        type: 'string',
        description: 'Optional kube context to query',
      },
      namespace: {
        type: 'string',
        description: 'Optional namespace for namespaced resources',
      },
      label_selector: {
        type: 'string',
        description: 'Optional label selector for pods query',
      },
      limit: {
        type: 'number',
        description: 'Max number of items to return (default: 50)',
      },
    },
    required: ['action'],
  },
  async (args) => {
    const action = args.action as string;
    const namespace = args.namespace as string | undefined;
    const context = args.context as string | undefined;
    const labelSelector = args.label_selector as string | undefined;
    const limit = (args.limit as number) || 50;

    const client = createKubernetesClient({ context, namespace });

    try {
      switch (action) {
        case 'status': {
          const [available, currentContext, clusterInfo] = await Promise.all([
            client.isAvailable(),
            client.getCurrentContext(),
            client.getClusterInfo(),
          ]);

          return {
            available,
            currentContext,
            clusterInfo,
          };
        }

        case 'contexts': {
          const [currentContext, contexts] = await Promise.all([
            client.getCurrentContext(),
            client.listContexts(),
          ]);

          return {
            currentContext,
            contexts,
            count: contexts.length,
          };
        }

        case 'namespaces': {
          const namespaces = await client.listNamespaces();
          return {
            namespaces: namespaces.slice(0, limit),
            count: namespaces.length,
            limited: namespaces.length > limit,
          };
        }

        case 'pods': {
          const pods = await client.getPods(namespace, labelSelector);
          return {
            pods: pods.slice(0, limit),
            count: pods.length,
            namespace: namespace || 'all',
            limited: pods.length > limit,
          };
        }

        case 'deployments': {
          const deployments = await client.getDeployments(namespace);
          return {
            deployments: deployments.slice(0, limit),
            count: deployments.length,
            namespace: namespace || 'all',
            limited: deployments.length > limit,
          };
        }

        case 'nodes': {
          const nodes = await client.getNodes();
          return {
            nodes: nodes.slice(0, limit),
            count: nodes.length,
            limited: nodes.length > limit,
          };
        }

        case 'events': {
          const events = await client.getEvents(namespace);
          return {
            events: events.slice(-limit),
            count: events.length,
            namespace: namespace || 'all',
            limited: events.length > limit,
          };
        }

        case 'top_pods': {
          const topPods = await client.getTopPods(namespace);
          return {
            topPods: topPods.slice(0, limit),
            count: topPods.length,
            namespace: namespace || 'all',
            limited: topPods.length > limit,
          };
        }

        case 'top_nodes': {
          const topNodes = await client.getTopNodes();
          return {
            topNodes: topNodes.slice(0, limit),
            count: topNodes.length,
            limited: topNodes.length > limit,
          };
        }

        default:
          return {
            error: `Unsupported kubernetes action: ${action}`,
          };
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown Kubernetes query error',
        hint: 'Ensure kubectl is installed and kube context/credentials are configured.',
      };
    }
  }
);

// Register default tools
toolRegistry.registerCategory('aws', 'AWS Cloud Operations', [
  awsQueryTool,
  awsMutateTool,
  awsCliTool,
  cloudwatchAlarmsTool,
  cloudwatchLogsTool,
]);

toolRegistry.registerCategory('kubernetes', 'Kubernetes Cluster Operations', [kubernetesQueryTool]);

/**
 * Prometheus Query Tool
 */
export const prometheusTool = defineTool(
  'prometheus',
  `Query Prometheus for metrics, alerts, and target health.

   Use for:
   - "Show me firing Prometheus alerts"
   - "What's the CPU usage across nodes?"
   - "Check target health status"
   - "Query custom metrics"

   Requires PROMETHEUS_URL environment variable or config.`,
  {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action to perform',
        enum: ['query', 'range_query', 'alerts', 'targets', 'health_check', 'common'],
      },
      query: {
        type: 'string',
        description: 'PromQL query (for query/range_query actions)',
      },
      common_metric: {
        type: 'string',
        description: 'Common metric shortcut (for common action)',
        enum: [
          'cpu_usage',
          'memory_usage',
          'disk_usage',
          'network_receive',
          'network_transmit',
          'request_rate',
          'error_rate',
          'latency_p99',
          'latency_p95',
          'container_cpu',
          'container_memory',
          'pod_ready',
        ],
      },
      from_minutes: {
        type: 'number',
        description: 'Minutes back for range query (default: 60)',
      },
      step: {
        type: 'string',
        description: 'Step for range query (default: 1m)',
      },
    },
    required: ['action'],
  },
  async (args) => {
    const action = args.action as string;

    if (!isPrometheusConfigured()) {
      return {
        error: 'Prometheus not configured',
        hint: 'Set PROMETHEUS_URL environment variable',
      };
    }

    try {
      switch (action) {
        case 'query': {
          if (!args.query) {
            return { error: 'Query is required for instant query' };
          }
          const result = await instantQuery(args.query as string);
          return {
            resultType: result.resultType,
            results: result.result.map((r) => ({
              labels: r.metric,
              value: r.value ? parseFloat(r.value[1]) : null,
              timestamp: r.value ? new Date(r.value[0] * 1000).toISOString() : null,
            })),
            count: result.result.length,
          };
        }

        case 'range_query': {
          if (!args.query) {
            return { error: 'Query is required for range query' };
          }
          const fromMinutes = (args.from_minutes as number) || 60;
          const step = (args.step as string) || '1m';
          const end = new Date();
          const start = new Date(end.getTime() - fromMinutes * 60 * 1000);

          const result = await rangeQuery(args.query as string, start, end, step);
          return {
            resultType: result.resultType,
            results: result.result.map((r) => ({
              labels: r.metric,
              points: r.values?.length || 0,
              lastValue:
                r.values && r.values.length > 0
                  ? parseFloat(r.values[r.values.length - 1][1])
                  : null,
            })),
            count: result.result.length,
          };
        }

        case 'alerts': {
          const alerts = await getFiringAlerts();
          return {
            firingAlerts: alerts.map((a) => ({
              name: a.alertname,
              instance: a.instance,
              job: a.job,
              severity: a.severity,
              summary: a.summary,
              state: a.state,
              since: a.activeAt,
            })),
            count: alerts.length,
          };
        }

        case 'targets': {
          const health = await getTargetHealth();
          return {
            summary: {
              healthy: health.healthy,
              unhealthy: health.unhealthy,
            },
            unhealthyTargets: health.targets
              .filter((t) => t.health !== 'up')
              .map((t) => ({
                job: t.job,
                instance: t.instance,
                health: t.health,
                error: t.lastError,
                lastScrape: t.lastScrape,
              })),
          };
        }

        case 'health_check': {
          const health = await getQuickHealthCheck();
          return {
            alertCount: health.alertCount,
            targets: health.targetHealth,
            topCpuUsage: health.topCpu?.map((c) => ({
              instance: c.instance,
              usage: `${c.value.toFixed(1)}%`,
            })),
            topMemoryUsage: health.topMemory?.map((m) => ({
              instance: m.instance,
              usage: `${m.value.toFixed(1)}%`,
            })),
          };
        }

        case 'common': {
          const metricKey = args.common_metric as string;
          const metricMap: Record<string, string> = {
            cpu_usage: COMMON_QUERIES.cpuUsageByNode,
            memory_usage: COMMON_QUERIES.memoryUsageByNode,
            disk_usage: COMMON_QUERIES.diskUsage,
            network_receive: COMMON_QUERIES.networkReceive,
            network_transmit: COMMON_QUERIES.networkTransmit,
            request_rate: COMMON_QUERIES.requestRate,
            error_rate: COMMON_QUERIES.errorRate,
            latency_p99: COMMON_QUERIES.latencyP99,
            latency_p95: COMMON_QUERIES.latencyP95,
            container_cpu: COMMON_QUERIES.containerCpu,
            container_memory: COMMON_QUERIES.containerMemory,
            pod_ready: COMMON_QUERIES.podReady,
          };

          const query = metricMap[metricKey];
          if (!query) {
            return {
              error: `Unknown common metric: ${metricKey}`,
              availableMetrics: Object.keys(metricMap),
            };
          }

          const result = await instantQuery(query);
          return {
            metric: metricKey,
            query,
            results: result.result.map((r) => ({
              labels: r.metric,
              value: r.value ? parseFloat(r.value[1]) : null,
            })),
            count: result.result.length,
          };
        }

        default:
          return { error: `Unknown action: ${action}` };
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
);

toolRegistry.registerCategory('observability', 'Observability & Monitoring', [
  datadogTool,
  prometheusTool,
]);

toolRegistry.registerCategory('knowledge', 'Knowledge Base', [searchKnowledgeTool]);

/**
 * PagerDuty Add Note Tool
 */
export const pagerdutyAddNoteTool = defineTool(
  'pagerduty_add_note',
  `Add a note to a PagerDuty incident. Use to document investigation findings, actions taken, or updates.`,
  {
    type: 'object',
    properties: {
      incident_id: {
        type: 'string',
        description: 'PagerDuty incident ID',
      },
      note: {
        type: 'string',
        description: 'Note content to add',
      },
      email: {
        type: 'string',
        description: 'Email of the user adding the note (for audit)',
      },
    },
    required: ['incident_id', 'note', 'email'],
  },
  async (args) => {
    try {
      const incidentId = args.incident_id as string;
      const note = args.note as string;
      const email = args.email as string;

      const result = await addIncidentNote(incidentId, note, email);

      return {
        success: true,
        noteId: result.id,
        message: 'Note added to incident',
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
);

/**
 * Slack Post Update Tool
 */
export const slackPostUpdateTool = defineTool(
  'slack_post_update',
  `Post an investigation update to a Slack channel. Use to keep stakeholders informed about incident progress.`,
  {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'Slack channel ID or name (e.g., #incidents, C12345678)',
      },
      incident_id: {
        type: 'string',
        description: 'Incident ID being investigated',
      },
      title: {
        type: 'string',
        description: 'Brief title of the incident',
      },
      status: {
        type: 'string',
        description: 'Current investigation status',
        enum: ['investigating', 'identified', 'monitoring', 'resolved'],
      },
      summary: {
        type: 'string',
        description: 'Summary of current findings and status',
      },
      severity: {
        type: 'string',
        description: 'Incident severity',
        enum: ['low', 'medium', 'high', 'critical'],
      },
      findings: {
        type: 'array',
        description: 'Key findings discovered',
        items: { type: 'string' },
      },
      next_steps: {
        type: 'array',
        description: 'Planned next steps',
        items: { type: 'string' },
      },
      thread_ts: {
        type: 'string',
        description: 'Thread timestamp to reply in (for threaded updates)',
      },
    },
    required: ['channel', 'incident_id', 'title', 'status', 'summary'],
  },
  async (args) => {
    if (!isSlackConfigured()) {
      return {
        error: 'Slack not configured',
        hint: 'Set SLACK_BOT_TOKEN environment variable or configure in .runbook/config.yaml',
      };
    }

    try {
      let channelId = args.channel as string;

      // If channel name provided, find the ID
      if (channelId.startsWith('#')) {
        const channel = await findChannel(channelId);
        if (!channel) {
          return { error: `Channel ${channelId} not found` };
        }
        channelId = channel.id;
      }

      const result = await postInvestigationUpdate(
        channelId,
        {
          incidentId: args.incident_id as string,
          title: args.title as string,
          status: args.status as 'investigating' | 'identified' | 'monitoring' | 'resolved',
          summary: args.summary as string,
          severity: args.severity as 'low' | 'medium' | 'high' | 'critical' | undefined,
          findings: args.findings as string[] | undefined,
          nextSteps: args.next_steps as string[] | undefined,
        },
        args.thread_ts as string | undefined
      );

      return {
        success: true,
        channel: result.channel,
        messageTs: result.ts,
        message: 'Update posted to Slack',
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
);

/**
 * Slack Post Root Cause Tool
 */
export const slackPostRootCauseTool = defineTool(
  'slack_post_root_cause',
  `Post a root cause identification message to Slack. Use when investigation has identified the likely root cause.`,
  {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'Slack channel ID or name',
      },
      incident_id: {
        type: 'string',
        description: 'Incident ID',
      },
      root_cause: {
        type: 'string',
        description: 'The identified root cause',
      },
      confidence: {
        type: 'string',
        description: 'Confidence level in the root cause',
        enum: ['low', 'medium', 'high'],
      },
      evidence: {
        type: 'array',
        description: 'Evidence supporting the root cause',
        items: { type: 'string' },
      },
      suggested_remediation: {
        type: 'string',
        description: 'Suggested fix or remediation',
      },
      thread_ts: {
        type: 'string',
        description: 'Thread timestamp to reply in',
      },
    },
    required: ['channel', 'incident_id', 'root_cause', 'confidence', 'evidence'],
  },
  async (args) => {
    if (!isSlackConfigured()) {
      return {
        error: 'Slack not configured',
        hint: 'Set SLACK_BOT_TOKEN environment variable',
      };
    }

    try {
      let channelId = args.channel as string;

      if (channelId.startsWith('#')) {
        const channel = await findChannel(channelId);
        if (!channel) {
          return { error: `Channel ${channelId} not found` };
        }
        channelId = channel.id;
      }

      const result = await postRootCauseIdentified(
        channelId,
        {
          incidentId: args.incident_id as string,
          rootCause: args.root_cause as string,
          confidence: args.confidence as 'low' | 'medium' | 'high',
          evidence: args.evidence as string[],
          suggestedRemediation: args.suggested_remediation as string | undefined,
        },
        args.thread_ts as string | undefined
      );

      return {
        success: true,
        channel: result.channel,
        messageTs: result.ts,
        message: 'Root cause posted to Slack',
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
);

/**
 * Slack Read Thread Tool
 */
export const slackReadThreadTool = defineTool(
  'slack_read_thread',
  `Read messages from a Slack channel or thread. Use to get incident context from ongoing discussions.`,
  {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'Slack channel ID or name',
      },
      thread_ts: {
        type: 'string',
        description: 'Thread timestamp to read (optional, reads channel history if not provided)',
      },
      limit: {
        type: 'number',
        description: 'Max messages to return (default: 50)',
      },
    },
    required: ['channel'],
  },
  async (args) => {
    if (!isSlackConfigured()) {
      return {
        error: 'Slack not configured',
        hint: 'Set SLACK_BOT_TOKEN environment variable',
      };
    }

    try {
      let channelId = args.channel as string;

      if (channelId.startsWith('#')) {
        const channel = await findChannel(channelId);
        if (!channel) {
          return { error: `Channel ${channelId} not found` };
        }
        channelId = channel.id;
      }

      const messages = await getChannelMessages(channelId, {
        threadTs: args.thread_ts as string | undefined,
        limit: (args.limit as number) || 50,
      });

      return {
        messages: messages.map((m) => ({
          timestamp: m.ts,
          text: m.text,
          isThreaded: !!m.threadTs,
        })),
        count: messages.length,
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
);

/**
 * Slack Simple Message Tool
 */
export const slackMessageTool = defineTool(
  'slack_message',
  `Send a simple message to a Slack channel.`,
  {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'Slack channel ID or name',
      },
      text: {
        type: 'string',
        description: 'Message text (supports Slack markdown)',
      },
      thread_ts: {
        type: 'string',
        description: 'Thread timestamp to reply in',
      },
    },
    required: ['channel', 'text'],
  },
  async (args) => {
    if (!isSlackConfigured()) {
      return {
        error: 'Slack not configured',
        hint: 'Set SLACK_BOT_TOKEN environment variable',
      };
    }

    try {
      let channelId = args.channel as string;

      if (channelId.startsWith('#')) {
        const channel = await findChannel(channelId);
        if (!channel) {
          return { error: `Channel ${channelId} not found` };
        }
        channelId = channel.id;
      }

      const result = await postMessage(channelId, args.text as string, {
        threadTs: args.thread_ts as string | undefined,
      });

      return {
        success: true,
        channel: result.channel,
        messageTs: result.ts,
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
);

/**
 * OpsGenie Get Alert Tool
 */
export const opsgenieGetAlertTool = defineTool(
  'opsgenie_get_alert',
  `Fetch details about an OpsGenie alert including status, priority, and details.`,
  {
    type: 'object',
    properties: {
      alert_id: {
        type: 'string',
        description: 'OpsGenie alert ID',
      },
    },
    required: ['alert_id'],
  },
  async (args) => {
    if (!isOpsGenieConfigured()) {
      return {
        error: 'OpsGenie not configured',
        hint: 'Set OPSGENIE_API_KEY environment variable',
      };
    }

    try {
      const alertId = args.alert_id as string;
      const alert = await getOpsGenieAlert(alertId);

      return {
        alert: {
          id: alert.id,
          tinyId: alert.tinyId,
          message: alert.message,
          status: alert.status,
          priority: alert.priority,
          acknowledged: alert.acknowledged,
          source: alert.source,
          tags: alert.tags,
          teams: alert.teams.map((t) => t.name),
          createdAt: alert.createdAt,
          description: alert.description,
          details: alert.details,
        },
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
);

/**
 * OpsGenie List Alerts Tool
 */
export const opsgenieListAlertsTool = defineTool(
  'opsgenie_list_alerts',
  `List OpsGenie alerts, optionally filtered by status or query.`,
  {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: 'Filter by status',
        enum: ['open', 'closed', 'acked'],
      },
      query: {
        type: 'string',
        description: 'OpsGenie search query',
      },
      limit: {
        type: 'number',
        description: 'Max alerts to return (default: 25)',
      },
    },
  },
  async (args) => {
    if (!isOpsGenieConfigured()) {
      return {
        error: 'OpsGenie not configured',
        hint: 'Set OPSGENIE_API_KEY environment variable',
      };
    }

    try {
      const alerts = await listOpsGenieAlerts({
        status: args.status as 'open' | 'closed' | 'acked' | undefined,
        query: args.query as string | undefined,
        limit: (args.limit as number) || 25,
      });

      return {
        alerts: alerts.map((a) => ({
          id: a.id,
          tinyId: a.tinyId,
          message: a.message,
          status: a.status,
          priority: a.priority,
          source: a.source,
          createdAt: a.createdAt,
        })),
        count: alerts.length,
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
);

/**
 * OpsGenie Get Incident Tool
 */
export const opsgenieGetIncidentTool = defineTool(
  'opsgenie_get_incident',
  `Fetch details about an OpsGenie incident.`,
  {
    type: 'object',
    properties: {
      incident_id: {
        type: 'string',
        description: 'OpsGenie incident ID',
      },
    },
    required: ['incident_id'],
  },
  async (args) => {
    if (!isOpsGenieConfigured()) {
      return {
        error: 'OpsGenie not configured',
        hint: 'Set OPSGENIE_API_KEY environment variable',
      };
    }

    try {
      const incident = await getOpsGenieIncident(args.incident_id as string);

      return {
        incident: {
          id: incident.id,
          tinyId: incident.tinyId,
          message: incident.message,
          status: incident.status,
          priority: incident.priority,
          impactedServices: incident.impactedServices,
          tags: incident.tags,
          createdAt: incident.createdAt,
          updatedAt: incident.updatedAt,
        },
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
);

/**
 * OpsGenie List Incidents Tool
 */
export const opsgenieListIncidentsTool = defineTool(
  'opsgenie_list_incidents',
  `List OpsGenie incidents, optionally filtered by status.`,
  {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: 'Filter by status',
        enum: ['open', 'resolved'],
      },
      limit: {
        type: 'number',
        description: 'Max incidents to return (default: 25)',
      },
    },
  },
  async (args) => {
    if (!isOpsGenieConfigured()) {
      return {
        error: 'OpsGenie not configured',
        hint: 'Set OPSGENIE_API_KEY environment variable',
      };
    }

    try {
      const incidents = await listOpsGenieIncidents({
        status: args.status as 'open' | 'resolved' | undefined,
        limit: (args.limit as number) || 25,
      });

      return {
        incidents: incidents.map((i) => ({
          id: i.id,
          tinyId: i.tinyId,
          message: i.message,
          status: i.status,
          priority: i.priority,
          impactedServices: i.impactedServices,
          createdAt: i.createdAt,
        })),
        count: incidents.length,
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
);

/**
 * OpsGenie Add Note Tool
 */
export const opsgenieAddNoteTool = defineTool(
  'opsgenie_add_note',
  `Add a note to an OpsGenie alert. Use to document investigation findings.`,
  {
    type: 'object',
    properties: {
      alert_id: {
        type: 'string',
        description: 'OpsGenie alert ID',
      },
      note: {
        type: 'string',
        description: 'Note content to add',
      },
    },
    required: ['alert_id', 'note'],
  },
  async (args) => {
    if (!isOpsGenieConfigured()) {
      return {
        error: 'OpsGenie not configured',
        hint: 'Set OPSGENIE_API_KEY environment variable',
      };
    }

    try {
      const result = await addOpsGenieAlertNote(args.alert_id as string, args.note as string);

      return {
        success: true,
        requestId: result.requestId,
        message: 'Note added to alert',
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
);

/**
 * OpsGenie Acknowledge Alert Tool
 */
export const opsgenieAcknowledgeAlertTool = defineTool(
  'opsgenie_acknowledge_alert',
  `Acknowledge an OpsGenie alert.`,
  {
    type: 'object',
    properties: {
      alert_id: {
        type: 'string',
        description: 'OpsGenie alert ID',
      },
      note: {
        type: 'string',
        description: 'Optional note to add',
      },
    },
    required: ['alert_id'],
  },
  async (args) => {
    if (!isOpsGenieConfigured()) {
      return {
        error: 'OpsGenie not configured',
        hint: 'Set OPSGENIE_API_KEY environment variable',
      };
    }
    const { config, autoApproveRisks } = await getSafetySettings();
    const riskLevel: RiskLevel = 'medium';
    const limit = checkMutationLimit(config.safety.maxMutationsPerSession);
    if (!limit.allowed) {
      return {
        status: 'blocked',
        reason: `Session mutation limit reached (${config.safety.maxMutationsPerSession}).`,
      };
    }

    try {
      const request: MutationRequest = {
        id: generateMutationId(),
        operation: 'opsgenie:acknowledgeAlert',
        resource: args.alert_id as string,
        description: `Acknowledge OpsGenie alert ${args.alert_id as string}`,
        riskLevel,
        parameters: {
          note: args.note as string | undefined,
        },
      };
      const approval = await requestApprovalWithOptions(request, {
        useSlack: config.incident.slack.enabled,
        autoApprove: autoApproveRisks,
      });
      if (!approval.approved) {
        return {
          status: 'rejected',
          reason: 'Operation rejected by user',
          alertId: args.alert_id as string,
        };
      }

      recordApprovedMutation(riskLevel);
      const result = await acknowledgeOpsGenieAlert(
        args.alert_id as string,
        args.note as string | undefined
      );

      return {
        success: true,
        requestId: result.requestId,
        message: 'Alert acknowledged',
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
);

/**
 * OpsGenie Close Alert Tool
 */
export const opsgenieCloseAlertTool = defineTool(
  'opsgenie_close_alert',
  `Close an OpsGenie alert.`,
  {
    type: 'object',
    properties: {
      alert_id: {
        type: 'string',
        description: 'OpsGenie alert ID',
      },
      note: {
        type: 'string',
        description: 'Optional resolution note',
      },
    },
    required: ['alert_id'],
  },
  async (args) => {
    if (!isOpsGenieConfigured()) {
      return {
        error: 'OpsGenie not configured',
        hint: 'Set OPSGENIE_API_KEY environment variable',
      };
    }
    const { config, autoApproveRisks } = await getSafetySettings();
    const riskLevel: RiskLevel = 'high';
    const limit = checkMutationLimit(config.safety.maxMutationsPerSession);
    if (!limit.allowed) {
      return {
        status: 'blocked',
        reason: `Session mutation limit reached (${config.safety.maxMutationsPerSession}).`,
      };
    }

    try {
      const request: MutationRequest = {
        id: generateMutationId(),
        operation: 'opsgenie:closeAlert',
        resource: args.alert_id as string,
        description: `Close OpsGenie alert ${args.alert_id as string}`,
        riskLevel,
        parameters: {
          note: args.note as string | undefined,
        },
      };
      const approval = await requestApprovalWithOptions(request, {
        useSlack: config.incident.slack.enabled,
        autoApprove: autoApproveRisks,
      });
      if (!approval.approved) {
        return {
          status: 'rejected',
          reason: 'Operation rejected by user',
          alertId: args.alert_id as string,
        };
      }

      recordApprovedMutation(riskLevel);
      const result = await closeOpsGenieAlert(
        args.alert_id as string,
        args.note as string | undefined
      );

      return {
        success: true,
        requestId: result.requestId,
        message: 'Alert closed',
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
);

toolRegistry.registerCategory('incident', 'Incident Management', [
  pagerdutyGetIncidentTool,
  pagerdutyListIncidentsTool,
  pagerdutyAddNoteTool,
  opsgenieGetAlertTool,
  opsgenieListAlertsTool,
  opsgenieGetIncidentTool,
  opsgenieListIncidentsTool,
  opsgenieAddNoteTool,
  opsgenieAcknowledgeAlertTool,
  opsgenieCloseAlertTool,
  slackPostUpdateTool,
  slackPostRootCauseTool,
  slackReadThreadTool,
  slackMessageTool,
]);

toolRegistry.registerCategory('skills', 'Skill Invocation', [skillTool]);

// ============================================================================
// Context Engineering Tools
// ============================================================================

/**
 * Scratchpad reference for get_full_result tool.
 * Set by the agent at runtime.
 */
let activeScratchpad: {
  getResultById: (id: string) => unknown;
  hasResult: (id: string) => boolean;
  getResultIds: () => string[];
} | null = null;

/**
 * Set the active scratchpad for the get_full_result tool.
 */
export function setActiveScratchpad(scratchpad: typeof activeScratchpad): void {
  activeScratchpad = scratchpad;
}

/**
 * Get Full Result Tool
 *
 * Retrieves full tool result by ID for drill-down after context compaction.
 */
export const getFullResultTool = defineTool(
  'get_full_result',
  `Retrieve the full result of a previous tool call by its result ID.

   Use when:
   - You need more details from a previously summarized result
   - A result was cleared from context due to token limits
   - You need to verify or examine raw data from an earlier tool call

   Result IDs look like: "aws-1a2b3c" or "cw_-4d5e6f"

   Available result IDs are shown when results are summarized or cleared.`,
  {
    type: 'object',
    properties: {
      result_id: {
        type: 'string',
        description: 'The result ID to retrieve (e.g., "aws-1a2b3c")',
      },
    },
    required: ['result_id'],
  },
  async (args) => {
    const resultId = args.result_id as string;

    if (!activeScratchpad) {
      return {
        error: 'Scratchpad not available',
        hint: 'This tool is only available during agent execution',
      };
    }

    if (!activeScratchpad.hasResult(resultId)) {
      const availableIds = activeScratchpad.getResultIds();
      return {
        error: `Result ID "${resultId}" not found`,
        availableIds: availableIds.slice(-10), // Show last 10 IDs
        hint: 'Result IDs are shown when results are summarized or cleared',
      };
    }

    const fullResult = activeScratchpad.getResultById(resultId);

    if (!fullResult) {
      return {
        error: `Failed to retrieve result for ID "${resultId}"`,
      };
    }

    return {
      resultId,
      result: fullResult,
      message: 'Full result retrieved successfully',
    };
  }
);

/**
 * List Available Results Tool
 *
 * Lists all available result IDs that can be retrieved.
 */
export const listResultsTool = defineTool(
  'list_results',
  `List all available tool result IDs that can be retrieved with get_full_result.

   Use when:
   - You need to see what results are available for drill-down
   - You want to check if a specific result is still available`,
  {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of IDs to return (default: 20)',
      },
    },
  },
  async (args) => {
    const limit = (args.limit as number) || 20;

    if (!activeScratchpad) {
      return {
        error: 'Scratchpad not available',
        hint: 'This tool is only available during agent execution',
      };
    }

    const allIds = activeScratchpad.getResultIds();

    return {
      resultIds: allIds.slice(-limit),
      total: allIds.length,
      showing: Math.min(limit, allIds.length),
    };
  }
);

toolRegistry.registerCategory('context', 'Context Management', [
  getFullResultTool,
  listResultsTool,
]);

// ============================================================================
// Diagram & Visualization Tools
// ============================================================================

import {
  mermaidToASCII,
  renderFlowchartASCII,
  renderSequenceDiagramASCII,
} from './diagram/mermaid';
import {
  generateLineChart,
  generateBarChart,
  generateSparkline,
  generateGauge,
  generateHistogram,
  type BarChartData,
} from './diagram/charts';

/**
 * Generate Flowchart Tool
 *
 * Creates ASCII flowcharts for visualizing processes, workflows, and decision trees.
 */
export const generateFlowchartTool = defineTool(
  'generate_flowchart',
  `Generate an ASCII flowchart to visualize processes, workflows, or decision trees.

   Use when:
   - Explaining a process or workflow
   - Visualizing system architecture
   - Showing decision flows
   - Illustrating data pipelines

   The flowchart supports:
   - Rectangular boxes for processes
   - Diamond shapes for decisions
   - Arrows showing flow direction
   - Labels on connections`,
  {
    type: 'object',
    properties: {
      nodes: {
        type: 'array',
        description: 'List of nodes in the flowchart',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique node identifier' },
            label: { type: 'string', description: 'Display label for the node' },
            shape: {
              type: 'string',
              enum: ['rect', 'diamond', 'circle', 'stadium'],
              description: 'Node shape (rect for process, diamond for decision)',
            },
          },
          required: ['id', 'label'],
        },
      },
      edges: {
        type: 'array',
        description: 'Connections between nodes',
        items: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'Source node ID' },
            to: { type: 'string', description: 'Target node ID' },
            label: { type: 'string', description: 'Optional label for the connection' },
          },
          required: ['from', 'to'],
        },
      },
      title: {
        type: 'string',
        description: 'Optional title for the flowchart',
      },
      direction: {
        type: 'string',
        enum: ['TD', 'LR', 'BT', 'RL'],
        description: 'Flow direction: TD (top-down), LR (left-right), etc.',
      },
    },
    required: ['nodes', 'edges'],
  },
  async (args) => {
    const nodes = args.nodes as Array<{ id: string; label: string; shape?: string }>;
    const edges = args.edges as Array<{ from: string; to: string; label?: string }>;
    const title = args.title as string | undefined;
    const direction = (args.direction as 'TD' | 'LR' | 'BT' | 'RL') || 'TD';

    // Build flowchart data
    const nodeMap = new Map<
      string,
      { id: string; label: string; shape: 'rect' | 'diamond' | 'circle' | 'stadium' }
    >();
    for (const node of nodes) {
      nodeMap.set(node.id, {
        id: node.id,
        label: node.label,
        shape: (node.shape as 'rect' | 'diamond' | 'circle' | 'stadium') || 'rect',
      });
    }

    const flowchartEdges = edges.map((e) => ({
      from: e.from,
      to: e.to,
      label: e.label,
      style: 'solid' as const,
      arrow: 'normal' as const,
    }));

    const flowchartData = {
      direction,
      nodes: nodeMap,
      edges: flowchartEdges,
    };

    const diagram = renderFlowchartASCII(flowchartData);

    return {
      type: 'flowchart',
      title,
      diagram: '\n' + (title ? `${title}\n${'─'.repeat(title.length)}\n\n` : '') + diagram,
    };
  }
);

/**
 * Generate Sequence Diagram Tool
 *
 * Creates ASCII sequence diagrams for showing service interactions over time.
 */
export const generateSequenceDiagramTool = defineTool(
  'generate_sequence_diagram',
  `Generate an ASCII sequence diagram to show service interactions over time.

   Use when:
   - Explaining how services communicate
   - Documenting API call flows
   - Visualizing request/response patterns
   - Showing message passing between components`,
  {
    type: 'object',
    properties: {
      participants: {
        type: 'array',
        description: 'List of participants (services, actors, etc.)',
        items: { type: 'string' },
      },
      messages: {
        type: 'array',
        description: 'Messages between participants in order',
        items: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'Sender participant' },
            to: { type: 'string', description: 'Receiver participant' },
            message: { type: 'string', description: 'Message content' },
            type: {
              type: 'string',
              enum: ['solid', 'dotted', 'async'],
              description: 'Line style (solid for sync, dotted for response, async for async)',
            },
          },
          required: ['from', 'to', 'message'],
        },
      },
      title: {
        type: 'string',
        description: 'Optional title for the diagram',
      },
    },
    required: ['participants', 'messages'],
  },
  async (args) => {
    const participants = args.participants as string[];
    const messages = args.messages as Array<{
      from: string;
      to: string;
      message: string;
      type?: string;
    }>;
    const title = args.title as string | undefined;

    const sequenceData = {
      participants,
      messages: messages.map((m) => ({
        from: m.from,
        to: m.to,
        message: m.message,
        type: (m.type as 'solid' | 'dotted' | 'async') || 'solid',
      })),
    };

    const diagram = renderSequenceDiagramASCII(sequenceData);

    return {
      type: 'sequence',
      title,
      diagram: '\n' + (title ? `${title}\n${'─'.repeat(title.length)}\n\n` : '') + diagram,
    };
  }
);

/**
 * Generate Architecture Diagram Tool
 *
 * Creates ASCII diagrams showing system components and relationships.
 */
export const generateArchitectureDiagramTool = defineTool(
  'generate_architecture_diagram',
  `Generate an ASCII architecture diagram showing system components and relationships.

   Use when:
   - Explaining system architecture
   - Showing infrastructure components
   - Visualizing service dependencies
   - Documenting deployment topology`,
  {
    type: 'object',
    properties: {
      components: {
        type: 'array',
        description: 'System components',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique component ID' },
            name: { type: 'string', description: 'Component name' },
            type: {
              type: 'string',
              enum: ['service', 'database', 'queue', 'cache', 'external', 'load_balancer'],
              description: 'Component type',
            },
          },
          required: ['id', 'name'],
        },
      },
      connections: {
        type: 'array',
        description: 'Connections between components',
        items: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'Source component ID' },
            to: { type: 'string', description: 'Target component ID' },
            label: { type: 'string', description: 'Connection label (e.g., HTTP, TCP, etc.)' },
          },
          required: ['from', 'to'],
        },
      },
      title: {
        type: 'string',
        description: 'Diagram title',
      },
    },
    required: ['components', 'connections'],
  },
  async (args) => {
    const components = args.components as Array<{ id: string; name: string; type?: string }>;
    const connections = args.connections as Array<{ from: string; to: string; label?: string }>;
    const title = args.title as string | undefined;

    // Map component types to shapes
    const typeToShape: Record<string, 'rect' | 'diamond' | 'circle' | 'stadium'> = {
      service: 'rect',
      database: 'stadium',
      queue: 'stadium',
      cache: 'circle',
      external: 'diamond',
      load_balancer: 'diamond',
    };

    const nodeMap = new Map<
      string,
      { id: string; label: string; shape: 'rect' | 'diamond' | 'circle' | 'stadium' }
    >();
    for (const comp of components) {
      nodeMap.set(comp.id, {
        id: comp.id,
        label: comp.name,
        shape: typeToShape[comp.type || 'service'] || 'rect',
      });
    }

    const edges = connections.map((c) => ({
      from: c.from,
      to: c.to,
      label: c.label,
      style: 'solid' as const,
      arrow: 'normal' as const,
    }));

    const flowchartData = {
      direction: 'LR' as const,
      nodes: nodeMap,
      edges,
    };

    const diagram = renderFlowchartASCII(flowchartData);

    // Add legend for component types
    const legend = `
Legend:
  ┌────┐ Service    ╭────╮ Database/Queue
  └────┘            ╰────╯
     ◆   External      ○   Cache
`;

    return {
      type: 'architecture',
      title,
      diagram: '\n' + (title ? `${title}\n${'─'.repeat(title.length)}\n\n` : '') + diagram + legend,
    };
  }
);

/**
 * Visualize Metrics Tool
 *
 * Creates ASCII charts for time-series data and metrics visualization.
 */
export const visualizeMetricsTool = defineTool(
  'visualize_metrics',
  `Generate ASCII charts to visualize metrics and time-series data.

   Use when:
   - Showing trends over time
   - Comparing values across categories
   - Displaying distribution of data
   - Visualizing system metrics (CPU, memory, etc.)

   Supports:
   - Line charts for trends
   - Bar charts for comparisons
   - Sparklines for compact inline display
   - Gauges for percentage indicators
   - Histograms for distributions`,
  {
    type: 'object',
    properties: {
      chart_type: {
        type: 'string',
        enum: ['line', 'bar', 'sparkline', 'gauge', 'histogram'],
        description: 'Type of chart to generate',
      },
      data: {
        type: 'array',
        description: 'Data points for the chart (objects with value property)',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Data point label (for bar charts)' },
            value: { type: 'number', description: 'Numeric value' },
            timestamp: { type: 'number', description: 'Unix timestamp (for line charts)' },
          },
          required: ['value'],
        },
      },
      values: {
        type: 'array',
        description:
          'Simple array of numbers for sparklines. Use this OR data, not both. Example: [0, 5, 10, 8, 12]',
        items: { type: 'number' },
      },
      title: {
        type: 'string',
        description: 'Chart title',
      },
      max: {
        type: 'number',
        description: 'Maximum value (for gauge charts)',
      },
      thresholds: {
        type: 'object',
        properties: {
          warn: { type: 'number', description: 'Warning threshold percentage' },
          critical: { type: 'number', description: 'Critical threshold percentage' },
        },
        description: 'Thresholds for gauge charts',
      },
    },
    required: ['chart_type'],
  },
  async (args) => {
    const chartType = args.chart_type as string;
    const data = (args.data || []) as Array<{ label?: string; value: number; timestamp?: number }>;
    const simpleValues = args.values as number[] | undefined;
    const title = args.title as string | undefined;
    const max = args.max as number | undefined;
    const thresholds = args.thresholds as { warn?: number; critical?: number } | undefined;

    let chart: string;

    switch (chartType) {
      case 'line': {
        const values = simpleValues || data.map((d) => d.value);
        chart = generateLineChart(values, { title });
        break;
      }

      case 'bar': {
        const barData: BarChartData[] = data.map((d, i) => ({
          label: d.label || `Item ${i + 1}`,
          value: d.value,
        }));
        chart = generateBarChart(barData, { title });
        break;
      }

      case 'sparkline': {
        // Prefer simple 'values' array if provided, otherwise extract from 'data'
        let values: number[];
        if (simpleValues && Array.isArray(simpleValues)) {
          values = simpleValues.map((v) => (typeof v === 'number' ? v : parseFloat(String(v))));
        } else if (data && Array.isArray(data)) {
          values = data.map((d) => {
            if (typeof d === 'number') return d;
            if (typeof d === 'object' && d !== null && 'value' in d) {
              const val = (d as { value: unknown }).value;
              return typeof val === 'number' ? val : parseFloat(String(val));
            }
            return NaN;
          });
        } else {
          values = [];
        }
        chart = (title ? `${title}: ` : '') + generateSparkline(values);
        break;
      }

      case 'gauge': {
        const value = data[0]?.value || 0;
        chart = generateGauge(value, max || 100, {
          title,
          thresholds: thresholds
            ? { warn: thresholds.warn || 70, critical: thresholds.critical || 90 }
            : undefined,
        });
        break;
      }

      case 'histogram': {
        const values = data.map((d) => d.value);
        chart = generateHistogram(values, 10, { title });
        break;
      }

      default:
        return { error: `Unknown chart type: ${chartType}` };
    }

    return {
      type: chartType,
      title,
      chart: '\n' + chart,
    };
  }
);

/**
 * Render Mermaid Diagram Tool
 *
 * Converts mermaid syntax directly to ASCII art.
 */
export const renderMermaidTool = defineTool(
  'render_mermaid',
  `Convert mermaid diagram syntax to ASCII art for terminal display.

   Supports:
   - Flowcharts (graph TD/LR)
   - Sequence diagrams (sequenceDiagram)
   - State diagrams (stateDiagram)

   Use when you have existing mermaid syntax and want to display it.`,
  {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Mermaid diagram code',
      },
    },
    required: ['code'],
  },
  async (args) => {
    const code = args.code as string;

    try {
      const diagram = mermaidToASCII(code);
      return {
        diagram: '\n' + diagram,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to render mermaid diagram',
        code,
      };
    }
  }
);

toolRegistry.registerCategory('diagram', 'Diagrams & Visualization', [
  generateFlowchartTool,
  generateSequenceDiagramTool,
  generateArchitectureDiagramTool,
  visualizeMetricsTool,
  renderMermaidTool,
]);
