export type ConfidenceLevel = 'low' | 'medium' | 'high';

export interface InvestigationEvalExpected {
  rootCause?: string;
  rootCauseKeywords?: string[];
  affectedServices?: string[];
  confidenceAtLeast?: ConfidenceLevel;
  requiredPhrases?: string[];
  forbiddenPhrases?: string[];
}

export interface InvestigationEvalCase {
  id: string;
  incidentId?: string;
  query?: string;
  context?: string;
  tags?: string[];
  expected: InvestigationEvalExpected;
  execute?: {
    maxIterations?: number;
    autoRemediate?: boolean;
  };
  mockResult?: {
    rootCause?: string;
    summary?: string;
    confidence?: ConfidenceLevel;
    remediationText?: string;
  };
}

export interface InvestigationEvalFixtures {
  version: string;
  passThreshold?: number;
  cases: InvestigationEvalCase[];
}

export interface InvestigationEvalScoring {
  rootCause: number | null;
  services: number | null;
  confidence: number | null;
  phraseCompliance: number | null;
  overall: number;
}

export interface InvestigationEvalScoreInput {
  expected: InvestigationEvalExpected;
  rootCauseText?: string;
  summaryText?: string;
  confidence?: ConfidenceLevel;
  remediationText?: string;
  affectedServicesDetected?: string[];
}

const CONFIDENCE_WEIGHT: Record<ConfidenceLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsNormalized(haystack: string, needle: string): boolean {
  if (!needle.trim()) {
    return false;
  }
  return normalize(haystack).includes(normalize(needle));
}

function normalizeServiceName(service: string): string {
  return service
    .toLowerCase()
    .replace(/^ts-/, '')
    .replace(/[-_]?service$/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function serviceAliases(service: string): string[] {
  const raw = service.trim().toLowerCase();
  const compact = normalizeServiceName(raw);
  const noPrefix = raw.replace(/^ts-/, '');
  const noSuffix = raw.replace(/[-_]?service$/g, '');

  return Array.from(new Set([raw, noPrefix, noSuffix, compact])).filter(Boolean);
}

function serviceCoverage(
  text: string,
  expectedServices: string[],
  detectedServices: string[] = []
): number {
  if (expectedServices.length === 0) {
    return 0;
  }

  const normalizedDetected = detectedServices.map((service) => normalizeServiceName(service));
  const normalizedText = normalize(text);

  const hits = expectedServices.filter((expectedService) => {
    const aliases = serviceAliases(expectedService);
    const aliasMatchesText = aliases.some((alias) => {
      const compact = normalizeServiceName(alias);
      return (
        (alias && normalizedText.includes(normalize(alias))) ||
        (compact && normalizedText.includes(compact))
      );
    });

    if (aliasMatchesText) {
      return true;
    }

    const compactExpected = normalizeServiceName(expectedService);
    return normalizedDetected.some((detected) => detected === compactExpected);
  }).length;

  return hits / expectedServices.length;
}

function keywordCoverage(text: string, keywords: string[]): number {
  if (keywords.length === 0) {
    return 0;
  }

  const hits = keywords.filter((keyword) => containsNormalized(text, keyword)).length;
  return hits / keywords.length;
}

export function scoreInvestigationResult(
  input: InvestigationEvalScoreInput
): InvestigationEvalScoring {
  const expected = input.expected;
  const combinedText = [input.rootCauseText, input.summaryText, input.remediationText]
    .filter(Boolean)
    .join('\n');

  let rootCause: number | null = null;
  if (expected.rootCause || (expected.rootCauseKeywords && expected.rootCauseKeywords.length > 0)) {
    const exactScore = expected.rootCause
      ? containsNormalized(combinedText, expected.rootCause) ||
        (input.rootCauseText ? containsNormalized(expected.rootCause, input.rootCauseText) : false)
        ? 1
        : 0
      : 0;

    const keywordScore = expected.rootCauseKeywords
      ? keywordCoverage(combinedText, expected.rootCauseKeywords)
      : 0;

    rootCause = Math.max(exactScore, keywordScore);
  }

  let services: number | null = null;
  if (expected.affectedServices && expected.affectedServices.length > 0) {
    services = serviceCoverage(
      combinedText,
      expected.affectedServices,
      input.affectedServicesDetected
    );
  }

  let confidence: number | null = null;
  if (expected.confidenceAtLeast) {
    const got = input.confidence ? CONFIDENCE_WEIGHT[input.confidence] : 0;
    const target = CONFIDENCE_WEIGHT[expected.confidenceAtLeast];
    confidence = got >= target ? 1 : got / target;
  }

  let phraseCompliance: number | null = null;
  if (
    (expected.requiredPhrases && expected.requiredPhrases.length > 0) ||
    (expected.forbiddenPhrases && expected.forbiddenPhrases.length > 0)
  ) {
    const required = expected.requiredPhrases || [];
    const forbidden = expected.forbiddenPhrases || [];

    const requiredScore = required.length > 0 ? keywordCoverage(combinedText, required) : 1;
    const forbiddenViolations = forbidden.filter((phrase) =>
      containsNormalized(combinedText, phrase)
    ).length;
    const forbiddenScore = forbidden.length > 0 ? 1 - forbiddenViolations / forbidden.length : 1;

    phraseCompliance = Math.max(0, (requiredScore + forbiddenScore) / 2);
  }

  const componentWeights: Array<{ score: number | null; weight: number }> = [
    { score: rootCause, weight: 0.5 },
    { score: services, weight: 0.1 },
    { score: confidence, weight: 0.2 },
    { score: phraseCompliance, weight: 0.2 },
  ].filter((item) => item.score !== null);

  const totalWeight = componentWeights.reduce((sum, item) => sum + item.weight, 0);
  const weightedSum = componentWeights.reduce(
    (sum, item) => sum + (item.score || 0) * item.weight,
    0
  );
  const overall = totalWeight > 0 ? Number((weightedSum / totalWeight).toFixed(4)) : 0;

  return {
    rootCause,
    services,
    confidence,
    phraseCompliance,
    overall,
  };
}
