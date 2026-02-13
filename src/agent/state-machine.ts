/**
 * Investigation State Machine
 *
 * Orchestrates the hypothesis-driven investigation flow through
 * distinct phases: TRIAGE → HYPOTHESIZE → INVESTIGATE → EVALUATE → CONCLUDE → REMEDIATE
 */

import { EventEmitter } from 'events';
import type { Hypothesis, EvidenceStrength, RetrievedKnowledge } from './types';
import type { CausalQuery } from './causal-query';

/**
 * Investigation phases
 */
export type InvestigationPhase =
  | 'idle'
  | 'triage'
  | 'hypothesize'
  | 'investigate'
  | 'evaluate'
  | 'conclude'
  | 'remediate'
  | 'complete';

/**
 * Phase transition events
 */
export interface PhaseTransition {
  from: InvestigationPhase;
  to: InvestigationPhase;
  reason: string;
  timestamp: Date;
}

/**
 * Triage result from initial incident analysis
 */
export interface TriageResult {
  incidentId?: string;
  summary: string;
  affectedServices: string[];
  symptoms: string[];
  errorMessages: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  timeWindow: {
    start: Date;
    end: Date;
  };
  relatedKnowledge?: RetrievedKnowledge;
}

/**
 * Hypothesis with investigation metadata
 */
export interface InvestigationHypothesis {
  id: string;
  statement: string;
  category:
    | 'infrastructure'
    | 'application'
    | 'dependency'
    | 'configuration'
    | 'capacity'
    | 'unknown';
  priority: number;
  status: 'pending' | 'investigating' | 'confirmed' | 'pruned';
  evidenceStrength: EvidenceStrength;
  confidence: number; // 0-100
  reasoning?: string;
  confirmingEvidence: string;
  refutingEvidence: string;
  queries: CausalQuery[];
  queryResults: Map<string, unknown>;
  children: InvestigationHypothesis[];
  parentId?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Evidence evaluation result
 */
export interface EvidenceEvaluation {
  hypothesisId: string;
  evidenceStrength: EvidenceStrength;
  confidence: number;
  reasoning: string;
  action: 'branch' | 'prune' | 'confirm' | 'continue';
  findings: string[];
}

/**
 * Investigation conclusion
 */
export interface Conclusion {
  rootCause: string;
  confidence: 'high' | 'medium' | 'low';
  confirmedHypothesisId: string;
  affectedServices?: string[];
  evidenceChain: Array<{
    finding: string;
    source: string;
    strength: EvidenceStrength;
  }>;
  alternativeExplanations: string[];
  unknowns: string[];
}

/**
 * Remediation step
 */
export interface RemediationStep {
  id: string;
  action: string;
  description: string;
  command?: string;
  rollbackCommand?: string;
  codeReference?: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requiresApproval: boolean;
  status: 'pending' | 'approved' | 'executing' | 'completed' | 'failed' | 'skipped';
  matchingSkill?: string;
  matchingRunbook?: string;
  result?: unknown;
  error?: string;
}

/**
 * Remediation plan
 */
export interface RemediationPlan {
  steps: RemediationStep[];
  estimatedRecoveryTime?: string;
  monitoring: string[];
}

/**
 * Investigation state
 */
export interface InvestigationState {
  id: string;
  query: string;
  phase: InvestigationPhase;
  startedAt: Date;
  updatedAt: Date;
  completedAt?: Date;

  // Phase results
  triage?: TriageResult;
  hypotheses: InvestigationHypothesis[];
  currentHypothesisId?: string;
  evaluations: EvidenceEvaluation[];
  conclusion?: Conclusion;
  remediationPlan?: RemediationPlan;

  // Tracking
  phaseHistory: PhaseTransition[];
  iterationCount: number;
  maxIterations: number;
  toolCallCount: number;
  errors: Array<{ phase: InvestigationPhase; error: string; timestamp: Date }>;
}

/**
 * State machine events
 */
export interface StateMachineEvents {
  phaseChange: (transition: PhaseTransition) => void;
  hypothesisCreated: (hypothesis: InvestigationHypothesis) => void;
  hypothesisUpdated: (hypothesis: InvestigationHypothesis) => void;
  evidenceEvaluated: (evaluation: EvidenceEvaluation) => void;
  conclusionReached: (conclusion: Conclusion) => void;
  remediationStarted: (plan: RemediationPlan) => void;
  stepCompleted: (step: RemediationStep) => void;
  error: (error: Error, phase: InvestigationPhase) => void;
  complete: (state: InvestigationState) => void;
}

/**
 * Investigation State Machine
 */
export class InvestigationStateMachine extends EventEmitter {
  private state: InvestigationState;
  private readonly maxHypotheses = 10;
  private readonly maxDepth = 4;

  constructor(
    query: string,
    options: {
      incidentId?: string;
      maxIterations?: number;
    } = {}
  ) {
    super();

    this.state = {
      id: this.generateId(),
      query,
      phase: 'idle',
      startedAt: new Date(),
      updatedAt: new Date(),
      hypotheses: [],
      evaluations: [],
      phaseHistory: [],
      iterationCount: 0,
      maxIterations: options.maxIterations || 20,
      toolCallCount: 0,
      errors: [],
    };

    if (options.incidentId) {
      this.state.triage = {
        incidentId: options.incidentId,
        summary: '',
        affectedServices: [],
        symptoms: [],
        errorMessages: [],
        severity: 'medium',
        timeWindow: {
          start: new Date(Date.now() - 60 * 60 * 1000),
          end: new Date(),
        },
      };
    }
  }

  /**
   * Get current state
   */
  getState(): Readonly<InvestigationState> {
    return { ...this.state };
  }

  /**
   * Get current phase
   */
  getPhase(): InvestigationPhase {
    return this.state.phase;
  }

  /**
   * Check if investigation is complete
   */
  isComplete(): boolean {
    return this.state.phase === 'complete';
  }

  /**
   * Check if we can continue iterating
   */
  canContinue(): boolean {
    return (
      this.state.iterationCount < this.state.maxIterations &&
      this.state.phase !== 'complete' &&
      this.state.phase !== 'idle'
    );
  }

  /**
   * Start the investigation
   */
  start(): void {
    if (this.state.phase !== 'idle') {
      throw new Error(`Cannot start: already in phase ${this.state.phase}`);
    }
    this.transitionTo('triage', 'Investigation started');
  }

  /**
   * Transition to a new phase
   */
  transitionTo(phase: InvestigationPhase, reason: string): void {
    const transition: PhaseTransition = {
      from: this.state.phase,
      to: phase,
      reason,
      timestamp: new Date(),
    };

    // Validate transition
    if (!this.isValidTransition(this.state.phase, phase)) {
      throw new Error(`Invalid transition from ${this.state.phase} to ${phase}`);
    }

    this.state.phase = phase;
    this.state.updatedAt = new Date();
    this.state.phaseHistory.push(transition);

    if (phase === 'complete') {
      this.state.completedAt = new Date();
    }

    this.emit('phaseChange', transition);
  }

  /**
   * Check if a phase transition is valid
   */
  private isValidTransition(from: InvestigationPhase, to: InvestigationPhase): boolean {
    const validTransitions: Record<InvestigationPhase, InvestigationPhase[]> = {
      idle: ['triage'],
      triage: ['hypothesize', 'conclude'], // Can skip to conclude if obvious
      hypothesize: ['investigate', 'conclude'],
      investigate: ['evaluate'],
      evaluate: ['investigate', 'hypothesize', 'conclude'], // Can loop back
      conclude: ['remediate', 'complete'],
      remediate: ['complete'],
      complete: [],
    };

    return validTransitions[from]?.includes(to) || false;
  }

  /**
   * Set triage result
   */
  setTriageResult(result: TriageResult): void {
    if (this.state.phase !== 'triage') {
      throw new Error(`Cannot set triage result in phase ${this.state.phase}`);
    }

    this.state.triage = result;
    this.state.updatedAt = new Date();
  }

  /**
   * Add a hypothesis
   */
  addHypothesis(
    hypothesis: Omit<
      InvestigationHypothesis,
      | 'id'
      | 'status'
      | 'evidenceStrength'
      | 'confidence'
      | 'queryResults'
      | 'children'
      | 'createdAt'
      | 'updatedAt'
    >
  ): InvestigationHypothesis {
    if (this.state.hypotheses.length >= this.maxHypotheses) {
      throw new Error(`Maximum hypotheses (${this.maxHypotheses}) reached`);
    }

    const newHypothesis: InvestigationHypothesis = {
      ...hypothesis,
      id: this.generateHypothesisId(),
      status: 'pending',
      evidenceStrength: 'pending',
      confidence: 0,
      queryResults: new Map(),
      children: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Check depth if it's a sub-hypothesis
    if (hypothesis.parentId) {
      const depth = this.getHypothesisDepth(hypothesis.parentId);
      if (depth >= this.maxDepth) {
        throw new Error(`Maximum hypothesis depth (${this.maxDepth}) reached`);
      }

      // Add to parent's children
      const parent = this.findHypothesis(hypothesis.parentId);
      if (parent) {
        parent.children.push(newHypothesis);
      }
    }

    this.state.hypotheses.push(newHypothesis);
    this.state.updatedAt = new Date();
    this.emit('hypothesisCreated', newHypothesis);

    return newHypothesis;
  }

  /**
   * Get hypothesis depth in the tree
   */
  private getHypothesisDepth(hypothesisId: string): number {
    let depth = 0;
    let current = this.findHypothesis(hypothesisId);

    while (current?.parentId) {
      depth++;
      current = this.findHypothesis(current.parentId);
    }

    return depth;
  }

  /**
   * Find a hypothesis by ID
   */
  findHypothesis(id: string): InvestigationHypothesis | undefined {
    return this.state.hypotheses.find((h) => h.id === id);
  }

  /**
   * Get active (non-pruned, non-confirmed) hypotheses
   */
  getActiveHypotheses(): InvestigationHypothesis[] {
    return this.state.hypotheses.filter(
      (h) => h.status === 'pending' || h.status === 'investigating'
    );
  }

  /**
   * Get the next hypothesis to investigate
   */
  getNextHypothesis(): InvestigationHypothesis | undefined {
    const active = this.getActiveHypotheses();

    // Prioritize by:
    // 1. Status: pending before investigating
    // 2. Priority: lower number = higher priority
    // 3. Depth: shallower hypotheses first
    return active.sort((a, b) => {
      if (a.status === 'pending' && b.status === 'investigating') return -1;
      if (a.status === 'investigating' && b.status === 'pending') return 1;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return this.getHypothesisDepth(a.id) - this.getHypothesisDepth(b.id);
    })[0];
  }

  /**
   * Set current hypothesis being investigated
   */
  setCurrentHypothesis(hypothesisId: string): void {
    const hypothesis = this.findHypothesis(hypothesisId);
    if (!hypothesis) {
      throw new Error(`Hypothesis ${hypothesisId} not found`);
    }

    hypothesis.status = 'investigating';
    hypothesis.updatedAt = new Date();
    this.state.currentHypothesisId = hypothesisId;
    this.state.updatedAt = new Date();
  }

  /**
   * Record query result for a hypothesis
   */
  recordQueryResult(hypothesisId: string, queryId: string, result: unknown): void {
    const hypothesis = this.findHypothesis(hypothesisId);
    if (!hypothesis) {
      throw new Error(`Hypothesis ${hypothesisId} not found`);
    }

    hypothesis.queryResults.set(queryId, result);
    hypothesis.updatedAt = new Date();
    this.state.toolCallCount++;
    this.state.updatedAt = new Date();
  }

  /**
   * Apply evidence evaluation to a hypothesis
   */
  applyEvaluation(evaluation: EvidenceEvaluation): void {
    const hypothesis = this.findHypothesis(evaluation.hypothesisId);
    if (!hypothesis) {
      throw new Error(`Hypothesis ${evaluation.hypothesisId} not found`);
    }

    hypothesis.evidenceStrength = evaluation.evidenceStrength;
    hypothesis.confidence = evaluation.confidence;
    hypothesis.reasoning = evaluation.reasoning;
    hypothesis.updatedAt = new Date();

    // Apply action
    switch (evaluation.action) {
      case 'confirm':
        hypothesis.status = 'confirmed';
        break;
      case 'prune':
        hypothesis.status = 'pruned';
        break;
      case 'branch':
        hypothesis.status = 'investigating'; // Will add sub-hypotheses
        break;
      case 'continue':
        hypothesis.status = 'investigating';
        break;
    }

    this.state.evaluations.push(evaluation);
    this.state.updatedAt = new Date();
    this.state.iterationCount++;

    this.emit('hypothesisUpdated', hypothesis);
    this.emit('evidenceEvaluated', evaluation);
  }

  /**
   * Set conclusion
   */
  setConclusion(conclusion: Conclusion): void {
    if (this.state.phase !== 'conclude') {
      throw new Error(`Cannot set conclusion in phase ${this.state.phase}`);
    }

    this.state.conclusion = conclusion;
    this.state.updatedAt = new Date();

    // Mark the confirmed hypothesis
    const confirmedHypothesis = this.findHypothesis(conclusion.confirmedHypothesisId);
    if (confirmedHypothesis) {
      confirmedHypothesis.status = 'confirmed';
      confirmedHypothesis.updatedAt = new Date();
    }

    this.emit('conclusionReached', conclusion);
  }

  /**
   * Set remediation plan
   */
  setRemediationPlan(plan: RemediationPlan): void {
    this.state.remediationPlan = plan;
    this.state.updatedAt = new Date();
    this.emit('remediationStarted', plan);
  }

  /**
   * Update remediation step status
   */
  updateRemediationStep(
    stepId: string,
    update: Partial<Pick<RemediationStep, 'status' | 'result' | 'error'>>
  ): void {
    const step = this.state.remediationPlan?.steps.find((s) => s.id === stepId);
    if (!step) {
      throw new Error(`Remediation step ${stepId} not found`);
    }

    Object.assign(step, update);
    this.state.updatedAt = new Date();

    if (update.status === 'completed' || update.status === 'failed') {
      this.emit('stepCompleted', step);
    }
  }

  /**
   * Record an error
   */
  recordError(error: Error): void {
    this.state.errors.push({
      phase: this.state.phase,
      error: error.message,
      timestamp: new Date(),
    });
    this.state.updatedAt = new Date();

    // Only emit if there are listeners (to prevent Node from throwing)
    if (this.listenerCount('error') > 0) {
      this.emit('error', error, this.state.phase);
    }
  }

  /**
   * Get investigation summary
   */
  getSummary(): string {
    const lines: string[] = [];

    lines.push(`# Investigation: ${this.state.id}`);
    lines.push(`Query: ${this.state.query}`);
    lines.push(`Phase: ${this.state.phase}`);
    lines.push(`Started: ${this.state.startedAt.toISOString()}`);
    lines.push(`Iterations: ${this.state.iterationCount}/${this.state.maxIterations}`);
    lines.push('');

    if (this.state.triage) {
      lines.push('## Triage');
      lines.push(`Severity: ${this.state.triage.severity}`);
      lines.push(`Services: ${this.state.triage.affectedServices.join(', ') || 'none identified'}`);
      lines.push(`Symptoms: ${this.state.triage.symptoms.join(', ') || 'none identified'}`);
      lines.push('');
    }

    if (this.state.hypotheses.length > 0) {
      lines.push('## Hypotheses');

      const proven = this.state.hypotheses.filter((h) => h.status === 'confirmed');
      const evaluating = this.state.hypotheses.filter(
        (h) => h.status === 'pending' || h.status === 'investigating'
      );
      const rejected = this.state.hypotheses.filter((h) => h.status === 'pruned');

      lines.push('### Proven');
      if (proven.length === 0) {
        lines.push('None confirmed yet.');
      }
      for (const h of proven) {
        lines.push(`✅ [PROVEN] ${h.statement}`);
        if (h.reasoning) {
          lines.push(`  Reasoning: ${h.reasoning}`);
        }
      }

      if (evaluating.length > 0) {
        lines.push('');
        lines.push('### Still Evaluating');
        for (const h of evaluating) {
          lines.push(`- [${h.status}] ${h.statement}`);
        }
      }

      if (rejected.length > 0) {
        lines.push('');
        lines.push('### Rejected / Deprioritized');
        for (const h of rejected) {
          lines.push(`- [rejected] ${h.statement}`);
        }
      }
      lines.push('');
    }

    if (this.state.conclusion) {
      lines.push('## Conclusion');
      lines.push(`Root Cause: ${this.state.conclusion.rootCause}`);
      lines.push(`Confidence: ${this.state.conclusion.confidence}`);
      if (
        this.state.conclusion.affectedServices &&
        this.state.conclusion.affectedServices.length > 0
      ) {
        lines.push(`Affected Services: ${this.state.conclusion.affectedServices.join(', ')}`);
      }
      lines.push('');
    }

    if (this.state.errors.length > 0) {
      lines.push('## Errors');
      for (const e of this.state.errors) {
        lines.push(`- [${e.phase}] ${e.error}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Serialize state to JSON
   */
  toJSON(): string {
    const serializable = {
      ...this.state,
      hypotheses: this.state.hypotheses.map((h) => ({
        ...h,
        queryResults: Object.fromEntries(h.queryResults),
      })),
    };
    return JSON.stringify(serializable, null, 2);
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  }

  /**
   * Generate hypothesis ID
   */
  private generateHypothesisId(): string {
    return `h_${this.state.hypotheses.length + 1}`;
  }
}

/**
 * Create a new investigation
 */
export function createInvestigation(
  query: string,
  options?: { incidentId?: string; maxIterations?: number }
): InvestigationStateMachine {
  return new InvestigationStateMachine(query, options);
}
