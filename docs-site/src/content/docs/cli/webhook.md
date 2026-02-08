---
title: webhook
description: Start the Slack webhook server for approvals
---

The `webhook` command starts a server that handles Slack interaction webhooks, enabling approval buttons and other interactive features.

## Usage

```bash
runbook webhook [options]
```

## Starting the Server

```bash
$ runbook webhook --port 3000

╔════════════════════════════════════════════════════════════╗
║                 Runbook Webhook Server                      ║
║  Listening on port 3000                                     ║
╚════════════════════════════════════════════════════════════╝

Endpoints:
  POST /slack/interactions  - Slack button callbacks
  POST /slack/events        - Slack event subscriptions
  GET  /health              - Health check

Server ready. Configure Slack app:
  Request URL: https://your-domain.com/slack/interactions

Waiting for interactions...
```

## Options

| Option | Description |
|--------|-------------|
| `--port <port>` | Port to listen on (default: 3000) |
| `--host <host>` | Host to bind to (default: 0.0.0.0) |
| `--pending-dir <path>` | Directory for pending approvals |
| `--tls-cert <path>` | TLS certificate file |
| `--tls-key <path>` | TLS key file |

## Slack App Configuration

### 1. Create Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click "Create New App"
3. Choose "From scratch"
4. Name it "Runbook" and select your workspace

### 2. Configure Interactivity

1. Go to "Interactivity & Shortcuts"
2. Enable Interactivity
3. Set Request URL: `https://your-domain.com/slack/interactions`
4. Save Changes

### 3. Add Bot Scopes

Go to "OAuth & Permissions" and add:
- `chat:write` - Post messages
- `chat:write.public` - Post to any channel
- `users:read` - Read user info for approvals

### 4. Install to Workspace

1. Go to "Install App"
2. Click "Install to Workspace"
3. Copy the Bot User OAuth Token

### 5. Configure Runbook

```yaml
# .runbook/config.yaml
incident:
  slack:
    enabled: true
    botToken: ${SLACK_BOT_TOKEN}
    signingSecret: ${SLACK_SIGNING_SECRET}
```

## How Approvals Work

### 1. Approval Requested

When Runbook needs approval, it posts to Slack:

```
┌────────────────────────────────────────────────┐
│ 🔐 Runbook Approval Request                    │
├────────────────────────────────────────────────┤
│                                                │
│ Operation: Scale checkout-api (4 → 8 tasks)   │
│ Risk Level: HIGH                               │
│ Requested by: runbook-agent                    │
│ Investigation: PD-12345                        │
│                                                │
│ Rollback: aws ecs update-service \            │
│   --desired-count 4                            │
│                                                │
│ [✅ Approve]  [❌ Deny]                        │
│                                                │
└────────────────────────────────────────────────┘
```

### 2. User Clicks Button

The webhook server receives the interaction:

```
[15:30:45] Received interaction from @alice
  Action: approve
  Approval ID: apr-abc123
  Operation: scale_ecs_service
```

### 3. Approval Processed

```
[15:30:45] Approval granted by @alice
  Approval ID: apr-abc123
  Notifying agent...

[15:30:46] Agent notified, executing operation
```

### 4. Confirmation Posted

```
┌────────────────────────────────────────────────┐
│ ✅ Approval Granted                            │
├────────────────────────────────────────────────┤
│                                                │
│ Approved by: @alice                            │
│ Time: 2024-01-15 15:30:45 UTC                 │
│                                                │
│ Operation is now executing...                  │
│                                                │
└────────────────────────────────────────────────┘
```

## Pending Approvals

Approvals are stored on disk while waiting:

```bash
$ ls .runbook/pending-approvals/

apr-abc123.json  # Pending approval
apr-def456.json  # Another pending

$ cat .runbook/pending-approvals/apr-abc123.json
```

```json
{
  "id": "apr-abc123",
  "operation": "scale_ecs_service",
  "args": {
    "service": "checkout-api",
    "desiredCount": 8
  },
  "riskLevel": "high",
  "rollbackCommand": "aws ecs update-service --desired-count 4",
  "requestedAt": "2024-01-15T15:30:00Z",
  "slackMessageTs": "1705333800.000100",
  "slackChannel": "C1234567890",
  "status": "pending"
}
```

## Security

### Signature Verification

The webhook server verifies Slack signatures:

```typescript
// Automatic verification using SLACK_SIGNING_SECRET
const isValid = verifySlackSignature(
  request.headers['x-slack-signature'],
  request.headers['x-slack-request-timestamp'],
  request.body,
  process.env.SLACK_SIGNING_SECRET
);
```

### HTTPS Requirement

Slack requires HTTPS for webhook URLs. Options:

1. **ngrok** (development):
   ```bash
   ngrok http 3000
   # Use the https URL from ngrok
   ```

2. **Reverse proxy** (production):
   ```nginx
   server {
     listen 443 ssl;
     server_name runbook.example.com;

     ssl_certificate /path/to/cert.pem;
     ssl_certificate_key /path/to/key.pem;

     location / {
       proxy_pass http://localhost:3000;
     }
   }
   ```

3. **Built-in TLS**:
   ```bash
   runbook webhook --port 443 \
     --tls-cert /path/to/cert.pem \
     --tls-key /path/to/key.pem
   ```

## Running in Production

### Docker

```dockerfile
FROM node:20-slim

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .

EXPOSE 3000
CMD ["npx", "runbook", "webhook", "--port", "3000"]
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: runbook-webhook
spec:
  replicas: 2
  selector:
    matchLabels:
      app: runbook-webhook
  template:
    spec:
      containers:
        - name: webhook
          image: runbook:latest
          command: ["npx", "runbook", "webhook"]
          ports:
            - containerPort: 3000
          env:
            - name: SLACK_BOT_TOKEN
              valueFrom:
                secretKeyRef:
                  name: runbook-secrets
                  key: slack-bot-token
            - name: SLACK_SIGNING_SECRET
              valueFrom:
                secretKeyRef:
                  name: runbook-secrets
                  key: slack-signing-secret
---
apiVersion: v1
kind: Service
metadata:
  name: runbook-webhook
spec:
  selector:
    app: runbook-webhook
  ports:
    - port: 80
      targetPort: 3000
```

### Health Checks

The server exposes a health endpoint:

```bash
curl http://localhost:3000/health

{"status":"healthy","pendingApprovals":2}
```

## Troubleshooting

### "Signature verification failed"

```
[ERROR] Signature verification failed
  Expected: v0=abc123...
  Received: v0=def456...
```

Ensure `SLACK_SIGNING_SECRET` matches your Slack app's signing secret.

### "Request URL not verified"

Slack needs to verify the URL. Ensure:
1. Server is running and accessible
2. URL is HTTPS
3. Endpoint responds within 3 seconds

### Approval buttons not working

Check:
1. Bot has `chat:write` permission
2. Bot is in the channel
3. Webhook URL is correct in Slack app settings

## Next Steps

- [Safety & Approvals](/RunbookAI/concepts/safety/) - Understanding the approval system
- [Slack Integration](/RunbookAI/integrations/slack/) - Full Slack setup guide
