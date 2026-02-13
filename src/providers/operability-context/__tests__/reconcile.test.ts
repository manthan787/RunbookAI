import { describe, expect, it } from 'vitest';
import {
  buildClaimFactDelta,
  calculateTrustScore,
  clampUnitInterval,
  reconcileClaimWithFact,
} from '../reconcile';
import type { AgentChangeClaim, VerifiedChangeFact } from '../types';

const baseClaim: AgentChangeClaim = {
  session: {
    sessionId: 'sess-1',
    agent: 'codex',
    repository: 'runbookai',
    branch: 'feature/checkout',
    baseSha: 'aaa111',
    headSha: 'bbb222',
    startedAt: '2026-02-13T12:00:00.000Z',
  },
  capturedAt: '2026-02-13T12:10:00.000Z',
  intentSummary: 'Improve checkout retry behavior',
  filesTouchedClaimed: ['src/checkout/retry.ts', 'src/checkout/client.ts'],
  servicesClaimed: ['checkout', 'payment'],
  riskClaimed: 'high',
  rolloutPlanClaimed: 'Canary 10% then 50%',
  rollbackPlanClaimed: 'Revert to previous image tag',
  testsRunClaimed: ['npm run test -- checkout'],
  unknowns: [],
};

const baseFact: VerifiedChangeFact = {
  changeId: 'chg-1',
  repository: 'runbookai',
  branch: 'feature/checkout',
  baseSha: 'aaa111',
  headSha: 'bbb222',
  verifiedAt: '2026-02-13T12:12:00.000Z',
  filesTouchedVerified: ['src/checkout/retry.ts', 'src/checkout/client.ts'],
  symbolsTouchedVerified: ['CheckoutClient.retry'],
  servicesVerified: ['checkout', 'payment'],
  riskVerified: 'high',
  blastRadius: {
    directlyImpactedServices: ['checkout'],
    downstreamServices: ['payment'],
    externalDependencies: ['redis'],
    severity: 'high',
    rationale: ['retry policy changed'],
  },
  operabilityGaps: [],
  rolloutPlanPresent: true,
  rollbackPlanPresent: true,
  testsRunVerified: ['npm run test -- checkout'],
  provenance: [
    {
      providerId: 'ci',
      source: 'ci',
      recordId: 'ci-123',
      observedAt: '2026-02-13T12:12:00.000Z',
    },
    {
      providerId: 'git',
      source: 'git_diff',
      recordId: 'diff-123',
      observedAt: '2026-02-13T12:12:01.000Z',
    },
  ],
};

describe('operability context reconciliation', () => {
  it('produces high trust for matching claim and fact', () => {
    const delta = buildClaimFactDelta(baseClaim, baseFact);
    expect(delta.filesMissingInClaim).toEqual([]);
    expect(delta.servicesMissingInClaim).toEqual([]);
    expect(delta.testsMissingInClaim).toEqual([]);
    expect(delta.riskMismatch).toBeUndefined();
    expect(delta.rolloutMismatch).toBe(false);
    expect(delta.rollbackMismatch).toBe(false);

    const trust = calculateTrustScore(delta);
    expect(trust).toBeGreaterThan(0.9);

    const summary = reconcileClaimWithFact(baseClaim, baseFact);
    expect(summary.trustScore).toBeGreaterThan(0.9);
    expect(summary.confidence.value).toBeGreaterThan(0.6);
  });

  it('captures claim-vs-fact drift and lowers trust', () => {
    const claim: AgentChangeClaim = {
      ...baseClaim,
      filesTouchedClaimed: ['src/checkout/retry.ts'],
      servicesClaimed: ['checkout'],
      riskClaimed: 'low',
      rolloutPlanClaimed: undefined,
      rollbackPlanClaimed: undefined,
      testsRunClaimed: [],
      unknowns: ['db saturation'],
    };

    const fact: VerifiedChangeFact = {
      ...baseFact,
      filesTouchedVerified: ['src/checkout/retry.ts', 'src/payment/client.ts'],
      servicesVerified: ['checkout', 'payment'],
      riskVerified: 'critical',
      blastRadius: {
        ...baseFact.blastRadius,
        rationale: ['payment timeout correlation'],
        severity: 'critical',
      },
      rolloutPlanPresent: true,
      rollbackPlanPresent: true,
      testsRunVerified: ['npm run test -- checkout', 'npm run test -- payment'],
    };

    const delta = buildClaimFactDelta(claim, fact);
    expect(delta.filesMissingInClaim).toEqual(['src/payment/client.ts']);
    expect(delta.servicesMissingInClaim).toEqual(['payment']);
    expect(delta.testsMissingInClaim).toEqual([
      'npm run test -- checkout',
      'npm run test -- payment',
    ]);
    expect(delta.riskMismatch).toEqual({ claimed: 'low', verified: 'critical' });
    expect(delta.rolloutMismatch).toBe(true);
    expect(delta.rollbackMismatch).toBe(true);
    expect(delta.unknownsNotCovered).toEqual(['db saturation']);

    const trust = calculateTrustScore(delta);
    expect(trust).toBeLessThan(0.6);
  });

  it('clamps trust inputs to 0..1', () => {
    expect(clampUnitInterval(2)).toBe(1);
    expect(clampUnitInterval(-1)).toBe(0);
    expect(clampUnitInterval(Number.NaN)).toBe(0);
  });
});
