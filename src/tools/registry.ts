/**
 * Tool Registry
 *
 * Central registry for all available tools. Tools are organized by category
 * and can be selectively enabled based on configuration.
 */

import type { Tool } from '../agent/types';
import { getActiveAlarms, filterLogEvents, listLogGroups } from './aws/cloudwatch';
import { getIncident, getIncidentAlerts, listIncidents, addIncidentNote } from './incident/pagerduty';
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

   Skills provide step-by-step procedures for complex tasks like:
   - investigate-incident: Full hypothesis-driven investigation
   - deploy-service: Safe deployment workflow
   - scale-service: Capacity planning and scaling
   - troubleshoot-service: General troubleshooting`,
  {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name of the skill to invoke',
      },
      args: {
        type: 'object',
        description: 'Arguments for the skill',
      },
    },
    required: ['name'],
  },
  async (args) => {
    // Placeholder - will be implemented with skill system
    return { message: 'Skill system not yet implemented', args };
  }
);

// Register default tools
toolRegistry.registerCategory('aws', 'AWS Cloud Operations', [
  awsQueryTool,
  awsMutateTool,
  cloudwatchAlarmsTool,
  cloudwatchLogsTool,
]);

toolRegistry.registerCategory('knowledge', 'Knowledge Base', [
  searchKnowledgeTool,
]);

toolRegistry.registerCategory('incident', 'Incident Management', [
  pagerdutyGetIncidentTool,
  pagerdutyListIncidentsTool,
]);

toolRegistry.registerCategory('skills', 'Skill Invocation', [skillTool]);
