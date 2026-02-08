---
title: OpsGenie Integration
description: Configure OpsGenie for alert and incident management
---

Runbook integrates with OpsGenie to manage alerts and incidents, providing full investigation capabilities.

## Configuration

```yaml
# .runbook/config.yaml
incident:
  opsgenie:
    enabled: true
    apiKey: ${OPSGENIE_API_KEY}
    region: us  # us or eu
```

## API Key Setup

1. Go to OpsGenie → Settings → API key management
2. Create a new API integration
3. Grant read/write permissions
4. Set as environment variable: `export OPSGENIE_API_KEY=your-key`

## Available Tools

### opsgenie_get_alert

Fetch details about a specific alert:

```bash
runbook ask "Get details for OpsGenie alert abc123"
```

Returns:
- Alert message and description
- Priority and status
- Created time
- Tags and extra properties
- Acknowledged/closed info

### opsgenie_list_alerts

List recent alerts:

```bash
runbook ask "Show open OpsGenie alerts"
runbook ask "What alerts fired in the last hour?"
```

### opsgenie_get_incident

Fetch incident details:

```bash
runbook ask "Get OpsGenie incident details for inc-456"
```

### opsgenie_list_incidents

List incidents:

```bash
runbook ask "Show active OpsGenie incidents"
```

### opsgenie_add_note

Add notes to alerts:

```bash
runbook ask "Add note to alert abc123: Investigating database connection issues"
```

### opsgenie_acknowledge_alert

Acknowledge an alert:

```bash
runbook ask "Acknowledge OpsGenie alert abc123"
```

### opsgenie_close_alert

Close an alert:

```bash
runbook ask "Close alert abc123 with note: Resolved by scaling database"
```

## Investigation Flow

```bash
# Investigate an OpsGenie alert
runbook investigate OG-abc123

# Or use the full alert ID
runbook investigate 12345678-1234-1234-1234-123456789012
```

## Region Configuration

OpsGenie has separate US and EU instances:

```yaml
incident:
  opsgenie:
    region: eu  # For EU instance (api.eu.opsgenie.com)
```

## Priority Mapping

OpsGenie priorities map to Runbook severity:

| OpsGenie Priority | Runbook Severity |
|-------------------|------------------|
| P1 | SEV1 (Critical) |
| P2 | SEV2 (High) |
| P3 | SEV3 (Medium) |
| P4, P5 | SEV4 (Low) |

## Example Queries

```bash
# Active alerts
runbook ask "Show all open P1 and P2 alerts"

# Team-specific
runbook ask "Show alerts for the platform team"

# Tag filtering
runbook ask "Show alerts tagged with 'database'"

# Time-based
runbook ask "What alerts were acknowledged in the last hour?"
```

## Next Steps

- [PagerDuty Integration](/RunbookAI/integrations/pagerduty/) - Alternative incident management
- [Slack Integration](/RunbookAI/integrations/slack/) - Notifications and approvals
