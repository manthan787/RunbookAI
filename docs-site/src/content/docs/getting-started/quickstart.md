---
title: Quick Start
description: Get up and running with Runbook in minutes
---

This guide will have you investigating incidents and querying infrastructure in under 5 minutes.

## Your First Query

Ask Runbook about your infrastructure using natural language:

```bash
runbook ask "What EC2 instances are running in production?"
```

You'll see real-time progress as Runbook:
1. Interprets your query
2. Calls the appropriate AWS APIs
3. Formats the results

```
→ Querying AWS for EC2 instances...
✓ aws_query (312ms)

Found 12 running EC2 instances in production:

| Instance ID         | Type      | State   | Name              |
|---------------------|-----------|---------|-------------------|
| i-0abc123def456789  | t3.medium | running | prod-api-1        |
| i-0def789abc012345  | t3.large  | running | prod-api-2        |
| i-0123456789abcdef  | r5.xlarge | running | prod-cache-1      |
...
```

## Multi-Resource Queries

Query across multiple resource types in a single command:

```bash
runbook ask "Show me cluster status, top pods by CPU, and any warning events"
```

Runbook automatically parallelizes queries:

```
→ Querying Kubernetes cluster status...
✓ kubernetes_query:status (145ms)
✓ kubernetes_query:top_pods (167ms)
✓ kubernetes_query:events (134ms)

Cluster: production-east
Status: Healthy
Nodes: 8/8 Ready

Top Pods by CPU:
| Pod                    | Namespace | CPU    | Memory |
|------------------------|-----------|--------|--------|
| api-gateway-7d9f8b6c5  | prod      | 450m   | 512Mi  |
| worker-processor-abc12 | jobs      | 380m   | 1.2Gi  |
...

Recent Warning Events:
- BackOff: Pod checkout-api-xyz restarting (5m ago)
- FailedScheduling: Insufficient memory (12m ago)
```

## Investigate an Incident

When you receive an incident, investigate it with hypothesis-driven analysis:

```bash
runbook investigate PD-12345
```

Runbook performs a systematic investigation:

```
→ Gathering incident context from PagerDuty...
✓ pagerduty_get_incident (245ms)

Incident: High Error Rate - checkout-api
Severity: SEV2
Duration: 15 minutes
Affected: checkout-api, payment-service

→ Searching knowledge base for similar incidents...
✓ search_knowledge (189ms)

Found relevant runbook: "Database Connection Exhaustion"
Found similar post-mortem: "2024-01-15 Checkout Outage"

→ Forming hypotheses...

Hypotheses:
  H1: Database connection exhaustion (traffic spike)
  H2: Recent deployment introduced connection leak
  H3: Downstream payment-service degradation
  H4: Cache invalidation storm

→ Testing H1: Database connection exhaustion...
✓ aws_query (RDS metrics) (234ms)

Evidence for H1: STRONG
- Active connections: 95/100 (95% utilization)
- Connection wait time: 2.3s (10x baseline)
- Request rate: 3x normal

→ Testing H3: Payment service...
✓ aws_query (ECS service) (156ms)

Evidence for H3: NONE
- Payment service healthy
- Error rate: 0.1% (normal)

Pruning H3 and H4 (no supporting evidence)

→ Deepening investigation on H1...
✓ aws_query (traffic patterns) (178ms)
✓ aws_query (deployment history) (145ms)

═══════════════════════════════════════════════════════
ROOT CAUSE IDENTIFIED

Cause: Database connection exhaustion due to traffic spike
Confidence: HIGH (0.92)

Timeline:
- 14:32 UTC: Traffic began increasing (marketing campaign)
- 14:45 UTC: Connection pool reached 80% capacity
- 14:52 UTC: Timeouts began occurring
- 15:00 UTC: Alert triggered

Suggested Remediation:
1. Scale RDS read replicas (requires approval)
2. Enable connection pooler (PgBouncer)
3. Notify marketing team about capacity

Related Knowledge:
- Runbook: "Database Connection Exhaustion" (90% match)
- Post-mortem: "2024-01-15 Checkout Outage" (similar pattern)
═══════════════════════════════════════════════════════
```

## Interactive Chat

For complex investigations, use interactive chat mode:

```bash
runbook chat
```

This opens a multi-turn conversation where you can:
- Ask follow-up questions
- Drill down into specific areas
- Request remediation actions

```
runbook> What's the current state of the checkout API?

→ Querying ECS service status...
The checkout-api service is degraded:
- Desired: 4 tasks, Running: 4
- Health: 2 healthy, 2 unhealthy
- Recent restarts: 3 in last 10 minutes

runbook> Show me the logs from the unhealthy containers

→ Fetching CloudWatch logs...
[14:52:03] ERROR: Connection timeout after 30000ms
[14:52:04] ERROR: Unable to acquire connection from pool
[14:52:05] WARN: Retry attempt 1/3 failed
...

runbook> Scale up the RDS cluster

This action requires approval:
[APPROVAL REQUIRED]
Operation: Modify RDS cluster - add 2 read replicas
Risk Level: HIGH
Estimated Time: 5-10 minutes
Rollback: aws rds modify-db-cluster --db-cluster-id prod-db --replicas 2

Approve? [y/N]
```

## Deploy a Service

Use built-in skills for common operations:

```bash
runbook deploy checkout-api --environment production --version 1.2.3
```

Runbook executes the deployment workflow:

```
Deploying checkout-api v1.2.3 to production...

Step 1/5: Pre-deployment checks
✓ Current version: 1.2.2 (healthy)
✓ Target image exists: registry/checkout-api:1.2.3
✓ No active incidents

Step 2/5: Canary deployment (10%)
→ Updating task definition...
→ Deploying canary...
✓ Canary healthy after 60s observation

Step 3/5: Request approval
[APPROVAL REQUIRED]
Operation: Deploy checkout-api v1.2.3 to 100%
Risk: HIGH
Rollback: runbook deploy checkout-api --version 1.2.2

[Approved via Slack by @oncall-engineer]

Step 4/5: Full rollout
→ Updating service to 100%...
→ Waiting for stability...
✓ All tasks healthy

Step 5/5: Post-deployment validation
✓ Error rate: 0.02% (within threshold)
✓ Latency p99: 145ms (within threshold)

Deployment successful!
```

## Next Steps

Now that you've seen Runbook in action:

- [Configuration](/RunbookAI/getting-started/configuration/) - Customize for your environment
- [Core Concepts](/RunbookAI/concepts/architecture/) - Understand the architecture
- [CLI Reference](/RunbookAI/cli/overview/) - Explore all commands
