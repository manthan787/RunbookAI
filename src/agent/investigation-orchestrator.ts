/**
 * Investigation Orchestrator
 *
 * Orchestrates the full investigation lifecycle by coordinating:
 * - State machine for phase transitions
 * - LLM for hypothesis generation and evidence evaluation
 * - Causal query builder for targeted queries
 * - Log analyzer for pattern extraction
 * - Tool execution for data gathering
 */

import {
  InvestigationStateMachine,
  createInvestigation,
  type InvestigationPhase,
  type InvestigationHypothesis,
  type EvidenceEvaluation,
  type TriageResult,
  type Conclusion,
  type RemediationPlan,
  type RemediationStep,
} from './state-machine';

import {
  parseHypothesisGeneration,
  parseEvidenceEvaluation,
  parseTriageResponse,
  parseConclusion,
  parseRemediationPlan,
  parseLogAnalysis,
  toTriageResult,
  toHypothesisInput,
  toEvidenceEvaluation,
  toConclusionResult,
  toRemediationSteps,
  fillPrompt,
  PROMPTS,
  type HypothesisGeneration,
} from './llm-parser';

import { analyzeLogs, analyzePatterns, type LogAnalysisResult } from './log-analyzer';

import {
  generateQueriesForHypothesis,
  generateQueryPlan,
  prioritizeQueries,
  isQueryTooBroad,
  suggestQueryRefinements,
  summarizeQueryResults,
  type CausalQuery,
  type QueryPlan,
} from './causal-query';

import type { Tool } from './types';

/**
 * LLM interface for generating structured outputs
 */
export interface LLMClient {
  complete(prompt: string): Promise<string>;
}

/**
 * Tool executor interface
 */
export interface ToolExecutor {
  execute(toolName: string, parameters: Record<string, unknown>): Promise<unknown>;
}

export interface RemediationContext {
  incidentId?: string;
  rootCause: string;
  affectedServices: string[];
}

/**
 * Investigation options
 */
export interface InvestigationOptions {
  incidentId?: string;
  maxIterations?: number;
  autoApproveRemediation?: boolean;
  approveRemediationStep?: (step: RemediationStep) => Promise<boolean>;
  knownServices?: string[];
  availableTools?: string[];
  slackChannel?: string;
  availableSkills?: string[];
  fetchRelevantRunbooks?: (context: RemediationContext) => Promise<string[]>;
}

/**
 * Investigation result
 */
export interface InvestigationResult {
  id: string;
  query: string;
  rootCause?: string;
  affectedServices?: string[];
  confidence?: 'high' | 'medium' | 'low';
  remediationPlan?: RemediationPlan;
  summary: string;
  durationMs: number;
}

/**
 * Event emitted during investigation
 */
export type InvestigationEvent =
  | { type: 'phase_change'; phase: InvestigationPhase; reason: string }
  | { type: 'triage_complete'; result: TriageResult }
  | { type: 'hypothesis_created'; hypothesis: InvestigationHypothesis }
  | { type: 'hypothesis_updated'; hypothesis: InvestigationHypothesis }
  | { type: 'query_executing'; query: CausalQuery }
  | { type: 'query_complete'; query: CausalQuery; result: unknown }
  | { type: 'evidence_evaluated'; evaluation: EvidenceEvaluation }
  | { type: 'conclusion_reached'; conclusion: Conclusion }
  | { type: 'remediation_step'; step: RemediationStep; status: string }
  | { type: 'error'; phase: InvestigationPhase; error: Error }
  | { type: 'complete'; result: InvestigationResult };

/**
 * Event handler for investigation events
 */
export type InvestigationEventHandler = (event: InvestigationEvent) => void;

/**
 * Investigation Orchestrator
 *
 * Main class that orchestrates the investigation flow.
 */
export class InvestigationOrchestrator {
  private readonly llm: LLMClient;
  private readonly toolExecutor: ToolExecutor;
  private readonly options: InvestigationOptions;
  private readonly eventHandlers: InvestigationEventHandler[] = [];
  private readonly availableTools?: Set<string>;
  private inferredLambdaFunctionName?: string;
  private inferredCloudWatchLogGroup?: string;

  constructor(llm: LLMClient, toolExecutor: ToolExecutor, options: InvestigationOptions = {}) {
    this.llm = llm;
    this.toolExecutor = toolExecutor;
    this.options = options;
    this.availableTools = options.availableTools
      ? new Set(options.availableTools.map((tool) => tool.trim()).filter(Boolean))
      : undefined;
  }

  /**
   * Add event handler
   */
  on(handler: InvestigationEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const index = this.eventHandlers.indexOf(handler);
      if (index !== -1) {
        this.eventHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Emit an event to all handlers
   */
  private emit(event: InvestigationEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (e) {
        console.error('Event handler error:', e);
      }
    }
  }

  private isToolAvailable(toolName: string): boolean {
    if (!this.availableTools) {
      return true;
    }
    return this.availableTools.has(toolName);
  }

  private extractLambdaNameFromArn(value: string): string | null {
    const marker = 'function:';
    const idx = value.indexOf(marker);
    if (idx === -1) {
      return null;
    }
    return value.slice(idx + marker.length).trim() || null;
  }

  private parseLambdaFunctionName(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    return this.extractLambdaNameFromArn(trimmed) || trimmed;
  }

  private setLambdaContext(functionName: string): void {
    this.inferredLambdaFunctionName = functionName;
    this.inferredCloudWatchLogGroup = `/aws/lambda/${functionName}`;
  }

  private extractLambdaFromAlarmDimensions(alarm: Record<string, unknown>): string | null {
    const dimensions = alarm.dimensions;
    if (!Array.isArray(dimensions)) {
      return null;
    }

    for (const dimension of dimensions) {
      if (!dimension || typeof dimension !== 'object') {
        continue;
      }
      const item = dimension as Record<string, unknown>;
      const name = item.name ?? item.Name;
      const value = item.value ?? item.Value;
      if (name === 'FunctionName') {
        const functionName = this.parseLambdaFunctionName(value);
        if (functionName) {
          return functionName;
        }
      }
    }

    return null;
  }

  private updateCloudWatchHints(
    toolName: string,
    result: unknown,
    parameters?: Record<string, unknown>
  ): void {
    const explicitLogGroup =
      parameters && typeof parameters.log_group === 'string' ? parameters.log_group.trim() : '';
    if (explicitLogGroup) {
      this.inferredCloudWatchLogGroup = explicitLogGroup;
      const prefix = '/aws/lambda/';
      if (explicitLogGroup.startsWith(prefix)) {
        this.inferredLambdaFunctionName = explicitLogGroup.slice(prefix.length);
      }
      return;
    }

    if (!result || typeof result !== 'object') {
      return;
    }

    if (toolName === 'cloudwatch_alarms') {
      const alarms = Array.isArray(result)
        ? result
        : Array.isArray((result as Record<string, unknown>).alarms)
          ? ((result as Record<string, unknown>).alarms as unknown[])
          : [];

      for (const alarm of alarms) {
        if (!alarm || typeof alarm !== 'object') {
          continue;
        }
        const functionName = this.extractLambdaFromAlarmDimensions(
          alarm as Record<string, unknown>
        );
        if (functionName) {
          this.setLambdaContext(functionName);
          return;
        }
      }
      return;
    }

    if (toolName !== 'aws_query') {
      return;
    }

    const obj = result as Record<string, unknown>;
    const results = obj.results;
    if (!results || typeof results !== 'object') {
      return;
    }

    const lambda = (results as Record<string, unknown>).lambda;
    if (!lambda || typeof lambda !== 'object') {
      return;
    }

    const resources = (lambda as Record<string, unknown>).resources;
    if (!Array.isArray(resources)) {
      return;
    }

    const preferredDemoFunction = process.env.RUNBOOK_DEMO_FUNCTION?.trim();
    let discovered: string | null = null;

    for (const resource of resources) {
      if (!resource || typeof resource !== 'object') {
        continue;
      }
      const item = resource as Record<string, unknown>;
      const candidate =
        this.parseLambdaFunctionName(item.name) ||
        this.parseLambdaFunctionName(item.functionName) ||
        this.parseLambdaFunctionName(item.FunctionName) ||
        this.parseLambdaFunctionName(item.id);

      if (!candidate) {
        continue;
      }

      if (preferredDemoFunction && candidate === preferredDemoFunction) {
        discovered = candidate;
        break;
      }

      if (!discovered) {
        discovered = candidate;
      }
    }

    if (discovered) {
      this.setLambdaContext(discovered);
    }
  }

  private enrichCloudwatchLogsQuery(query: CausalQuery): CausalQuery {
    if (query.tool !== 'cloudwatch_logs') {
      return query;
    }

    const params: Record<string, unknown> = {
      ...query.parameters,
    };

    if (!params.log_group) {
      const demoLogGroup = process.env.RUNBOOK_DEMO_LOG_GROUP?.trim();
      const demoFunction = process.env.RUNBOOK_DEMO_FUNCTION?.trim();
      const inferredLogGroup = this.inferredCloudWatchLogGroup?.trim();
      const inferredFunction = this.inferredLambdaFunctionName?.trim();

      if (inferredLogGroup) {
        params.log_group = inferredLogGroup;
      } else if (demoLogGroup) {
        params.log_group = demoLogGroup;
      } else if (inferredFunction) {
        params.log_group = `/aws/lambda/${inferredFunction}`;
      } else if (demoFunction) {
        params.log_group = `/aws/lambda/${demoFunction}`;
      }
    }

    if (!params.minutes_back) {
      params.minutes_back = 60;
    }

    return {
      ...query,
      parameters: params,
    };
  }

  private hasMeaningfulTriageSignal(toolName: string, result: unknown): boolean {
    if (!result || typeof result !== 'object') {
      return false;
    }

    const obj = result as Record<string, unknown>;
    if (obj.error) {
      return false;
    }

    if (toolName === 'cloudwatch_alarms') {
      if (typeof obj.count === 'number') {
        return obj.count > 0;
      }
      if (Array.isArray(obj.alarms)) {
        return obj.alarms.length > 0;
      }
      if (Array.isArray(result)) {
        return (result as unknown[]).length > 0;
      }
      return false;
    }

    if (toolName === 'datadog') {
      if (typeof obj.count === 'number') {
        return obj.count > 0;
      }
      if (Array.isArray(obj.triggeredMonitors)) {
        return obj.triggeredMonitors.length > 0;
      }
      return false;
    }

    if (toolName === 'search_knowledge') {
      // Knowledge is supplemental context; always continue to fetch live telemetry.
      return false;
    }

    if (toolName === 'aws_query') {
      const total = obj.totalResources;
      if (typeof total === 'number') {
        return total > 0;
      }
      const results = obj.results;
      if (results && typeof results === 'object') {
        return Object.keys(results as Record<string, unknown>).length > 0;
      }
      return false;
    }

    return true;
  }

  private buildFallbackQuery(original: CausalQuery, fallbackTool: string): CausalQuery {
    const fallbackParams: Record<string, unknown> = {
      ...original.parameters,
    };

    if (fallbackTool === 'cloudwatch_alarms') {
      fallbackParams.state = 'ALARM';
    } else if (fallbackTool === 'cloudwatch_logs' && !fallbackParams.filter_pattern) {
      fallbackParams.filter_pattern = 'ERROR timeout exception';
    } else if (fallbackTool === 'datadog' && !fallbackParams.action) {
      fallbackParams.action = 'monitors';
    } else if (fallbackTool === 'aws_query' && !fallbackParams.services) {
      fallbackParams.services = ['ecs', 'ec2', 'rds'];
    }

    return {
      ...original,
      tool: fallbackTool,
      parameters: fallbackParams,
      expectedOutcome: `${original.expectedOutcome} (fallback via ${fallbackTool})`,
      relevanceScore: Math.max(0.1, original.relevanceScore - 0.1),
    };
  }

  private adaptQueryToEnvironment(query: CausalQuery): CausalQuery | null {
    if (this.isToolAvailable(query.tool)) {
      return this.enrichCloudwatchLogsQuery(query);
    }

    const fallbackOrder: Record<string, string[]> = {
      datadog: ['cloudwatch_alarms', 'cloudwatch_logs', 'aws_query'],
      cloudwatch_logs: ['datadog', 'aws_query'],
      cloudwatch_alarms: ['datadog', 'aws_query'],
      search_knowledge: ['aws_query', 'cloudwatch_logs'],
      web_search: ['search_knowledge', 'aws_query'],
    };

    const fallbacks = fallbackOrder[query.tool] || [];
    for (const fallbackTool of fallbacks) {
      if (this.isToolAvailable(fallbackTool)) {
        return this.enrichCloudwatchLogsQuery(this.buildFallbackQuery(query, fallbackTool));
      }
    }

    return null;
  }

  private inferAffectedServices(
    rootCause: string,
    modelServices: string[] | undefined,
    triageServices: string[] | undefined
  ): string[] {
    const candidates = [
      ...(modelServices || []),
      ...(triageServices || []),
      ...(this.options.knownServices || []),
    ]
      .map((service) => service.trim())
      .filter(Boolean);

    const uniqueCandidates = Array.from(new Set(candidates));
    const lowerRootCause = rootCause.toLowerCase();

    const mentionedCandidates = uniqueCandidates.filter((service) => {
      const normalized = service.toLowerCase();
      const aliases = [
        normalized,
        normalized.replace(/^ts-/, ''),
        normalized.replace(/-service$/i, ''),
        normalized.replace(/_service$/i, ''),
      ];

      return aliases.some((alias) => alias && lowerRootCause.includes(alias));
    });

    const inferred =
      mentionedCandidates.length > 0
        ? mentionedCandidates
        : modelServices && modelServices.length > 0
          ? modelServices
          : triageServices || [];

    return Array.from(new Set(inferred.map((service) => service.trim()).filter(Boolean))).slice(
      0,
      10
    );
  }

  private formatPromptList(items: string[], emptyMessage: string): string {
    if (items.length === 0) {
      return emptyMessage;
    }
    return items.map((item) => `- ${item}`).join('\n');
  }

  private buildKnowledgeSearchQuery(query: string): string {
    let cleaned = query.trim();

    if (this.options.incidentId) {
      const escapedIncidentId = this.options.incidentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      cleaned = cleaned.replace(new RegExp(escapedIncidentId, 'gi'), ' ');
    }

    cleaned = cleaned
      .replace(/\binvestigate incident\b/gi, ' ')
      .replace(/\bidentify the root cause with supporting evidence\b/gi, ' ')
      .replace(/\bhypothesis-driven investigation\b/gi, ' ')
      .replace(/[^\w\s:/.-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned || cleaned.split(' ').length < 3) {
      return 'production incident runbook known issue remediation';
    }

    return `${cleaned} runbook known issue remediation`;
  }

  private async resolveRelevantRunbooks(context: RemediationContext): Promise<string[]> {
    if (!this.options.fetchRelevantRunbooks) {
      return [];
    }

    try {
      const runbooks = await this.options.fetchRelevantRunbooks(context);
      return Array.from(new Set(runbooks.map((runbook) => runbook.trim()).filter(Boolean))).slice(
        0,
        10
      );
    } catch {
      return [];
    }
  }

  private async resolveCodeFixCandidates(
    rootCause: string,
    affectedServices: string[]
  ): Promise<string[]> {
    const query = [rootCause, ...affectedServices].join(' ').trim();
    if (!query) {
      return [];
    }

    const tools: string[] = [];
    if (this.isToolAvailable('github_query')) {
      tools.push('github_query');
    }
    if (this.isToolAvailable('gitlab_query')) {
      tools.push('gitlab_query');
    }
    if (tools.length === 0) {
      return [];
    }

    const deduped = new Set<string>();
    const formatted: string[] = [];

    for (const toolName of tools) {
      try {
        const result = await this.toolExecutor.execute(toolName, {
          action: 'fix_candidates',
          query,
          services: affectedServices.slice(0, 6),
          limit: 8,
        });

        if (!result || typeof result !== 'object') {
          continue;
        }

        const obj = result as Record<string, unknown>;
        if (obj.error) {
          continue;
        }

        const candidates = Array.isArray(obj.candidates) ? obj.candidates : [];
        for (const candidate of candidates) {
          if (!candidate || typeof candidate !== 'object') {
            continue;
          }

          const item = candidate as Record<string, unknown>;
          const url = typeof item.url === 'string' ? item.url.trim() : '';
          if (!url || deduped.has(url)) {
            continue;
          }

          deduped.add(url);

          const provider =
            typeof item.provider === 'string'
              ? item.provider.trim()
              : toolName === 'github_query'
                ? 'github'
                : 'gitlab';
          const type = typeof item.type === 'string' ? item.type.replace(/_/g, ' ').trim() : 'code';
          const title = typeof item.title === 'string' ? item.title.trim() : url;
          const path =
            typeof item.path === 'string' && item.path.trim() ? ` (${item.path.trim()})` : '';

          formatted.push(`[${provider}] ${type}: ${title}${path} -> ${url}`);
          if (formatted.length >= 12) {
            return formatted;
          }
        }
      } catch {
        // Keep remediation flow resilient when code providers are unavailable.
      }
    }

    return formatted;
  }

  /**
   * Run a full investigation
   */
  async investigate(query: string, context?: string): Promise<InvestigationResult> {
    const startTime = Date.now();
    const machine = createInvestigation(query, {
      incidentId: this.options.incidentId,
      maxIterations: this.options.maxIterations,
    });

    // Set up event forwarding from state machine
    this.setupMachineEvents(machine);

    try {
      // Start the investigation
      machine.start();

      // Phase 1: Triage
      await this.runTriage(machine, query, context);

      // Phase 2-4: Hypothesis-Evidence Loop
      while (machine.canContinue() && machine.getPhase() !== 'conclude') {
        await this.runInvestigationCycle(machine);
      }

      // Phase 5: Conclusion
      if (machine.getPhase() === 'conclude' || machine.getPhase() === 'evaluate') {
        await this.runConclusion(machine);
      }

      // Phase 6: Remediation (if we have a conclusion)
      if (machine.getState().conclusion && machine.getPhase() !== 'complete') {
        await this.runRemediation(machine);
      }

      // Complete the investigation
      if (machine.getPhase() !== 'complete') {
        machine.transitionTo('complete', 'Investigation finished');
      }

      const result: InvestigationResult = {
        id: machine.getState().id,
        query,
        rootCause: machine.getState().conclusion?.rootCause,
        affectedServices: machine.getState().conclusion?.affectedServices,
        confidence: machine.getState().conclusion?.confidence,
        remediationPlan: machine.getState().remediationPlan,
        summary: machine.getSummary(),
        durationMs: Date.now() - startTime,
      };

      this.emit({ type: 'complete', result });
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      machine.recordError(err);
      this.emit({ type: 'error', phase: machine.getPhase(), error: err });
      throw error;
    }
  }

  /**
   * Set up event forwarding from state machine
   */
  private setupMachineEvents(machine: InvestigationStateMachine): void {
    machine.on('phaseChange', (transition) => {
      this.emit({ type: 'phase_change', phase: transition.to, reason: transition.reason });
    });

    machine.on('hypothesisCreated', (hypothesis) => {
      this.emit({ type: 'hypothesis_created', hypothesis });
    });

    machine.on('hypothesisUpdated', (hypothesis) => {
      this.emit({ type: 'hypothesis_updated', hypothesis });
    });

    machine.on('evidenceEvaluated', (evaluation) => {
      this.emit({ type: 'evidence_evaluated', evaluation });
    });

    machine.on('conclusionReached', (conclusion) => {
      this.emit({ type: 'conclusion_reached', conclusion });
    });

    machine.on('stepCompleted', (step) => {
      this.emit({ type: 'remediation_step', step, status: step.status });
    });
  }

  /**
   * Run the triage phase
   */
  private async runTriage(
    machine: InvestigationStateMachine,
    query: string,
    context?: string
  ): Promise<void> {
    const triageContext = await this.gatherTriageContext(query, context);

    const prompt = fillPrompt(PROMPTS.triage, {
      context: triageContext,
    });

    const response = await this.llm.complete(prompt);
    const triageResponse = parseTriageResponse(response);
    const triageResult = toTriageResult(triageResponse, this.options.incidentId);

    machine.setTriageResult(triageResult);
    this.emit({ type: 'triage_complete', result: triageResult });

    // Transition to hypothesize
    machine.transitionTo('hypothesize', 'Triage complete');

    // Generate initial hypotheses
    await this.generateHypotheses(machine, triageResult);
  }

  /**
   * Gather context for triage
   */
  private async gatherTriageContext(query: string, additionalContext?: string): Promise<string> {
    const contextParts: string[] = [];
    let triageQueryIndex = 0;

    contextParts.push(`Query: ${query}`);

    if (additionalContext) {
      contextParts.push(`Additional Context: ${additionalContext}`);
    }

    // Seed triage with the explicit incident context from CLI input.
    if (this.options.incidentId) {
      const incidentContextSources: Array<{
        tool: string;
        params: Record<string, unknown>;
        label: string;
      }> = [
        {
          tool: 'pagerduty_get_incident',
          params: { incident_id: this.options.incidentId },
          label: 'Incident Context (PagerDuty)',
        },
        {
          tool: 'opsgenie_get_incident',
          params: { incident_id: this.options.incidentId },
          label: 'Incident Context (OpsGenie)',
        },
      ];

      for (const source of incidentContextSources) {
        if (!this.isToolAvailable(source.tool)) {
          continue;
        }

        const triageQuery: CausalQuery = {
          id: `triage_${++triageQueryIndex}_${source.tool}`,
          hypothesisId: 'triage',
          queryType: 'exploratory',
          tool: source.tool,
          parameters: source.params,
          expectedOutcome: source.label,
          relevanceScore: 0.9,
        };
        this.emit({ type: 'query_executing', query: triageQuery });

        try {
          const result = await this.toolExecutor.execute(source.tool, source.params);
          this.emit({ type: 'query_complete', query: triageQuery, result });
          if (result && typeof result === 'object' && !(result as Record<string, unknown>).error) {
            contextParts.push(`${source.label}: ${JSON.stringify(result)}`);
            break;
          }
        } catch (error) {
          this.emit({
            type: 'query_complete',
            query: triageQuery,
            result: { error: error instanceof Error ? error.message : String(error) },
          });
          // Try next incident provider source.
        }
      }
    }

    // Try to gather some initial context from tools
    const triageSources: Array<{ tool: string; params: Record<string, unknown>; label: string }> = [
      {
        tool: 'search_knowledge',
        params: {
          query: this.buildKnowledgeSearchQuery(query),
          type_filter: ['runbook', 'known_issue'],
        },
        label: 'Supplemental Runbooks and Known Issues',
      },
      { tool: 'cloudwatch_alarms', params: { state: 'ALARM' }, label: 'Active Alarms' },
      { tool: 'datadog', params: { action: 'monitors' }, label: 'Triggered Monitors' },
      {
        tool: 'aws_query',
        params: {
          query: 'List CloudWatch and Lambda resources related to active incidents',
          services: ['cloudwatch', 'lambda'],
          limit: 10,
        },
        label: 'Cloud Provider Status',
      },
    ];

    for (const source of triageSources) {
      if (!this.isToolAvailable(source.tool)) {
        continue;
      }
      const triageQuery: CausalQuery = {
        id: `triage_${++triageQueryIndex}_${source.tool}`,
        hypothesisId: 'triage',
        queryType: 'exploratory',
        tool: source.tool,
        parameters: source.params,
        expectedOutcome: source.label,
        relevanceScore: 0.7,
      };
      this.emit({ type: 'query_executing', query: triageQuery });
      try {
        const result = await this.toolExecutor.execute(source.tool, source.params);
        this.emit({ type: 'query_complete', query: triageQuery, result });
        this.updateCloudWatchHints(source.tool, result, source.params);
        if (result) {
          contextParts.push(`${source.label}: ${JSON.stringify(result)}`);
          if (this.hasMeaningfulTriageSignal(source.tool, result)) {
            break;
          }
        }
      } catch (error) {
        this.emit({
          type: 'query_complete',
          query: triageQuery,
          result: { error: error instanceof Error ? error.message : String(error) },
        });
        // Try next fallback source
      }
    }

    return contextParts.join('\n\n');
  }

  /**
   * Generate hypotheses based on triage results
   */
  private async generateHypotheses(
    machine: InvestigationStateMachine,
    triage: TriageResult
  ): Promise<void> {
    const prompt = fillPrompt(PROMPTS.generateHypotheses, {
      triageSummary: triage.summary,
      symptoms: triage.symptoms.join('\n- ') || 'None identified',
      errorMessages: triage.errorMessages.join('\n- ') || 'None identified',
      services: triage.affectedServices.join(', ') || 'Unknown',
    });

    const response = await this.llm.complete(prompt);
    const hypothesisGen = parseHypothesisGeneration(response);

    // Add each hypothesis to the state machine
    for (const hypothesis of hypothesisGen.hypotheses) {
      const input = toHypothesisInput(hypothesis);
      machine.addHypothesis(input);
    }
  }

  /**
   * Run a single investigation cycle
   */
  private async runInvestigationCycle(machine: InvestigationStateMachine): Promise<void> {
    const hypothesis = machine.getNextHypothesis();

    if (!hypothesis) {
      // No more hypotheses to investigate
      machine.transitionTo('conclude', 'All hypotheses investigated');
      return;
    }

    // Transition to investigate if needed
    if (machine.getPhase() === 'hypothesize' || machine.getPhase() === 'evaluate') {
      machine.transitionTo('investigate', `Investigating: ${hypothesis.statement}`);
    }

    // Set current hypothesis
    machine.setCurrentHypothesis(hypothesis.id);

    // Generate and execute queries
    const queries = await this.executeQueriesForHypothesis(machine, hypothesis);

    // Transition to evaluate
    machine.transitionTo('evaluate', 'Evidence gathered');

    // Evaluate evidence
    await this.evaluateEvidence(machine, hypothesis, queries);

    // Check if we should conclude
    const confirmedHypothesis = machine.getState().hypotheses.find((h) => h.status === 'confirmed');
    if (confirmedHypothesis) {
      machine.transitionTo('conclude', 'Root cause confirmed');
    }
  }

  /**
   * Execute queries for a hypothesis
   */
  private async executeQueriesForHypothesis(
    machine: InvestigationStateMachine,
    hypothesis: InvestigationHypothesis
  ): Promise<Map<string, unknown>> {
    const results = new Map<string, unknown>();

    // Convert hypothesis to the format expected by causal query builder
    const hypothesisForQuery = {
      id: hypothesis.id,
      parentId: hypothesis.parentId || null,
      depth: 0,
      statement: hypothesis.statement,
      evidenceQuery: null,
      evidenceStrength: hypothesis.evidenceStrength,
      evidenceData: null,
      reasoning: hypothesis.reasoning || null,
      children: [],
      status:
        hypothesis.status === 'pending'
          ? ('active' as const)
          : (hypothesis.status as 'active' | 'pruned' | 'confirmed'),
      createdAt: hypothesis.createdAt.toISOString(),
    };

    const queries = generateQueriesForHypothesis(hypothesisForQuery);

    // Check for overly broad queries and refine
    const refinedQueries = queries.map((q) => {
      if (isQueryTooBroad(q)) {
        return suggestQueryRefinements(q, {
          service: machine.getState().triage?.affectedServices[0],
          timeRange: 60, // Last hour
        });
      }
      return q;
    });

    // Execute each query
    for (const query of refinedQueries) {
      const runnableQuery = this.adaptQueryToEnvironment(query);
      if (!runnableQuery) {
        results.set(query.id, { error: `No compatible tool available for ${query.tool}` });
        continue;
      }

      this.emit({ type: 'query_executing', query: runnableQuery });

      try {
        const result = await this.toolExecutor.execute(
          runnableQuery.tool,
          runnableQuery.parameters
        );
        this.updateCloudWatchHints(runnableQuery.tool, result, runnableQuery.parameters);
        results.set(runnableQuery.id, result);
        machine.recordQueryResult(hypothesis.id, runnableQuery.id, result);

        this.emit({ type: 'query_complete', query: runnableQuery, result });
      } catch (error) {
        results.set(runnableQuery.id, { error: String(error) });
      }
    }

    return results;
  }

  /**
   * Evaluate evidence for a hypothesis
   */
  private async evaluateEvidence(
    machine: InvestigationStateMachine,
    hypothesis: InvestigationHypothesis,
    queryResults: Map<string, unknown>
  ): Promise<void> {
    // Format evidence for LLM
    const evidenceLines: string[] = [];
    for (const [queryId, result] of queryResults) {
      evidenceLines.push(`Query ${queryId}:\n${JSON.stringify(result, null, 2)}`);
    }

    const prompt = fillPrompt(PROMPTS.evaluateEvidence, {
      hypothesis: hypothesis.statement,
      confirmingEvidence: hypothesis.confirmingEvidence,
      refutingEvidence: hypothesis.refutingEvidence,
      evidence: evidenceLines.join('\n\n'),
    });

    const response = await this.llm.complete(prompt);
    const evaluationInput = parseEvidenceEvaluation(response);

    // Override hypothesis ID to match current hypothesis
    evaluationInput.hypothesisId = hypothesis.id;

    const evaluation = toEvidenceEvaluation(evaluationInput);
    machine.applyEvaluation(evaluation);

    // Handle branching - add sub-hypotheses if action is branch
    if (evaluation.action === 'branch' && evaluationInput.subHypotheses) {
      for (const subHypothesis of evaluationInput.subHypotheses) {
        const input = toHypothesisInput(subHypothesis, hypothesis.id);
        machine.addHypothesis(input);
      }
    }
  }

  /**
   * Run the conclusion phase
   */
  private async runConclusion(machine: InvestigationStateMachine): Promise<void> {
    // Transition to conclude if not already there
    if (machine.getPhase() !== 'conclude') {
      machine.transitionTo('conclude', 'Ready to conclude');
    }

    const confirmedHypothesis = machine.getState().hypotheses.find((h) => h.status === 'confirmed');
    const allHypotheses = machine.getState().hypotheses;
    const evaluations = machine.getState().evaluations;

    // Format evidence chain from evaluations
    const evidenceChain = evaluations
      .filter((e) => e.evidenceStrength === 'strong' || e.evidenceStrength === 'weak')
      .map((e) => ({
        finding: e.findings.join(', '),
        source: e.hypothesisId,
        strength: e.evidenceStrength,
      }));

    const prompt = fillPrompt(PROMPTS.generateConclusion, {
      hypothesis: confirmedHypothesis?.statement || allHypotheses[0]?.statement || 'Unknown',
      evidence: JSON.stringify(evidenceChain, null, 2),
      alternatives:
        allHypotheses
          .filter((h) => h.status === 'pruned')
          .map((h) => `- ${h.statement}: ${h.reasoning || 'No evidence'}`)
          .join('\n') || 'None',
    });

    const response = await this.llm.complete(prompt);
    const conclusionInput = parseConclusion(response);

    // Use the actual confirmed hypothesis ID
    if (confirmedHypothesis) {
      conclusionInput.confirmedHypothesisId = confirmedHypothesis.id;
    }

    const inferredServices = this.inferAffectedServices(
      conclusionInput.rootCause,
      conclusionInput.affectedServices,
      machine.getState().triage?.affectedServices
    );
    if (inferredServices.length > 0) {
      conclusionInput.affectedServices = inferredServices;
    }

    const conclusion = toConclusionResult(conclusionInput);
    machine.setConclusion(conclusion);
  }

  /**
   * Run the remediation phase
   */
  private async runRemediation(machine: InvestigationStateMachine): Promise<void> {
    const conclusion = machine.getState().conclusion;
    if (!conclusion) {
      return;
    }

    // Transition to remediate
    machine.transitionTo('remediate', 'Starting remediation planning');

    const triage = machine.getState().triage;
    const availableSkills = this.options.availableSkills || [];
    const relevantRunbooks = await this.resolveRelevantRunbooks({
      incidentId: this.options.incidentId,
      rootCause: conclusion.rootCause,
      affectedServices: triage?.affectedServices || [],
    });
    const codeFixCandidates = await this.resolveCodeFixCandidates(
      conclusion.rootCause,
      triage?.affectedServices || []
    );

    const prompt = fillPrompt(PROMPTS.generateRemediation, {
      rootCause: conclusion.rootCause,
      services: triage?.affectedServices.join(', ') || 'Unknown',
      skills: this.formatPromptList(availableSkills, 'No skills available'),
      runbooks: this.formatPromptList(relevantRunbooks, 'None found'),
      codeFixes: this.formatPromptList(codeFixCandidates, 'None found'),
    });

    const response = await this.llm.complete(prompt);
    const planInput = parseRemediationPlan(response);
    const steps = toRemediationSteps(planInput);

    const plan: RemediationPlan = {
      steps,
      estimatedRecoveryTime: planInput.estimatedRecoveryTime,
      monitoring: planInput.monitoring,
    };

    machine.setRemediationPlan(plan);

    // Execute remediation steps when auto-remediation is enabled
    // or when an interactive approval callback is provided.
    if (this.options.autoApproveRemediation || this.options.approveRemediationStep) {
      await this.executeRemediation(machine, plan);
    }
  }

  /**
   * Execute remediation steps
   */
  private async executeRemediation(
    machine: InvestigationStateMachine,
    plan: RemediationPlan
  ): Promise<void> {
    for (const step of plan.steps) {
      if (step.command && !step.matchingSkill) {
        machine.updateRemediationStep(step.id, {
          status: 'pending',
          error:
            'Manual execution required. This step has a command but no mapped skill for automatic execution.',
        });
        continue;
      }

      if (!this.options.autoApproveRemediation) {
        const approved = this.options.approveRemediationStep
          ? await this.options.approveRemediationStep(step)
          : false;

        if (!approved) {
          machine.updateRemediationStep(step.id, {
            status: 'pending',
            error: 'Awaiting user approval for execution.',
          });
          continue;
        }
      }

      if (!step.matchingSkill) {
        machine.updateRemediationStep(step.id, {
          status: 'skipped',
          error: 'No execution method available',
        });
        continue;
      }

      machine.updateRemediationStep(step.id, { status: 'executing' });
      this.emit({ type: 'remediation_step', step, status: 'executing' });

      try {
        const result = await this.toolExecutor.execute('skill', {
          name: step.matchingSkill,
          args: {
            action: step.action,
            description: step.description,
            command: step.command,
            rollbackCommand: step.rollbackCommand,
          },
        });

        if (
          typeof result === 'object' &&
          result !== null &&
          'error' in result &&
          typeof (result as { error?: unknown }).error === 'string'
        ) {
          throw new Error((result as { error: string }).error);
        }

        machine.updateRemediationStep(step.id, {
          status: 'completed',
          result,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        machine.updateRemediationStep(step.id, {
          status: 'failed',
          error: errorMessage,
        });
      }
    }
  }

  /**
   * Analyze logs and incorporate findings
   */
  async analyzeLogsForHypothesis(
    logs: string[],
    hypothesis?: InvestigationHypothesis
  ): Promise<LogAnalysisResult> {
    const result = analyzeLogs(logs, this.options.knownServices);

    // If we have an LLM, enhance with LLM analysis
    try {
      const timeRange = result.timeRange;
      const prompt = fillPrompt(PROMPTS.analyzeLogs, {
        logs: logs.slice(0, 100).join('\n'),
        startTime: timeRange?.start.toISOString() || 'unknown',
        endTime: timeRange?.end.toISOString() || 'unknown',
      });

      const response = await this.llm.complete(prompt);
      const llmAnalysis = parseLogAnalysis(response);

      // Merge LLM findings with pattern analysis
      result.suggestedHypotheses = [
        ...new Set([...result.suggestedHypotheses, ...llmAnalysis.suggestedHypotheses]),
      ];

      if (llmAnalysis.summary) {
        result.summary = llmAnalysis.summary;
      }
    } catch (e) {
      // Fall back to pattern-only analysis
    }

    return result;
  }
}

/**
 * Create an investigation orchestrator
 */
export function createOrchestrator(
  llm: LLMClient,
  toolExecutor: ToolExecutor,
  options?: InvestigationOptions
): InvestigationOrchestrator {
  return new InvestigationOrchestrator(llm, toolExecutor, options);
}
