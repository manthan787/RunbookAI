---
title: Hypothesis System
description: How Runbook forms, tests, and manages hypotheses
---

The hypothesis system is the core of Runbook's investigation methodology. Instead of following rigid playbooks, Runbook forms multiple theories about what might be wrong and tests them systematically.

## Hypothesis Lifecycle

```
Formation → Prioritization → Testing → Evaluation → Branch/Prune/Confirm
```

### 1. Formation

Hypotheses are generated based on:

- **Incident symptoms** - Error messages, metrics anomalies
- **Service topology** - Dependencies, communication patterns
- **Knowledge base** - Similar past incidents, runbooks
- **Temporal patterns** - Recent changes, deployments

```typescript
interface Hypothesis {
  id: string;              // Unique identifier (h1, h1.1, h1.1.1)
  description: string;     // Human-readable description
  category: HypothesisCategory;
  probability: number;     // Initial probability (0-1)
  evidence: Evidence[];    // Collected evidence
  children: Hypothesis[];  // Sub-hypotheses (branches)
  status: 'active' | 'confirmed' | 'pruned';
  depth: number;           // Current depth in tree (max: 4)
}
```

### 2. Prioritization

Hypotheses are tested in priority order based on:

| Factor | Weight | Description |
|--------|--------|-------------|
| **Initial probability** | 0.4 | Based on symptom matching |
| **Knowledge match** | 0.3 | Similarity to known issues |
| **Recency** | 0.2 | Recent changes more likely |
| **Severity potential** | 0.1 | High-impact causes first |

### 3. Testing

Each hypothesis is tested with targeted queries:

```
Hypothesis: "Database connection exhaustion"
  │
  ├─ Query: Get RDS connection metrics
  │   Result: 95/100 connections (95%)
  │
  ├─ Query: Get connection wait times
  │   Result: 2.3s average (10x baseline)
  │
  └─ Query: Check for recent config changes
      Result: No changes in 7 days
```

### 4. Evaluation

After gathering data, evidence is evaluated:

```typescript
type EvidenceStrength = 'strong' | 'weak' | 'none';

// Strong: Clear correlation (>0.8)
// Weak: Partial correlation (0.4-0.8)
// None: No correlation (<0.4)
```

### 5. Actions

Based on evidence strength:

| Evidence | Action | Effect |
|----------|--------|--------|
| **Strong** | Branch | Create sub-hypotheses to investigate deeper |
| **Weak** | Continue | Test other hypotheses, revisit later |
| **None** | Prune | Remove from consideration |

## Hypothesis Tree

Runbook maintains a tree structure of hypotheses:

```
Root (Investigation)
├── H1: Database connection exhaustion [CONFIRMED: 0.92]
│   ├── H1.1: Traffic spike caused exhaustion [CONFIRMED: 0.88]
│   │   └── H1.1.1: Marketing campaign [CONFIRMED: 0.95]
│   └── H1.2: Connection pool misconfigured [PRUNED]
│
├── H2: Recent deployment bug [PRUNED]
│   └── No correlation with error timeline
│
├── H3: Payment service degradation [PRUNED]
│   └── Service healthy, no correlation
│
└── H4: Traffic spike [MERGED → H1.1]
    └── Merged with H1.1 (same evidence)
```

### Depth Limits

The tree has a maximum depth of 4 to prevent infinite investigation:

- **Depth 0**: Root (the investigation itself)
- **Depth 1**: Primary hypotheses (3-5 theories)
- **Depth 2**: Secondary hypotheses (drilling deeper)
- **Depth 3**: Tertiary hypotheses (specific causes)
- **Depth 4**: Final hypotheses (root cause candidates)

## Branching

When evidence is **strong**, Runbook branches to investigate deeper:

```
H1: Database overload [Evidence: STRONG]
    │
    ├─ Create H1.1: Traffic spike caused overload
    ├─ Create H1.2: Connection leak in application
    └─ Create H1.3: Replication lag from primary

Each branch becomes a new hypothesis to test.
```

### Branching Strategy

```typescript
// When to branch
if (evidenceStrength === 'strong' && depth < maxDepth) {
  // Generate sub-hypotheses that explain WHY
  const subHypotheses = generateSubHypotheses(hypothesis, evidence);

  // Add as children
  hypothesis.children = subHypotheses;

  // Continue investigation with children
  for (const child of subHypotheses) {
    investigate(child);
  }
}
```

## Pruning

When evidence is **none**, the hypothesis is pruned:

```
H2: Recent deployment bug
    │
    ├─ Query: Get deployment history
    │   Result: Last deploy 6 hours ago
    │
    ├─ Query: Compare error timeline
    │   Result: Errors started 30 minutes ago
    │
    └─ Evidence: NONE (no temporal correlation)

    ✗ Pruning H2: No evidence of deployment correlation
```

### Pruning Criteria

A hypothesis is pruned when:
- Evidence strength is `none`
- All sub-hypotheses are pruned
- Contradictory evidence is found
- Timeout reached without progress

## Merging

When two hypotheses converge on the same evidence, they're merged:

```
H1.1: Traffic spike caused DB exhaustion
H4: Traffic spike caused issues

Both point to same root cause → Merge H4 into H1.1
```

## Confidence Calculation

Confidence is calculated dynamically as evidence is gathered:

```typescript
function calculateConfidence(hypothesis: Hypothesis): number {
  let confidence = hypothesis.baseProbability;

  for (const evidence of hypothesis.evidence) {
    const multiplier = {
      strong: 1.3,
      weak: 1.0,
      none: 0.5,
    }[evidence.strength];

    confidence *= multiplier;
  }

  // Knowledge boost
  if (hypothesis.matchesKnownPattern) {
    confidence *= 1.15;
  }

  // Corroboration boost
  if (hypothesis.evidence.length > 2) {
    confidence *= 1.1;
  }

  return Math.min(confidence, 0.99);
}
```

### Confidence Levels

| Range | Level | Meaning |
|-------|-------|---------|
| 0.9-1.0 | **Very High** | Root cause confirmed with high certainty |
| 0.7-0.9 | **High** | Strong evidence, likely root cause |
| 0.5-0.7 | **Medium** | Moderate evidence, needs more investigation |
| 0.3-0.5 | **Low** | Weak evidence, other causes more likely |
| 0.0-0.3 | **Very Low** | Minimal evidence, probably not the cause |

## Categories

Hypotheses are categorized to ensure diverse investigation:

```typescript
type HypothesisCategory =
  | 'infrastructure'  // Resource exhaustion, hardware failure
  | 'deployment'      // Code changes, configuration drift
  | 'dependency'      // Downstream service issues
  | 'traffic'         // Load patterns, DDoS
  | 'data'            // Corruption, migration issues
  | 'security'        // Unauthorized access, breaches
  | 'configuration'   // Misconfigurations, drift
  | 'network'         // Connectivity, DNS, routing
  | 'external';       // Third-party services, APIs
```

### Category Distribution

Runbook ensures hypotheses cover multiple categories:

```
Ideal Distribution (5 hypotheses):
- 1-2 from most likely category (based on symptoms)
- 1-2 from second most likely
- 1 from a less likely category (edge cases)
```

## Example: Full Investigation

```
Investigation: High error rate on checkout-api

PHASE: Formation
  H1: Database connection exhaustion [infrastructure, P: 0.45]
  H2: Recent deployment bug [deployment, P: 0.25]
  H3: Payment service degradation [dependency, P: 0.15]
  H4: Traffic spike [traffic, P: 0.15]

PHASE: Testing H1 (highest priority)
  Query: RDS connection metrics
  Result: 95% capacity
  Evidence: STRONG

PHASE: Branching H1
  H1.1: Traffic spike caused exhaustion [P: 0.6]
  H1.2: Connection pool misconfigured [P: 0.3]
  H1.3: Slow queries holding connections [P: 0.1]

PHASE: Testing H1.1
  Query: Request rate metrics
  Result: 3x baseline
  Evidence: STRONG

PHASE: Testing H2 (parallel)
  Query: Deployment timeline
  Result: No correlation
  Evidence: NONE
  → Pruning H2

PHASE: Testing H3 (parallel)
  Query: Payment service health
  Result: Healthy (0.1% errors)
  Evidence: NONE
  → Pruning H3

PHASE: Merging
  H4 (traffic spike) → Merged with H1.1

PHASE: Confirmation
  H1: Database connection exhaustion [CONFIRMED: 0.92]
    H1.1: Traffic spike as cause [CONFIRMED: 0.88]

PHASE: Conclusion
  Root Cause: Database connection exhaustion due to traffic spike
  Confidence: HIGH (0.92)
```

## Best Practices

### For Investigation Quality

1. **Diverse hypotheses** - Cover multiple categories
2. **Evidence-based** - Always test before branching
3. **Time-bounded** - Don't investigate forever
4. **Knowledge-informed** - Use organizational context

### For Configuration

```yaml
agent:
  # Limit hypothesis tree depth
  maxHypothesisDepth: 4

  # Min hypotheses before investigating
  minHypotheses: 3

  # Max hypotheses to form
  maxHypotheses: 7

  # Confidence threshold for confirmation
  confirmationThreshold: 0.75

  # Prune threshold
  pruneThreshold: 0.2
```

## Next Steps

- [Evidence & Confidence](/RunbookAI/concepts/evidence/) - Deep dive into evidence evaluation
- [Safety & Approvals](/RunbookAI/concepts/safety/) - Understanding the approval system
