/**
 * Tool Registry
 *
 * Central registry for all available tools. Tools are organized by category
 * and can be selectively enabled based on configuration.
 */

import type { Tool } from '../agent/types';
import { getActiveAlarms, filterLogEvents, listLogGroups } from './aws/cloudwatch';
import { getIncident, getIncidentAlerts, listIncidents, addIncidentNote } from './incident/pagerduty';
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
import { AWS_SERVICES, getServiceById, getAllServiceIds, CATEGORY_DESCRIPTIONS } from '../providers/aws/services';
import { executeListOperation, executeMultiServiceQuery, getInstalledServices } from '../providers/aws/executor';
import {
  classifyRisk,
  requestApproval,
  generateMutationId,
  checkCooldown,
  recordCriticalMutation,
  type MutationRequest,
} from '../agent/approval';

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
  registerCategory(
    name: string,
    description: string,
    tools: Tool[]
  ): void {
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
        enum: ['compute', 'database', 'storage', 'networking', 'security', 'analytics', 'integration', 'devtools', 'ml', 'management'],
      },
      region: {
        type: 'string',
        description: 'AWS region (defaults to us-east-1)',
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
    const region = args.region as string | undefined;
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

      for (const [serviceId, result] of Object.entries(results)) {
        if (result.error) {
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
        _meta: {
          region: region || 'us-east-1',
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

    // Classify risk level
    const riskLevel = classifyRisk(operation, resource);

    // Check cooldown for critical operations
    if (riskLevel === 'critical') {
      const cooldown = checkCooldown(operation, 60000);
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

    // Request approval
    const approval = await requestApproval(request);

    if (!approval.approved) {
      return {
        status: 'rejected',
        reason: 'Operation rejected by user',
        mutationId: request.id,
        riskLevel,
      };
    }

    // Record critical mutation for cooldown
    if (riskLevel === 'critical') {
      recordCriticalMutation();
    }

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
      const { EC2Client, RebootInstancesCommand, StopInstancesCommand, StartInstancesCommand } = await import('@aws-sdk/client-ec2');
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
      const { LambdaClient, UpdateFunctionConfigurationCommand } = await import('@aws-sdk/client-lambda');
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
      throw new Error(`Unsupported operation: ${operation}. Supported: ecs:UpdateService, ec2:RebootInstances, ec2:StopInstances, ec2:StartInstances, lambda:UpdateFunctionConfiguration`);
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
        typeFilter: args.type_filter as Array<'runbook' | 'postmortem' | 'architecture' | 'known_issue'> | undefined,
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

      if (state === 'all' || !state) {
        const alarms = await getActiveAlarms(region);
        return { alarms, count: alarms.length };
      }

      const alarms = await getActiveAlarms(region);
      const filtered = alarms.filter((a) => a.stateValue === state);
      return { alarms: filtered, count: filtered.length };
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
    const skillName = args.name as string;
    const skillArgs = (args.args as Record<string, unknown>) || {};

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

    // Return skill info for agent to execute steps
    return {
      skill: {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        riskLevel: skill.riskLevel,
        steps: skill.steps.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          action: s.action,
          requiresApproval: s.requiresApproval,
        })),
      },
      parameters: skillArgs,
      message: `Skill "${skill.name}" loaded with ${skill.steps.length} steps. Execute each step in sequence.`,
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

// Register default tools
toolRegistry.registerCategory('aws', 'AWS Cloud Operations', [
  awsQueryTool,
  awsMutateTool,
  cloudwatchAlarmsTool,
  cloudwatchLogsTool,
]);

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
              lastValue: r.values && r.values.length > 0 ? parseFloat(r.values[r.values.length - 1][1]) : null,
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

toolRegistry.registerCategory('knowledge', 'Knowledge Base', [
  searchKnowledgeTool,
]);

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

    try {
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

    try {
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
