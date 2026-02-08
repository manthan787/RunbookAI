---
title: Document Types
description: Knowledge document types and their schemas
---

Runbook supports multiple document types, each with specific schemas and use cases.

## Runbook

Operational procedures for common scenarios.

```markdown
---
type: runbook
title: Database Connection Exhaustion
services: [checkout-api, payment-service]
symptoms:
  - "Connection timeout errors"
  - "Pool exhausted warnings"
severity: sev2
tags: [database, postgresql, connections]
author: platform-team
lastValidated: 2024-01-15
---

# Database Connection Exhaustion

## Problem Description
Database connection pool becomes exhausted, causing timeouts.

## Diagnosis Steps
1. Check RDS connection count: `aws rds describe-db-instances`
2. Review connection wait metrics in CloudWatch
3. Check for long-running queries

## Resolution
1. Scale read replicas if traffic-related
2. Restart application pods to clear stale connections
3. Enable PgBouncer for connection pooling

## Rollback
Reverse scaling: `aws rds modify-db-cluster --replicas 2`
```

## Post-mortem

Incident reviews with root cause analysis.

```markdown
---
type: postmortem
title: "2024-01-15 Checkout Outage"
incidentId: PD-12345
severity: sev2
duration: 45m
services: [checkout-api]
rootCause: Database connection exhaustion
author: on-call-team
date: 2024-01-16
---

# 2024-01-15 Checkout Outage

## Summary
45-minute outage affecting checkout functionality due to database connection exhaustion.

## Timeline
- 14:32 - Marketing campaign email sent
- 14:45 - Traffic increased 3x
- 14:52 - First connection timeouts
- 15:00 - Alert triggered
- 15:15 - Root cause identified
- 15:30 - Read replicas scaled
- 15:45 - Full recovery

## Root Cause
Traffic spike from marketing campaign exhausted database connection pool.

## Action Items
- [ ] Implement PgBouncer
- [ ] Add traffic forecasting
- [ ] Create marketing-engineering notification process
```

## Architecture

System design and dependencies.

```markdown
---
type: architecture
title: Checkout API Service
services: [checkout-api]
dependencies:
  - postgresql
  - redis
  - payment-service
lastUpdated: 2024-01-10
---

# Checkout API Architecture

## Overview
Handles checkout flow for e-commerce platform.

## Dependencies
- **PostgreSQL**: Primary database via PgBouncer
- **Redis**: Session and cart caching
- **payment-service**: Payment processing

## Scaling
- ECS Fargate with auto-scaling
- Min: 4 tasks, Max: 20 tasks
- Scale trigger: CPU > 70%

## Endpoints
- POST /api/checkout - Create order
- GET /api/checkout/:id - Order status
```

## Known Issue

Documented bugs with workarounds.

```markdown
---
type: known_issue
title: Redis Connection Pool Bug
services: [api-gateway]
status: open
workaround: true
jiraTicket: PLAT-1234
---

# Redis Connection Pool Bug

## Issue
Redis client leaks connections under high load.

## Symptoms
- Connection count grows over time
- Eventually hits Redis max connections
- Service becomes unresponsive

## Workaround
Restart api-gateway pods daily via cron job:
```bash
kubectl rollout restart deployment/api-gateway -n prod
```

## Fix
Upgrade redis-client to v4.2.0 (scheduled for next sprint)
```

## Ownership

Service ownership and contacts.

```markdown
---
type: ownership
service: checkout-api
team: platform-team
slack: "#platform-team"
oncall: platform-oncall
escalation: platform-leads
---

# checkout-api Ownership

## Team
Platform Team

## Contacts
- Slack: #platform-team
- On-call: platform-oncall (PagerDuty)
- Escalation: platform-leads

## Responsibilities
- Checkout flow
- Order creation
- Cart management
```

## Environment

Environment-specific configurations.

```markdown
---
type: environment
name: production
region: us-east-1
cluster: prod-east
---

# Production Environment

## AWS
- Region: us-east-1
- Account: 123456789012
- VPC: vpc-prod

## Kubernetes
- Cluster: prod-east-1
- Namespace: prod

## Databases
- PostgreSQL: prod-db.cluster-xxx.us-east-1.rds.amazonaws.com
- Redis: prod-cache.xxx.cache.amazonaws.com
```

## Playbook

Step-by-step workflows.

```markdown
---
type: playbook
title: Production Deployment Checklist
services: [all]
---

# Production Deployment Checklist

## Pre-deployment
- [ ] All tests passing
- [ ] Change reviewed and approved
- [ ] Staging deployment successful
- [ ] No active incidents

## Deployment
- [ ] Deploy to canary (10%)
- [ ] Monitor for 10 minutes
- [ ] Full rollout (100%)
- [ ] Verify all pods healthy

## Post-deployment
- [ ] Monitor error rates for 30 minutes
- [ ] Update deployment log
- [ ] Notify team in Slack
```

## FAQ

Common questions and answers.

```markdown
---
type: faq
services: [all]
---

# Frequently Asked Questions

## How do I access production logs?

Use CloudWatch Logs:
```bash
aws logs filter-log-events \
  --log-group-name /ecs/production \
  --filter-pattern "ERROR"
```

## How do I restart a service?

Force new deployment:
```bash
aws ecs update-service \
  --cluster prod \
  --service checkout-api \
  --force-new-deployment
```
```

## Schema Reference

All documents support these common fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Document type |
| `title` | string | Yes | Document title |
| `services` | string[] | No | Related services |
| `tags` | string[] | No | Search tags |
| `author` | string | No | Author or team |
| `lastValidated` | date | No | Last review date |

## Next Steps

- [Sources](/RunbookAI/knowledge/sources/) - Configure where to find documents
- [Writing Runbooks](/RunbookAI/knowledge/writing-runbooks/) - Best practices
