---
title: Incident Tools
description: PagerDuty, OpsGenie, and Slack tool reference
---

Tools for incident management and communication.

## PagerDuty Tools

### pagerduty_get_incident

Get incident details.

```
pagerduty_get_incident:
  incident_id: "P12345"
```

Returns:
- Title and description
- Severity and status
- Timeline
- Assigned users
- Related alerts

### pagerduty_list_incidents

List incidents.

```
pagerduty_list_incidents:
  status: triggered | acknowledged | resolved
  since: "2024-01-01T00:00:00Z"
  until: "2024-01-31T23:59:59Z"
  service_ids: ["PXXXXXX"]
```

### pagerduty_add_note

Add note to incident.

```
pagerduty_add_note:
  incident_id: "P12345"
  content: "Root cause identified: database connection exhaustion"
```

### pagerduty_get_alerts

Get alerts for incident.

```
pagerduty_get_alerts:
  incident_id: "P12345"
```

## OpsGenie Tools

### opsgenie_get_alert

Get alert details.

```
opsgenie_get_alert:
  alert_id: "abc123-def456"
```

### opsgenie_list_alerts

List alerts.

```
opsgenie_list_alerts:
  status: open | closed
  priority: P1 | P2 | P3 | P4 | P5
  query: "tag:database"
```

### opsgenie_get_incident

Get incident details.

```
opsgenie_get_incident:
  incident_id: "inc-123"
```

### opsgenie_list_incidents

List incidents.

```
opsgenie_list_incidents:
  status: open | resolved
```

### opsgenie_add_note

Add note to alert.

```
opsgenie_add_note:
  alert_id: "abc123"
  note: "Investigating connection issues"
```

### opsgenie_acknowledge_alert

Acknowledge an alert.

```
opsgenie_acknowledge_alert:
  alert_id: "abc123"
  user: "oncall@company.com"
```

### opsgenie_close_alert

Close an alert.

```
opsgenie_close_alert:
  alert_id: "abc123"
  note: "Resolved by scaling database"
```

## Slack Tools

### slack_post_message

Post message to channel.

```
slack_post_message:
  channel: "#incidents"
  text: "Investigation started for PD-12345"
  blocks:  # Optional: Block Kit formatting
    - type: section
      text:
        type: mrkdwn
        text: "*Investigation Started*\nIncident: PD-12345"
```

### slack_send_approval_request

Request approval via buttons.

```
slack_send_approval_request:
  channel: "#approvals"
  operation: "Scale checkout-api from 4 to 8 tasks"
  riskLevel: high
  rollbackCommand: "aws ecs update-service --desired-count 4"
  metadata:
    skillId: "scale-service"
    sessionId: "session-abc"
```

Posts interactive message with Approve/Deny buttons.

### slack_get_channel_messages

Get recent messages.

```
slack_get_channel_messages:
  channel: "#incidents"
  limit: 20
  oldest: "1704067200"  # Unix timestamp
```

## Example Workflows

### Incident Investigation

```
1. pagerduty_get_incident(incident_id)
   → Get incident context

2. pagerduty_get_alerts(incident_id)
   → Get related alerts

3. search_knowledge(symptoms)
   → Find relevant runbooks

4. [investigation...]

5. pagerduty_add_note(incident_id, findings)
   → Document findings

6. slack_post_message(channel, summary)
   → Notify team
```

### Approval Flow

```
1. slack_send_approval_request(operation, risk)
   → Post approval request

2. [Webhook receives button click]

3. [If approved, continue execution]

4. slack_post_message(channel, "Approved by @user")
   → Confirm approval
```

## Configuration

```yaml
incident:
  pagerduty:
    enabled: true
    apiKey: ${PAGERDUTY_API_KEY}

  opsgenie:
    enabled: true
    apiKey: ${OPSGENIE_API_KEY}
    region: us

  slack:
    enabled: true
    botToken: ${SLACK_BOT_TOKEN}
    defaultChannel: "#incidents"
```
