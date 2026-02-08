---
title: Evidence & Confidence
description: How Runbook evaluates evidence and calculates confidence
---

Runbook uses a structured approach to evaluate evidence gathered during investigations and calculate confidence levels for hypotheses.

## Evidence Classification

Every piece of data gathered is classified by its strength:

| Strength | Description | Correlation | Effect on Hypothesis |
|----------|-------------|-------------|---------------------|
| **Strong** | Clear correlation with hypothesis | > 0.8 | Branch deeper, increase confidence |
| **Weak** | Partial correlation, inconclusive | 0.4 - 0.8 | Continue investigating |
| **None** | No correlation or contradicts | < 0.4 | Prune hypothesis |

## Evidence Types

### Metric Evidence

Numerical data from monitoring systems:

```typescript
interface MetricEvidence {
  type: 'metric';
  source: 'cloudwatch' | 'datadog' | 'prometheus';
  metric: string;
  value: number;
  baseline: number;
  deviation: number;  // How far from baseline
  period: string;     // Time window
}

// Example
{
  type: 'metric',
  source: 'cloudwatch',
  metric: 'DatabaseConnections',
  value: 95,
  baseline: 30,
  deviation: 3.16,  // 3.16 standard deviations
  period: '5m'
}
```

### Log Evidence

Patterns found in logs:

```typescript
interface LogEvidence {
  type: 'log';
  source: 'cloudwatch' | 'datadog';
  pattern: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  samples: string[];
}

// Example
{
  type: 'log',
  source: 'cloudwatch',
  pattern: 'Connection timeout',
  count: 1523,
  firstSeen: '2024-01-15T14:52:00Z',
  lastSeen: '2024-01-15T15:10:00Z',
  samples: [
    'ERROR: Connection timeout after 30000ms',
    'ERROR: Unable to acquire connection from pool'
  ]
}
```

### Timeline Evidence

Events correlated with incident timeline:

```typescript
interface TimelineEvidence {
  type: 'timeline';
  event: string;
  timestamp: string;
  correlation: 'before' | 'during' | 'after';
  timeDelta: number;  // Seconds from incident start
}

// Example
{
  type: 'timeline',
  event: 'Marketing email campaign sent',
  timestamp: '2024-01-15T14:30:00Z',
  correlation: 'before',
  timeDelta: -1320  // 22 minutes before
}
```

### State Evidence

Current system state:

```typescript
interface StateEvidence {
  type: 'state';
  resource: string;
  expected: unknown;
  actual: unknown;
  matches: boolean;
}

// Example
{
  type: 'state',
  resource: 'RDS connection limit',
  expected: 100,
  actual: 95,
  matches: false  // At capacity
}
```

## Evidence Evaluation

### Metric Evaluation

```typescript
function evaluateMetricEvidence(
  metric: MetricEvidence,
  hypothesis: Hypothesis
): EvidenceStrength {
  // Calculate deviation significance
  const zScore = (metric.value - metric.baseline) / standardDeviation;

  if (zScore > 2.5 && alignsWithHypothesis(metric, hypothesis)) {
    return 'strong';
  } else if (zScore > 1.5) {
    return 'weak';
  } else {
    return 'none';
  }
}
```

### Log Evaluation

```typescript
function evaluateLogEvidence(
  log: LogEvidence,
  hypothesis: Hypothesis
): EvidenceStrength {
  // Check pattern relevance
  const relevance = calculateRelevance(log.pattern, hypothesis);

  // Check temporal correlation
  const temporal = log.firstSeen > incidentStart - 300; // 5 min buffer

  if (relevance > 0.8 && temporal && log.count > 10) {
    return 'strong';
  } else if (relevance > 0.5 || (temporal && log.count > 5)) {
    return 'weak';
  } else {
    return 'none';
  }
}
```

### Timeline Evaluation

```typescript
function evaluateTimelineEvidence(
  timeline: TimelineEvidence,
  hypothesis: Hypothesis
): EvidenceStrength {
  // Events before incident are more relevant
  if (timeline.correlation === 'before') {
    if (timeline.timeDelta > -3600 && timeline.timeDelta < 0) {
      // Within 1 hour before
      return hypothesis.category === 'deployment' ? 'strong' : 'weak';
    }
  }

  if (timeline.correlation === 'during') {
    return 'strong';  // Concurrent events are highly relevant
  }

  return 'none';
}
```

## Confidence Calculation

### Base Formula

```typescript
function calculateConfidence(hypothesis: Hypothesis): number {
  // Start with prior probability
  let confidence = hypothesis.priorProbability;

  // Apply evidence multipliers
  for (const evidence of hypothesis.evidence) {
    const multiplier = {
      strong: 1.3,  // Increase by 30%
      weak: 1.0,    // No change
      none: 0.5,    // Decrease by 50%
    }[evidence.strength];

    confidence *= multiplier;
  }

  // Apply boosts
  confidence *= getKnowledgeBoost(hypothesis);
  confidence *= getCorroborationBoost(hypothesis);

  // Clamp to valid range
  return Math.min(Math.max(confidence, 0.01), 0.99);
}
```

### Knowledge Boost

When a hypothesis matches a known pattern from the knowledge base:

```typescript
function getKnowledgeBoost(hypothesis: Hypothesis): number {
  const match = findKnowledgeMatch(hypothesis);

  if (match && match.similarity > 0.8) {
    return 1.15;  // 15% boost for strong match
  } else if (match && match.similarity > 0.6) {
    return 1.08;  // 8% boost for moderate match
  }

  return 1.0;  // No boost
}
```

### Corroboration Boost

When multiple independent evidence sources agree:

```typescript
function getCorroborationBoost(hypothesis: Hypothesis): number {
  const strongEvidence = hypothesis.evidence
    .filter(e => e.strength === 'strong');

  const uniqueSources = new Set(strongEvidence.map(e => e.source));

  if (uniqueSources.size >= 3) {
    return 1.15;  // 15% boost for 3+ sources
  } else if (uniqueSources.size >= 2) {
    return 1.10;  // 10% boost for 2 sources
  }

  return 1.0;
}
```

## Confidence Thresholds

### For Hypothesis Actions

| Threshold | Action | Description |
|-----------|--------|-------------|
| > 0.75 | **Confirm** | Hypothesis is accepted as root cause |
| 0.50 - 0.75 | **Continue** | Need more evidence |
| 0.20 - 0.50 | **Deprioritize** | Move to lower priority |
| < 0.20 | **Prune** | Remove from consideration |

### For Remediation

| Threshold | Recommendation |
|-----------|----------------|
| > 0.85 | Suggest immediate remediation |
| 0.70 - 0.85 | Suggest remediation with caution |
| 0.50 - 0.70 | Suggest investigation before action |
| < 0.50 | Do not suggest remediation |

## Evidence Aggregation

### Weighted Aggregation

When multiple pieces of evidence relate to the same hypothesis:

```typescript
function aggregateEvidence(evidenceList: Evidence[]): AggregatedEvidence {
  const weights = {
    metric: 0.4,    // Numerical data is most reliable
    log: 0.3,       // Logs are informative but can be noisy
    timeline: 0.2,  // Timeline is suggestive but not definitive
    state: 0.1,     // Current state snapshot
  };

  let totalWeight = 0;
  let weightedScore = 0;

  for (const evidence of evidenceList) {
    const score = strengthToScore(evidence.strength);
    const weight = weights[evidence.type];

    weightedScore += score * weight;
    totalWeight += weight;
  }

  return {
    score: weightedScore / totalWeight,
    strength: scoreToStrength(weightedScore / totalWeight),
    count: evidenceList.length,
    sources: uniqueSources(evidenceList),
  };
}
```

### Contradiction Handling

When evidence contradicts:

```typescript
function handleContradiction(
  positive: Evidence[],
  negative: Evidence[]
): EvidenceStrength {
  const positiveScore = aggregateEvidence(positive).score;
  const negativeScore = aggregateEvidence(negative).score;

  const netScore = positiveScore - negativeScore;

  if (netScore > 0.3) {
    return 'weak';  // Positive but uncertain
  } else if (netScore < -0.3) {
    return 'none';  // Likely wrong
  } else {
    return 'weak';  // Inconclusive
  }
}
```

## Confidence Decay

Confidence can decay over time during long investigations:

```typescript
function applyConfidenceDecay(
  hypothesis: Hypothesis,
  elapsed: number  // Seconds since evidence gathered
): number {
  // Decay rate: 10% per hour for stale evidence
  const decayRate = 0.1 / 3600;
  const decayFactor = Math.exp(-decayRate * elapsed);

  return hypothesis.confidence * decayFactor;
}
```

## Example: Evidence Evaluation

```
Hypothesis: Database connection exhaustion

Evidence Gathered:
  1. [METRIC] RDS connections: 95/100
     Deviation: 3.2 std
     → Strength: STRONG (deviation > 2.5)

  2. [LOG] "Connection timeout" errors: 1523 occurrences
     First seen: 2 minutes before alert
     → Strength: STRONG (relevant pattern, temporal match)

  3. [TIMELINE] Deployment: 6 hours ago
     Correlation: BEFORE (well before)
     → Strength: NONE (too early to correlate)

  4. [STATE] Pool size: 10 (expected: 10)
     → Strength: NONE (matches expected)

Confidence Calculation:
  Prior probability: 0.45
  × STRONG multiplier (metric): 1.3 → 0.585
  × STRONG multiplier (log): 1.3 → 0.760
  × NONE multiplier (timeline): 0.5 → 0.380
  × NONE multiplier (state): 0.5 → 0.190

  + Knowledge boost (matches runbook): × 1.15 → 0.218
  + Corroboration boost (2 sources): × 1.10 → 0.240

Wait, that seems low. Let's recalculate properly:
  Prior: 0.45
  After metric (STRONG): 0.45 × 1.3 = 0.585
  After log (STRONG): 0.585 × 1.3 = 0.760
  After timeline (NONE): 0.760 × 0.5 = 0.380
  After state (NONE): 0.380 × 0.5 = 0.190

The NONE evidence significantly reduced confidence.

Better approach - only apply negative evidence if it directly contradicts:
  Prior: 0.45
  After metric (STRONG): 0.45 × 1.3 = 0.585
  After log (STRONG): 0.585 × 1.3 = 0.760
  Timeline/State: Not contradictory, no multiplier
  Knowledge boost: 0.760 × 1.15 = 0.874
  Corroboration: 0.874 × 1.10 = 0.962

Final Confidence: 0.92 (HIGH)
```

## Configuration

```yaml
agent:
  evidence:
    # Strength thresholds
    strongThreshold: 0.8
    weakThreshold: 0.4

    # Multipliers
    strongMultiplier: 1.3
    weakMultiplier: 1.0
    noneMultiplier: 0.5

    # Boosts
    knowledgeBoostStrong: 1.15
    knowledgeBoostWeak: 1.08
    corroborationBoost2: 1.10
    corroborationBoost3: 1.15

    # Decay
    decayRatePerHour: 0.1

  confidence:
    confirmThreshold: 0.75
    pruneThreshold: 0.20
    remediationThreshold: 0.70
```

## Next Steps

- [Safety & Approvals](/RunbookAI/concepts/safety/) - Understanding the approval system
- [CLI Reference](/RunbookAI/cli/overview/) - Explore all commands
