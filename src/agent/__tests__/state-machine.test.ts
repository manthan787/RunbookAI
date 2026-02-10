/**
 * Tests for Investigation State Machine
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  InvestigationStateMachine,
  createInvestigation,
  type InvestigationPhase,
  type TriageResult,
  type EvidenceEvaluation,
} from '../state-machine';

describe('InvestigationStateMachine', () => {
  let machine: InvestigationStateMachine;

  beforeEach(() => {
    machine = createInvestigation('Why is the API slow?');
  });

  describe('initialization', () => {
    it('should start in idle phase', () => {
      expect(machine.getPhase()).toBe('idle');
    });

    it('should have empty hypotheses list', () => {
      expect(machine.getState().hypotheses).toHaveLength(0);
    });

    it('should not be complete', () => {
      expect(machine.isComplete()).toBe(false);
    });

    it('should generate unique ID', () => {
      const machine2 = createInvestigation('Another query');
      expect(machine.getState().id).not.toBe(machine2.getState().id);
    });

    it('should accept incident ID in options', () => {
      const incidentMachine = createInvestigation('Investigate incident', {
        incidentId: 'PD-12345',
      });
      expect(incidentMachine.getState().triage?.incidentId).toBe('PD-12345');
    });
  });

  describe('phase transitions', () => {
    it('should transition from idle to triage on start', () => {
      machine.start();
      expect(machine.getPhase()).toBe('triage');
    });

    it('should throw if started twice', () => {
      machine.start();
      expect(() => machine.start()).toThrow('Cannot start: already in phase triage');
    });

    it('should allow valid transition: triage → hypothesize', () => {
      machine.start();
      machine.transitionTo('hypothesize', 'Triage complete');
      expect(machine.getPhase()).toBe('hypothesize');
    });

    it('should allow valid transition: hypothesize → investigate', () => {
      machine.start();
      machine.transitionTo('hypothesize', 'Triage complete');
      machine.transitionTo('investigate', 'Starting investigation');
      expect(machine.getPhase()).toBe('investigate');
    });

    it('should allow valid transition: investigate → evaluate', () => {
      machine.start();
      machine.transitionTo('hypothesize', 'Triage complete');
      machine.transitionTo('investigate', 'Starting investigation');
      machine.transitionTo('evaluate', 'Evaluating evidence');
      expect(machine.getPhase()).toBe('evaluate');
    });

    it('should allow loop: evaluate → investigate', () => {
      machine.start();
      machine.transitionTo('hypothesize', 'Triage complete');
      machine.transitionTo('investigate', 'Starting investigation');
      machine.transitionTo('evaluate', 'Evaluating evidence');
      machine.transitionTo('investigate', 'More investigation needed');
      expect(machine.getPhase()).toBe('investigate');
    });

    it('should allow skip to conclude from triage', () => {
      machine.start();
      machine.transitionTo('conclude', 'Obvious root cause');
      expect(machine.getPhase()).toBe('conclude');
    });

    it('should throw on invalid transition', () => {
      machine.start();
      expect(() => machine.transitionTo('remediate', 'Invalid')).toThrow(
        'Invalid transition from triage to remediate'
      );
    });

    it('should record phase history', () => {
      machine.start();
      machine.transitionTo('hypothesize', 'Reason 1');
      machine.transitionTo('investigate', 'Reason 2');

      const history = machine.getState().phaseHistory;
      expect(history).toHaveLength(3);
      expect(history[0].from).toBe('idle');
      expect(history[0].to).toBe('triage');
      expect(history[1].to).toBe('hypothesize');
      expect(history[2].to).toBe('investigate');
    });

    it('should emit phaseChange events', () => {
      const transitions: InvestigationPhase[] = [];
      machine.on('phaseChange', (t) => transitions.push(t.to));

      machine.start();
      machine.transitionTo('hypothesize', 'Done');

      expect(transitions).toEqual(['triage', 'hypothesize']);
    });

    it('should mark complete when reaching complete phase', () => {
      machine.start();
      machine.transitionTo('conclude', 'Found it');
      machine.transitionTo('complete', 'Done');

      expect(machine.isComplete()).toBe(true);
      expect(machine.getState().completedAt).toBeDefined();
    });
  });

  describe('triage', () => {
    it('should set triage result', () => {
      machine.start();

      const triageResult: TriageResult = {
        summary: 'API latency spike',
        affectedServices: ['api-gateway', 'user-service'],
        symptoms: ['p99 latency > 5s', 'error rate increasing'],
        errorMessages: ['timeout waiting for response'],
        severity: 'high',
        timeWindow: {
          start: new Date('2024-01-01T10:00:00Z'),
          end: new Date('2024-01-01T11:00:00Z'),
        },
      };

      machine.setTriageResult(triageResult);

      expect(machine.getState().triage).toEqual(triageResult);
    });

    it('should throw if setting triage in wrong phase', () => {
      machine.start();
      machine.transitionTo('hypothesize', 'Skip');

      expect(() =>
        machine.setTriageResult({
          summary: 'Test',
          affectedServices: [],
          symptoms: [],
          errorMessages: [],
          severity: 'low',
          timeWindow: { start: new Date(), end: new Date() },
        })
      ).toThrow('Cannot set triage result in phase hypothesize');
    });
  });

  describe('hypotheses', () => {
    beforeEach(() => {
      machine.start();
      machine.transitionTo('hypothesize', 'Triage done');
    });

    it('should add a hypothesis', () => {
      const hypothesis = machine.addHypothesis({
        statement: 'Database connection pool exhausted',
        category: 'infrastructure',
        priority: 1,
        confirmingEvidence: 'Connection count at max',
        refutingEvidence: 'Connections available',
        queries: [],
      });

      expect(hypothesis.id).toBe('h_1');
      expect(hypothesis.status).toBe('pending');
      expect(hypothesis.evidenceStrength).toBe('pending');
      expect(hypothesis.confidence).toBe(0);
      expect(machine.getState().hypotheses).toHaveLength(1);
    });

    it('should add multiple hypotheses with sequential IDs', () => {
      machine.addHypothesis({
        statement: 'Hypothesis 1',
        category: 'application',
        priority: 1,
        confirmingEvidence: '',
        refutingEvidence: '',
        queries: [],
      });

      machine.addHypothesis({
        statement: 'Hypothesis 2',
        category: 'dependency',
        priority: 2,
        confirmingEvidence: '',
        refutingEvidence: '',
        queries: [],
      });

      expect(machine.getState().hypotheses[0].id).toBe('h_1');
      expect(machine.getState().hypotheses[1].id).toBe('h_2');
    });

    it('should emit hypothesisCreated event', () => {
      let created: any = null;
      machine.on('hypothesisCreated', (h) => (created = h));

      machine.addHypothesis({
        statement: 'Test hypothesis',
        category: 'unknown',
        priority: 1,
        confirmingEvidence: '',
        refutingEvidence: '',
        queries: [],
      });

      expect(created).not.toBeNull();
      expect(created.statement).toBe('Test hypothesis');
    });

    it('should find hypothesis by ID', () => {
      machine.addHypothesis({
        statement: 'Find me',
        category: 'application',
        priority: 1,
        confirmingEvidence: '',
        refutingEvidence: '',
        queries: [],
      });

      const found = machine.findHypothesis('h_1');
      expect(found?.statement).toBe('Find me');
    });

    it('should return undefined for non-existent hypothesis', () => {
      expect(machine.findHypothesis('h_999')).toBeUndefined();
    });

    it('should enforce max hypotheses limit', () => {
      // Add 10 hypotheses (the max)
      for (let i = 0; i < 10; i++) {
        machine.addHypothesis({
          statement: `Hypothesis ${i}`,
          category: 'unknown',
          priority: i,
          confirmingEvidence: '',
          refutingEvidence: '',
          queries: [],
        });
      }

      // 11th should throw
      expect(() =>
        machine.addHypothesis({
          statement: 'Too many',
          category: 'unknown',
          priority: 11,
          confirmingEvidence: '',
          refutingEvidence: '',
          queries: [],
        })
      ).toThrow('Maximum hypotheses (10) reached');
    });

    it('should support sub-hypotheses', () => {
      const parent = machine.addHypothesis({
        statement: 'Parent hypothesis',
        category: 'infrastructure',
        priority: 1,
        confirmingEvidence: '',
        refutingEvidence: '',
        queries: [],
      });

      const child = machine.addHypothesis({
        statement: 'Child hypothesis',
        category: 'infrastructure',
        priority: 1,
        parentId: parent.id,
        confirmingEvidence: '',
        refutingEvidence: '',
        queries: [],
      });

      expect(child.parentId).toBe(parent.id);
      expect(parent.children).toHaveLength(1);
      expect(parent.children[0].id).toBe(child.id);
    });

    it('should get active hypotheses', () => {
      machine.addHypothesis({
        statement: 'Active 1',
        category: 'application',
        priority: 1,
        confirmingEvidence: '',
        refutingEvidence: '',
        queries: [],
      });

      const h2 = machine.addHypothesis({
        statement: 'Will be pruned',
        category: 'application',
        priority: 2,
        confirmingEvidence: '',
        refutingEvidence: '',
        queries: [],
      });

      // Prune h2
      machine.applyEvaluation({
        hypothesisId: h2.id,
        evidenceStrength: 'none',
        confidence: 0,
        reasoning: 'No evidence',
        action: 'prune',
        findings: [],
      });

      const active = machine.getActiveHypotheses();
      expect(active).toHaveLength(1);
      expect(active[0].statement).toBe('Active 1');
    });

    it('should get next hypothesis by priority', () => {
      machine.addHypothesis({
        statement: 'Low priority',
        category: 'application',
        priority: 3,
        confirmingEvidence: '',
        refutingEvidence: '',
        queries: [],
      });

      machine.addHypothesis({
        statement: 'High priority',
        category: 'infrastructure',
        priority: 1,
        confirmingEvidence: '',
        refutingEvidence: '',
        queries: [],
      });

      const next = machine.getNextHypothesis();
      expect(next?.statement).toBe('High priority');
    });
  });

  describe('evidence evaluation', () => {
    beforeEach(() => {
      machine.start();
      machine.transitionTo('hypothesize', 'Triage done');
      machine.addHypothesis({
        statement: 'Test hypothesis',
        category: 'application',
        priority: 1,
        confirmingEvidence: '',
        refutingEvidence: '',
        queries: [],
      });
    });

    it('should apply evaluation to hypothesis', () => {
      const evaluation: EvidenceEvaluation = {
        hypothesisId: 'h_1',
        evidenceStrength: 'strong',
        confidence: 85,
        reasoning: 'Multiple indicators point to this',
        action: 'confirm',
        findings: ['High CPU usage', 'Memory leak detected'],
      };

      machine.applyEvaluation(evaluation);

      const hypothesis = machine.findHypothesis('h_1');
      expect(hypothesis?.evidenceStrength).toBe('strong');
      expect(hypothesis?.confidence).toBe(85);
      expect(hypothesis?.status).toBe('confirmed');
      expect(hypothesis?.reasoning).toBe('Multiple indicators point to this');
    });

    it('should prune hypothesis when action is prune', () => {
      machine.applyEvaluation({
        hypothesisId: 'h_1',
        evidenceStrength: 'none',
        confidence: 0,
        reasoning: 'No supporting evidence',
        action: 'prune',
        findings: [],
      });

      const hypothesis = machine.findHypothesis('h_1');
      expect(hypothesis?.status).toBe('pruned');
    });

    it('should emit events on evaluation', () => {
      let updatedHypothesis: any = null;
      let evaluation: any = null;

      machine.on('hypothesisUpdated', (h) => (updatedHypothesis = h));
      machine.on('evidenceEvaluated', (e) => (evaluation = e));

      machine.applyEvaluation({
        hypothesisId: 'h_1',
        evidenceStrength: 'weak',
        confidence: 30,
        reasoning: 'Some evidence',
        action: 'continue',
        findings: [],
      });

      expect(updatedHypothesis).not.toBeNull();
      expect(evaluation).not.toBeNull();
    });

    it('should increment iteration count', () => {
      expect(machine.getState().iterationCount).toBe(0);

      machine.applyEvaluation({
        hypothesisId: 'h_1',
        evidenceStrength: 'weak',
        confidence: 30,
        reasoning: 'Test',
        action: 'continue',
        findings: [],
      });

      expect(machine.getState().iterationCount).toBe(1);
    });

    it('should track evaluations history', () => {
      machine.applyEvaluation({
        hypothesisId: 'h_1',
        evidenceStrength: 'weak',
        confidence: 30,
        reasoning: 'First eval',
        action: 'continue',
        findings: [],
      });

      expect(machine.getState().evaluations).toHaveLength(1);
      expect(machine.getState().evaluations[0].reasoning).toBe('First eval');
    });
  });

  describe('conclusion', () => {
    beforeEach(() => {
      machine.start();
      machine.transitionTo('hypothesize', 'Triage done');
      machine.addHypothesis({
        statement: 'Root cause found',
        category: 'infrastructure',
        priority: 1,
        confirmingEvidence: '',
        refutingEvidence: '',
        queries: [],
      });
      machine.transitionTo('conclude', 'Evidence strong');
    });

    it('should set conclusion', () => {
      machine.setConclusion({
        rootCause: 'Database connection pool exhausted',
        confidence: 'high',
        confirmedHypothesisId: 'h_1',
        evidenceChain: [
          { finding: 'Connection count at max', source: 'cloudwatch', strength: 'strong' },
        ],
        alternativeExplanations: ['Could also be network issue'],
        unknowns: ['Exact trigger time'],
      });

      const conclusion = machine.getState().conclusion;
      expect(conclusion?.rootCause).toBe('Database connection pool exhausted');
      expect(conclusion?.confidence).toBe('high');
    });

    it('should mark confirmed hypothesis', () => {
      machine.setConclusion({
        rootCause: 'Test',
        confidence: 'medium',
        confirmedHypothesisId: 'h_1',
        evidenceChain: [],
        alternativeExplanations: [],
        unknowns: [],
      });

      const hypothesis = machine.findHypothesis('h_1');
      expect(hypothesis?.status).toBe('confirmed');
    });

    it('should emit conclusionReached event', () => {
      let reached: any = null;
      machine.on('conclusionReached', (c) => (reached = c));

      machine.setConclusion({
        rootCause: 'Test',
        confidence: 'low',
        confirmedHypothesisId: 'h_1',
        evidenceChain: [],
        alternativeExplanations: [],
        unknowns: [],
      });

      expect(reached).not.toBeNull();
    });
  });

  describe('remediation', () => {
    beforeEach(() => {
      machine.start();
      machine.transitionTo('conclude', 'Skip to end');
      machine.setConclusion({
        rootCause: 'Test root cause',
        confidence: 'high',
        confirmedHypothesisId: 'h_1',
        evidenceChain: [],
        alternativeExplanations: [],
        unknowns: [],
      });
      machine.transitionTo('remediate', 'Starting remediation');
    });

    it('should set remediation plan', () => {
      machine.setRemediationPlan({
        steps: [
          {
            id: 'step_1',
            action: 'Restart service',
            description: 'Restart the API service',
            command: 'aws ecs update-service --force-new-deployment',
            rollbackCommand: 'aws ecs update-service --desired-count 0',
            riskLevel: 'medium',
            requiresApproval: true,
            status: 'pending',
          },
        ],
        estimatedRecoveryTime: '5 minutes',
        monitoring: ['Check p99 latency', 'Monitor error rate'],
      });

      const plan = machine.getState().remediationPlan;
      expect(plan?.steps).toHaveLength(1);
      expect(plan?.estimatedRecoveryTime).toBe('5 minutes');
    });

    it('should update step status', () => {
      machine.setRemediationPlan({
        steps: [
          {
            id: 'step_1',
            action: 'Test action',
            description: 'Test',
            riskLevel: 'low',
            requiresApproval: false,
            status: 'pending',
          },
        ],
        monitoring: [],
      });

      machine.updateRemediationStep('step_1', {
        status: 'completed',
        result: { success: true },
      });

      const step = machine.getState().remediationPlan?.steps[0];
      expect(step?.status).toBe('completed');
      expect(step?.result).toEqual({ success: true });
    });

    it('should emit stepCompleted event', () => {
      let completed: any = null;
      machine.on('stepCompleted', (s) => (completed = s));

      machine.setRemediationPlan({
        steps: [
          {
            id: 'step_1',
            action: 'Test',
            description: 'Test',
            riskLevel: 'low',
            requiresApproval: false,
            status: 'pending',
          },
        ],
        monitoring: [],
      });

      machine.updateRemediationStep('step_1', { status: 'completed' });

      expect(completed).not.toBeNull();
      expect(completed.id).toBe('step_1');
    });
  });

  describe('error handling', () => {
    it('should record errors', () => {
      machine.start();
      machine.recordError(new Error('Something went wrong'));

      expect(machine.getState().errors).toHaveLength(1);
      expect(machine.getState().errors[0].error).toBe('Something went wrong');
      expect(machine.getState().errors[0].phase).toBe('triage');
    });

    it('should emit error event', () => {
      let emittedError: any = null;
      let emittedPhase: any = null;

      machine.on('error', (e, p) => {
        emittedError = e;
        emittedPhase = p;
      });

      machine.start();
      machine.recordError(new Error('Test error'));

      expect(emittedError?.message).toBe('Test error');
      expect(emittedPhase).toBe('triage');
    });
  });

  describe('iteration limits', () => {
    it('should track iteration count', () => {
      machine.start();
      expect(machine.getState().iterationCount).toBe(0);
    });

    it('should respect max iterations', () => {
      const limitedMachine = createInvestigation('Test', { maxIterations: 5 });
      expect(limitedMachine.getState().maxIterations).toBe(5);
    });

    it('should report canContinue correctly', () => {
      machine.start();
      expect(machine.canContinue()).toBe(true);

      machine.transitionTo('conclude', 'Done');
      machine.transitionTo('complete', 'Finished');
      expect(machine.canContinue()).toBe(false);
    });
  });

  describe('serialization', () => {
    it('should serialize to JSON', () => {
      machine.start();
      machine.transitionTo('hypothesize', 'Test');
      machine.addHypothesis({
        statement: 'Test hypothesis',
        category: 'application',
        priority: 1,
        confirmingEvidence: '',
        refutingEvidence: '',
        queries: [],
      });

      const json = machine.toJSON();
      const parsed = JSON.parse(json);

      expect(parsed.phase).toBe('hypothesize');
      expect(parsed.hypotheses).toHaveLength(1);
      expect(parsed.hypotheses[0].statement).toBe('Test hypothesis');
    });

    it('should generate readable summary', () => {
      machine.start();
      machine.setTriageResult({
        summary: 'API slowdown',
        affectedServices: ['api', 'db'],
        symptoms: ['High latency'],
        errorMessages: [],
        severity: 'high',
        timeWindow: { start: new Date(), end: new Date() },
      });

      const summary = machine.getSummary();

      expect(summary).toContain('Investigation');
      expect(summary).toContain('Why is the API slow?');
      expect(summary).toContain('Severity: high');
      expect(summary).toContain('api, db');
    });

    it('should prioritize proven hypotheses and de-emphasize rejected ones in summary', () => {
      machine.start();

      const proven = machine.addHypothesis({
        statement: 'Redis connection pool exhaustion',
        category: 'capacity',
        priority: 1,
        confirmingEvidence: 'Pool utilization near 100%',
        refutingEvidence: 'Pool utilization normal',
        queries: [],
      });

      const rejected = machine.addHypothesis({
        statement: 'Lambda cold starts are the main cause',
        category: 'infrastructure',
        priority: 2,
        confirmingEvidence: 'Cold starts strongly correlated with errors',
        refutingEvidence: 'Cold starts minimal during incident',
        queries: [],
      });

      const pending = machine.addHypothesis({
        statement: 'Third-party dependency timeout',
        category: 'dependency',
        priority: 3,
        confirmingEvidence: 'Dependency latency spike',
        refutingEvidence: 'Dependency response time normal',
        queries: [],
      });

      machine.applyEvaluation({
        hypothesisId: proven.id,
        evidenceStrength: 'strong',
        confidence: 92,
        reasoning:
          'Error spikes align with pool saturation and recover after recycling connections.',
        action: 'confirm',
        findings: [],
      });

      machine.applyEvaluation({
        hypothesisId: rejected.id,
        evidenceStrength: 'none',
        confidence: 8,
        reasoning: 'Cold-start metrics are normal during the incident window.',
        action: 'prune',
        findings: [],
      });

      const summary = machine.getSummary();

      expect(summary).toContain('### Proven');
      expect(summary).toContain('✅ [PROVEN] Redis connection pool exhaustion');
      expect(summary).toContain('### Still Evaluating');
      expect(summary).toContain('- [pending] Third-party dependency timeout');
      expect(summary).toContain('### Rejected / Deprioritized');
      expect(summary).toContain('- [rejected] Lambda cold starts are the main cause');
      expect(summary).not.toContain('Cold-start metrics are normal during the incident window.');
      expect(summary.indexOf('### Proven')).toBeLessThan(
        summary.indexOf('### Rejected / Deprioritized')
      );
    });
  });
});
