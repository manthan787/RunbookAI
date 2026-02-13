import type {
  AgentChangeClaim,
  ClaimFactDelta,
  ConfidenceFactor,
  ConfidenceScore,
  ReconciledChangeSummary,
  VerifiedChangeFact,
} from './types';

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function toCanonicalSet(values: string[]): Set<string> {
  return new Set(values.map(normalizeToken).filter(Boolean));
}

function setDifference(left: Set<string>, right: Set<string>): string[] {
  const result: string[] = [];
  for (const value of left) {
    if (!right.has(value)) {
      result.push(value);
    }
  }
  return result.sort();
}

export function clampUnitInterval(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export function buildClaimFactDelta(
  claim: AgentChangeClaim,
  fact: VerifiedChangeFact
): ClaimFactDelta {
  const claimFiles = toCanonicalSet(claim.filesTouchedClaimed);
  const factFiles = toCanonicalSet(fact.filesTouchedVerified);
  const claimServices = toCanonicalSet(claim.servicesClaimed);
  const factServices = toCanonicalSet(fact.servicesVerified);
  const claimTests = toCanonicalSet(claim.testsRunClaimed);
  const factTests = toCanonicalSet(fact.testsRunVerified);

  const evidenceCorpus = [
    ...fact.blastRadius.rationale,
    ...fact.operabilityGaps.map((gap) => `${gap.title} ${gap.description}`),
  ]
    .join(' ')
    .toLowerCase();

  const unknownsNotCovered = claim.unknowns
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => !evidenceCorpus.includes(value.toLowerCase()))
    .sort();

  const riskMismatch =
    claim.riskClaimed && claim.riskClaimed !== fact.riskVerified
      ? {
          claimed: claim.riskClaimed,
          verified: fact.riskVerified,
        }
      : undefined;

  return {
    filesMissingInClaim: setDifference(factFiles, claimFiles),
    filesMissingInFact: setDifference(claimFiles, factFiles),
    servicesMissingInClaim: setDifference(factServices, claimServices),
    servicesMissingInFact: setDifference(claimServices, factServices),
    testsMissingInClaim: setDifference(factTests, claimTests),
    testsMissingInFact: setDifference(claimTests, factTests),
    unknownsNotCovered,
    riskMismatch,
    rolloutMismatch: Boolean(claim.rolloutPlanClaimed) !== fact.rolloutPlanPresent,
    rollbackMismatch: Boolean(claim.rollbackPlanClaimed) !== fact.rollbackPlanPresent,
  };
}

export function calculateTrustScore(delta: ClaimFactDelta): number {
  const fileUnion = Math.max(
    1,
    delta.filesMissingInClaim.length + delta.filesMissingInFact.length + 1
  );
  const serviceUnion = Math.max(
    1,
    delta.servicesMissingInClaim.length + delta.servicesMissingInFact.length + 1
  );
  const testUnion = Math.max(
    1,
    delta.testsMissingInClaim.length + delta.testsMissingInFact.length + 1
  );
  const unknownTotal = Math.max(1, delta.unknownsNotCovered.length + 1);

  const fileMismatchRatio =
    (delta.filesMissingInClaim.length + delta.filesMissingInFact.length) / fileUnion;
  const serviceMismatchRatio =
    (delta.servicesMissingInClaim.length + delta.servicesMissingInFact.length) / serviceUnion;
  const testMismatchRatio =
    (delta.testsMissingInClaim.length + delta.testsMissingInFact.length) / testUnion;
  const unknownRatio = delta.unknownsNotCovered.length / unknownTotal;

  const rolloutPenalty = delta.rolloutMismatch ? 0.06 : 0;
  const rollbackPenalty = delta.rollbackMismatch ? 0.06 : 0;
  const riskPenalty = delta.riskMismatch ? 0.14 : 0;

  const mismatchPenalty =
    fileMismatchRatio * 0.34 +
    serviceMismatchRatio * 0.3 +
    testMismatchRatio * 0.14 +
    unknownRatio * 0.1 +
    rolloutPenalty +
    rollbackPenalty +
    riskPenalty;

  return clampUnitInterval(1 - mismatchPenalty);
}

function calculateReconciliationConfidence(
  fact: VerifiedChangeFact,
  trustScore: number
): ConfidenceScore {
  const provenanceScore = clampUnitInterval(fact.provenance.length / 3);
  const criticalGaps = fact.operabilityGaps.filter((gap) => gap.severity === 'critical').length;
  const highGaps = fact.operabilityGaps.filter((gap) => gap.severity === 'high').length;
  const riskDrag = clampUnitInterval((criticalGaps * 0.18 + highGaps * 0.08) / 1.5);
  const score = clampUnitInterval(
    trustScore * 0.65 + provenanceScore * 0.25 + (1 - riskDrag) * 0.1
  );

  const factors: ConfidenceFactor[] = [
    {
      name: 'claim_fact_trust',
      weight: 0.65,
      score: trustScore,
      notes: `Claim/fact alignment score ${trustScore.toFixed(2)}`,
    },
    {
      name: 'provenance_depth',
      weight: 0.25,
      score: provenanceScore,
      notes: `Derived from ${fact.provenance.length} provenance records`,
    },
    {
      name: 'open_operability_risk',
      weight: 0.1,
      score: 1 - riskDrag,
      notes: `${criticalGaps} critical and ${highGaps} high operability gaps`,
    },
  ];

  return {
    value: score,
    rationale:
      `Confidence combines claim/fact trust (${trustScore.toFixed(2)}), ` +
      `provenance depth (${provenanceScore.toFixed(2)}), and open risk penalties.`,
    factors,
  };
}

export function reconcileClaimWithFact(
  claim: AgentChangeClaim,
  fact: VerifiedChangeFact,
  generatedAt: string = new Date().toISOString()
): ReconciledChangeSummary {
  const delta = buildClaimFactDelta(claim, fact);
  const trustScore = calculateTrustScore(delta);
  const confidence = calculateReconciliationConfidence(fact, trustScore);

  return {
    sessionId: claim.session.sessionId,
    claim,
    fact,
    delta,
    trustScore,
    confidence,
    generatedAt,
  };
}

export function summarizeDelta(delta: ClaimFactDelta): string {
  const lines: string[] = [];
  if (delta.filesMissingInClaim.length > 0) {
    lines.push(`Files missing in claim: ${delta.filesMissingInClaim.join(', ')}`);
  }
  if (delta.servicesMissingInClaim.length > 0) {
    lines.push(`Services missing in claim: ${delta.servicesMissingInClaim.join(', ')}`);
  }
  if (delta.testsMissingInClaim.length > 0) {
    lines.push(`Tests missing in claim: ${delta.testsMissingInClaim.join(', ')}`);
  }
  if (delta.riskMismatch) {
    lines.push(
      `Risk mismatch: claimed ${delta.riskMismatch.claimed}, verified ${delta.riskMismatch.verified}`
    );
  }
  if (delta.rolloutMismatch) {
    lines.push('Rollout plan presence mismatch between claim and verified fact');
  }
  if (delta.rollbackMismatch) {
    lines.push('Rollback plan presence mismatch between claim and verified fact');
  }
  if (delta.unknownsNotCovered.length > 0) {
    lines.push(`Unknowns not covered by facts: ${delta.unknownsNotCovered.join(', ')}`);
  }
  return lines.length > 0 ? lines.join(' | ') : 'No claim/fact deltas detected.';
}
