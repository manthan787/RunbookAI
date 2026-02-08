---
title: Service Deployment
description: Example of deploying a service with Runbook
---

This example demonstrates deploying a service using Runbook's deployment skill.

## Scenario

Deploy checkout-api version 1.2.3 to production with canary testing.

## Deployment

### Start Deployment

```bash
runbook deploy checkout-api --version 1.2.3 --environment production
```

### Execution

```
╔════════════════════════════════════════════════════════════╗
║              Deploying checkout-api v1.2.3                  ║
║              Environment: production                        ║
╚════════════════════════════════════════════════════════════╝

Step 1/6: Pre-deployment Checks
───────────────────────────────
→ Checking service exists...
✓ Service found: checkout-api (ECS, prod cluster)

→ Checking current version...
✓ Current version: 1.2.2
  Running: 4 tasks, all healthy
  Last deployed: 2024-01-14 10:30 UTC

→ Checking target image...
✓ Image exists: registry.example.com/checkout-api:1.2.3
  Pushed: 2024-01-15 09:00 UTC
  Size: 245 MB
  Digest: sha256:abc123...

→ Checking for incidents...
✓ No active incidents affecting checkout-api

→ Checking for ongoing deployments...
✓ No deployments in progress

→ Checking rollback availability...
✓ Rollback target: 1.2.2 (healthy)

All pre-deployment checks passed ✓

Step 2/6: Validate Configuration
────────────────────────────────
→ Comparing configurations...

  Task Definition Changes:
  ├─ Image: 1.2.2 → 1.2.3
  ├─ Memory: 512 MB (unchanged)
  ├─ CPU: 256 units (unchanged)
  └─ Environment: No changes

→ Checking environment variables...
✓ All required env vars present

→ Checking secrets...
✓ All secrets accessible

→ Checking health check...
✓ Health check endpoint: /health
  Protocol: HTTP
  Interval: 30s

Configuration validated ✓

Step 3/6: Canary Deployment (10%)
─────────────────────────────────
→ Creating new task definition...
✓ Task definition: checkout-api:45

→ Deploying canary (1 of 10 tasks)...
→ Waiting for task to start...
✓ Task running: checkout-api-canary-abc123

→ Performing health checks...
  Check 1/3: ✓ Healthy
  Check 2/3: ✓ Healthy
  Check 3/3: ✓ Healthy

→ Observing metrics (60s)...

  ┌────────────────────────────────────────────┐
  │ Canary Metrics                             │
  ├────────────────────────────────────────────┤
  │                                            │
  │  Error Rate                                │
  │  Threshold: 1%    Current: 0.02% ✓         │
  │  ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁ 0.02%          │
  │                                            │
  │  Latency (p99)                             │
  │  Threshold: 500ms Current: 145ms ✓         │
  │  ▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃ 145ms           │
  │                                            │
  │  Health Checks                             │
  │  Status: Passing ✓                         │
  │                                            │
  └────────────────────────────────────────────┘

Canary healthy after 60s observation ✓

Step 4/6: Request Approval
──────────────────────────

╔════════════════════════════════════════════════════════════╗
║                    APPROVAL REQUIRED                        ║
╠════════════════════════════════════════════════════════════╣
║                                                             ║
║  Operation: Deploy checkout-api v1.2.3 to 100%              ║
║  Risk Level: HIGH                                           ║
║  Environment: production                                    ║
║                                                             ║
║  Canary Results (60s observation):                          ║
║    • Error rate: 0.02% (threshold: 1%) ✓                   ║
║    • Latency p99: 145ms (threshold: 500ms) ✓               ║
║    • Health checks: Passing ✓                              ║
║                                                             ║
║  Changes:                                                   ║
║    • Image: 1.2.2 → 1.2.3                                  ║
║    • No config changes                                      ║
║                                                             ║
║  Rollback Command:                                          ║
║    runbook deploy checkout-api --version 1.2.2              ║
║                                                             ║
╚════════════════════════════════════════════════════════════╝

Sent to Slack #runbook-approvals...

┌────────────────────────────────────────────┐
│ 🚀 Deployment Approval Request             │
│                                            │
│ Service: checkout-api                      │
│ Version: 1.2.2 → 1.2.3                     │
│ Environment: production                    │
│                                            │
│ Canary: Healthy (0.02% errors, 145ms p99)  │
│                                            │
│ [✅ Approve]  [❌ Deny]                    │
└────────────────────────────────────────────┘

Waiting for approval...
✓ Approved by @alice at 15:10 UTC

Step 5/6: Full Rollout
──────────────────────
→ Updating service to v1.2.3...

  Deployment Progress:
  ├─ Task 1/10: ████████████ Started
  ├─ Task 2/10: ████████████ Started
  ├─ Task 3/10: ████████████ Started
  ├─ Task 4/10: ██████████░░ Starting
  └─ ...

→ Waiting for all tasks to be healthy...

  Rolling Update:
  ├─ Old tasks: 10 → 8 → 5 → 2 → 0
  ├─ New tasks: 0 → 2 → 5 → 8 → 10
  └─ Duration: 4m 32s

→ Draining old tasks...
✓ Old tasks drained

→ Verifying service stability...
✓ All 10 tasks healthy

Full rollout complete ✓

Step 6/6: Post-deployment Validation
─────────────────────────────────────
→ Monitoring for 5 minutes...

  ┌────────────────────────────────────────────┐
  │ Post-Deployment Metrics                    │
  ├────────────────────────────────────────────┤
  │                                            │
  │  Error Rate (5m)                           │
  │  Before: 0.5%   After: 0.03% ✓ (improved)  │
  │  ▂▂▂▂▂▂▂▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁                │
  │                                            │
  │  Latency p99 (5m)                          │
  │  Before: 180ms  After: 142ms ✓ (improved)  │
  │  ▄▄▄▄▄▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃                │
  │                                            │
  │  Request Rate                              │
  │  Current: 1,200/min ✓ (stable)             │
  │  ▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅                │
  │                                            │
  │  Health Checks                             │
  │  Status: All passing ✓                     │
  │                                            │
  └────────────────────────────────────────────┘

Post-deployment validation passed ✓

═══════════════════════════════════════════════════════════════
                    DEPLOYMENT SUCCESSFUL
═══════════════════════════════════════════════════════════════

Summary:
  Service: checkout-api
  Version: 1.2.2 → 1.2.3
  Environment: production
  Duration: 8m 34s
  Tasks: 10

Improvements Observed:
  • Error rate: 0.5% → 0.03% (94% reduction)
  • Latency p99: 180ms → 142ms (21% improvement)

Rollback Command (if needed):
  runbook deploy checkout-api --version 1.2.2

Deployment logged to scratchpad.
```

## Rollback Example

If issues are detected post-deployment:

```bash
runbook deploy checkout-api --version 1.2.2
```

Or with auto-rollback enabled:

```bash
runbook deploy checkout-api --version 1.2.3 --auto-rollback
```

If validation fails:

```
Step 6/6: Post-deployment Validation
─────────────────────────────────────
→ Monitoring for 5 minutes...

  Error Rate:
  Before: 0.5%   After: 5.2% ✗ (degraded)

  Latency p99:
  Before: 180ms  After: 2.3s ✗ (degraded)

DEPLOYMENT VALIDATION FAILED

Initiating automatic rollback...
→ Rolling back to v1.2.2...
→ Updating service...
✓ Rollback complete

Version: 1.2.3 → 1.2.2 (rolled back)

Please investigate:
  runbook ask "Show errors for checkout-api last 10 minutes"
```
