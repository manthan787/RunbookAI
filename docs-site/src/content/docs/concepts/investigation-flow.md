---
title: Investigation Flow
description: Understanding how Runbook conducts investigations
---

Runbook follows a structured investigation methodology inspired by how experienced SREs approach incidents. This page explains each phase of the investigation flow.

## Investigation Phases

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   TRIAGE    │ → │ HYPOTHESIZE │ → │ INVESTIGATE │
│             │    │             │    │             │
│ Parse alert │    │ Form 3-5    │    │ Test each   │
│ Get context │    │ theories    │    │ hypothesis  │
│ Search KB   │    │ Prioritize  │    │ recursively │
└─────────────┘    └─────────────┘    └─────────────┘
                                             │
                                             ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  REMEDIATE  │ ← │  CONCLUDE   │ ← │  EVALUATE   │
│             │    │             │    │             │
│ Match skill │    │ Root cause  │    │ Classify    │
│ Get approval│    │ Confidence  │    │ evidence    │
│ Execute     │    │ Timeline    │    │ Branch/Prune│
└─────────────┘    └─────────────┘    └─────────────┘
```

## Phase 1: Triage

The first phase gathers context about the incident before forming hypotheses.

### What Happens

1. **Parse the incident** - Extract key information from the alert
2. **Identify affected services** - Map the incident to your service topology
3. **Search knowledge base** - Find relevant runbooks and past incidents
4. **Gather initial metrics** - Pull recent data for affected services

### Example Output

```
→ Gathering incident context...
✓ pagerduty_get_incident (245ms)

Incident: High Error Rate - checkout-api
Severity: SEV2
Triggered: 15 minutes ago
Description: Error rate exceeded 5% threshold

Affected Services:
- checkout-api (primary)
- payment-service (dependency)
- PostgreSQL database (dependency)

→ Searching knowledge base...
✓ search_knowledge (189ms)

Relevant Knowledge:
- Runbook: "Database Connection Exhaustion" (85% match)
- Post-mortem: "2024-01-15 Checkout Outage" (72% match)
- Architecture: checkout-api → PgBouncer → PostgreSQL
```

## Phase 2: Hypothesize

Based on the context gathered, Runbook forms multiple testable hypotheses.

### Hypothesis Categories

| Category | Examples |
|----------|----------|
| **Infrastructure** | Resource exhaustion, capacity limits, hardware failure |
| **Deployment** | Recent code changes, configuration drift, rollback needed |
| **Dependencies** | Downstream service degradation, third-party outage |
| **Traffic** | Load spike, DDoS, unusual patterns |
| **Data** | Corruption, migration issues, replication lag |

### Example Output

```
→ Forming hypotheses based on evidence...

Hypotheses:
  H1: Database connection exhaustion [P: 0.45]
      - Symptoms match "Database Connection Exhaustion" runbook
      - checkout-api depends on PostgreSQL

  H2: Recent deployment introduced bug [P: 0.25]
      - checkout-api deployed 2 hours ago
      - Error pattern started after deployment window

  H3: Payment service degradation [P: 0.15]
      - checkout-api depends on payment-service
      - Could cause cascading failures

  H4: Traffic spike overwhelming capacity [P: 0.15]
      - SEV2 incidents often correlate with traffic
      - No marketing campaign known
```

## Phase 3: Investigate

Each hypothesis is tested with targeted queries. The investigation proceeds depth-first, with a maximum depth of 4 levels.

### Investigation Strategy

```
For each hypothesis (by priority):
  1. Generate targeted queries
  2. Execute tool calls
  3. Evaluate evidence strength
  4. If STRONG: branch deeper (up to depth 4)
  5. If WEAK: continue with lower priority
  6. If NONE: prune hypothesis
```

### Example Output

```
→ Testing H1: Database connection exhaustion...
✓ aws_query (RDS metrics) (234ms)

Evidence Analysis:
  Active Connections: 95/100 (95% capacity)
  Connection Wait Time: 2.3s (10x baseline)
  Read IOPS: Normal
  CPU Utilization: 45% (normal)

Evidence for H1: STRONG
Branching to investigate traffic correlation...

  → Testing H1.1: Traffic spike as root cause...
  ✓ aws_query (CloudWatch request metrics) (178ms)

  Request Rate: 3x normal baseline
  Traffic Source: Organic (not DDoS)
  Started: 14:32 UTC

  Evidence for H1.1: STRONG

  → Testing H1.2: Connection pool misconfiguration...
  ✓ aws_query (ECS task definition) (145ms)

  Pool Size: 10 (appropriate for traffic)
  Max Connections: 100 (RDS limit)

  Evidence for H1.2: WEAK

Pruning H1.2 (pool config is appropriate)
Confirming H1 + H1.1: Traffic spike caused connection exhaustion
```

## Phase 4: Evaluate

After gathering evidence, Runbook evaluates each hypothesis and determines confidence levels.

### Evidence Classification

| Strength | Criteria | Action |
|----------|----------|--------|
| **STRONG** | Clear correlation, metrics match hypothesis | Branch deeper or confirm |
| **WEAK** | Partial correlation, needs more data | Continue investigating |
| **NONE** | No correlation, contradicts hypothesis | Prune hypothesis |

### Confidence Scoring

```typescript
// Confidence calculation
confidence = baseConfidence
  * evidenceMultiplier      // STRONG: 1.2, WEAK: 0.8, NONE: 0.5
  * knowledgeBoost          // If matches known pattern: 1.1
  * corroborationBoost      // If multiple evidence sources: 1.15
```

### Example Output

```
→ Evaluating hypotheses...

Hypothesis Tree:
  H1: Database connection exhaustion [CONFIRMED: 0.92]
    └─ H1.1: Traffic spike as root cause [CONFIRMED: 0.88]
        └─ Organic traffic increase from marketing campaign
    └─ H1.2: Connection pool misconfiguration [PRUNED]
        └─ Pool size appropriate for load

  H2: Recent deployment bug [PRUNED]
      └─ No correlation with error timeline

  H3: Payment service degradation [PRUNED]
      └─ Payment service healthy (0.1% error rate)

  H4: Traffic spike [MERGED with H1.1]
```

## Phase 5: Conclude

Runbook synthesizes findings into a conclusion with confidence level and timeline.

### Example Output

```
═══════════════════════════════════════════════════════════════
                    ROOT CAUSE IDENTIFIED
═══════════════════════════════════════════════════════════════

Root Cause: Database connection exhaustion due to traffic spike
Confidence: HIGH (0.92)

Timeline:
  14:32 UTC - Traffic began increasing (marketing email sent)
  14:45 UTC - Connection pool reached 80% capacity
  14:48 UTC - Connection wait times started increasing
  14:52 UTC - First timeout errors in checkout-api
  14:55 UTC - Error rate exceeded 5% threshold
  15:00 UTC - PagerDuty alert triggered

Evidence Summary:
  ✓ RDS connections at 95% capacity
  ✓ Connection wait time 10x baseline
  ✓ Request rate 3x normal
  ✓ Traffic increase started before errors
  ✓ No recent deployments correlated

Contributing Factors:
  - Connection pool size not auto-scaling
  - No PgBouncer connection pooler in use
  - Marketing team didn't notify of campaign

Related Knowledge Applied:
  - Runbook: "Database Connection Exhaustion" (followed steps 1-4)
  - Post-mortem: "2024-01-15 Checkout Outage" (similar pattern)
═══════════════════════════════════════════════════════════════
```

## Phase 6: Remediate

Based on the root cause, Runbook suggests and executes remediation actions.

### Remediation Matching

1. **Skill matching** - Find built-in or custom skills for the issue
2. **Runbook matching** - Locate relevant runbook steps
3. **Action generation** - Create specific remediation actions

### Example Output

```
Suggested Remediation:

Immediate Actions:
  1. [REQUIRES APPROVAL] Scale RDS read replicas (2 → 4)
     Estimated Impact: Reduce connection pressure by 50%
     Rollback: aws rds modify-db-cluster --replicas 2

  2. [REQUIRES APPROVAL] Enable RDS connection pooling
     Estimated Impact: 10x connection efficiency
     Rollback: Disable RDS Proxy

  3. [INFO] Notify marketing team about capacity planning
     No system changes required

Long-term Recommendations:
  - Implement PgBouncer for application-level pooling
  - Set up auto-scaling for RDS read replicas
  - Create marketing → engineering notification process

Matched Skill: scale-service
Matched Runbook: "Database Connection Exhaustion" (Step 5)

[Approve Immediate Actions?] [y/N]
```

## State Transitions

The investigation state machine manages phase transitions:

```typescript
type InvestigationPhase =
  | 'triage'
  | 'hypothesize'
  | 'investigate'
  | 'evaluate'
  | 'conclude'
  | 'remediate';

// Valid transitions
triage → hypothesize       // After gathering context
hypothesize → investigate  // After forming hypotheses
investigate → evaluate     // After testing hypotheses
evaluate → investigate     // If more testing needed
evaluate → conclude        // If root cause identified
conclude → remediate       // If remediation available
remediate → complete       // After actions executed
```

## Timeouts and Limits

| Setting | Default | Purpose |
|---------|---------|---------|
| `maxIterations` | 10 | Max LLM round-trips per investigation |
| `maxHypothesisDepth` | 4 | Max depth of hypothesis branching |
| `toolTimeout` | 30s | Max time for single tool execution |
| `investigationTimeout` | 10m | Max total investigation time |

## Next Steps

- [Hypothesis System](/RunbookAI/concepts/hypothesis/) - Deep dive into hypothesis management
- [Evidence & Confidence](/RunbookAI/concepts/evidence/) - Understanding evidence evaluation
