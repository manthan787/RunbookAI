---
title: Incident Investigation
description: Example of investigating a production incident
---

This example walks through a complete incident investigation using Runbook.

## Scenario

You receive a PagerDuty alert: **High Error Rate - checkout-api (SEV2)**

## Investigation

### Start Investigation

```bash
runbook investigate PD-12345
```

### Phase 1: Triage

```
═══════════════════════════════════════════════════════════════
                    INCIDENT INVESTIGATION
═══════════════════════════════════════════════════════════════

Incident: High Error Rate - checkout-api
Severity: SEV2
Duration: 15 minutes
Triggered: 2024-01-15 15:00 UTC

Phase 1: Triage
───────────────
→ Gathering incident context from PagerDuty...
✓ pagerduty_get_incident (245ms)

Alert Details:
  • Error rate: 5.2% (threshold: 1%)
  • Affected: checkout-api
  • Started: 14:52 UTC

Affected Services:
  • checkout-api (primary)
  • payment-service (dependency)
  • PostgreSQL database (infrastructure)

→ Searching knowledge base...
✓ search_knowledge (189ms)

Relevant Knowledge:
  📘 Runbook: "Database Connection Exhaustion" (85% match)
     Services: checkout-api, payment-service
     Symptoms match: connection timeout, high error rate

  📕 Post-mortem: "2024-01-15 Checkout Outage" (72% match)
     Root cause: Traffic spike from marketing campaign

  📐 Architecture: "checkout-api Service"
     Dependencies: PostgreSQL via PgBouncer, Redis
```

### Phase 2: Hypothesize

```
Phase 2: Hypothesize
────────────────────
Forming hypotheses based on evidence...

Based on symptoms and knowledge base matches:

  H1: Database connection exhaustion [P: 0.45]
      • Matches "Database Connection Exhaustion" runbook
      • checkout-api depends on PostgreSQL
      • Previous similar incident in knowledge base

  H2: Recent deployment introduced bug [P: 0.25]
      • checkout-api deployed 2 hours ago
      • Error pattern could indicate code issue

  H3: Payment service degradation [P: 0.15]
      • checkout-api depends on payment-service
      • Could cause cascading failures

  H4: Traffic spike overwhelming capacity [P: 0.15]
      • SEV2 incidents often correlate with traffic
      • Similar to previous marketing campaign incident
```

### Phase 3: Investigate

```
Phase 3: Investigate
────────────────────

Testing H1: Database connection exhaustion...
→ aws_query (RDS connection metrics)
✓ 234ms

  RDS Metrics:
  ├─ Database: prod-checkout-db
  ├─ Connections: 95/100 (95% capacity)
  ├─ Connection Wait Time: 2.3s (baseline: 0.2s)
  ├─ CPU: 45% (normal)
  └─ Read IOPS: 12,000 (normal)

  Evidence: STRONG
  • Connections at 95% capacity
  • Connection wait time 10x baseline
  • CPU and IOPS normal (not query-related)

  ↳ Branching to investigate cause of connection exhaustion...

Testing H1.1: Traffic spike caused exhaustion...
→ aws_query (CloudWatch request metrics)
✓ 178ms

  Traffic Metrics:
  ├─ Current: 3,600 req/min
  ├─ Baseline: 1,200 req/min
  ├─ Increase: 3x
  └─ Started: 14:32 UTC

  Source Analysis:
  ├─ Origin: Organic (not DDoS)
  ├─ Pattern: Gradual increase
  └─ Correlation: Marketing campaign sent at 14:30 UTC

  Evidence: STRONG
  • Request rate 3x normal
  • Started 28 minutes ago
  • Correlates with marketing campaign

Testing H2: Recent deployment bug...
→ aws_query (ECS deployment history)
✓ 145ms

  Deployment History:
  ├─ Last deploy: 6 hours ago (v1.2.2)
  ├─ Error timeline: Started 28 minutes ago
  └─ Correlation: None

  Evidence: NONE
  • Last deployment was 6 hours ago
  • Errors started 28 minutes ago
  • No temporal correlation

  ✗ Pruning H2: No deployment in error window

Testing H3: Payment service degradation...
→ aws_query (ECS service health)
✓ 156ms

  payment-service Status:
  ├─ Tasks: 4/4 running
  ├─ Health: All healthy
  ├─ Error rate: 0.1% (normal)
  └─ Latency: 45ms (normal)

  Evidence: NONE
  • Payment service is healthy
  • No errors or latency issues

  ✗ Pruning H3: Service healthy

Testing H1.2: Connection pool misconfiguration...
→ aws_query (ECS task definition)
✓ 134ms

  Pool Configuration:
  ├─ App pool size: 10 connections/task
  ├─ Tasks: 4 running
  ├─ Total possible: 40 connections
  └─ RDS limit: 100 connections

  Analysis:
  • Pool size is appropriate for normal traffic
  • But insufficient for 3x traffic spike

  Evidence: WEAK
  • Config is correct for normal load
  • Insufficient for current traffic

  → Continue investigating, not root cause
```

### Phase 4: Evaluate

```
Phase 4: Evaluate
─────────────────

Hypothesis Confidence:

  H1: Database connection exhaustion
      Confidence: 0.92 ████████████████████ HIGH
      Evidence:
        • Connections at 95% capacity [STRONG]
        • Wait time 10x baseline [STRONG]
        • Runbook match: 85% [BOOST]

      H1.1: Traffic spike as root cause
            Confidence: 0.88 ██████████████████ HIGH
            Evidence:
              • 3x traffic increase [STRONG]
              • Correlates with marketing email [STRONG]

      H1.2: Pool misconfiguration
            Status: PRUNED (contributing factor, not cause)

  H2: Deployment bug
      Status: PRUNED
      Reason: No deployment in error window

  H3: Payment service
      Status: PRUNED
      Reason: Service healthy

  H4: Traffic spike
      Status: MERGED → H1.1
      Reason: Same evidence, combined hypothesis
```

### Phase 5: Conclude

```
Phase 5: Conclude
─────────────────

═══════════════════════════════════════════════════════════════
                    ROOT CAUSE IDENTIFIED
═══════════════════════════════════════════════════════════════

Root Cause: Database connection exhaustion due to traffic spike
Confidence: HIGH (0.92)

Timeline:
  14:30 UTC │ Marketing campaign email sent
  14:32 UTC │ Traffic began increasing (3x)
  14:45 UTC │ Connection pool reached 80% capacity
  14:48 UTC │ Connection wait times started increasing
  14:52 UTC │ First timeout errors in checkout-api
  14:55 UTC │ Error rate exceeded 5% threshold
  15:00 UTC │ PagerDuty alert triggered

Evidence Summary:
  ✓ RDS connections at 95% capacity
  ✓ Connection wait time 10x baseline
  ✓ Request rate 3x normal
  ✓ Traffic increase correlates with marketing campaign
  ✓ No recent deployments
  ✓ Payment service healthy

Contributing Factors:
  • Connection pool not auto-scaling with traffic
  • No PgBouncer connection pooler in use
  • Marketing team didn't notify engineering of campaign

Related Knowledge Applied:
  • Runbook: "Database Connection Exhaustion" (followed steps 1-4)
  • Post-mortem: "2024-01-15 Checkout Outage" (similar pattern)
═══════════════════════════════════════════════════════════════
```

### Phase 6: Remediate

```
Phase 6: Remediate
──────────────────

Suggested Remediation:

Immediate Actions:

  [1] Scale RDS read replicas
      Risk: HIGH
      Impact: Reduce connection pressure by 50%
      Skill: scale-service

      ╔═══════════════════════════════════════════════════════╗
      ║                  APPROVAL REQUIRED                     ║
      ╠═══════════════════════════════════════════════════════╣
      ║  Operation: Add 2 RDS read replicas                    ║
      ║  Current: 2 replicas                                   ║
      ║  Target: 4 replicas                                    ║
      ║                                                        ║
      ║  Rollback:                                             ║
      ║  aws rds modify-db-cluster \                          ║
      ║    --db-cluster-id prod-checkout-db \                 ║
      ║    --scaling-configuration MinCapacity=2              ║
      ╚═══════════════════════════════════════════════════════╝

      [Waiting for Slack approval...]
      ✓ Approved by @alice (15:05 UTC)

      → Executing scale operation...
      ✓ Scale initiated (1.2s)
      → Waiting for replicas...
      ✓ Replicas available (4m 32s)

  [2] Restart checkout-api tasks
      Risk: MEDIUM
      Impact: Clear stale connections
      Skill: restart-service

      [Approval received via Slack]

      → Restarting tasks...
      ✓ 4/4 tasks restarted (2m 15s)

Long-term Recommendations:
  • Implement PgBouncer for connection pooling
  • Add auto-scaling for RDS read replicas
  • Create marketing → engineering notification process
  • Add traffic forecasting for campaigns

═══════════════════════════════════════════════════════════════
                    INVESTIGATION COMPLETE
═══════════════════════════════════════════════════════════════

Duration: 8 minutes 34 seconds
Actions Taken: 2 (with approval)
Status: Resolved

Post-incident:
  • Notes added to PagerDuty incident
  • Investigation logged to scratchpad
  • Recommendations documented

Would you like to generate a post-mortem? [y/N]
```

## Key Takeaways

1. **Knowledge integration** - The runbook and post-mortem matches significantly improved hypothesis formation
2. **Systematic testing** - Each hypothesis was tested with specific queries
3. **Evidence-based pruning** - Hypotheses without evidence were quickly eliminated
4. **Approved remediation** - Actions required explicit approval before execution
5. **Full audit trail** - Every step was logged for review
