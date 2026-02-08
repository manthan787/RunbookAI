# Slack Gateway Setup

This gateway lets teams mention `@runbookAI` in Slack alert channels and route requests into Runbook.

## Supported commands

- `@runbookAI infra <question>`
- `@runbookAI knowledge <question>`
- `@runbookAI deploy <service/environment>`
- `@runbookAI investigate <incident-id or summary>`

## Required Slack app settings

1. OAuth scopes (Bot Token Scopes)
- `app_mentions:read`
- `channels:history`
- `chat:write`
- `groups:history` (if private channels are used)

2. Event subscriptions
- Enable events
- Subscribe to bot events:
  - `app_mention`
  - `message.channels` (optional, for alert message context flows)
  - `message.groups` (optional, for private channels)

3. Socket Mode (recommended for local)
- Enable Socket Mode in Slack app settings
- Generate App-Level Token with `connections:write`

## Run locally (Socket Mode)

```bash
export SLACK_BOT_TOKEN=xoxb-...
export SLACK_APP_TOKEN=xapp-...
runbook slack-gateway --mode socket
```

## Run with HTTP Events API

```bash
export SLACK_BOT_TOKEN=xoxb-...
export SLACK_SIGNING_SECRET=...
runbook slack-gateway --mode http --port 3001
```

Set Slack Request URL to `https://<your-domain>/slack/events`.

## Config example

```yaml
incident:
  slack:
    enabled: true
    botToken: ${SLACK_BOT_TOKEN}
    appToken: ${SLACK_APP_TOKEN}
    signingSecret: ${SLACK_SIGNING_SECRET}
    events:
      enabled: true
      mode: socket
      port: 3001
      alertChannels: [C01234567]
      allowedUsers: [U01234567]
      requireThreadedMentions: true
```

## Guardrails

- Channel allowlist: restrict invocation to specific alert channels.
- User allowlist: only allow specific on-call responders.
- Thread-only mode: require mentions in threads to keep alert channels clean.
- Existing mutation approval path still applies for risky actions.
