/**
 * Hypothesis Engine: Branching investigation strategy
 *
 * Forms hypotheses, tests them with targeted queries, branches on
 * strong evidence, and prunes dead ends.
 */

import type { Hypothesis, EvidenceStrength, ConfidenceLevel } from './types';

export interface InvestigationTree {
  incidentId: string;
  query: string;
  rootHypotheses: Hypothesis[];
  confirmedRootCause: Hypothesis | null;
  maxDepth: number;
  createdAt: string;
  updatedAt: string;
}

export class HypothesisEngine {
  private hypotheses: Map<string, Hypothesis> = new Map();
  private tree: InvestigationTree;
  private idCounter = 0;

  constructor(
    incidentId: string,
    query: string,
    private readonly maxDepth: number = 4
  ) {
    this.tree = {
      incidentId,
      query,
      rootHypotheses: [],
      confirmedRootCause: null,
      maxDepth,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Create a new hypothesis
   */
  addHypothesis(statement: string, parentId: string | null = null): Hypothesis {
    const parent = parentId ? this.hypotheses.get(parentId) : null;
    const depth = parent ? parent.depth + 1 : 0;

    if (depth > this.maxDepth) {
      throw new Error(`Maximum hypothesis depth (${this.maxDepth}) exceeded`);
    }

    const hypothesis: Hypothesis = {
      id: `h${++this.idCounter}`,
      parentId,
      depth,
      statement,
      evidenceQuery: null,
      evidenceStrength: 'pending',
      evidenceData: null,
      reasoning: null,
      children: [],
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    this.hypotheses.set(hypothesis.id, hypothesis);

    if (parent) {
      parent.children.push(hypothesis);
    } else {
      this.tree.rootHypotheses.push(hypothesis);
    }

    this.tree.updatedAt = new Date().toISOString();
    return hypothesis;
  }

  /**
   * Record evidence for a hypothesis
   */
  recordEvidence(
    hypothesisId: string,
    query: string,
    data: unknown,
    strength: EvidenceStrength,
    reasoning: string
  ): void {
    const hypothesis = this.hypotheses.get(hypothesisId);
    if (!hypothesis) {
      throw new Error(`Hypothesis ${hypothesisId} not found`);
    }

    hypothesis.evidenceQuery = query;
    hypothesis.evidenceData = data;
    hypothesis.evidenceStrength = strength;
    hypothesis.reasoning = reasoning;
    this.tree.updatedAt = new Date().toISOString();
  }

  /**
   * Prune a hypothesis (no supporting evidence)
   */
  prune(hypothesisId: string, reason: string): void {
    const hypothesis = this.hypotheses.get(hypothesisId);
    if (!hypothesis) {
      throw new Error(`Hypothesis ${hypothesisId} not found`);
    }

    hypothesis.status = 'pruned';
    hypothesis.reasoning = reason;

    // Also prune all children
    for (const child of hypothesis.children) {
      this.prune(child.id, 'Parent hypothesis pruned');
    }

    this.tree.updatedAt = new Date().toISOString();
  }

  /**
   * Confirm a hypothesis as the root cause
   */
  confirm(hypothesisId: string): void {
    const hypothesis = this.hypotheses.get(hypothesisId);
    if (!hypothesis) {
      throw new Error(`Hypothesis ${hypothesisId} not found`);
    }

    hypothesis.status = 'confirmed';
    this.tree.confirmedRootCause = hypothesis;
    this.tree.updatedAt = new Date().toISOString();
  }

  /**
   * Get all active (non-pruned) hypotheses that need testing
   */
  getActiveHypotheses(): Hypothesis[] {
    return Array.from(this.hypotheses.values()).filter(
      (h) => h.status === 'active' && h.evidenceStrength === 'pending'
    );
  }

  /**
   * Get hypotheses with strong evidence (candidates for branching)
   */
  getStrongHypotheses(): Hypothesis[] {
    return Array.from(this.hypotheses.values()).filter(
      (h) => h.status === 'active' && h.evidenceStrength === 'strong' && h.depth < this.maxDepth
    );
  }

  /**
   * Get a hypothesis by ID
   */
  getHypothesis(id: string): Hypothesis | undefined {
    return this.hypotheses.get(id);
  }

  /**
   * Get the full investigation tree
   */
  getTree(): InvestigationTree {
    return this.tree;
  }

  /**
   * Check if investigation is complete
   */
  isComplete(): boolean {
    return (
      this.tree.confirmedRootCause !== null ||
      this.getActiveHypotheses().length === 0 // All hypotheses tested
    );
  }

  /**
   * Calculate confidence for the confirmed root cause
   */
  calculateConfidence(): ConfidenceLevel {
    const confirmed = this.tree.confirmedRootCause;
    if (!confirmed) {
      return 'low';
    }

    const factors = {
      evidenceChainDepth: confirmed.depth,
      corroboratingSignals: this.countCorroboratingSignals(confirmed),
      contradictingSignals: this.countContradictingSignals(),
      hasStrongEvidence: confirmed.evidenceStrength === 'strong',
    };

    let score = 0;

    // Deeper investigation = more validated
    score += Math.min(factors.evidenceChainDepth * 15, 30);

    // Multiple confirming signals
    score += Math.min(factors.corroboratingSignals * 20, 40);

    // Contradicting signals reduce confidence
    score -= factors.contradictingSignals * 25;

    // Strong direct evidence
    score += factors.hasStrongEvidence ? 20 : 0;

    if (score >= 70) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
  }

  private countCorroboratingSignals(hypothesis: Hypothesis): number {
    // Count ancestors with strong evidence
    let count = 0;
    let current = hypothesis;

    while (current.parentId) {
      const parent = this.hypotheses.get(current.parentId);
      if (parent && parent.evidenceStrength === 'strong') {
        count++;
      }
      if (!parent) break;
      current = parent;
    }

    return count;
  }

  private countContradictingSignals(): number {
    // Count hypotheses that had some evidence but were pruned
    return Array.from(this.hypotheses.values()).filter(
      (h) => h.status === 'pruned' && h.evidenceStrength === 'weak'
    ).length;
  }

  /**
   * Export to markdown for incident updates
   */
  toMarkdown(): string {
    const lines: string[] = [];

    lines.push(`# Investigation: ${this.tree.incidentId || 'Query'}`);
    lines.push('');
    lines.push(`**Query:** ${this.tree.query}`);
    lines.push(`**Started:** ${this.tree.createdAt}`);
    lines.push('');

    if (this.tree.confirmedRootCause) {
      const confidence = this.calculateConfidence();
      lines.push('## Root Cause Identified');
      lines.push('');
      lines.push(`**${this.tree.confirmedRootCause.statement}**`);
      lines.push('');
      lines.push(`Confidence: ${confidence.toUpperCase()}`);
      lines.push('');
      if (this.tree.confirmedRootCause.reasoning) {
        lines.push(`Reasoning: ${this.tree.confirmedRootCause.reasoning}`);
        lines.push('');
      }
    }

    lines.push('## Hypothesis Tree');
    lines.push('');

    for (const root of this.tree.rootHypotheses) {
      this.appendHypothesisMarkdown(root, lines, 0);
    }

    return lines.join('\n');
  }

  private appendHypothesisMarkdown(h: Hypothesis, lines: string[], indent: number): void {
    const prefix = '  '.repeat(indent);
    const statusIcon =
      h.status === 'confirmed' ? '✅' : h.status === 'pruned' ? '❌' : h.evidenceStrength === 'strong' ? '⚠️' : '○';

    const evidenceLabel =
      h.evidenceStrength !== 'pending' ? ` [${h.evidenceStrength.toUpperCase()}]` : '';

    lines.push(`${prefix}- ${statusIcon} ${h.statement}${evidenceLabel}`);

    if (h.reasoning && h.status !== 'active') {
      lines.push(`${prefix}  _${h.reasoning}_`);
    }

    for (const child of h.children) {
      this.appendHypothesisMarkdown(child, lines, indent + 1);
    }
  }

  /**
   * Serialize to JSON for persistence
   */
  toJSON(): string {
    return JSON.stringify(this.tree, null, 2);
  }

  /**
   * Load from JSON
   */
  static fromJSON(json: string): HypothesisEngine {
    const tree = JSON.parse(json) as InvestigationTree;
    const engine = new HypothesisEngine(tree.incidentId, tree.query, tree.maxDepth);

    // Rebuild internal state
    engine.tree = tree;
    const rebuildMap = (hypotheses: Hypothesis[]) => {
      for (const h of hypotheses) {
        engine.hypotheses.set(h.id, h);
        const idNum = parseInt(h.id.slice(1), 10);
        if (idNum > engine.idCounter) {
          engine.idCounter = idNum;
        }
        rebuildMap(h.children);
      }
    };
    rebuildMap(tree.rootHypotheses);

    return engine;
  }
}
