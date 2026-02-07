/**
 * Main Agent class
 *
 * Orchestrates the research-first, hypothesis-driven investigation loop.
 */

import type {
  AgentEvent,
  AgentConfig,
  Tool,
  RetrievedKnowledge,
  InvestigationContext,
} from './types';
import { Scratchpad } from './scratchpad';
import { HypothesisEngine } from './hypothesis';
import { SafetyManager } from './safety';
import {
  buildSystemPrompt,
  buildIterationPrompt,
  buildFinalAnswerPrompt,
  buildKnowledgePrompt,
  buildHypothesisContext,
} from './prompts';
import { estimateTokens } from '../utils/tokens';

const DEFAULT_CONFIG: AgentConfig = {
  maxIterations: 10,
  maxHypothesisDepth: 4,
  contextThresholdTokens: 100000,
  keepToolUses: 5,
  toolLimits: {
    aws_query: 10,
    search_knowledge: 5,
    web_search: 3,
  },
};

export interface AgentDependencies {
  llm: LLMClient;
  tools: Tool[];
  skills: string[];
  knowledgeRetriever?: KnowledgeRetriever;
  config?: Partial<AgentConfig>;
  scratchpadDir?: string;
}

// Interfaces for dependencies (to be implemented)
export interface LLMClient {
  chat(
    systemPrompt: string,
    userPrompt: string,
    tools?: Tool[]
  ): Promise<LLMResponse>;
}

export interface LLMResponse {
  content: string;
  toolCalls: ToolCall[];
  thinking?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface KnowledgeRetriever {
  retrieve(context: InvestigationContext): Promise<RetrievedKnowledge>;
}

export class Agent {
  private readonly config: AgentConfig;
  private readonly llm: LLMClient;
  private readonly tools: Map<string, Tool>;
  private readonly skills: string[];
  private readonly knowledgeRetriever?: KnowledgeRetriever;
  private readonly safety: SafetyManager;
  private readonly scratchpadDir: string;
  private systemPrompt: string;

  constructor(deps: AgentDependencies) {
    this.config = { ...DEFAULT_CONFIG, ...deps.config };
    this.llm = deps.llm;
    this.tools = new Map(deps.tools.map((t) => [t.name, t]));
    this.skills = deps.skills;
    this.knowledgeRetriever = deps.knowledgeRetriever;
    this.safety = new SafetyManager();
    this.scratchpadDir = deps.scratchpadDir || '.runbook/scratchpad';
    this.systemPrompt = buildSystemPrompt(deps.tools, deps.skills);
  }

  /**
   * Run the agent on a query
   *
   * Yields events as the investigation progresses.
   */
  async *run(query: string, incidentId?: string): AsyncGenerator<AgentEvent> {
    // Initialize scratchpad
    const sessionId = Scratchpad.generateSessionId();
    const scratchpad = new Scratchpad(
      this.scratchpadDir,
      sessionId,
      this.config.toolLimits
    );
    await scratchpad.append({ type: 'init', query, incidentId });

    // Initialize hypothesis engine for investigations
    const hypothesisEngine = incidentId
      ? new HypothesisEngine(incidentId, query, this.config.maxHypothesisDepth)
      : null;

    // Retrieve relevant knowledge
    let knowledge: RetrievedKnowledge | undefined;
    if (this.knowledgeRetriever) {
      const context: InvestigationContext = {
        incidentId,
        services: [], // Will be populated from query analysis
        symptoms: [],
        errorMessages: [],
        timeWindow: {
          start: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // Last hour
          end: new Date().toISOString(),
        },
      };
      knowledge = await this.knowledgeRetriever.retrieve(context);

      if (knowledge.runbooks.length > 0 || knowledge.postmortems.length > 0) {
        yield {
          type: 'knowledge_retrieved',
          documentCount:
            knowledge.runbooks.length +
            knowledge.postmortems.length +
            knowledge.knownIssues.length,
          types: [
            knowledge.runbooks.length > 0 ? 'runbooks' : '',
            knowledge.postmortems.length > 0 ? 'postmortems' : '',
            knowledge.knownIssues.length > 0 ? 'known_issues' : '',
          ].filter(Boolean),
        };
      }
    }

    // Main iteration loop
    let iteration = 0;
    let lastResponse: LLMResponse | null = null;

    while (iteration < this.config.maxIterations) {
      iteration++;

      // Check context size and clear if needed
      const toolResults = scratchpad.getToolResults();
      const fullContext = this.formatToolResults(toolResults);
      const contextTokens = estimateTokens(this.systemPrompt + query + fullContext);

      if (contextTokens > this.config.contextThresholdTokens) {
        const clearedCount = scratchpad.clearOldestToolResults(this.config.keepToolUses);
        yield {
          type: 'context_cleared',
          clearedCount,
          keptCount: this.config.keepToolUses,
        };
      }

      // Build iteration prompt
      const currentToolResults = this.formatToolResults(scratchpad.getToolResults());
      const hypothesisContext = hypothesisEngine
        ? buildHypothesisContext(hypothesisEngine.getActiveHypotheses())
        : undefined;

      let userPrompt = buildIterationPrompt(
        query,
        currentToolResults,
        scratchpad.getToolUsageStatus(),
        hypothesisContext
      );

      // Add knowledge context on first iteration
      if (iteration === 1 && knowledge) {
        userPrompt = buildKnowledgePrompt(knowledge) + '\n\n' + userPrompt;
      }

      // Call LLM
      const response = await this.llm.chat(
        this.systemPrompt,
        userPrompt,
        Array.from(this.tools.values())
      );
      lastResponse = response;

      // Emit thinking if present
      if (response.thinking) {
        yield { type: 'thinking', content: response.thinking };
        await scratchpad.append({ type: 'thinking', content: response.thinking });
      }

      // If no tool calls, we're done
      if (response.toolCalls.length === 0) {
        break;
      }

      // Execute tool calls
      for (const toolCall of response.toolCalls) {
        const tool = this.tools.get(toolCall.name);
        if (!tool) {
          yield {
            type: 'tool_error',
            tool: toolCall.name,
            error: `Unknown tool: ${toolCall.name}`,
          };
          continue;
        }

        // Check graceful limits
        const limitCheck = scratchpad.canCallTool(
          toolCall.name,
          toolCall.args.query as string | undefined
        );
        if (limitCheck.warning) {
          yield {
            type: 'tool_limit',
            tool: toolCall.name,
            warning: limitCheck.warning,
          };
        }

        // Execute tool
        yield {
          type: 'tool_start',
          tool: toolCall.name,
          args: toolCall.args,
        };

        const startTime = Date.now();
        try {
          const result = await tool.execute(toolCall.args);
          const durationMs = Date.now() - startTime;

          yield {
            type: 'tool_end',
            tool: toolCall.name,
            result,
            durationMs,
          };

          await scratchpad.append({
            type: 'tool_result',
            tool: toolCall.name,
            args: toolCall.args,
            result,
            durationMs,
          });
        } catch (error) {
          yield {
            type: 'tool_error',
            tool: toolCall.name,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    }

    // Generate final answer
    yield { type: 'answer_start' };

    const allToolResults = this.formatToolResults(scratchpad.getToolResults());
    const finalPrompt = buildFinalAnswerPrompt(query, allToolResults, knowledge);

    const finalResponse = await this.llm.chat(this.systemPrompt, finalPrompt);

    // Include hypothesis tree if investigation
    let answer = finalResponse.content;
    if (hypothesisEngine && hypothesisEngine.isComplete()) {
      answer += '\n\n---\n\n' + hypothesisEngine.toMarkdown();
    }

    yield {
      type: 'done',
      answer,
      investigationId: sessionId,
    };
  }

  /**
   * Format tool results for prompt context
   */
  private formatToolResults(
    results: Array<{ tool: string; args: Record<string, unknown>; result: unknown }>
  ): string {
    if (results.length === 0) {
      return 'No data retrieved yet.';
    }

    return results
      .map((r, i) => {
        const argsStr = JSON.stringify(r.args, null, 2);
        const resultStr =
          typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 2);
        return `### Tool Call ${i + 1}: ${r.tool}\n\n**Args:**\n\`\`\`json\n${argsStr}\n\`\`\`\n\n**Result:**\n\`\`\`\n${resultStr}\n\`\`\``;
      })
      .join('\n\n---\n\n');
  }

  /**
   * Get available tools
   */
  getTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get safety manager for approval flows
   */
  getSafetyManager(): SafetyManager {
    return this.safety;
  }
}
