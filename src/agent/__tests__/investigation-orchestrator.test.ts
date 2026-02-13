/**
 * Tests for Investigation Orchestrator
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  InvestigationOrchestrator,
  createOrchestrator,
  type LLMClient,
  type ToolExecutor,
  type InvestigationEvent,
} from '../investigation-orchestrator';

// Mock LLM responses
const mockTriageResponse = JSON.stringify({
  summary: 'API latency spike affecting user service',
  severity: 'high',
  affectedServices: ['api-gateway', 'user-service'],
  symptoms: ['p99 latency > 5s', 'error rate increasing'],
  errorMessages: ['Connection timeout', 'Service unavailable'],
  timeWindow: {
    start: '2024-01-15T10:00:00Z',
    end: '2024-01-15T11:00:00Z',
  },
});

const mockHypothesisResponse = JSON.stringify({
  hypotheses: [
    {
      statement: 'Database connection pool exhausted',
      category: 'infrastructure',
      priority: 1,
      confirmingEvidence: 'High number of waiting connections',
      refutingEvidence: 'Connection count is normal',
      queries: [{ type: 'metrics', description: 'Check connection count' }],
    },
    {
      statement: 'Network latency between services',
      category: 'dependency',
      priority: 2,
      confirmingEvidence: 'High inter-service latency',
      refutingEvidence: 'Normal network metrics',
      queries: [{ type: 'metrics', description: 'Check network latency' }],
    },
  ],
  reasoning: 'Based on symptoms, database and network issues are most likely',
});

const mockEvidenceEvaluationConfirm = JSON.stringify({
  hypothesisId: 'h_1',
  evidenceStrength: 'strong',
  confidence: 90,
  reasoning: 'Connection count at maximum, matching the expected pattern',
  action: 'confirm',
  findings: ['Connection pool at 100%', 'Queries queuing up'],
});

const mockEvidenceEvaluationPrune = JSON.stringify({
  hypothesisId: 'h_2',
  evidenceStrength: 'none',
  confidence: 10,
  reasoning: 'Network metrics are normal',
  action: 'prune',
  findings: ['Network latency within normal range'],
});

const mockConclusionResponse = JSON.stringify({
  rootCause: 'Database connection pool exhausted due to connection leak',
  confidence: 'high',
  confirmedHypothesisId: 'h_1',
  evidenceChain: [{ finding: 'Connection pool at 100%', source: 'cloudwatch', strength: 'strong' }],
  alternativeExplanations: ['Network issues were ruled out'],
  unknowns: ['Exact code path causing the leak'],
});

const mockRemediationResponse = JSON.stringify({
  steps: [
    {
      action: 'Restart the service',
      description: 'Force new deployment to clear connection pool',
      command: 'aws ecs update-service --force-new-deployment',
      riskLevel: 'medium',
      requiresApproval: true,
    },
  ],
  estimatedRecoveryTime: '5 minutes',
  monitoring: ['Watch connection count', 'Monitor error rate'],
});

const mockRemediationWithSkillResponse = JSON.stringify({
  steps: [
    {
      action: 'Redeploy user-service',
      description: 'Redeploy to clear stale DB connection state',
      riskLevel: 'medium',
      requiresApproval: false,
      matchingSkill: 'deploy-service',
    },
  ],
  estimatedRecoveryTime: '7 minutes',
  monitoring: ['Watch p99 latency', 'Monitor DB connection saturation'],
});

const mockRemediationCommandOnlyResponse = JSON.stringify({
  steps: [
    {
      action: 'Run an AWS CLI command manually',
      description: 'Force a deployment using CLI',
      command: 'aws ecs update-service --force-new-deployment',
      riskLevel: 'medium',
      requiresApproval: false,
    },
  ],
  estimatedRecoveryTime: '10 minutes',
  monitoring: ['Watch service stability'],
});

describe('InvestigationOrchestrator', () => {
  let mockLLM: LLMClient;
  let mockToolExecutor: ToolExecutor;
  let llmCallIndex: number;

  beforeEach(() => {
    llmCallIndex = 0;

    // Create mock LLM that returns appropriate responses based on call order
    // The order is: triage -> hypothesis generation -> evidence eval (repeat) -> conclusion -> remediation
    mockLLM = {
      complete: vi.fn().mockImplementation(async (prompt: string) => {
        llmCallIndex++;

        // First call is triage
        if (llmCallIndex === 1) {
          return mockTriageResponse;
        }

        // Second call is hypothesis generation
        if (llmCallIndex === 2) {
          return mockHypothesisResponse;
        }

        // Third call is first evidence evaluation - confirm the first hypothesis
        if (llmCallIndex === 3) {
          return mockEvidenceEvaluationConfirm;
        }

        // Fourth call is conclusion
        if (llmCallIndex === 4) {
          return mockConclusionResponse;
        }

        // Fifth call is remediation
        if (llmCallIndex === 5) {
          return mockRemediationResponse;
        }

        // Additional calls return a generic response
        return mockEvidenceEvaluationPrune;
      }),
    };

    // Create mock tool executor
    mockToolExecutor = {
      execute: vi.fn().mockImplementation(async (tool: string, params: Record<string, unknown>) => {
        if (tool === 'cloudwatch_alarms') {
          return [{ alarmName: 'HighLatency', state: 'ALARM' }];
        }
        if (tool === 'cloudwatch_logs') {
          return [{ message: 'Connection timeout after 30s' }];
        }
        if (tool === 'datadog') {
          return { metrics: { cpu: 45, memory: 80 } };
        }
        if (tool === 'aws_query') {
          return { services: ['api-gateway'], status: 'running' };
        }
        return { success: true };
      }),
    };
  });

  describe('creation', () => {
    it('should create orchestrator with createOrchestrator function', () => {
      const orchestrator = createOrchestrator(mockLLM, mockToolExecutor);
      expect(orchestrator).toBeInstanceOf(InvestigationOrchestrator);
    });

    it('should accept options', () => {
      const orchestrator = createOrchestrator(mockLLM, mockToolExecutor, {
        incidentId: 'INC-123',
        maxIterations: 5,
      });
      expect(orchestrator).toBeInstanceOf(InvestigationOrchestrator);
    });
  });

  describe('event handling', () => {
    it('should emit events during investigation', async () => {
      const orchestrator = createOrchestrator(mockLLM, mockToolExecutor);
      const events: InvestigationEvent[] = [];

      orchestrator.on((event) => events.push(event));

      await orchestrator.investigate('Why is the API slow?');

      // Should have phase change events
      const phaseChanges = events.filter((e) => e.type === 'phase_change');
      expect(phaseChanges.length).toBeGreaterThan(0);

      // Should have triage complete
      const triageComplete = events.find((e) => e.type === 'triage_complete');
      expect(triageComplete).toBeDefined();

      // Should have complete event
      const complete = events.find((e) => e.type === 'complete');
      expect(complete).toBeDefined();
    });

    it('should allow removing event handlers', () => {
      const orchestrator = createOrchestrator(mockLLM, mockToolExecutor);
      const events: InvestigationEvent[] = [];

      const unsubscribe = orchestrator.on((event) => events.push(event));
      unsubscribe();

      // Events list should remain empty after investigation
      // since handler was removed
    });
  });

  describe('investigation phases', () => {
    it('should complete triage phase', async () => {
      const orchestrator = createOrchestrator(mockLLM, mockToolExecutor);
      const events: InvestigationEvent[] = [];

      orchestrator.on((event) => events.push(event));

      await orchestrator.investigate('Why is the API slow?');

      const triageEvent = events.find((e) => e.type === 'triage_complete');
      expect(triageEvent).toBeDefined();
      if (triageEvent?.type === 'triage_complete') {
        expect(triageEvent.result.summary).toBe('API latency spike affecting user service');
        expect(triageEvent.result.severity).toBe('high');
      }
    });

    it('should create hypotheses', async () => {
      const orchestrator = createOrchestrator(mockLLM, mockToolExecutor);
      const events: InvestigationEvent[] = [];

      orchestrator.on((event) => events.push(event));

      await orchestrator.investigate('Why is the API slow?');

      const hypothesisEvents = events.filter((e) => e.type === 'hypothesis_created');
      expect(hypothesisEvents.length).toBeGreaterThan(0);
    });

    it('should evaluate evidence', async () => {
      const orchestrator = createOrchestrator(mockLLM, mockToolExecutor);
      const events: InvestigationEvent[] = [];

      orchestrator.on((event) => events.push(event));

      await orchestrator.investigate('Why is the API slow?');

      const evaluationEvents = events.filter((e) => e.type === 'evidence_evaluated');
      expect(evaluationEvents.length).toBeGreaterThan(0);
    });

    it('should reach conclusion', async () => {
      const orchestrator = createOrchestrator(mockLLM, mockToolExecutor);
      const events: InvestigationEvent[] = [];

      orchestrator.on((event) => events.push(event));

      await orchestrator.investigate('Why is the API slow?');

      const conclusionEvent = events.find((e) => e.type === 'conclusion_reached');
      expect(conclusionEvent).toBeDefined();
      if (conclusionEvent?.type === 'conclusion_reached') {
        expect(conclusionEvent.conclusion.rootCause).toContain('connection pool');
      }
    });
  });

  describe('investigation result', () => {
    it('should return complete result', async () => {
      const orchestrator = createOrchestrator(mockLLM, mockToolExecutor);

      const result = await orchestrator.investigate('Why is the API slow?');

      expect(result.id).toBeDefined();
      expect(result.query).toBe('Why is the API slow?');
      expect(result.rootCause).toBeDefined();
      expect(result.confidence).toBe('high');
      expect(result.summary).toBeDefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should include remediation plan', async () => {
      const orchestrator = createOrchestrator(mockLLM, mockToolExecutor);

      const result = await orchestrator.investigate('Why is the API slow?');

      expect(result.remediationPlan).toBeDefined();
      expect(result.remediationPlan?.steps.length).toBeGreaterThan(0);
    });
  });

  describe('tool execution', () => {
    it('should execute tool queries', async () => {
      const orchestrator = createOrchestrator(mockLLM, mockToolExecutor);
      const queryEvents: InvestigationEvent[] = [];

      orchestrator.on((event) => {
        if (event.type === 'query_executing' || event.type === 'query_complete') {
          queryEvents.push(event);
        }
      });

      await orchestrator.investigate('Why is the API slow?');

      expect(queryEvents.length).toBeGreaterThan(0);
      expect(mockToolExecutor.execute).toHaveBeenCalled();
    });

    it('should handle tool errors gracefully', async () => {
      // Reset call index for this test
      llmCallIndex = 0;

      // Make tool executor throw an error sometimes
      mockToolExecutor.execute = vi.fn().mockImplementation(async (tool: string) => {
        if (tool === 'cloudwatch_alarms') {
          throw new Error('Access denied');
        }
        return { success: true };
      });

      const orchestrator = createOrchestrator(mockLLM, mockToolExecutor);

      // Should not throw - errors should be captured
      const result = await orchestrator.investigate('Why is the API slow?');
      expect(result).toBeDefined();
    });

    it('should execute remediation through the skill tool when auto-approve is enabled', async () => {
      let callIndex = 0;
      const complete = vi.fn().mockImplementation(async () => {
        callIndex++;
        if (callIndex === 1) return mockTriageResponse;
        if (callIndex === 2) return mockHypothesisResponse;
        if (callIndex === 3) return mockEvidenceEvaluationConfirm;
        if (callIndex === 4) return mockConclusionResponse;
        if (callIndex === 5) return mockRemediationWithSkillResponse;
        return mockEvidenceEvaluationPrune;
      });
      const llm: LLMClient = { complete };

      const execute = vi.fn().mockImplementation(async (tool: string) => {
        if (tool === 'cloudwatch_alarms') return [{ alarmName: 'HighLatency', state: 'ALARM' }];
        if (tool === 'cloudwatch_logs') return [{ message: 'Connection timeout after 30s' }];
        if (tool === 'datadog') return { metrics: { cpu: 45, memory: 80 } };
        if (tool === 'aws_query') return { services: ['api-gateway'], status: 'running' };
        if (tool === 'skill') return { ok: true };
        return { success: true };
      });
      const toolExecutor: ToolExecutor = { execute };

      const orchestrator = createOrchestrator(llm, toolExecutor, {
        autoApproveRemediation: true,
      });
      const result = await orchestrator.investigate('Why is the API slow?');

      expect(execute).toHaveBeenCalledWith(
        'skill',
        expect.objectContaining({
          name: 'deploy-service',
        })
      );
      expect(result.remediationPlan?.steps[0]?.status).toBe('completed');
    });

    it('should mark command-only remediation steps as pending manual execution', async () => {
      let callIndex = 0;
      const complete = vi.fn().mockImplementation(async () => {
        callIndex++;
        if (callIndex === 1) return mockTriageResponse;
        if (callIndex === 2) return mockHypothesisResponse;
        if (callIndex === 3) return mockEvidenceEvaluationConfirm;
        if (callIndex === 4) return mockConclusionResponse;
        if (callIndex === 5) return mockRemediationCommandOnlyResponse;
        return mockEvidenceEvaluationPrune;
      });
      const llm: LLMClient = { complete };

      const execute = vi.fn().mockImplementation(async (tool: string) => {
        if (tool === 'cloudwatch_alarms') return [{ alarmName: 'HighLatency', state: 'ALARM' }];
        if (tool === 'cloudwatch_logs') return [{ message: 'Connection timeout after 30s' }];
        if (tool === 'datadog') return { metrics: { cpu: 45, memory: 80 } };
        if (tool === 'aws_query') return { services: ['api-gateway'], status: 'running' };
        return { success: true };
      });
      const toolExecutor: ToolExecutor = { execute };

      const orchestrator = createOrchestrator(llm, toolExecutor, {
        autoApproveRemediation: true,
      });
      const result = await orchestrator.investigate('Why is the API slow?');

      const invokedTools = execute.mock.calls.map((call) => call[0]);
      expect(invokedTools).not.toContain('execute_command');
      expect(invokedTools).not.toContain('invoke_skill');
      expect(result.remediationPlan?.steps[0]?.status).toBe('pending');
      expect(result.remediationPlan?.steps[0]?.error).toContain('Manual execution required');
    });

    it('should execute skill-based remediation when user approval callback approves', async () => {
      let callIndex = 0;
      const complete = vi.fn().mockImplementation(async () => {
        callIndex++;
        if (callIndex === 1) return mockTriageResponse;
        if (callIndex === 2) return mockHypothesisResponse;
        if (callIndex === 3) return mockEvidenceEvaluationConfirm;
        if (callIndex === 4) return mockConclusionResponse;
        if (callIndex === 5) return mockRemediationWithSkillResponse;
        return mockEvidenceEvaluationPrune;
      });
      const llm: LLMClient = { complete };

      const execute = vi.fn().mockImplementation(async (tool: string) => {
        if (tool === 'cloudwatch_alarms') return [{ alarmName: 'HighLatency', state: 'ALARM' }];
        if (tool === 'cloudwatch_logs') return [{ message: 'Connection timeout after 30s' }];
        if (tool === 'datadog') return { metrics: { cpu: 45, memory: 80 } };
        if (tool === 'aws_query') return { services: ['api-gateway'], status: 'running' };
        if (tool === 'skill') return { ok: true };
        return { success: true };
      });
      const toolExecutor: ToolExecutor = { execute };

      const approveRemediationStep = vi.fn().mockResolvedValue(true);
      const orchestrator = createOrchestrator(llm, toolExecutor, {
        autoApproveRemediation: false,
        approveRemediationStep,
      });
      const result = await orchestrator.investigate('Why is the API slow?');

      expect(approveRemediationStep).toHaveBeenCalled();
      expect(execute).toHaveBeenCalledWith(
        'skill',
        expect.objectContaining({
          name: 'deploy-service',
        })
      );
      expect(result.remediationPlan?.steps[0]?.status).toBe('completed');
    });
  });

  describe('options', () => {
    it('should use incident ID from options', async () => {
      const orchestrator = createOrchestrator(mockLLM, mockToolExecutor, {
        incidentId: 'INC-456',
      });

      const events: InvestigationEvent[] = [];
      orchestrator.on((event) => events.push(event));

      await orchestrator.investigate('Investigate incident');

      const triageEvent = events.find((e) => e.type === 'triage_complete');
      // Triage should include incident ID (passed through)
      expect(triageEvent).toBeDefined();
    });

    it('should fetch incident context using the provided incident ID during triage', async () => {
      const execute = vi.fn().mockImplementation(async (tool: string) => {
        if (tool === 'pagerduty_get_incident') {
          return {
            incident: {
              id: 'INC-456',
              title: 'High error rate in API',
              status: 'triggered',
            },
          };
        }
        if (tool === 'cloudwatch_alarms') return [{ alarmName: 'HighLatency', state: 'ALARM' }];
        if (tool === 'cloudwatch_logs') return [{ message: 'Connection timeout after 30s' }];
        if (tool === 'aws_query') return { services: ['api-gateway'], status: 'running' };
        return { success: true };
      });
      const toolExecutor: ToolExecutor = { execute };

      const orchestrator = createOrchestrator(mockLLM, toolExecutor, {
        incidentId: 'INC-456',
        availableTools: ['pagerduty_get_incident', 'cloudwatch_alarms', 'cloudwatch_logs'],
      });

      await orchestrator.investigate('Investigate incident');

      expect(execute).toHaveBeenCalledWith('pagerduty_get_incident', {
        incident_id: 'INC-456',
      });
    });

    it('should query runbooks during triage when search_knowledge is available', async () => {
      const execute = vi.fn().mockImplementation(async (tool: string) => {
        if (tool === 'search_knowledge') {
          return {
            documentCount: 1,
            runbooks: [
              { title: 'Redis Timeout Runbook', content: 'Check connection pool settings' },
            ],
          };
        }
        if (tool === 'cloudwatch_alarms') return [{ alarmName: 'HighLatency', state: 'ALARM' }];
        if (tool === 'aws_query') return { services: ['api-gateway'], status: 'running' };
        return { success: true };
      });
      const toolExecutor: ToolExecutor = { execute };

      const orchestrator = createOrchestrator(mockLLM, toolExecutor, {
        incidentId: 'INC-456',
        availableTools: ['search_knowledge', 'cloudwatch_alarms', 'aws_query'],
      });

      await orchestrator.investigate('Investigate redis timeouts in production');

      expect(execute).toHaveBeenCalledWith(
        'search_knowledge',
        expect.objectContaining({
          query: expect.stringContaining('Investigate redis timeouts in production'),
          type_filter: ['runbook', 'known_issue'],
        })
      );
    });

    it('should keep knowledge supplemental by continuing to telemetry and avoid incident ID in knowledge query', async () => {
      const execute = vi.fn().mockImplementation(async (tool: string) => {
        if (tool === 'search_knowledge') {
          return {
            documentCount: 1,
            runbooks: [
              { title: 'Redis Timeout Runbook', content: 'Check connection pool settings' },
            ],
          };
        }
        if (tool === 'cloudwatch_alarms') return [{ alarmName: 'HighErrorRate', state: 'ALARM' }];
        if (tool === 'aws_query') return { services: ['lambda'], status: 'running' };
        return { success: true };
      });
      const toolExecutor: ToolExecutor = { execute };

      const incidentId = 'Q2POX0UC7OBO7M';
      const orchestrator = createOrchestrator(mockLLM, toolExecutor, {
        incidentId,
        availableTools: ['search_knowledge', 'cloudwatch_alarms', 'aws_query'],
      });

      await orchestrator.investigate(
        `Investigate incident ${incidentId}. Identify the root cause with supporting evidence.`
      );

      const knowledgeCall = execute.mock.calls.find((call) => call[0] === 'search_knowledge');
      expect(knowledgeCall).toBeDefined();
      const knowledgeParams = (knowledgeCall?.[1] ?? {}) as Record<string, unknown>;
      expect(String(knowledgeParams.query)).not.toContain(incidentId);

      expect(execute).toHaveBeenCalledWith('cloudwatch_alarms', { state: 'ALARM' });
    });

    it('should respect max iterations', async () => {
      const orchestrator = createOrchestrator(mockLLM, mockToolExecutor, {
        maxIterations: 2,
      });

      // Should complete even with low iteration limit
      const result = await orchestrator.investigate('Why is the API slow?');
      expect(result).toBeDefined();
    });

    it('should include available skills and relevant runbooks in remediation prompt context', async () => {
      let callIndex = 0;
      const complete = vi.fn().mockImplementation(async () => {
        callIndex++;
        if (callIndex === 1) return mockTriageResponse;
        if (callIndex === 2) return mockHypothesisResponse;
        if (callIndex === 3) return mockEvidenceEvaluationConfirm;
        if (callIndex === 4) return mockConclusionResponse;
        if (callIndex === 5) return mockRemediationResponse;
        return mockEvidenceEvaluationPrune;
      });
      const llm: LLMClient = { complete };
      const fetchRelevantRunbooks = vi
        .fn()
        .mockResolvedValue(['DB Connection Recovery', 'API Latency Playbook']);

      const orchestrator = createOrchestrator(llm, mockToolExecutor, {
        incidentId: 'INC-456',
        availableSkills: ['deploy-service', 'rollback-deployment'],
        fetchRelevantRunbooks,
      });

      await orchestrator.investigate('Investigate incident');

      expect(fetchRelevantRunbooks).toHaveBeenCalledWith(
        expect.objectContaining({
          incidentId: 'INC-456',
          affectedServices: ['api-gateway', 'user-service'],
        })
      );

      const remediationPromptCall = complete.mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('Generate a remediation plan for the identified root cause')
      );
      expect(remediationPromptCall).toBeDefined();

      const remediationPrompt = remediationPromptCall?.[0] as string;
      expect(remediationPrompt).toContain('- deploy-service');
      expect(remediationPrompt).toContain('- rollback-deployment');
      expect(remediationPrompt).toContain('- DB Connection Recovery');
      expect(remediationPrompt).toContain('- API Latency Playbook');
    });

    it('should query code providers and include code-fix candidates in remediation prompt context', async () => {
      let callIndex = 0;
      const complete = vi.fn().mockImplementation(async () => {
        callIndex++;
        if (callIndex === 1) return mockTriageResponse;
        if (callIndex === 2) return mockHypothesisResponse;
        if (callIndex === 3) return mockEvidenceEvaluationConfirm;
        if (callIndex === 4) return mockConclusionResponse;
        if (callIndex === 5) return mockRemediationResponse;
        return mockEvidenceEvaluationPrune;
      });
      const llm: LLMClient = { complete };

      const execute = vi.fn().mockImplementation(async (tool: string) => {
        if (tool === 'cloudwatch_alarms') return [{ alarmName: 'HighLatency', state: 'ALARM' }];
        if (tool === 'cloudwatch_logs') return [{ message: 'Connection timeout after 30s' }];
        if (tool === 'datadog') return { metrics: { cpu: 45, memory: 80 } };
        if (tool === 'aws_query') return { services: ['api-gateway'], status: 'running' };
        if (tool === 'github_query') {
          return {
            provider: 'github',
            query: 'database connection pool exhausted',
            repository: 'acme/platform',
            candidates: [
              {
                provider: 'github',
                type: 'pull_request',
                title: 'Fix DB connection leak in checkout worker',
                url: 'https://github.com/acme/platform/pull/42',
              },
            ],
          };
        }
        return { success: true };
      });
      const toolExecutor: ToolExecutor = { execute };

      const orchestrator = createOrchestrator(llm, toolExecutor, {
        availableTools: ['cloudwatch_alarms', 'cloudwatch_logs', 'aws_query', 'github_query'],
      });

      await orchestrator.investigate('Investigate incident');

      expect(execute).toHaveBeenCalledWith(
        'github_query',
        expect.objectContaining({
          action: 'fix_candidates',
        })
      );

      const remediationPromptCall = complete.mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('Generate a remediation plan for the identified root cause')
      );
      expect(remediationPromptCall).toBeDefined();

      const remediationPrompt = remediationPromptCall?.[0] as string;
      expect(remediationPrompt).toContain('Available Code Fix Candidates');
      expect(remediationPrompt).toContain('https://github.com/acme/platform/pull/42');
    });
  });

  describe('log analysis', () => {
    it('should analyze logs for hypothesis', async () => {
      // Create a mock that returns log analysis response
      const logAnalysisLLM: LLMClient = {
        complete: vi.fn().mockResolvedValue(
          JSON.stringify({
            patterns: [],
            anomalies: [],
            summary: 'Connection issues detected',
            suggestedHypotheses: ['Database connectivity issue'],
          })
        ),
      };

      const orchestrator = createOrchestrator(logAnalysisLLM, mockToolExecutor);

      const logs = [
        '2024-01-15T10:00:00Z ERROR connection timeout',
        '2024-01-15T10:01:00Z ERROR database connection failed',
      ];

      const analysis = await orchestrator.analyzeLogsForHypothesis(logs);

      expect(analysis.totalLines).toBe(2);
      expect(analysis.patternMatches.length).toBeGreaterThan(0);
      expect(analysis.suggestedHypotheses.length).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    it('should emit error event on failure', async () => {
      // Make LLM throw an error
      mockLLM.complete = vi.fn().mockRejectedValue(new Error('LLM unavailable'));

      const orchestrator = createOrchestrator(mockLLM, mockToolExecutor);
      const events: InvestigationEvent[] = [];
      orchestrator.on((event) => events.push(event));

      await expect(orchestrator.investigate('Test')).rejects.toThrow('LLM unavailable');

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
    });
  });
});
