import { describe, it, expect } from 'vitest';
import { scoreInvestigationResult } from '../scoring';

describe('scoreInvestigationResult', () => {
  it('scores high when expected root cause and services are present', () => {
    const score = scoreInvestigationResult({
      expected: {
        rootCauseKeywords: ['redis', 'connection pool'],
        affectedServices: ['checkout-api', 'redis'],
        confidenceAtLeast: 'medium',
      },
      rootCauseText: 'Redis connection pool exhaustion in checkout-api caused timeouts.',
      summaryText: 'checkout-api had repeated Redis connection failures.',
      confidence: 'high',
    });

    expect(score.rootCause).toBeGreaterThanOrEqual(0.9);
    expect(score.services).toBeGreaterThanOrEqual(0.9);
    expect(score.confidence).toBe(1);
    expect(score.overall).toBeGreaterThan(0.9);
  });

  it('uses alias-aware service matching', () => {
    const score = scoreInvestigationResult({
      expected: {
        affectedServices: ['ts-order-service'],
      },
      summaryText: 'Order service experienced elevated error rate.',
      affectedServicesDetected: ['order-service'],
    });

    expect(score.services).toBe(1);
  });

  it('applies weighted scoring so service miss does not dominate', () => {
    const score = scoreInvestigationResult({
      expected: {
        rootCauseKeywords: ['cpu', 'capacity', 'load surge'],
        affectedServices: ['orders'],
        confidenceAtLeast: 'medium',
        requiredPhrases: ['evidence'],
      },
      rootCauseText: 'Insufficient CPU capacity during load surge',
      summaryText: 'Evidence supports the root cause.',
      confidence: 'high',
      affectedServicesDetected: ['sock-shop'],
    });

    expect(score.rootCause).toBeGreaterThan(0.6);
    expect(score.services).toBe(0);
    expect(score.overall).toBeGreaterThan(0.7);
  });

  it('penalizes forbidden phrases', () => {
    const score = scoreInvestigationResult({
      expected: {
        forbiddenPhrases: ['drop database'],
      },
      summaryText: 'Potential remediation: drop database and restore.',
    });

    expect(score.phraseCompliance).toBeLessThan(1);
    expect(score.overall).toBeLessThan(1);
  });

  it('returns zero overall when no scoreable expectations exist', () => {
    const score = scoreInvestigationResult({
      expected: {},
      summaryText: 'Some answer',
    });

    expect(score.overall).toBe(0);
  });
});
