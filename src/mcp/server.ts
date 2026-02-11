/**
 * MCP Server for RunbookAI Knowledge Access
 *
 * Exposes RunbookAI's knowledge base and investigation capabilities
 * to Claude Code via the Model Context Protocol.
 */

import { createRetriever, KnowledgeRetriever } from '../knowledge/retriever/index';
import type { RetrievedChunk, KnowledgeType } from '../knowledge/types';

/**
 * MCP Tool definition
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, MCPPropertySchema>;
    required?: string[];
  };
}

export interface MCPPropertySchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  items?: MCPPropertySchema;
  enum?: string[];
  default?: unknown;
}

/**
 * MCP Tool call request
 */
export interface MCPToolCallRequest {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * MCP Tool call response
 */
export interface MCPToolCallResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

/**
 * MCP Resource definition
 */
export interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

/**
 * MCP Resource read response
 */
export interface MCPResourceReadResponse {
  contents: Array<{
    uri: string;
    mimeType: string;
    text: string;
  }>;
}

/**
 * Available MCP tools
 */
export const MCP_TOOLS: MCPTool[] = [
  {
    name: 'search_runbooks',
    description:
      'Search organizational runbooks for troubleshooting procedures and operational guides. Returns relevant runbooks with content previews.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (e.g., "database connection timeout", "high latency")',
        },
        services: {
          type: 'array',
          description: 'Filter by service names',
          items: { type: 'string', description: 'Service name' },
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 5)',
          default: 5,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_known_issues',
    description:
      'Get active known issues that may explain current symptoms. Known issues include workarounds and related tickets.',
    inputSchema: {
      type: 'object',
      properties: {
        services: {
          type: 'array',
          description: 'Services to check for known issues',
          items: { type: 'string', description: 'Service name' },
        },
        symptoms: {
          type: 'array',
          description: 'Symptoms to match against known issues',
          items: { type: 'string', description: 'Symptom description' },
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 5)',
          default: 5,
        },
      },
    },
  },
  {
    name: 'search_postmortems',
    description:
      'Search past incident postmortems for similar issues. Useful for understanding historical context and proven solutions.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for postmortems',
        },
        services: {
          type: 'array',
          description: 'Filter by affected services',
          items: { type: 'string', description: 'Service name' },
        },
        rootCause: {
          type: 'string',
          description: 'Search by root cause type (e.g., "configuration", "capacity")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 3)',
          default: 3,
        },
      },
    },
  },
  {
    name: 'get_knowledge_stats',
    description: 'Get statistics about available knowledge in the RunbookAI knowledge base.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_services',
    description: 'List all services that have associated runbooks or documentation.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Filter by knowledge type',
          enum: ['runbook', 'postmortem', 'architecture', 'known_issue'],
        },
      },
    },
  },
];

/**
 * MCP Server configuration
 */
export interface MCPServerConfig {
  baseDir: string;
}

const DEFAULT_CONFIG: MCPServerConfig = {
  baseDir: '.runbook',
};

/**
 * Format retrieved chunks as text output
 */
function formatChunks(chunks: RetrievedChunk[], type: string): string {
  if (chunks.length === 0) {
    return `No ${type} found matching your query.`;
  }

  const lines: string[] = [`## ${type} (${chunks.length} results)\n`];

  for (const chunk of chunks) {
    const score = Math.round(chunk.score * 100);
    lines.push(`### ${chunk.title}`);
    lines.push(`- **Relevance:** ${score}%`);
    lines.push(`- **Services:** ${chunk.services.join(', ') || 'general'}`);
    if (chunk.sourceUrl) {
      lines.push(`- **Source:** ${chunk.sourceUrl}`);
    }
    lines.push('');
    // Limit content to 1000 chars per chunk
    const content = chunk.content.slice(0, 1000);
    lines.push(content);
    if (chunk.content.length > 1000) {
      lines.push('\n_[Content truncated]_');
    }
    lines.push('\n---\n');
  }

  return lines.join('\n');
}

/**
 * Handle search_runbooks tool call
 */
async function handleSearchRunbooks(
  args: Record<string, unknown>,
  retriever: KnowledgeRetriever
): Promise<MCPToolCallResponse> {
  const query = String(args.query || '');
  const services = Array.isArray(args.services) ? args.services.map(String) : undefined;
  const limit = typeof args.limit === 'number' ? args.limit : 5;

  const knowledge = await retriever.search(query, {
    typeFilter: ['runbook'],
    serviceFilter: services,
    limit,
  });

  return {
    content: [
      {
        type: 'text',
        text: formatChunks(knowledge.runbooks, 'Runbooks'),
      },
    ],
  };
}

/**
 * Handle get_known_issues tool call
 */
async function handleGetKnownIssues(
  args: Record<string, unknown>,
  retriever: KnowledgeRetriever
): Promise<MCPToolCallResponse> {
  const services = Array.isArray(args.services) ? args.services.map(String) : [];
  const symptoms = Array.isArray(args.symptoms) ? args.symptoms.map(String) : [];
  const limit = typeof args.limit === 'number' ? args.limit : 5;

  const query = [...services, ...symptoms].join(' ') || '*';

  const knowledge = await retriever.search(query, {
    typeFilter: ['known_issue'],
    serviceFilter: services.length > 0 ? services : undefined,
    limit,
  });

  return {
    content: [
      {
        type: 'text',
        text: formatChunks(knowledge.knownIssues, 'Known Issues'),
      },
    ],
  };
}

/**
 * Handle search_postmortems tool call
 */
async function handleSearchPostmortems(
  args: Record<string, unknown>,
  retriever: KnowledgeRetriever
): Promise<MCPToolCallResponse> {
  const query = String(args.query || args.rootCause || '*');
  const services = Array.isArray(args.services) ? args.services.map(String) : undefined;
  const limit = typeof args.limit === 'number' ? args.limit : 3;

  const knowledge = await retriever.search(query, {
    typeFilter: ['postmortem'],
    serviceFilter: services,
    limit,
  });

  return {
    content: [
      {
        type: 'text',
        text: formatChunks(knowledge.postmortems, 'Postmortems'),
      },
    ],
  };
}

/**
 * Handle get_knowledge_stats tool call
 */
async function handleGetKnowledgeStats(
  retriever: KnowledgeRetriever
): Promise<MCPToolCallResponse> {
  const counts = retriever.getDocumentCountsByType();
  const total = Object.values(counts).reduce((sum, c) => sum + c, 0);

  const lines: string[] = [
    '## RunbookAI Knowledge Base Statistics\n',
    `**Total Documents:** ${total}\n`,
    '### By Type:',
    `- Runbooks: ${counts.runbook || 0}`,
    `- Postmortems: ${counts.postmortem || 0}`,
    `- Known Issues: ${counts.known_issue || 0}`,
    `- Architecture Docs: ${counts.architecture || 0}`,
    `- FAQs: ${counts.faq || 0}`,
    `- Playbooks: ${counts.playbook || 0}`,
  ];

  return {
    content: [
      {
        type: 'text',
        text: lines.join('\n'),
      },
    ],
  };
}

/**
 * Handle list_services tool call
 */
async function handleListServices(
  args: Record<string, unknown>,
  retriever: KnowledgeRetriever
): Promise<MCPToolCallResponse> {
  const typeFilter = typeof args.type === 'string' ? [args.type as KnowledgeType] : undefined;

  const allDocs = retriever.getAllDocuments();
  const services = new Set<string>();

  for (const doc of allDocs) {
    if (typeFilter && !typeFilter.includes(doc.type)) {
      continue;
    }
    for (const service of doc.services) {
      services.add(service);
    }
  }

  const sortedServices = Array.from(services).sort();

  if (sortedServices.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No services found in the knowledge base.',
        },
      ],
    };
  }

  const lines: string[] = [
    `## Services with Documentation (${sortedServices.length})\n`,
    ...sortedServices.map((s) => `- ${s}`),
  ];

  return {
    content: [
      {
        type: 'text',
        text: lines.join('\n'),
      },
    ],
  };
}

/**
 * MCP Server class
 */
export class MCPServer {
  private config: MCPServerConfig;
  private retriever: KnowledgeRetriever | null = null;

  constructor(config: Partial<MCPServerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get available tools
   */
  getTools(): MCPTool[] {
    return MCP_TOOLS;
  }

  /**
   * Initialize the retriever
   */
  private getRetriever(): KnowledgeRetriever {
    if (!this.retriever) {
      this.retriever = createRetriever(this.config.baseDir);
    }
    return this.retriever;
  }

  /**
   * Handle a tool call
   */
  async handleToolCall(request: MCPToolCallRequest): Promise<MCPToolCallResponse> {
    const retriever = this.getRetriever();

    try {
      switch (request.name) {
        case 'search_runbooks':
          return await handleSearchRunbooks(request.arguments, retriever);
        case 'get_known_issues':
          return await handleGetKnownIssues(request.arguments, retriever);
        case 'search_postmortems':
          return await handleSearchPostmortems(request.arguments, retriever);
        case 'get_knowledge_stats':
          return await handleGetKnowledgeStats(retriever);
        case 'list_services':
          return await handleListServices(request.arguments, retriever);
        default:
          return {
            content: [
              {
                type: 'text',
                text: `Unknown tool: ${request.name}`,
              },
            ],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error executing tool: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Handle tools/list request
   */
  handleListTools(): { tools: MCPTool[] } {
    return { tools: this.getTools() };
  }

  /**
   * Close the server and clean up resources
   */
  close(): void {
    this.retriever?.close();
    this.retriever = null;
  }
}

/**
 * Create an MCP server instance
 */
export function createMCPServer(config?: Partial<MCPServerConfig>): MCPServer {
  return new MCPServer(config);
}

/**
 * Run the MCP server in stdio mode
 * This reads JSON-RPC messages from stdin and writes responses to stdout
 */
export async function runStdioServer(config?: Partial<MCPServerConfig>): Promise<void> {
  const server = createMCPServer(config);

  // Read JSON-RPC messages from stdin
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  // Handle JSON-RPC messages
  rl.on('line', async (line) => {
    try {
      const message = JSON.parse(line);
      let response: unknown;

      if (message.method === 'tools/list') {
        response = {
          jsonrpc: '2.0',
          id: message.id,
          result: server.handleListTools(),
        };
      } else if (message.method === 'tools/call') {
        const result = await server.handleToolCall({
          name: message.params.name,
          arguments: message.params.arguments || {},
        });
        response = {
          jsonrpc: '2.0',
          id: message.id,
          result,
        };
      } else if (message.method === 'initialize') {
        response = {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: {
              name: 'runbook-ai',
              version: '1.0.0',
            },
            capabilities: {
              tools: {},
            },
          },
        };
      } else {
        response = {
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32601,
            message: `Method not found: ${message.method}`,
          },
        };
      }

      console.log(JSON.stringify(response));
    } catch (error) {
      console.log(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: `Parse error: ${error instanceof Error ? error.message : String(error)}`,
          },
        })
      );
    }
  });

  rl.on('close', () => {
    server.close();
    process.exit(0);
  });
}
