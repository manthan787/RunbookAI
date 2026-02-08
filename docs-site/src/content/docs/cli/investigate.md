---
title: investigate
description: Investigate incidents using hypothesis-driven analysis
---

The `investigate` command performs a thorough, hypothesis-driven investigation of incidents. It forms theories about what might be wrong, tests them systematically, and provides a root cause analysis with confidence levels.

## Usage

```bash
runbook investigate <incident-id> [options]
```

The incident ID can be:
- PagerDuty incident: `PD-12345` or full ID
- OpsGenie alert: `OG-abcdef` or full ID
- Custom identifier if using other systems

## Examples

### Basic Investigation

```bash
# Investigate a PagerDuty incident
runbook investigate PD-12345

# Investigate an OpsGenie alert
runbook investigate OG-98765

# Verbose mode for detailed output
runbook investigate PD-12345 --verbose
```

## Investigation Output

A typical investigation looks like:

```
$ runbook investigate PD-12345

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

Affected Services:
  • checkout-api (primary)
  • payment-service (dependency)
  • PostgreSQL database (infrastructure)

→ Searching knowledge base...
✓ search_knowledge (189ms)

Relevant Knowledge:
  • Runbook: "Database Connection Exhaustion" (85% match)
  • Post-mortem: "2024-01-15 Checkout Outage" (72% match)

Phase 2: Hypothesize
────────────────────
Forming hypotheses based on evidence...

  H1: Database connection exhaustion [P: 0.45]
      Symptom match with "Database Connection Exhaustion" runbook

  H2: Recent deployment introduced bug [P: 0.25]
      checkout-api deployed 2 hours ago

  H3: Payment service degradation [P: 0.15]
      Downstream dependency could cause cascading failure

  H4: Traffic spike overwhelming capacity [P: 0.15]
      SEV2 incidents often correlate with traffic

Phase 3: Investigate
────────────────────
Testing H1: Database connection exhaustion...
→ aws_query (RDS metrics)
✓ 234ms

  Evidence: STRONG
  • Active connections: 95/100 (95% capacity)
  • Connection wait time: 2.3s (10x baseline)
  • CPU: 45% (normal)

  ↳ Branching to investigate root cause...

Testing H1.1: Traffic spike caused exhaustion...
→ aws_query (CloudWatch request metrics)
✓ 178ms

  Evidence: STRONG
  • Request rate: 3x normal baseline
  • Traffic source: Organic (not attack)
  • Started: 14:32 UTC (28 minutes ago)

Testing H2: Recent deployment bug...
→ aws_query (ECS deployment history)
✓ 145ms

  Evidence: NONE
  • Last deployment: 6 hours ago
  • No correlation with error timeline
  ✗ Pruning H2

Testing H3: Payment service degradation...
→ aws_query (ECS service health)
✓ 156ms

  Evidence: NONE
  • Payment service healthy
  • Error rate: 0.1% (normal)
  ✗ Pruning H3

Phase 4: Evaluate
─────────────────
Hypothesis Confidence:
  H1: Database connection exhaustion   [0.92] ████████████████████ HIGH
    H1.1: Traffic spike as root cause  [0.88] ██████████████████   HIGH
  H2: Deployment bug                   [PRUNED]
  H3: Payment service issue            [PRUNED]
  H4: Traffic spike                    [MERGED → H1.1]

Phase 5: Conclude
─────────────────
═══════════════════════════════════════════════════════════════
                    ROOT CAUSE IDENTIFIED
═══════════════════════════════════════════════════════════════

Root Cause: Database connection exhaustion due to traffic spike
Confidence: HIGH (0.92)

Timeline:
  14:32 UTC │ Traffic began increasing (marketing campaign)
  14:45 UTC │ Connection pool reached 80% capacity
  14:48 UTC │ Connection wait times started increasing
  14:52 UTC │ First timeout errors in checkout-api
  14:55 UTC │ Error rate exceeded 5% threshold
  15:00 UTC │ PagerDuty alert triggered

Contributing Factors:
  • Connection pool not auto-scaling
  • No PgBouncer connection pooler
  • Marketing team didn't notify of campaign

Phase 6: Remediate
──────────────────
Suggested Actions:

  [1] IMMEDIATE - Scale RDS read replicas
      Risk: HIGH
      Impact: Reduce connection pressure by 50%
      Command: aws rds modify-db-cluster --replicas 4
      Rollback: aws rds modify-db-cluster --replicas 2

  [2] IMMEDIATE - Restart checkout-api tasks
      Risk: MEDIUM
      Impact: Clear stuck connections
      Command: aws ecs update-service --force-new-deployment
      Rollback: (automatic on failure)

  [3] LONG-TERM - Implement connection pooler
      Impact: 10x connection efficiency
      See: runbook/database-pooling.md

Proceed with immediate actions? [y/N]
```

## Options

| Option | Description |
|--------|-------------|
| `--verbose, -v` | Show detailed execution |
| `--json` | Output results as JSON |
| `--no-remediate` | Skip remediation phase |
| `--max-depth <n>` | Max hypothesis depth (default: 4) |
| `--timeout <ms>` | Investigation timeout (default: 600000) |

## Investigation Modes

### Full Investigation (default)

Complete hypothesis-driven investigation with all phases:

```bash
runbook investigate PD-12345
```

### Quick Triage

Skip hypothesis formation, just gather context:

```bash
runbook investigate PD-12345 --triage-only
```

Output:
```
Incident: High Error Rate - checkout-api
Severity: SEV2
Duration: 15 minutes

Affected Services:
  • checkout-api
  • payment-service

Current State:
  • ECS: 4/4 tasks running, 2 unhealthy
  • RDS: 95% connection utilization
  • Error rate: 5.2%

Relevant Knowledge:
  • Runbook: "Database Connection Exhaustion"

For full investigation: runbook investigate PD-12345
```

### Skip Remediation

Investigate but don't suggest remediation:

```bash
runbook investigate PD-12345 --no-remediate
```

## Custom Incident Sources

If not using PagerDuty or OpsGenie, you can provide incident details inline:

```bash
runbook investigate --description "High error rate on checkout-api" \
  --service checkout-api \
  --severity sev2 \
  --start-time "2024-01-15T15:00:00Z"
```

## Investigation History

View past investigations:

```bash
# List recent investigations
runbook investigate --history

# View specific investigation
runbook investigate --show session-abc123

# Resume investigation
runbook investigate --resume session-abc123
```

## Integration with Incident Management

### Auto-Update Incidents

Runbook can update the incident with findings:

```yaml
# In config.yaml
incident:
  pagerduty:
    autoUpdate: true
    addNotes: true
    resolveOnFix: false
```

When enabled:
- Investigation findings are added as incident notes
- Timeline is synchronized
- Remediation actions are logged

### Slack Notifications

Send investigation updates to Slack:

```yaml
incident:
  slack:
    enabled: true
    investigationChannel: "#incidents"
```

## Best Practices

1. **Start early** - Investigate as soon as you're paged
2. **Don't skip hypotheses** - Even unlikely causes should be tested
3. **Trust the confidence** - Don't override when confidence is high
4. **Document learnings** - Add post-mortems to knowledge base

## Troubleshooting

### "Incident not found"

```
Error: Incident PD-12345 not found

Possible causes:
1. Incident ID is incorrect
2. PagerDuty API key doesn't have access
3. Incident has been deleted

Try: runbook investigate PD-12345 --verbose
```

### "Investigation timed out"

```
Error: Investigation timed out after 10 minutes

The investigation was too complex or tools took too long.
Partial results are saved to: .runbook/scratchpad/session-abc.jsonl

To resume: runbook investigate --resume session-abc
```

## Next Steps

- [chat](/RunbookAI/cli/chat/) - For interactive investigations
- [Hypothesis System](/RunbookAI/concepts/hypothesis/) - Understanding the methodology
