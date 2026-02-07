/**
 * Tool Registry
 *
 * Central registry for all available tools. Tools are organized by category
 * and can be selectively enabled based on configuration.
 */

import type { Tool } from '../agent/types';

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
   - "Get CloudWatch metrics for RDS connections"

   Do NOT use for mutations - use aws_mutate instead.`,
  {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language query about AWS infrastructure',
      },
      region: {
        type: 'string',
        description: 'AWS region (defaults to configured default)',
      },
    },
    required: ['query'],
  },
  async (args) => {
    // Placeholder - will be implemented with actual AWS SDK calls
    return { message: 'AWS query tool not yet implemented', args };
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
    // Placeholder - will be implemented with knowledge system
    return { message: 'Knowledge search not yet implemented', args };
  }
);

/**
 * PagerDuty Get Incident Tool
 */
export const pagerdutyGetIncidentTool = defineTool(
  'pagerduty_get_incident',
  `Fetch details about a PagerDuty incident.

   Returns:
   - Incident status and urgency
   - Triggered alerts
   - Assigned responders
   - Service information
   - Timeline of events`,
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
    // Placeholder - will be implemented with PagerDuty API
    return { message: 'PagerDuty integration not yet implemented', args };
  }
);

/**
 * PagerDuty Add Note Tool
 */
export const pagerdutyAddNoteTool = defineTool(
  'pagerduty_add_note',
  `Add an investigation note to a PagerDuty incident.

   Use to:
   - Document investigation progress
   - Share findings with responders
   - Record remediation steps taken`,
  {
    type: 'object',
    properties: {
      incident_id: {
        type: 'string',
        description: 'PagerDuty incident ID',
      },
      note: {
        type: 'string',
        description: 'Note content (markdown supported)',
      },
    },
    required: ['incident_id', 'note'],
  },
  async (args) => {
    // Placeholder
    return { message: 'PagerDuty integration not yet implemented', args };
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
]);

toolRegistry.registerCategory('knowledge', 'Knowledge Base', [
  searchKnowledgeTool,
]);

toolRegistry.registerCategory('incident', 'Incident Management', [
  pagerdutyGetIncidentTool,
  pagerdutyAddNoteTool,
]);

toolRegistry.registerCategory('skills', 'Skill Invocation', [skillTool]);
