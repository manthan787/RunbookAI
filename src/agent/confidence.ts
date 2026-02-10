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

// ============================================================================
// Confidence Visualization Utilities
// ============================================================================

export interface ConfidenceThresholds {
  high: number;
  medium: number;
}

const DEFAULT_THRESHOLDS: ConfidenceThresholds = {
  high: 70,
  medium: 40,
};

/**
 * Get the confidence level from a numeric value
 */
export function getConfidenceLevelFromValue(
  value: number,
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS
): ConfidenceLevel {
  if (value >= thresholds.high) return 'high';
  if (value >= thresholds.medium) return 'medium';
  return 'low';
}

/**
 * Format confidence as a text bar for non-TTY output
 *
 * Example output: "████████░░ 82% (High)"
 */
export function formatConfidenceText(
  value: number,
  options: {
    width?: number;
    showLabel?: boolean;
    showPercentage?: boolean;
    thresholds?: ConfidenceThresholds;
  } = {}
): string {
  const {
    width = 10,
    showLabel = true,
    showPercentage = true,
    thresholds = DEFAULT_THRESHOLDS,
  } = options;

  // Clamp value between 0 and 100
  const clampedValue = Math.max(0, Math.min(100, value));

  const filled = Math.round((clampedValue / 100) * width);
  const empty = width - filled;

  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
  const level = getConfidenceLevelFromValue(clampedValue, thresholds);
  const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);

  const parts: string[] = [bar];
  if (showPercentage) {
    parts.push(`${clampedValue}%`);
  }
  if (showLabel) {
    parts.push(`(${levelLabel})`);
  }

  return parts.join(' ');
}

/**
 * Format confidence as a compact badge
 *
 * Example output: "High (85%)"
 */
export function formatConfidenceBadge(
  value: number,
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS
): string {
  const level = getConfidenceLevelFromValue(value, thresholds);
  const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);
  return `${levelLabel} (${value}%)`;
}

/**
 * Get color for confidence level (for terminal/UI output)
 */
export function getConfidenceColor(
  value: number,
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS
): 'green' | 'yellow' | 'red' {
  const level = getConfidenceLevelFromValue(value, thresholds);
  switch (level) {
    case 'high':
      return 'green';
    case 'medium':
      return 'yellow';
    case 'low':
      return 'red';
  }
}

/**
 * Format confidence for markdown output
 *
 * Example output: "**High** (85%) ████████░░"
 */
export function formatConfidenceMarkdown(
  value: number,
  options: {
    width?: number;
    thresholds?: ConfidenceThresholds;
  } = {}
): string {
  const { width = 10, thresholds = DEFAULT_THRESHOLDS } = options;

  const clampedValue = Math.max(0, Math.min(100, value));
  const filled = Math.round((clampedValue / 100) * width);
  const empty = width - filled;

  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
  const level = getConfidenceLevelFromValue(clampedValue, thresholds);
  const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);

  return `**${levelLabel}** (${clampedValue}%) ${bar}`;
}

/**
 * Parse a confidence percentage from text
 *
 * Handles formats like "85%", "85", "high", "High (85%)"
 */
export function parseConfidenceValue(text: string): number | null {
  // Try to extract percentage
  const percentMatch = text.match(/(\d+)%?/);
  if (percentMatch) {
    const value = parseInt(percentMatch[1], 10);
    if (value >= 0 && value <= 100) {
      return value;
    }
  }

  // Try to interpret level words
  const lower = text.toLowerCase().trim();
  if (lower === 'high' || lower.includes('high')) return 85;
  if (lower === 'medium' || lower.includes('medium')) return 55;
  if (lower === 'low' || lower.includes('low')) return 25;

  return null;
}

/**
 * Calculate aggregate confidence from multiple sources
 */
export function aggregateConfidence(values: number[], weights?: number[]): number {
  if (values.length === 0) return 0;

  if (weights && weights.length === values.length) {
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    if (totalWeight === 0) return 0;
    const weightedSum = values.reduce((sum, v, i) => sum + v * weights[i], 0);
    return Math.round(weightedSum / totalWeight);
  }

  // Simple average
  const sum = values.reduce((acc, v) => acc + v, 0);
  return Math.round(sum / values.length);
}

/**
 * Describe what the confidence level means in context
 */
export function describeConfidenceInContext(
  value: number,
  context: 'investigation' | 'hypothesis' | 'general' = 'general'
): string {
  const level = getConfidenceLevelFromValue(value);

  const descriptions: Record<typeof context, Record<ConfidenceLevel, string>> = {
    investigation: {
      high: 'Strong evidence supports this conclusion. Multiple data points corroborate the finding.',
      medium:
        'Evidence supports this conclusion with some uncertainty. Additional validation recommended.',
      low: 'Limited evidence available. This is a preliminary assessment that requires further investigation.',
    },
    hypothesis: {
      high: 'This hypothesis is well-supported by gathered evidence.',
      medium: 'This hypothesis has partial support. Some evidence is inconclusive.',
      low: 'This hypothesis needs more evidence to be confirmed or refuted.',
    },
    general: {
      high: 'High confidence in this result.',
      medium: 'Moderate confidence in this result.',
      low: 'Low confidence in this result.',
    },
  };

  return descriptions[context][level];
}
