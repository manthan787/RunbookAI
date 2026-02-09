/**
 * Tests for LLM Response Parser
 */

import { describe, it, expect } from 'vitest';
import {
  extractJSON,
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
} from '../llm-parser';

describe('extractJSON', () => {
  it('should extract JSON from markdown code block', () => {
    const text = `Here's the analysis:

\`\`\`json
{"key": "value"}
\`\`\`

That's my analysis.`;

    expect(extractJSON(text)).toBe('{"key": "value"}');
  });

  it('should extract JSON from code block without json label', () => {
    const text = `\`\`\`
{"key": "value"}
\`\`\``;

    expect(extractJSON(text)).toBe('{"key": "value"}');
  });

  it('should extract raw JSON object', () => {
    const text = `The answer is {"key": "value"} here.`;

    expect(extractJSON(text)).toBe('{"key": "value"}');
  });

  it('should extract raw JSON array', () => {
    const text = `The items are [1, 2, 3]`;

    expect(extractJSON(text)).toBe('[1, 2, 3]');
  });

  it('should handle nested JSON', () => {
    const text = `\`\`\`json
{
  "outer": {
    "inner": [1, 2, 3]
  }
}
\`\`\``;

    const extracted = extractJSON(text);
    const parsed = JSON.parse(extracted);
    expect(parsed.outer.inner).toEqual([1, 2, 3]);
  });
});

describe('parseHypothesisGeneration', () => {
  it('should parse valid hypothesis generation response', () => {
    const response = `\`\`\`json
{
  "hypotheses": [
    {
      "statement": "Database connection pool is exhausted",
      "category": "infrastructure",
      "priority": 1,
      "confirmingEvidence": "High number of waiting connections",
      "refutingEvidence": "Connection count is normal",
      "queries": [
        {
          "type": "metrics",
          "description": "Check database connection count",
          "service": "rds"
        }
      ]
    }
  ],
  "reasoning": "Based on the timeout errors, database issues are most likely."
}
\`\`\``;

    const result = parseHypothesisGeneration(response);

    expect(result.hypotheses).toHaveLength(1);
    expect(result.hypotheses[0].statement).toBe('Database connection pool is exhausted');
    expect(result.hypotheses[0].category).toBe('infrastructure');
    expect(result.hypotheses[0].priority).toBe(1);
    expect(result.reasoning).toContain('database issues');
  });

  it('should reject invalid category', () => {
    const response = `{
      "hypotheses": [{
        "statement": "Test",
        "category": "invalid_category",
        "priority": 1,
        "confirmingEvidence": "Test",
        "refutingEvidence": "Test",
        "queries": []
      }],
      "reasoning": "Test"
    }`;

    expect(() => parseHypothesisGeneration(response)).toThrow();
  });

  it('should reject priority out of range', () => {
    const response = `{
      "hypotheses": [{
        "statement": "Test",
        "category": "application",
        "priority": 10,
        "confirmingEvidence": "Test",
        "refutingEvidence": "Test",
        "queries": []
      }],
      "reasoning": "Test"
    }`;

    expect(() => parseHypothesisGeneration(response)).toThrow();
  });

  it('should accept null query service and normalize it', () => {
    const response = `{
      "hypotheses": [{
        "statement": "Upstream dependency latency",
        "category": "dependency",
        "priority": 2,
        "confirmingEvidence": "Gateway timeout spikes",
        "refutingEvidence": "No dependency saturation",
        "queries": [{
          "type": "logs",
          "description": "Check timeout errors",
          "service": null
        }]
      }],
      "reasoning": "Dependency behavior matches observed symptoms"
    }`;

    const result = parseHypothesisGeneration(response);
    expect(result.hypotheses[0].queries[0].service).toBeUndefined();
  });
});

describe('parseEvidenceEvaluation', () => {
  it('should parse valid evidence evaluation', () => {
    const response = `{
      "hypothesisId": "h_1",
      "evidenceStrength": "strong",
      "confidence": 85,
      "reasoning": "Multiple metrics confirm the hypothesis",
      "action": "confirm",
      "findings": ["High CPU usage", "Memory pressure detected"]
    }`;

    const result = parseEvidenceEvaluation(response);

    expect(result.hypothesisId).toBe('h_1');
    expect(result.evidenceStrength).toBe('strong');
    expect(result.confidence).toBe(85);
    expect(result.action).toBe('confirm');
    expect(result.findings).toHaveLength(2);
  });

  it('should parse evaluation with sub-hypotheses', () => {
    const response = `{
      "hypothesisId": "h_1",
      "evidenceStrength": "weak",
      "confidence": 40,
      "reasoning": "Need to investigate more specifically",
      "action": "branch",
      "findings": ["Some evidence found"],
      "subHypotheses": [{
        "statement": "Specific sub-issue",
        "category": "application",
        "priority": 1,
        "confirmingEvidence": "More specific evidence",
        "refutingEvidence": "Counter evidence",
        "queries": []
      }]
    }`;

    const result = parseEvidenceEvaluation(response);

    expect(result.action).toBe('branch');
    expect(result.subHypotheses).toHaveLength(1);
    expect(result.subHypotheses![0].statement).toBe('Specific sub-issue');
  });

  it('should reject invalid action', () => {
    const response = `{
      "hypothesisId": "h_1",
      "evidenceStrength": "strong",
      "confidence": 85,
      "reasoning": "Test",
      "action": "invalid_action",
      "findings": []
    }`;

    expect(() => parseEvidenceEvaluation(response)).toThrow();
  });

  it('should reject confidence out of range', () => {
    const response = `{
      "hypothesisId": "h_1",
      "evidenceStrength": "strong",
      "confidence": 150,
      "reasoning": "Test",
      "action": "confirm",
      "findings": []
    }`;

    expect(() => parseEvidenceEvaluation(response)).toThrow();
  });
});

describe('parseTriageResponse', () => {
  it('should parse valid triage response', () => {
    const response = `{
      "summary": "API latency spike affecting user service",
      "severity": "high",
      "affectedServices": ["api-gateway", "user-service"],
      "symptoms": ["p99 latency > 5s", "error rate increasing"],
      "errorMessages": ["Connection timeout", "Service unavailable"],
      "timeWindow": {
        "start": "2024-01-01T10:00:00Z",
        "end": "2024-01-01T11:00:00Z"
      }
    }`;

    const result = parseTriageResponse(response);

    expect(result.summary).toBe('API latency spike affecting user service');
    expect(result.severity).toBe('high');
    expect(result.affectedServices).toContain('api-gateway');
    expect(result.symptoms).toHaveLength(2);
    expect(result.errorMessages).toHaveLength(2);
  });

  it('should accept optional initial hypotheses', () => {
    const response = `{
      "summary": "Test",
      "severity": "low",
      "affectedServices": [],
      "symptoms": [],
      "errorMessages": [],
      "timeWindow": {
        "start": "2024-01-01T00:00:00Z",
        "end": "2024-01-01T01:00:00Z"
      },
      "initialHypotheses": ["Database issue", "Network problem"]
    }`;

    const result = parseTriageResponse(response);
    expect(result.initialHypotheses).toEqual(['Database issue', 'Network problem']);
  });
});

describe('parseConclusion', () => {
  it('should parse valid conclusion', () => {
    const response = `{
      "rootCause": "Database connection pool exhausted due to connection leak in user service",
      "confidence": "high",
      "confirmedHypothesisId": "h_1",
      "evidenceChain": [
        {
          "finding": "Connection count at 100% capacity",
          "source": "cloudwatch",
          "strength": "strong"
        }
      ],
      "alternativeExplanations": ["Network issues were ruled out"],
      "unknowns": ["Exact code path causing the leak"]
    }`;

    const result = parseConclusion(response);

    expect(result.rootCause).toContain('connection pool exhausted');
    expect(result.confidence).toBe('high');
    expect(result.confirmedHypothesisId).toBe('h_1');
    expect(result.evidenceChain).toHaveLength(1);
  });

  it('should coerce string unknowns and alternatives into arrays', () => {
    const response = `{
      "rootCause": "Redis saturation",
      "confidence": "medium",
      "confirmedHypothesisId": "h_2",
      "evidenceChain": [
        {
          "finding": "Redis max connections reached",
          "source": "metrics",
          "strength": "strong"
        }
      ],
      "affectedServices": "ts-order-service",
      "alternativeExplanations": "Transient network jitter",
      "unknowns": "Whether this issue recurs under peak load"
    }`;

    const result = parseConclusion(response);
    expect(result.affectedServices).toEqual(['ts-order-service']);
    expect(result.alternativeExplanations).toEqual(['Transient network jitter']);
    expect(result.unknowns).toEqual(['Whether this issue recurs under peak load']);
  });
});

describe('parseRemediationPlan', () => {
  it('should parse valid remediation plan', () => {
    const response = `{
      "steps": [
        {
          "action": "Restart the user service",
          "description": "Force new deployment to clear connection pool",
          "command": "aws ecs update-service --force-new-deployment",
          "rollbackCommand": "aws ecs update-service --desired-count 0",
          "riskLevel": "medium",
          "requiresApproval": true,
          "matchingSkill": "deploy-service"
        }
      ],
      "estimatedRecoveryTime": "5 minutes",
      "monitoring": ["Watch connection count", "Monitor error rate"]
    }`;

    const result = parseRemediationPlan(response);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].riskLevel).toBe('medium');
    expect(result.steps[0].requiresApproval).toBe(true);
    expect(result.estimatedRecoveryTime).toBe('5 minutes');
    expect(result.monitoring).toHaveLength(2);
  });

  it('should accept null optional fields in remediation steps', () => {
    const response = `{
      "steps": [
        {
          "action": "Scale service",
          "description": "Increase replicas",
          "command": null,
          "rollbackCommand": null,
          "riskLevel": "low",
          "requiresApproval": false,
          "matchingSkill": null,
          "matchingRunbook": null
        }
      ],
      "monitoring": []
    }`;

    const result = parseRemediationPlan(response);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].command).toBeUndefined();
    expect(result.steps[0].rollbackCommand).toBeUndefined();
    expect(result.steps[0].matchingSkill).toBeUndefined();
    expect(result.steps[0].matchingRunbook).toBeUndefined();
  });
});

describe('parseLogAnalysis', () => {
  it('should parse valid log analysis', () => {
    const response = `{
      "patterns": [
        {
          "pattern": "Connection timeout to database",
          "count": 150,
          "severity": "error",
          "firstSeen": "2024-01-01T10:00:00Z",
          "lastSeen": "2024-01-01T10:30:00Z",
          "examples": ["Error: Connection timeout after 30s"]
        }
      ],
      "anomalies": [
        {
          "description": "Sudden spike in connection attempts",
          "timestamp": "2024-01-01T10:15:00Z",
          "relevance": "high"
        }
      ],
      "summary": "Database connectivity issues starting at 10:00",
      "suggestedHypotheses": ["Database overloaded", "Network partition"]
    }`;

    const result = parseLogAnalysis(response);

    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0].count).toBe(150);
    expect(result.anomalies).toHaveLength(1);
    expect(result.suggestedHypotheses).toContain('Database overloaded');
  });
});

describe('toTriageResult', () => {
  it('should convert triage response to result', () => {
    const response = {
      summary: 'Test incident',
      severity: 'high' as const,
      affectedServices: ['service-a'],
      symptoms: ['symptom-1'],
      errorMessages: ['error-1'],
      timeWindow: {
        start: '2024-01-01T10:00:00Z',
        end: '2024-01-01T11:00:00Z',
      },
    };

    const result = toTriageResult(response, 'PD-12345');

    expect(result.incidentId).toBe('PD-12345');
    expect(result.summary).toBe('Test incident');
    expect(result.timeWindow.start).toBeInstanceOf(Date);
    expect(result.timeWindow.end).toBeInstanceOf(Date);
  });
});

describe('toHypothesisInput', () => {
  it('should convert hypothesis input to state machine format', () => {
    const input = {
      statement: 'Test hypothesis',
      category: 'application' as const,
      priority: 2,
      confirmingEvidence: 'Confirming test',
      refutingEvidence: 'Refuting test',
      queries: [{ type: 'metrics' as const, description: 'Check CPU', service: 'ec2' }],
    };

    const result = toHypothesisInput(input, 'h_parent');

    expect(result.statement).toBe('Test hypothesis');
    expect(result.parentId).toBe('h_parent');
    // Queries are empty - causal query builder generates them
    expect(result.queries).toHaveLength(0);
  });
});

describe('toEvidenceEvaluation', () => {
  it('should convert evidence evaluation input', () => {
    const input = {
      hypothesisId: 'h_1',
      evidenceStrength: 'strong' as const,
      confidence: 85,
      reasoning: 'Test reasoning',
      action: 'confirm' as const,
      findings: ['Finding 1'],
    };

    const result = toEvidenceEvaluation(input);

    expect(result.hypothesisId).toBe('h_1');
    expect(result.evidenceStrength).toBe('strong');
  });
});

describe('toConclusionResult', () => {
  it('should convert conclusion input', () => {
    const input = {
      rootCause: 'Test cause',
      confidence: 'high' as const,
      confirmedHypothesisId: 'h_1',
      evidenceChain: [{ finding: 'Test', source: 'cloudwatch', strength: 'strong' as const }],
      alternativeExplanations: ['Alt 1'],
      unknowns: ['Unknown 1'],
    };

    const result = toConclusionResult(input);

    expect(result.rootCause).toBe('Test cause');
    expect(result.confidence).toBe('high');
  });
});

describe('toRemediationSteps', () => {
  it('should convert remediation plan to steps', () => {
    const input = {
      steps: [
        {
          action: 'Restart service',
          description: 'Restart the service',
          riskLevel: 'medium' as const,
          requiresApproval: true,
        },
        {
          action: 'Monitor',
          description: 'Watch metrics',
          riskLevel: 'low' as const,
          requiresApproval: false,
        },
      ],
      monitoring: ['Watch CPU'],
    };

    const result = toRemediationSteps(input);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('step_1');
    expect(result[0].status).toBe('pending');
    expect(result[1].id).toBe('step_2');
  });
});

describe('fillPrompt', () => {
  it('should fill in template values', () => {
    const template = 'Hello {name}, your ID is {id}';
    const result = fillPrompt(template, { name: 'Alice', id: '123' });

    expect(result).toBe('Hello Alice, your ID is 123');
  });

  it('should handle multiple occurrences', () => {
    const template = '{x} + {x} = 2{x}';
    const result = fillPrompt(template, { x: '5' });

    expect(result).toBe('5 + 5 = 25');
  });

  it('should work with real prompts', () => {
    const result = fillPrompt(PROMPTS.triage, {
      context: 'API timeout errors reported',
    });

    expect(result).toContain('API timeout errors reported');
    expect(result).toContain('severity');
  });
});

describe('PROMPTS', () => {
  it('should have all required prompt templates', () => {
    expect(PROMPTS.triage).toBeDefined();
    expect(PROMPTS.generateHypotheses).toBeDefined();
    expect(PROMPTS.evaluateEvidence).toBeDefined();
    expect(PROMPTS.generateConclusion).toBeDefined();
    expect(PROMPTS.generateRemediation).toBeDefined();
    expect(PROMPTS.analyzeLogs).toBeDefined();
  });

  it('should have placeholders in templates', () => {
    expect(PROMPTS.triage).toContain('{context}');
    expect(PROMPTS.generateHypotheses).toContain('{symptoms}');
    expect(PROMPTS.evaluateEvidence).toContain('{hypothesis}');
  });
});
