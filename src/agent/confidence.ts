/**
 * Confidence scoring for evidence evaluation
 *
 * Classifies evidence strength and calculates overall confidence
 * for investigation conclusions.
 */

import type { EvidenceStrength, ConfidenceLevel } from './types';

export interface ConfidenceFactors {
  evidenceChainDepth: number;
  corroboratingSignals: number;
  contradictingSignals: number;
  temporalCorrelation: boolean;
  historicalPatternMatch: boolean;
  directEvidence: boolean;
}

/**
 * Calculate confidence level from factors
 */
export function calculateConfidence(factors: ConfidenceFactors): ConfidenceLevel {
  let score = 0;

  // Deeper investigation = more validated (max 30 points)
  score += Math.min(factors.evidenceChainDepth * 15, 30);

  // Multiple corroborating signals (max 40 points)
  score += Math.min(factors.corroboratingSignals * 20, 40);

  // Contradicting signals reduce confidence
  score -= factors.contradictingSignals * 25;

  // Temporal correlation (events align in time)
  score += factors.temporalCorrelation ? 15 : 0;

  // Historical pattern match (seen this before)
  score += factors.historicalPatternMatch ? 15 : 0;

  // Direct evidence is strong
  score += factors.directEvidence ? 20 : 0;

  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

/**
 * Evidence classification prompt for LLM
 */
export const EVIDENCE_CLASSIFICATION_PROMPT = `
You are evaluating evidence for a hypothesis about an incident.

Given:
- Hypothesis: {hypothesis}
- Query executed: {query}
- Query result: {result}

Classify the evidence strength:

STRONG: The data directly supports this hypothesis with clear, unambiguous signals.
Examples:
- Error rate spiked at exact time of incident
- Connection pool at 100% capacity
- OOM killer events in logs
- Service returning 503s

WEAK: The data somewhat supports the hypothesis but could have other explanations.
Examples:
- Metrics slightly elevated but within normal range
- Some errors present but low volume
- Timing approximately matches but not exact

NONE: The data does not support this hypothesis or actively contradicts it.
Examples:
- All metrics normal
- No relevant errors in logs
- Timeline doesn't match
- Different service affected

Respond with JSON:
{
  "strength": "strong" | "weak" | "none",
  "reasoning": "Brief explanation of why this evidence supports or refutes the hypothesis"
}
`;

/**
 * Parse evidence classification from LLM response
 */
export function parseEvidenceClassification(response: string): {
  strength: EvidenceStrength;
  reasoning: string;
} {
  try {
    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        strength: parsed.strength as EvidenceStrength,
        reasoning: parsed.reasoning || 'No reasoning provided',
      };
    }
  } catch {
    // Fall through to text parsing
  }

  // Fallback: look for keywords
  const lower = response.toLowerCase();
  if (lower.includes('strong')) {
    return { strength: 'strong', reasoning: response };
  } else if (lower.includes('weak')) {
    return { strength: 'weak', reasoning: response };
  } else {
    return { strength: 'none', reasoning: response };
  }
}

/**
 * Check for temporal correlation between events
 */
export function hasTemporalCorrelation(
  incidentTime: Date,
  eventTime: Date,
  toleranceMinutes: number = 5
): boolean {
  const diffMs = Math.abs(incidentTime.getTime() - eventTime.getTime());
  const diffMinutes = diffMs / (1000 * 60);
  return diffMinutes <= toleranceMinutes;
}

/**
 * Confidence level descriptions for user output
 */
export const CONFIDENCE_DESCRIPTIONS: Record<ConfidenceLevel, string> = {
  high: 'High confidence - Strong evidence chain with corroborating signals',
  medium: 'Medium confidence - Evidence supports this conclusion but some uncertainty remains',
  low: 'Low confidence - Limited evidence, consider additional investigation',
};
