---
title: Introduction
description: Learn what Runbook is and how it can transform your incident response workflow
---

Runbook is an **AI-powered SRE assistant** that investigates incidents, executes operational workflows, and manages cloud infrastructure using a research-first, hypothesis-driven methodology. Think of it as a 24/7 on-call engineer that:

- Gathers context before acting
- Forms testable hypotheses about issues
- Executes targeted queries to validate theories
- Provides full audit trails for every decision
- Integrates with your existing operational knowledge

## Why Runbook?

Traditional incident response relies on human intuition and tribal knowledge. When an alert fires at 3 AM, your on-call engineer must:

1. Wake up and gain context
2. Remember (or find) the relevant runbooks
3. Form theories about what's wrong
4. Query multiple systems to validate
5. Take action while documenting everything

**Runbook automates this entire process** while keeping humans in the loop for critical decisions.

## Key Features

### Hypothesis-Driven Investigation

Unlike simple automation that follows rigid playbooks, Runbook forms multiple hypotheses about what might be wrong and tests them systematically. It branches on strong evidence and prunes dead ends, just like an experienced SRE would.

```bash
$ runbook investigate PD-12345
Forming hypotheses...
  H1: Database connection exhaustion (traffic spike)
  H2: Recent deployment caused connection leak
  H3: Parameter group misconfiguration
Testing H1: Traffic spike hypothesis...
Evidence: STRONG - Request rate 3x normal
ROOT CAUSE: Database connection exhaustion due to traffic spike
Confidence: HIGH
```

### Knowledge Integration

Runbook indexes your organizational knowledge—runbooks, post-mortems, architecture docs—and retrieves relevant information during investigations. When it encounters a familiar pattern, it already knows the solution.

### Multi-Provider Support

First-class integrations with:

| Category | Providers |
|----------|-----------|
| Cloud | AWS (40+ services), Kubernetes |
| Incidents | PagerDuty, OpsGenie |
| Observability | Datadog, Prometheus, CloudWatch |
| Communication | Slack |

### Safety-First Approvals

All mutations require explicit approval. Runbook shows you exactly what it wants to do, the risk level, and the rollback command before taking action.

```
[APPROVAL REQUIRED]
Operation: Scale RDS cluster from 2 to 4 replicas
Risk Level: HIGH
Rollback: aws rds modify-db-cluster --db-cluster-id prod-db --replicas 2

[Approve] [Deny]
```

### Full Audit Trail

Every tool call, hypothesis, and decision is logged to a JSONL scratchpad. You always know exactly what Runbook did and why.

## How It Works

```
Incident Alert
    ↓
[Knowledge Retrieval] Search runbooks, post-mortems
    ↓
[Hypothesis Formation] Generate 3-5 testable theories
    ↓
[Investigation Loop]
    ├─ Execute targeted queries
    ├─ Evaluate evidence strength
    └─ Branch or prune hypotheses
    ↓
[Conclusion] Root cause + confidence level
    ↓
[Remediation] Execute approved actions
    ↓
[Audit Trail] Full log of all decisions
```

## Next Steps

Ready to get started? Head to the [Installation](/RunbookAI/getting-started/installation/) guide to set up Runbook in your environment.
