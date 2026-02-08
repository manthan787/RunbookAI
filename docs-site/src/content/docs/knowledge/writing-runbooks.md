---
title: Writing Runbooks
description: Best practices for creating effective runbooks
---

Well-written runbooks are essential for Runbook to provide effective assistance. This guide covers best practices for creating runbooks that work well with AI-assisted investigations.

## Runbook Structure

### Essential Sections

```markdown
---
type: runbook
title: Clear, Descriptive Title
services: [service-names]
symptoms:
  - "Symptom 1"
  - "Symptom 2"
severity: sev2
tags: [relevant, tags]
author: team-name
lastValidated: 2024-01-15
---

# Title

## Problem Description
Brief explanation of what this runbook addresses.

## Symptoms
How to recognize this issue.

## Diagnosis Steps
Step-by-step investigation process.

## Resolution
How to fix the issue.

## Rollback
How to undo changes if needed.

## Prevention
Long-term fixes to prevent recurrence.
```

## Frontmatter Best Practices

### Title

Be specific and searchable:

```yaml
# Good
title: "Database Connection Pool Exhaustion"
title: "High Memory Usage in API Gateway"
title: "SSL Certificate Expiration"

# Avoid
title: "DB Issues"
title: "Troubleshooting"
title: "Problem Fix"
```

### Services

List all affected services:

```yaml
# Include primary and related services
services:
  - checkout-api      # Primary
  - payment-service   # Dependency
  - postgresql        # Infrastructure
```

### Symptoms

Use exact error messages and observable metrics:

```yaml
symptoms:
  - "Connection timeout after 30000ms"
  - "Unable to acquire connection from pool"
  - "RDS connections > 90% capacity"
  - "p99 latency > 2 seconds"
```

### Tags

Use consistent, searchable tags:

```yaml
tags:
  - database
  - postgresql
  - connections
  - performance
  - sev2
```

## Writing Effective Content

### Problem Description

Explain the issue clearly:

```markdown
## Problem Description

The database connection pool becomes exhausted when request volume
exceeds the configured pool size, or when connections are held too
long by slow queries. This causes new requests to time out waiting
for available connections.

**Impact**: Checkout failures, user-facing errors, potential revenue loss
**Typical Duration**: 15-45 minutes if not addressed
**Frequency**: 2-3 times per quarter, usually during traffic spikes
```

### Diagnosis Steps

Make steps actionable and specific:

```markdown
## Diagnosis Steps

### 1. Check Current Connection Count

```bash
aws rds describe-db-instances \
  --db-instance-identifier prod-db \
  --query 'DBInstances[0].DBInstanceStatus'
```

**Expected**: `available`
**If not**: Database may be in maintenance or failed state

### 2. Check Connection Metrics

```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name DatabaseConnections \
  --dimensions Name=DBInstanceIdentifier,Value=prod-db \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Maximum
```

**Healthy**: < 80% of max connections
**Warning**: 80-90%
**Critical**: > 90%

### 3. Identify Long-Running Queries

Connect to database and run:
```sql
SELECT pid, now() - pg_stat_activity.query_start AS duration, query
FROM pg_stat_activity
WHERE state = 'active'
ORDER BY duration DESC
LIMIT 10;
```

**Action**: Queries running > 30 seconds should be investigated
```

### Resolution Steps

Include exact commands with explanations:

```markdown
## Resolution

### Option 1: Scale Read Replicas (Traffic-Related)

If connection exhaustion is due to traffic spike:

```bash
aws rds modify-db-cluster \
  --db-cluster-identifier prod-db \
  --scaling-configuration MinCapacity=2,MaxCapacity=8 \
  --apply-immediately
```

**Wait time**: 5-10 minutes for new replicas

### Option 2: Restart Application Pods (Connection Leak)

If connections are stale or leaked:

```bash
kubectl rollout restart deployment/checkout-api -n prod
```

**Impact**: Brief increase in latency during restart
**Duration**: 2-3 minutes

### Option 3: Kill Long-Running Queries

If specific queries are holding connections:

```sql
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE duration > interval '5 minutes'
  AND state = 'active'
  AND query NOT LIKE '%pg_stat_activity%';
```

**Caution**: May cause transaction rollbacks
```

### Rollback Procedures

Always include rollback:

```markdown
## Rollback

### Revert Replica Scaling
```bash
aws rds modify-db-cluster \
  --db-cluster-identifier prod-db \
  --scaling-configuration MinCapacity=2,MaxCapacity=4
```

### Revert Pod Restart
Pods will recover automatically on failure. If issues persist:
```bash
kubectl rollout undo deployment/checkout-api -n prod
```
```

## Machine-Readable Patterns

Help Runbook match symptoms automatically:

```markdown
## Symptoms

### Error Messages (Exact Match)
- `PSQLException: Cannot acquire connection from pool`
- `TimeoutException: Connection wait timeout`
- `Error: pool exhausted, max connections reached`

### Metrics Thresholds
- RDS DatabaseConnections > 90 (of 100 max)
- Application connection_wait_time_p99 > 5000ms
- ECS task health check failures > 3

### Log Patterns
```regex
Connection pool exhausted.*waiting for available connection
Unable to acquire connection within \d+ ms
Max connections \(\d+\) reached
```
```

## Cross-Referencing

Link related documents:

```markdown
## Related Documents

- **Runbook**: [Connection Pool Tuning](./connection-pool-tuning.md)
- **Architecture**: [Database Architecture](../architecture/database.md)
- **Post-mortem**: [2024-01-15 Checkout Outage](../postmortems/2024-01-15.md)

## See Also

- AWS RDS Documentation: [Connection Management](https://docs.aws.amazon.com/...)
- PgBouncer: [Configuration Guide](https://www.pgbouncer.org/config.html)
```

## Validation Checklist

Before publishing a runbook:

- [ ] Title is specific and searchable
- [ ] Services list is complete
- [ ] Symptoms include exact error messages
- [ ] Diagnosis steps are numbered and actionable
- [ ] Commands are copy-paste ready
- [ ] Expected outputs are documented
- [ ] Resolution options cover common cases
- [ ] Rollback procedures are included
- [ ] Related documents are linked
- [ ] lastValidated date is recent

## Example: Complete Runbook

See the [example runbook](https://github.com/manthanthakar/RunbookAI/blob/main/examples/runbooks/redis-connection-exhaustion.md) in the repository for a full example.

## Next Steps

- [Document Types](/RunbookAI/knowledge/document-types/) - Other document types
- [Search & Retrieval](/RunbookAI/knowledge/search/) - How documents are found
