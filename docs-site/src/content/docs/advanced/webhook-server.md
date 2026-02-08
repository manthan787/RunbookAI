---
title: Webhook Server
description: Running the webhook server in production
---

The webhook server handles Slack interactions for approval buttons and other interactive features.

## Architecture

```
Slack Button Click
       │
       ▼
┌──────────────────┐
│ Slack Servers    │
│                  │
│ POST /slack/     │
│ interactions     │
└──────────────────┘
       │
       ▼
┌──────────────────┐
│ Webhook Server   │
│                  │
│ • Verify sig     │
│ • Parse action   │
│ • Update pending │
│ • Notify agent   │
└──────────────────┘
       │
       ▼
┌──────────────────┐
│ Runbook Agent    │
│                  │
│ • Receive        │
│   approval       │
│ • Continue       │
│   execution      │
└──────────────────┘
```

## Starting the Server

### Basic

```bash
runbook webhook --port 3000
```

### With Options

```bash
runbook webhook \
  --port 3000 \
  --host 0.0.0.0 \
  --pending-dir .runbook/pending \
  --tls-cert /path/to/cert.pem \
  --tls-key /path/to/key.pem
```

## Production Deployment

### Docker

```dockerfile
FROM node:20-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --production

COPY dist/ ./dist/
COPY node_modules/ ./node_modules/

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/cli.js", "webhook", "--port", "3000"]
```

Build and run:

```bash
docker build -t runbook-webhook .
docker run -d \
  -p 3000:3000 \
  -e SLACK_BOT_TOKEN=$SLACK_BOT_TOKEN \
  -e SLACK_SIGNING_SECRET=$SLACK_SIGNING_SECRET \
  -v $(pwd)/.runbook:/app/.runbook \
  runbook-webhook
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: runbook-webhook
  labels:
    app: runbook-webhook
spec:
  replicas: 2
  selector:
    matchLabels:
      app: runbook-webhook
  template:
    metadata:
      labels:
        app: runbook-webhook
    spec:
      containers:
        - name: webhook
          image: your-registry/runbook-webhook:latest
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
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "256Mi"
              cpu: "500m"
          volumeMounts:
            - name: pending-approvals
              mountPath: /app/.runbook/pending
      volumes:
        - name: pending-approvals
          persistentVolumeClaim:
            claimName: runbook-pending-pvc
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
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: runbook-webhook
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  tls:
    - hosts:
        - runbook.example.com
      secretName: runbook-tls
  rules:
    - host: runbook.example.com
      http:
        paths:
          - path: /slack
            pathType: Prefix
            backend:
              service:
                name: runbook-webhook
                port:
                  number: 80
```

### Persistent Storage

Pending approvals need persistence:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: runbook-pending-pvc
spec:
  accessModes:
    - ReadWriteMany  # For multiple replicas
  resources:
    requests:
      storage: 1Gi
  storageClassName: efs  # Or your storage class
```

## High Availability

### Multiple Replicas

Run multiple webhook server instances behind a load balancer.

**Important**: Pending approvals must be on shared storage (NFS, EFS, etc.) so any replica can process them.

### Health Checks

The server exposes:

```
GET /health
{
  "status": "healthy",
  "uptime": 3600,
  "pendingApprovals": 2
}
```

## Security

### Signature Verification

All Slack requests are verified:

```typescript
const isValid = verifySlackSignature(
  headers['x-slack-signature'],
  headers['x-slack-request-timestamp'],
  body,
  SLACK_SIGNING_SECRET
);

if (!isValid) {
  return res.status(401).send('Invalid signature');
}
```

### TLS

Always use HTTPS in production:

```bash
# Built-in TLS
runbook webhook --port 443 \
  --tls-cert /path/to/fullchain.pem \
  --tls-key /path/to/privkey.pem

# Or use a reverse proxy (nginx, Traefik, etc.)
```

### Network Policies

Restrict access to webhook server:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: runbook-webhook-policy
spec:
  podSelector:
    matchLabels:
      app: runbook-webhook
  ingress:
    - from:
        - ipBlock:
            cidr: 0.0.0.0/0  # Allow from internet (for Slack)
      ports:
        - port: 3000
```

## Monitoring

### Metrics

The server exposes Prometheus metrics:

```
GET /metrics

# HELP runbook_webhook_requests_total Total webhook requests
# TYPE runbook_webhook_requests_total counter
runbook_webhook_requests_total{action="approve"} 45
runbook_webhook_requests_total{action="deny"} 3

# HELP runbook_pending_approvals Current pending approvals
# TYPE runbook_pending_approvals gauge
runbook_pending_approvals 2
```

### Logging

```bash
# View logs
runbook webhook --port 3000 --log-level debug

# JSON logging for production
runbook webhook --port 3000 --log-format json
```

## Troubleshooting

### "Request URL not verified"

Slack needs to verify the URL. Ensure:
1. Server is running and accessible
2. URL is HTTPS
3. Responds within 3 seconds

### "Signature verification failed"

Check `SLACK_SIGNING_SECRET` matches Slack app settings.

### "Approval not received by agent"

1. Check pending files exist in pending directory
2. Verify agent is polling for approvals
3. Check file permissions
