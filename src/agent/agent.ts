/**
 * Main Agent class
 *
 * Orchestrates the research-first, hypothesis-driven investigation loop.
 * Implements context engineering best practices:
 * - Just-in-time retrieval
 * - Progressive disclosure
 * - Token-efficient summaries
 * - Smart compaction
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
  buildFinalAnswerPrompt,
  buildKnowledgePrompt,
  buildHypothesisContext,
  buildContextAwareSystemPrompt,
  buildContextAwareIterationPrompt,
} from './prompts';
import { estimateTokens } from '../utils/tokens';
import { ToolSummarizer } from './tool-summarizer';
import { InvestigationMemory } from './investigation-memory';
import { ContextCompactor, createCompactor } from './context-compactor';
import { KnowledgeContextManager } from './knowledge-context';
import { ServiceContextManager } from './service-context';
import { InfraContextManager, createInfraContextManager } from './infra-context';
import { setActiveScratchpad } from '../tools/registry';

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

function stableSerialize(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      return input.map(normalize);
    }
    if (input && typeof input === 'object') {
      const obj = input as Record<string, unknown>;
      const normalized: Record<string, unknown> = {};
      for (const key of Object.keys(obj).sort()) {
        normalized[key] = normalize(obj[key]);
      }
      return normalized;
    }
    return input;
  };

  return JSON.stringify(normalize(value));
}

function isProceduralRunbookQuery(query: string): boolean {
  const normalized = query.toLowerCase();
  return /what should i do|what do i do|how do i|runbook|playbook|procedure|steps|fix|resolve|troubleshoot/.test(
    normalized
  );
}

function buildRunbookCitationSection(knowledge?: RetrievedKnowledge): string {
  if (!knowledge || knowledge.runbooks.length === 0) {
    return '';
  }

  const seen = new Set<string>();
  const references: Array<{ title: string; sourceUrl?: string }> = [];

  for (const runbook of knowledge.runbooks) {
    const key = runbook.documentId || runbook.id || runbook.title;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    references.push({
      title: runbook.title,
      sourceUrl: runbook.sourceUrl,
    });
  }

  if (references.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push('## Runbook References');
  lines.push('');
  references.slice(0, 8).forEach((reference, index) => {
    const sourceSuffix = reference.sourceUrl ? ` (${reference.sourceUrl})` : '';
    lines.push(`${index + 1}. ${reference.title}${sourceSuffix}`);
  });

  return `\n\n---\n\n${lines.join('\n')}`;
}

export interface AgentDependencies {
  llm: LLMClient;
  tools: Tool[];
  skills: string[];
  knowledgeRetriever?: KnowledgeRetriever;
  config?: Partial<AgentConfig>;
  scratchpadDir?: string;
  promptConfig?: {
    awsRegions?: string[];
    awsDefaultRegion?: string;
  };
  /** Enable context engineering features */
  contextEngineering?: {
    /** Enable tool result summarization */
    enableSummarization?: boolean;
    /** Enable investigation memory */
    enableInvestigationMemory?: boolean;
    /** Enable smart compaction */
    enableSmartCompaction?: boolean;
    /** Enable infrastructure pre-discovery */
    enableInfraDiscovery?: boolean;
    /** Compaction preset */
    compactionPreset?: 'incident' | 'research' | 'balanced';
  };
  /** Service graph for dependency awareness */
  serviceGraph?: import('./service-context').ServiceContextManager extends ServiceContextManager
    ? ConstructorParameters<typeof ServiceContextManager>[0]
    : never;
}

// Interfaces for dependencies (to be implemented)
export interface LLMClient {
  chat(systemPrompt: string, userPrompt: string, tools?: Tool[]): Promise<LLMResponse>;
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
  private readonly promptConfig?: { awsRegions?: string[]; awsDefaultRegion?: string };
  private systemPrompt: string;

  // Context engineering components
  private readonly contextEngineering: {
    enableSummarization: boolean;
    enableInvestigationMemory: boolean;
    enableSmartCompaction: boolean;
    enableInfraDiscovery: boolean;
    compactionPreset: 'incident' | 'research' | 'balanced';
  };
  private toolSummarizer?: ToolSummarizer;
  private contextCompactor?: ContextCompactor;
  private infraContextManager?: InfraContextManager;
  private knowledgeContextManager?: KnowledgeContextManager;
  private serviceContextManager?: ServiceContextManager;

  constructor(deps: AgentDependencies) {
    this.config = { ...DEFAULT_CONFIG, ...deps.config };
    this.llm = deps.llm;
    this.tools = new Map(deps.tools.map((t) => [t.name, t]));
    this.skills = deps.skills;
    this.knowledgeRetriever = deps.knowledgeRetriever;
    this.safety = new SafetyManager();
    this.scratchpadDir = deps.scratchpadDir || '.runbook/scratchpad';
    this.promptConfig = deps.promptConfig;
    this.systemPrompt = buildSystemPrompt(deps.tools, deps.skills, deps.promptConfig);

    // Initialize context engineering settings
    this.contextEngineering = {
      enableSummarization: deps.contextEngineering?.enableSummarization ?? true,
      enableInvestigationMemory: deps.contextEngineering?.enableInvestigationMemory ?? true,
      enableSmartCompaction: deps.contextEngineering?.enableSmartCompaction ?? true,
      enableInfraDiscovery: deps.contextEngineering?.enableInfraDiscovery ?? false,
      compactionPreset: deps.contextEngineering?.compactionPreset ?? 'balanced',
    };

    // Initialize context engineering components
    if (this.contextEngineering.enableSummarization) {
      this.toolSummarizer = new ToolSummarizer();
    }
    if (this.contextEngineering.enableSmartCompaction) {
      this.contextCompactor = createCompactor(this.contextEngineering.compactionPreset);
    }
    if (this.contextEngineering.enableInfraDiscovery) {
      this.infraContextManager = createInfraContextManager({
        regions: deps.promptConfig?.awsRegions,
        defaultRegion: deps.promptConfig?.awsDefaultRegion,
      });
    }
  }

  /**
   * Run the agent on a query
   *
   * Yields events as the investigation progresses.
   */
  async *run(query: string, incidentId?: string): AsyncGenerator<AgentEvent> {
    // Initialize scratchpad with tiered storage support
    const sessionId = Scratchpad.generateSessionId();
    const scratchpad = new Scratchpad(this.scratchpadDir, sessionId, this.config.toolLimits);
    await scratchpad.append({ type: 'init', query, incidentId });

    // Set active scratchpad for get_full_result tool
    setActiveScratchpad({
      getResultById: (id: string) => scratchpad.getResultById(id),
      hasResult: (id: string) => scratchpad.hasResult(id),
      getResultIds: () => scratchpad.getResultIds(),
    });

    // Initialize investigation memory if enabled
    let investigationMemory: InvestigationMemory | undefined;
    if (this.contextEngineering.enableInvestigationMemory) {
      investigationMemory = new InvestigationMemory(query, {
        incidentId,
        sessionId,
        baseDir: this.scratchpadDir,
      });
      await investigationMemory.init();
    }

    // Initialize hypothesis engine for investigations
    const hypothesisEngine = incidentId
      ? new HypothesisEngine(incidentId, query, this.config.maxHypothesisDepth)
      : null;

    // Run infrastructure discovery if enabled
    if (this.infraContextManager && this.contextEngineering.enableInfraDiscovery) {
      try {
        await this.infraContextManager.discover();
      } catch (error) {
        // Infra discovery is optional, continue on failure
      }
    }

    // Retrieve relevant knowledge
    let knowledge: RetrievedKnowledge | undefined;
    if (this.knowledgeRetriever) {
      const context: InvestigationContext = {
        query,
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
            knowledge.runbooks.length + knowledge.postmortems.length + knowledge.knownIssues.length,
          types: [
            knowledge.runbooks.length > 0 ? 'runbooks' : '',
            knowledge.postmortems.length > 0 ? 'postmortems' : '',
            knowledge.knownIssues.length > 0 ? 'known_issues' : '',
          ].filter(Boolean),
        };
      }
    }

    const hasRelevantRunbookKnowledge =
      !!knowledge && (knowledge.runbooks.length > 0 || knowledge.knownIssues.length > 0);
    const shouldPreferKnowledgeOnlyAnswer =
      !incidentId && hasRelevantRunbookKnowledge && isProceduralRunbookQuery(query);

    if (shouldPreferKnowledgeOnlyAnswer && knowledge) {
      yield { type: 'answer_start' };

      const knowledgeOnlyPrompt = [
        buildKnowledgePrompt(knowledge),
        '## User Query',
        query,
        '',
        '## Instructions',
        'Answer directly from the organizational knowledge above.',
        'Prioritize runbook steps and known issue remediation in a concise numbered list.',
        'Do not call tools. If something is missing, say what is missing.',
      ].join('\n');

      const knowledgeOnlySystemPrompt = `${this.systemPrompt}\n\nFor this response, rely only on provided organizational knowledge and do not use tools.`;
      const finalResponse = await this.llm.chat(knowledgeOnlySystemPrompt, knowledgeOnlyPrompt);
      const citationSection = buildRunbookCitationSection(knowledge);

      yield {
        type: 'done',
        answer:
          citationSection && !finalResponse.content.includes('## Runbook References')
            ? finalResponse.content + citationSection
            : finalResponse.content,
        investigationId: sessionId,
      };

      setActiveScratchpad(null);
      return;
    }

    // Track previous services/symptoms for re-querying
    let previousServices: string[] = [];
    let previousSymptoms: string[] = [];

    // Main iteration loop
    let iteration = 0;
    let lastResponse: LLMResponse | null = null;
    const repeatedToolCallCount = new Map<string, number>();

    while (iteration < this.config.maxIterations) {
      iteration++;

      // Advance investigation memory iteration
      if (investigationMemory) {
        investigationMemory.advanceIteration();
      }

      // Check context size and apply smart compaction if needed
      const toolResults = scratchpad.getToolResults();
      const fullContext = this.formatToolResults(toolResults);
      const contextTokens = estimateTokens(this.systemPrompt + query + fullContext);

      if (contextTokens > this.config.contextThresholdTokens) {
        if (this.contextCompactor && this.contextEngineering.enableSmartCompaction) {
          // Smart compaction based on importance scoring
          const tieredResults = scratchpad.getTieredResults();
          const plan = this.contextCompactor.compact(tieredResults, {
            query,
            investigationState: investigationMemory?.getState(),
            compactResults: this.toolSummarizer
              ? new Map(tieredResults.filter((r) => r.compact).map((r) => [r, r.compact!] as const))
              : undefined,
          });

          const counts = scratchpad.applyCompactionPlan(plan);

          yield {
            type: 'context_cleared',
            clearedCount: counts.clearedCount,
            keptCount: counts.fullCount + counts.compactCount,
          };
        } else {
          // Fallback to naive clearing
          const clearedCount = scratchpad.clearOldestToolResults(this.config.keepToolUses);
          yield {
            type: 'context_cleared',
            clearedCount,
            keptCount: this.config.keepToolUses,
          };
        }
      }

      // Build iteration prompt with context engineering
      let currentToolResults: string;
      if (this.contextEngineering.enableSummarization) {
        currentToolResults = scratchpad.buildTieredContext();
      } else {
        currentToolResults = this.formatToolResults(scratchpad.getToolResults());
      }

      const hypothesisContext = hypothesisEngine
        ? buildHypothesisContext(hypothesisEngine.getActiveHypotheses())
        : undefined;

      // Build context-aware iteration prompt
      let userPrompt = buildContextAwareIterationPrompt(
        query,
        currentToolResults,
        scratchpad.getToolUsageStatus(),
        {
          hypothesisContext,
          investigationState: investigationMemory?.getState(),
          knowledgeSummary: this.knowledgeContextManager?.buildCompactSummary(),
          serviceSummary: this.serviceContextManager?.buildCompactSummary(),
        }
      );

      // Add knowledge context on first iteration
      if (iteration === 1 && knowledge) {
        userPrompt = buildKnowledgePrompt(knowledge) + '\n\n' + userPrompt;
      }

      // Build context-aware system prompt
      const contextAwareSystemPrompt = buildContextAwareSystemPrompt(
        Array.from(this.tools.values()),
        this.skills,
        this.promptConfig,
        {
          infraContext: this.infraContextManager?.getContext(),
          knowledgeContext: this.knowledgeContextManager?.getContext(),
          serviceContext: this.serviceContextManager?.buildServiceContextSection(),
          investigationState: investigationMemory?.getState(),
        }
      );

      // Call LLM
      const response = await this.llm.chat(
        contextAwareSystemPrompt,
        userPrompt,
        Array.from(this.tools.values())
      );
      lastResponse = response;

      // Emit thinking if present and extract findings
      if (response.thinking) {
        yield { type: 'thinking', content: response.thinking };
        await scratchpad.append({ type: 'thinking', content: response.thinking });

        // Extract findings from thinking for investigation memory
        if (investigationMemory) {
          investigationMemory.extractFromThinking(response.thinking);
        }
      }

      // If no tool calls, we're done
      if (response.toolCalls.length === 0) {
        break;
      }

      // Execute tool calls
      let executedAnyTool = false;
      for (const toolCall of response.toolCalls) {
        const callSignature = `${toolCall.name}:${stableSerialize(toolCall.args)}`;
        const signatureCount = (repeatedToolCallCount.get(callSignature) || 0) + 1;
        repeatedToolCallCount.set(callSignature, signatureCount);

        if (signatureCount > 2) {
          const warning =
            `Skipping repetitive tool call (${signatureCount}x): ${toolCall.name}. ` +
            'Try a different query, narrower scope, or move to synthesis.';
          yield {
            type: 'tool_limit',
            tool: toolCall.name,
            warning,
          };
          yield {
            type: 'tool_error',
            tool: toolCall.name,
            error: warning,
          };
          continue;
        }

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
        executedAnyTool = true;

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

          // Generate compact summary if summarization is enabled
          let compact;
          if (this.toolSummarizer && this.contextEngineering.enableSummarization) {
            compact = this.toolSummarizer.summarize(toolCall.name, toolCall.args, result);
          }

          // Append with tiered storage support
          const resultId = await scratchpad.appendToolResult(
            {
              tool: toolCall.name,
              args: toolCall.args,
              result,
              durationMs,
            },
            { compact }
          );

          // Update investigation memory with discovered services
          if (investigationMemory && compact?.services) {
            investigationMemory.addDiscoveredServices(compact.services);
          }

          // Check for new services/symptoms to trigger knowledge re-query
          if (investigationMemory && this.knowledgeContextManager) {
            const state = investigationMemory.getState();
            const newServices = state.servicesDiscovered.filter(
              (s) => !previousServices.includes(s)
            );
            const newSymptoms = state.symptomsIdentified.filter(
              (s) => !previousSymptoms.includes(s)
            );

            if (newServices.length > 0 || newSymptoms.length > 0) {
              await this.knowledgeContextManager.updateFromInvestigationState(
                state,
                previousServices,
                previousSymptoms
              );
              previousServices = [...state.servicesDiscovered];
              previousSymptoms = [...state.symptomsIdentified];
            }
          }
        } catch (error) {
          yield {
            type: 'tool_error',
            tool: toolCall.name,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      if (!executedAnyTool) {
        break;
      }
    }

    // Save investigation memory
    if (investigationMemory) {
      await investigationMemory.save();
    }

    // Generate final answer
    yield { type: 'answer_start' };

    // Use tiered context for final answer if available
    let allToolResults: string;
    if (this.contextEngineering.enableSummarization) {
      allToolResults = scratchpad.buildTieredContext();
    } else {
      allToolResults = this.formatToolResults(scratchpad.getToolResults());
    }

    const finalPrompt = buildFinalAnswerPrompt(query, allToolResults, knowledge);

    const finalResponse = await this.llm.chat(this.systemPrompt, finalPrompt);

    // Include hypothesis tree if investigation
    let answer = finalResponse.content;
    if (hypothesisEngine && hypothesisEngine.isComplete()) {
      answer += '\n\n---\n\n' + hypothesisEngine.toMarkdown();
    }

    // Include investigation summary only for explicit incident investigations.
    if (investigationMemory && incidentId) {
      answer += '\n\n---\n\n## Investigation Summary\n\n' + investigationMemory.buildFinalSummary();
    }

    const citationSection = buildRunbookCitationSection(knowledge);
    if (citationSection && !answer.includes('## Runbook References')) {
      answer += citationSection;
    }

    yield {
      type: 'done',
      answer,
      investigationId: sessionId,
    };

    // Clear active scratchpad reference
    setActiveScratchpad(null);
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
