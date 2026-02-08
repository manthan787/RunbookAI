---
title: Slack Integration
description: Configure Slack for notifications and approvals
---

Runbook integrates with Slack to send notifications, request approvals via interactive buttons, and post investigation updates.

## Configuration

```yaml
# .runbook/config.yaml
incident:
  slack:
    enabled: true
    botToken: ${SLACK_BOT_TOKEN}
    signingSecret: ${SLACK_SIGNING_SECRET}
    defaultChannel: "#incidents"
    approvalChannel: "#runbook-approvals"
```

## Slack App Setup

### 1. Create Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click "Create New App" → "From scratch"
3. Name: "Runbook", Workspace: Your workspace

### 2. Add Bot Scopes

Go to OAuth & Permissions → Scopes → Bot Token Scopes:

| Scope | Purpose |
|-------|---------|
| `chat:write` | Post messages |
| `chat:write.public` | Post to channels without joining |
| `users:read` | Get user info for approvals |
| `channels:read` | List channels |

### 3. Enable Interactivity

Go to Interactivity & Shortcuts:
1. Enable Interactivity
2. Request URL: `https://your-domain.com/slack/interactions`

### 4. Install App

1. Go to Install App
2. Click "Install to Workspace"
3. Copy Bot User OAuth Token

### 5. Get Signing Secret

Go to Basic Information → App Credentials → Signing Secret

### 6. Set Environment Variables

```bash
export SLACK_BOT_TOKEN="xoxb-your-token"
export SLACK_SIGNING_SECRET="your-signing-secret"
```

## Available Tools

### slack_post_message

Post messages to Slack:

```bash
runbook ask "Post to #incidents: Investigation started for checkout-api"
```

### slack_send_approval_request

Request approval via interactive buttons:

```typescript
// Internal tool call
slack_send_approval_request({
  channel: "#runbook-approvals",
  operation: "Scale checkout-api from 4 to 8 tasks",
  riskLevel: "high",
  rollbackCommand: "aws ecs update-service --desired-count 4"
})
```

### slack_get_channel_messages

Retrieve recent messages (for context):

```bash
runbook ask "Show recent messages in #incidents"
```

## Approval Flow

### 1. Runbook Requests Approval

When a high-risk operation is needed, Runbook posts to Slack:

```
┌────────────────────────────────────────────┐
│ 🔐 Runbook Approval Request               │
│                                            │
│ Operation: Scale checkout-api (4 → 8)     │
│ Risk: HIGH                                 │
│ Investigation: PD-12345                    │
│                                            │
│ Rollback: aws ecs update-service \        │
│   --desired-count 4                        │
│                                            │
│ [✅ Approve]  [❌ Deny]                    │
└────────────────────────────────────────────┘
```

### 2. User Clicks Button

A user reviews and clicks Approve or Deny.

### 3. Webhook Processes

The [webhook server](/RunbookAI/cli/webhook/) receives the interaction and:
- Verifies the signature
- Records the approval/denial
- Notifies the agent

### 4. Confirmation Posted

```
┌────────────────────────────────────────────┐
│ ✅ Approved by @alice                      │
│ Operation executing...                     │
└────────────────────────────────────────────┘
```

## Investigation Updates

Configure automatic updates during investigations:

```yaml
incident:
  slack:
    investigationUpdates: true
    updateChannel: "#incidents"
```

Updates posted:
- Investigation started
- Hypotheses formed
- Root cause identified
- Remediation suggested
- Actions executed

## Channel Configuration

### Default Channel

Messages without a specific channel go here:

```yaml
incident:
  slack:
    defaultChannel: "#incidents"
```

### Approval Channel

Approval requests go to a dedicated channel:

```yaml
incident:
  slack:
    approvalChannel: "#runbook-approvals"
```

### Per-Service Channels

Route notifications by service:

```yaml
services:
  checkout-api:
    slack:
      channel: "#checkout-team"
  payment-service:
    slack:
      channel: "#payments-team"
```

## Webhook Server

For interactive features (buttons), run the webhook server:

```bash
runbook webhook --port 3000
```

See [webhook command](/RunbookAI/cli/webhook/) for details.

## Message Formatting

Runbook uses Slack Block Kit for rich formatting:

```
╔═══════════════════════════════════════════╗
║ 🔍 Investigation Complete                  ║
╠═══════════════════════════════════════════╣
║                                            ║
║ Root Cause: Database connection exhaustion ║
║ Confidence: HIGH (0.92)                    ║
║                                            ║
║ Timeline:                                  ║
║ • 14:32 - Traffic increased               ║
║ • 14:45 - Connections at 80%              ║
║ • 15:00 - Alert triggered                 ║
║                                            ║
║ Remediation: Scale RDS (pending approval) ║
║                                            ║
╚═══════════════════════════════════════════╝
```

## Troubleshooting

### "Channel not found"

```
Error: channel_not_found

1. Ensure channel exists
2. Invite bot to private channels: /invite @Runbook
3. Check channel name (with #)
```

### "Not authorized"

```
Error: not_authed

1. Verify SLACK_BOT_TOKEN is set
2. Check token hasn't expired
3. Reinstall app if needed
```

### Buttons not working

1. Ensure webhook server is running
2. Check Request URL in Slack app settings
3. Verify SLACK_SIGNING_SECRET is correct

## Next Steps

- [webhook Command](/RunbookAI/cli/webhook/) - Set up webhook server
- [Safety & Approvals](/RunbookAI/concepts/safety/) - Understanding approvals
