---
title: deploy
description: Deploy services using built-in workflows
---

The `deploy` command executes deployment workflows for your services. It uses the `deploy-service` skill with safety checks, approval gates, and rollback capabilities.

## Usage

```bash
runbook deploy <service> [options]
```

## Examples

```bash
# Deploy to production
runbook deploy checkout-api --environment production

# Deploy specific version
runbook deploy api-gateway --version 2.0.0

# Dry run (show what would happen)
runbook deploy payment-service --dry-run

# Deploy with canary
runbook deploy order-service --canary-percent 10
```

## Options

| Option | Description |
|--------|-------------|
| `--environment, -e` | Target environment (production, staging, dev) |
| `--version, -v` | Version or image tag to deploy |
| `--dry-run` | Show what would happen without executing |
| `--canary-percent` | Percentage of traffic for canary (default: 10) |
| `--skip-checks` | Skip pre-deployment checks (not recommended) |
| `--force` | Force deployment even with warnings |
| `--timeout <ms>` | Deployment timeout (default: 600000) |

## Deployment Workflow

```
$ runbook deploy checkout-api --environment production --version 1.2.3

╔════════════════════════════════════════════════════════════╗
║              Deploying checkout-api v1.2.3                  ║
║              Environment: production                        ║
╚════════════════════════════════════════════════════════════╝

Step 1/6: Pre-deployment Checks
───────────────────────────────
✓ Service exists: checkout-api
✓ Current version: 1.2.2 (healthy)
✓ Target image exists: registry/checkout-api:1.2.3
✓ No active incidents affecting checkout-api
✓ No ongoing deployments
✓ Rollback version available: 1.2.2

Step 2/6: Validate Configuration
────────────────────────────────
✓ Environment variables configured
✓ Secrets accessible
✓ Resource limits appropriate
✓ Health check endpoints defined

Step 3/6: Canary Deployment (10%)
─────────────────────────────────
→ Creating canary task definition...
→ Deploying canary (1 of 10 tasks)...
→ Waiting for canary health...

  Canary metrics (60s observation):
  ├─ Error rate: 0.02% ✓ (threshold: 1%)
  ├─ Latency p99: 145ms ✓ (threshold: 500ms)
  └─ Health checks: passing ✓

✓ Canary healthy

Step 4/6: Request Approval
──────────────────────────
╔════════════════════════════════════════════════════════════╗
║                    APPROVAL REQUIRED                        ║
╠════════════════════════════════════════════════════════════╣
║  Operation: Deploy checkout-api v1.2.3 to 100%              ║
║  Risk Level: HIGH                                           ║
║  Environment: production                                    ║
║                                                             ║
║  Canary Results:                                            ║
║    Error rate: 0.02%                                        ║
║    Latency p99: 145ms                                       ║
║    Duration: 60s                                            ║
║                                                             ║
║  Rollback: runbook deploy checkout-api --version 1.2.2      ║
╚════════════════════════════════════════════════════════════╝

[Approved via Slack by @alice]

Step 5/6: Full Rollout
──────────────────────
→ Updating service to 100%...
  ├─ Task 1/10: healthy
  ├─ Task 2/10: healthy
  ├─ Task 3/10: healthy
  ...
  └─ Task 10/10: healthy

→ Draining old tasks...
✓ All new tasks healthy
✓ Old tasks drained

Step 6/6: Post-deployment Validation
─────────────────────────────────────
→ Monitoring for 5 minutes...

  Post-deployment metrics:
  ├─ Error rate: 0.03% ✓ (stable)
  ├─ Latency p99: 142ms ✓ (improved)
  ├─ Request rate: 1.2k/s ✓ (normal)
  └─ Health checks: passing ✓

═══════════════════════════════════════════════════════════════
                    DEPLOYMENT SUCCESSFUL
═══════════════════════════════════════════════════════════════

Version: 1.2.2 → 1.2.3
Duration: 8m 34s
Rollback: runbook deploy checkout-api --version 1.2.2

Post-deployment notes added to knowledge base.
```

## Dry Run Mode

Preview deployment without executing:

```bash
$ runbook deploy checkout-api --version 1.2.3 --dry-run

DRY RUN MODE - No changes will be made

Deployment Plan:
  Service: checkout-api
  Current Version: 1.2.2
  Target Version: 1.2.3
  Environment: production
  Tasks: 10 → 10 (no scaling)

Steps that would execute:
  1. Pre-deployment checks
  2. Validate configuration
  3. Deploy canary (10% = 1 task)
  4. Request approval
  5. Full rollout (remaining 9 tasks)
  6. Post-deployment validation

Estimated Duration: 8-12 minutes
Rollback Command: runbook deploy checkout-api --version 1.2.2
```

## Rollback

When a deployment fails or you need to revert:

```bash
# Rollback to previous version
runbook deploy checkout-api --version 1.2.2

# Automatic rollback on failure
runbook deploy checkout-api --version 1.2.3 --auto-rollback
```

### Automatic Rollback

When `--auto-rollback` is enabled and post-deployment validation fails:

```
Step 6/6: Post-deployment Validation
─────────────────────────────────────
→ Monitoring for 5 minutes...

  Post-deployment metrics:
  ├─ Error rate: 5.2% ✗ (threshold: 1%)
  ├─ Latency p99: 2.3s ✗ (threshold: 500ms)
  └─ Health checks: failing ✗

DEPLOYMENT FAILED - Initiating automatic rollback

→ Rolling back to v1.2.2...
→ Updating service...
✓ Rollback complete

Version: 1.2.3 → 1.2.2 (rolled back)

Please investigate:
- Check logs: runbook ask "show errors for checkout-api last 10 minutes"
- Review changes in v1.2.3
```

## Service Types

The deploy command supports multiple service types:

### ECS Services

```bash
runbook deploy checkout-api --environment production
```

Uses: AWS ECS UpdateService, task definitions

### Kubernetes Deployments

```bash
runbook deploy api-gateway --environment production --type kubernetes
```

Uses: kubectl set image, rollout status

### Lambda Functions

```bash
runbook deploy data-processor --environment production --type lambda
```

Uses: AWS Lambda UpdateFunctionCode

## Integration with CI/CD

Use in CI/CD pipelines:

```yaml
# GitHub Actions example
- name: Deploy to Production
  run: |
    runbook deploy ${{ github.event.repository.name }} \
      --version ${{ github.sha }} \
      --environment production \
      --auto-rollback
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
```

## Best Practices

1. **Always use dry-run first** - Preview changes before applying
2. **Deploy to staging first** - Test in lower environments
3. **Use canary deployments** - Catch issues early
4. **Enable auto-rollback** - Automatically revert on failure
5. **Set appropriate timeouts** - Some deployments take longer

## Next Steps

- [knowledge](/RunbookAI/cli/knowledge/) - Manage knowledge base
- [Skills](/RunbookAI/skills/overview/) - Understanding deployment skills
