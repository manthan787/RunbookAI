/**
 * Tool Registry
 *
 * Central registry for all available tools. Tools are organized by category
 * and can be selectively enabled based on configuration.
 */

import type { Tool } from '../agent/types';
import { describeInstances } from './aws/ec2';
import { listClusters, getAllServicesWithStatus } from './aws/ecs';
import { listFunctions } from './aws/lambda';
import { describeDBInstances, describeDBClusters } from './aws/rds';
import { describeTables } from './aws/dynamodb';
import { getAllAppsWithStatus } from './aws/amplify';
import { getActiveAlarms, filterLogEvents, listLogGroups } from './aws/cloudwatch';
import { getIncident, getIncidentAlerts, listIncidents, addIncidentNote } from './incident/pagerduty';
import { createRetriever } from '../knowledge/retriever';
import { getEnabledServices } from '../providers/aws/client';

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

/**
 * AWS Query Tool - Meta-router for read-only AWS operations
 */
export const awsQueryTool = defineTool(
  'aws_query',
  `Query AWS infrastructure state. This is a read-only meta-tool that routes
   natural language queries to appropriate AWS APIs.

   Use for:
   - "What EC2 instances are running?"
   - "Show me the ECS services in prod"
   - "What's the status of the checkout-api Lambda?"
   - "List all Lambda functions"
   - "Show me DynamoDB tables"
   - "What Amplify apps are deployed?"

   Do NOT use for mutations - use aws_mutate instead.`,
  {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language query about AWS infrastructure',
      },
      resource_type: {
        type: 'string',
        description: 'Type of resource to query: ec2, ecs, lambda, rds, dynamodb, amplify, elasticache',
        enum: ['ec2', 'ecs', 'lambda', 'rds', 'dynamodb', 'amplify', 'elasticache', 'all'],
      },
      region: {
        type: 'string',
        description: 'AWS region (defaults to us-east-1)',
      },
      account: {
        type: 'string',
        description: 'AWS account name (from service config, defaults to default account)',
      },
    },
    required: ['query'],
  },
  async (args) => {
    const region = args.region as string | undefined;
    const accountName = args.account as string | undefined;
    const resourceType = (args.resource_type as string) || 'all';
    const results: Record<string, unknown> = {};

    try {
      // Get enabled services from config
      const enabled = await getEnabledServices();
      const allCompute = enabled.compute;
      const allDatabases = enabled.databases;
      const allStorage = enabled.storage;

      // Helper to check if a service is enabled (or if no config exists, allow all)
      const isEnabled = (type: string, category: string[]) => {
        // If no services are configured, allow everything (for users who haven't set up config)
        if (category.length === 0) return true;
        return category.includes(type);
      };

      // Route based on resource type or query all
      if ((resourceType === 'ec2' || resourceType === 'all') && isEnabled('ec2', allCompute)) {
        const instances = await describeInstances(undefined, region);
        results.ec2_instances = instances.map((i) => ({
          id: i.instanceId,
          name: i.name,
          type: i.instanceType,
          state: i.state,
          privateIp: i.privateIp,
          publicIp: i.publicIp,
        }));
      }

      if ((resourceType === 'ecs' || resourceType === 'all') && isEnabled('ecs', allCompute)) {
        const clusters = await listClusters(region);
        const services = await getAllServicesWithStatus(region);
        results.ecs_clusters = clusters;
        results.ecs_services = services.map((s) => ({
          name: s.serviceName,
          cluster: s.clusterArn.split('/').pop(),
          status: s.status,
          running: s.runningCount,
          desired: s.desiredCount,
          pending: s.pendingCount,
        }));
      }

      if ((resourceType === 'lambda' || resourceType === 'all') && isEnabled('lambda', allCompute)) {
        const functions = await listFunctions(region);
        results.lambda_functions = functions.map((f) => ({
          name: f.functionName,
          runtime: f.runtime,
          memory: f.memorySize,
          timeout: f.timeout,
          state: f.state,
        }));
      }

      if ((resourceType === 'rds' || resourceType === 'all') && isEnabled('rds', allDatabases)) {
        const [instances, clusters] = await Promise.all([
          describeDBInstances(undefined, region),
          describeDBClusters(undefined, region),
        ]);
        results.rds_instances = instances.map((db) => ({
          id: db.dbInstanceIdentifier,
          class: db.dbInstanceClass,
          engine: `${db.engine} ${db.engineVersion}`,
          status: db.dbInstanceStatus,
          multiAZ: db.multiAZ,
        }));
        results.rds_clusters = clusters.map((c) => ({
          id: c.dbClusterIdentifier,
          engine: `${c.engine} ${c.engineVersion}`,
          status: c.status,
          members: c.members,
        }));
      }

      if ((resourceType === 'dynamodb' || resourceType === 'all') && isEnabled('dynamodb', allDatabases)) {
        const tables = await describeTables(undefined, accountName, region);
        results.dynamodb_tables = tables.map((t) => ({
          name: t.tableName,
          status: t.tableStatus,
          itemCount: t.itemCount,
          sizeBytes: t.tableSizeBytes,
          billingMode: t.billingMode,
          keys: t.keySchema.map((k) => `${k.attributeName} (${k.keyType})`).join(', '),
        }));
      }

      if ((resourceType === 'amplify' || resourceType === 'all') && isEnabled('amplify', allCompute)) {
        const apps = await getAllAppsWithStatus(accountName, region);
        results.amplify_apps = apps.map((app) => ({
          id: app.appId,
          name: app.name,
          repository: app.repository,
          platform: app.platform,
          productionBranch: app.productionBranch?.branchName,
          customDomains: app.customDomains,
          branches: app.branches.map((b) => ({
            name: b.branchName,
            stage: b.stage,
            status: b.status,
          })),
        }));
      }

      // Include info about which services were queried
      results._meta = {
        enabledCompute: allCompute.length > 0 ? allCompute : ['all (no config)'],
        enabledDatabases: allDatabases.length > 0 ? allDatabases : ['all (no config)'],
        queriedType: resourceType,
      };

      return results;
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown error querying AWS',
        hint: 'Make sure AWS credentials are configured (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, or AWS profile)',
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
   - Scaling services
   - Updating deployments
   - Restarting instances
   - Modifying configurations

   Always provide rollback instructions.`,
  {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        description: 'The AWS operation to perform (e.g., ecs:UpdateService)',
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
        description: 'Command to rollback this change',
      },
    },
    required: ['operation', 'parameters', 'description'],
  },
  async (args) => {
    // Placeholder - will be implemented with approval flow
    return { message: 'AWS mutate tool not yet implemented', args };
  }
);

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
