---
title: Built-in Skills
description: Skills included with Runbook
---

Runbook includes 8 built-in skills for common operational tasks.

## investigate-incident

Hypothesis-driven incident investigation.

```yaml
id: investigate-incident
parameters:
  - incident_id: string (required)
  - time_window: string (optional, default: "1h")
riskLevel: low
```

### Usage

```bash
runbook investigate PD-12345
```

### What It Does

1. Fetch incident details from PagerDuty/OpsGenie
2. Search knowledge base for similar incidents
3. Form 3-5 hypotheses
4. Test each hypothesis with targeted queries
5. Branch on strong evidence, prune on none
6. Conclude with root cause and confidence
7. Suggest remediation

## deploy-service

Deploy a service with safety checks.

```yaml
id: deploy-service
parameters:
  - service_type: string (ecs, kubernetes, lambda)
  - service_name: string (required)
  - image: string (required)
  - canary_percent: integer (default: 10)
  - cluster: string (optional)
riskLevel: high
```

### Usage

```bash
runbook deploy checkout-api --version 1.2.3
```

### Steps

1. **Pre-checks**: Verify service exists, image available, no incidents
2. **Canary**: Deploy to 10% of traffic
3. **Observe**: Monitor errors and latency for 60s
4. **Approval**: Request approval for full rollout
5. **Rollout**: Deploy to 100%
6. **Verify**: Check all replicas healthy

## scale-service

Scale compute resources up or down.

```yaml
id: scale-service
parameters:
  - service_name: string (required)
  - target_count: integer (required)
  - cluster: string (required)
  - service_type: string (ecs, kubernetes)
riskLevel: high
```

### Usage

```bash
runbook ask "Scale checkout-api to 8 replicas"
```

### Steps

1. Check current replica count
2. Validate target (> 0, reasonable limit)
3. Request approval if scaling down
4. Execute scale operation
5. Wait for stability
6. Verify health

## rollback-deployment

Roll back to a previous version.

```yaml
id: rollback-deployment
parameters:
  - service_name: string (required)
  - target_version: string (optional, default: previous)
  - cluster: string (optional)
riskLevel: high
```

### Usage

```bash
runbook ask "Rollback checkout-api to the previous version"
```

### Steps

1. Identify current version
2. Find previous stable version
3. Request approval
4. Execute rollback
5. Wait for stability
6. Verify health

## troubleshoot-service

Run diagnostics on a service.

```yaml
id: troubleshoot-service
parameters:
  - service_name: string (required)
  - service_type: string (ecs, kubernetes, lambda)
riskLevel: medium
```

### Usage

```bash
runbook ask "Troubleshoot the payment-service"
```

### Checks

1. Service health and status
2. Recent deployments
3. Resource utilization (CPU, memory)
4. Error rates and logs
5. Dependency health
6. Recent configuration changes

## cost-analysis

Analyze infrastructure costs.

```yaml
id: cost-analysis
parameters:
  - service_name: string (optional)
  - time_period: string (default: "30d")
riskLevel: low
```

### Usage

```bash
runbook ask "Analyze costs for checkout-api"
runbook ask "What are our top 5 most expensive services?"
```

### Output

- Cost breakdown by service
- Comparison to previous period
- Anomaly detection
- Optimization recommendations

## investigate-cost-spike

Root cause analysis for cost anomalies.

```yaml
id: investigate-cost-spike
parameters:
  - threshold_dollars: number (optional)
  - time_period: string (default: "7d")
riskLevel: medium
```

### Usage

```bash
runbook ask "Why did our AWS bill spike last week?"
```

### Analysis

1. Identify cost anomalies
2. Break down by service/resource
3. Correlate with events (deployments, scaling)
4. Find root cause
5. Suggest remediation

## security-audit

Run security checks on infrastructure.

```yaml
id: security-audit
parameters:
  - resource_type: string (ec2, rds, s3, iam)
  - scope: string (all, production, specific-service)
riskLevel: medium
```

### Usage

```bash
runbook ask "Run a security audit on production S3 buckets"
```

### Checks

- Public access settings
- Encryption at rest
- IAM policies
- Security group rules
- Compliance with best practices

## Skill Summary

| Skill | Risk | Approval | Purpose |
|-------|------|----------|---------|
| investigate-incident | low | No | Root cause analysis |
| deploy-service | high | Yes | Deploy new versions |
| scale-service | high | Yes (down) | Adjust capacity |
| rollback-deployment | high | Yes | Revert changes |
| troubleshoot-service | medium | No | Diagnostics |
| cost-analysis | low | No | Cost visibility |
| investigate-cost-spike | medium | No | Cost anomalies |
| security-audit | medium | No | Security checks |

## Disabling Built-ins

To disable built-in skills:

```yaml
skills:
  builtinEnabled: false
```

Or disable specific skills:

```yaml
skills:
  builtinEnabled: true
  disabled:
    - cost-analysis
    - security-audit
```

## Next Steps

- [Custom Skills](/RunbookAI/skills/custom/) - Create your own
- [Execution Model](/RunbookAI/skills/execution/) - How skills run
