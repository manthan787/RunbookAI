---
title: PagerDuty Integration
description: Configure PagerDuty for incident management
---

Runbook integrates with PagerDuty to fetch incident details, add notes, and correlate alerts with infrastructure data.

## Configuration

```yaml
# .runbook/config.yaml
incident:
  pagerduty:
    enabled: true
    apiKey: ${PAGERDUTY_API_KEY}
    serviceIds:  # Optional: filter to specific services
      - PXXXXXX
      - PYYYYYY
```

## API Key Setup

1. Go to PagerDuty → Integrations → API Access Keys
2. Create a new API key with read/write access
3. Set as environment variable: `export PAGERDUTY_API_KEY=your-key`

## Available Tools

### pagerduty_get_incident

Fetch details about a specific incident:

```bash
runbook ask "Get details for incident PD-12345"
```

Returns:
- Incident title and description
- Severity and status
- Created/acknowledged/resolved times
- Assigned users
- Related alerts

### pagerduty_list_incidents

List recent incidents:

```bash
runbook ask "Show active PagerDuty incidents"
runbook ask "What incidents occurred this week?"
```

Options:
- Status filter: triggered, acknowledged, resolved
- Time range: last hour, last day, etc.
- Service filter: specific services only

### pagerduty_add_note

Add investigation notes to an incident:

```bash
runbook ask "Add note to PD-12345: Root cause identified as database connection exhaustion"
```

### pagerduty_get_alerts

Get alerts associated with an incident:

```bash
runbook ask "Show alerts for PD-12345"
```

## Investigation Flow

When investigating a PagerDuty incident:

```bash
runbook investigate PD-12345
```

Runbook automatically:

1. Fetches incident details via API
2. Extracts affected services
3. Retrieves related alerts
4. Searches knowledge base for similar incidents
5. Begins hypothesis-driven investigation

## Auto-Update Incidents

Enable automatic incident updates:

```yaml
incident:
  pagerduty:
    autoUpdate: true      # Add notes during investigation
    addNotes: true        # Add investigation findings as notes
    resolveOnFix: false   # Don't auto-resolve (manual confirmation)
```

With auto-update enabled, Runbook adds notes like:

```
[Runbook Investigation]
Root cause identified: Database connection exhaustion
Confidence: HIGH (0.92)
Remediation: Scale RDS read replicas (pending approval)
```

## Service Mapping

Map PagerDuty services to your infrastructure:

```yaml
services:
  checkout-api:
    pagerduty:
      serviceId: PXXXXXX
    aws:
      ecs:
        cluster: prod
        service: checkout-api
```

This enables:
- Automatic service identification from incidents
- Direct correlation with infrastructure
- Smarter hypothesis formation

## Example Queries

```bash
# Current incidents
runbook ask "Are there any active incidents?"

# Incident history
runbook ask "Show resolved incidents from this week"

# Service-specific
runbook ask "Any incidents affecting checkout-api?"

# Severity filter
runbook ask "Show all SEV1 incidents from the last month"
```

## Troubleshooting

### "Invalid API key"

```
Error: Invalid PagerDuty API key

1. Verify key at PagerDuty → Integrations → API Access Keys
2. Check key has read/write permissions
3. Ensure PAGERDUTY_API_KEY is set correctly
```

### "Incident not found"

```
Error: Incident PD-12345 not found

1. Verify incident ID is correct
2. Check API key has access to the service
3. Incident may have been deleted
```

## Next Steps

- [OpsGenie Integration](/RunbookAI/integrations/opsgenie/) - Alternative incident management
- [Slack Integration](/RunbookAI/integrations/slack/) - Notifications and approvals
