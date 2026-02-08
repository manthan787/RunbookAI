---
title: Safety & Approvals
description: Understanding Runbook's safety controls and approval system
---

Runbook is designed with safety as a first-class concern. All operations that could affect your infrastructure require explicit approval, with clear rollback paths.

## Risk Classification

Every operation is automatically classified by risk level:

| Risk Level | Examples | Default Behavior |
|------------|----------|------------------|
| **Critical** | Delete instances, drop databases, terminate clusters | Always requires approval |
| **High** | Deploy to production, restart services, scale down | Requires approval |
| **Medium** | Modify non-production, restart dev services | Configurable |
| **Low** | Read operations, describe, list, status | Usually auto-approved |

### Classification Rules

```typescript
function classifyRisk(operation: Operation): RiskLevel {
  // Critical operations
  if (matchesCritical(operation)) {
    return 'critical';
  }

  // High-risk operations
  if (matchesHighRisk(operation)) {
    return 'high';
  }

  // Production environment
  if (operation.environment === 'production') {
    return operation.isMutation ? 'high' : 'medium';
  }

  // Read-only operations
  if (!operation.isMutation) {
    return 'low';
  }

  return 'medium';
}
```

### Critical Operations

Operations that are always classified as critical:

```typescript
const criticalPatterns = [
  /delete.*instance/i,
  /terminate.*instance/i,
  /drop.*database/i,
  /delete.*cluster/i,
  /purge/i,
  /destroy/i,
  /truncate.*table/i,
  /reset.*password/i,
  /revoke.*access/i,
];
```

### High-Risk Operations

```typescript
const highRiskPatterns = [
  /restart/i,
  /reboot/i,
  /stop.*service/i,
  /scale.*down/i,
  /deploy.*production/i,
  /update.*production/i,
  /modify.*security/i,
  /change.*network/i,
];
```

## Approval Flow

### Standard Flow

```
Operation Requested
    │
    ▼
Risk Classification
    │
    ├── Critical/High → Approval Required
    │                        │
    │                        ▼
    │                   Show Details
    │                   ┌─────────────────────────────┐
    │                   │ Operation: Scale down RDS   │
    │                   │ Risk: HIGH                  │
    │                   │ Rollback: aws rds modify... │
    │                   └─────────────────────────────┘
    │                        │
    │                   ┌────┴────┐
    │                   ▼         ▼
    │               Approve    Deny
    │                   │         │
    │                   ▼         ▼
    │               Execute    Abort
    │
    ├── Medium → Check Config
    │                │
    │         ┌──────┴──────┐
    │         ▼             ▼
    │    Configured     Configured
    │    to Approve     to Require
    │         │             │
    │         ▼             ▼
    │     Execute      (Same as High)
    │
    └── Low → Auto-Execute
                │
                ▼
            Execute
```

### Approval Display

When approval is required, Runbook displays:

```
╔════════════════════════════════════════════════════════════╗
║                    APPROVAL REQUIRED                        ║
╠════════════════════════════════════════════════════════════╣
║                                                             ║
║  Operation: Scale ECS service 'checkout-api'                ║
║             from 4 tasks to 2 tasks                         ║
║                                                             ║
║  Risk Level: HIGH                                           ║
║                                                             ║
║  Impact:                                                    ║
║    - Reduces capacity by 50%                                ║
║    - May increase latency under load                        ║
║    - Affects production traffic                             ║
║                                                             ║
║  Rollback Command:                                          ║
║    aws ecs update-service --cluster prod \                  ║
║      --service checkout-api --desired-count 4               ║
║                                                             ║
║  Estimated Time: 2-5 minutes                                ║
║                                                             ║
╚════════════════════════════════════════════════════════════╝

  [A]pprove    [D]eny    [M]ore Info
```

## Approval Channels

### CLI Approval

Default method when running interactively:

```bash
runbook> Scale down the checkout API

[APPROVAL REQUIRED]
Operation: Scale ECS service checkout-api (4 → 2)
Risk Level: HIGH
Rollback: aws ecs update-service --desired-count 4

Approve? [y/N] y

→ Scaling service...
✓ Service scaled successfully
```

### Slack Approval

When Slack integration is enabled, approvals can be sent to a channel:

```yaml
incident:
  slack:
    enabled: true
    approvalChannel: "#runbook-approvals"
```

Approval request appears in Slack:

```
┌────────────────────────────────────────────────┐
│ 🔐 Runbook Approval Request                    │
├────────────────────────────────────────────────┤
│                                                │
│ Operation: Scale checkout-api (4 → 2 tasks)   │
│ Requested by: runbook-agent                    │
│ Risk: HIGH                                     │
│ Investigation: PD-12345                        │
│                                                │
│ [✅ Approve]  [❌ Deny]                        │
│                                                │
└────────────────────────────────────────────────┘
```

When a user clicks:
- **Approve**: Operation executes, approver is logged
- **Deny**: Operation aborted, reason optionally recorded

### Webhook Server

For production use, run the webhook server:

```bash
runbook webhook --port 3000
```

This enables:
- Slack button interactions
- Approval status persistence
- Multi-user approval workflows

## Rollback Commands

Every mutation includes a rollback command:

```typescript
interface ApprovalRequest {
  operation: string;
  riskLevel: RiskLevel;
  impact: string[];
  rollbackCommand: string;
  estimatedDuration: string;
  affectedResources: string[];
}
```

### Rollback Generation

Runbook automatically generates rollback commands:

```typescript
function generateRollback(operation: Operation): string {
  switch (operation.type) {
    case 'scale_ecs_service':
      return `aws ecs update-service --cluster ${operation.cluster} ` +
        `--service ${operation.service} --desired-count ${operation.currentCount}`;

    case 'deploy_ecs_service':
      return `aws ecs update-service --cluster ${operation.cluster} ` +
        `--service ${operation.service} --task-definition ${operation.previousTask}`;

    case 'modify_rds':
      return `aws rds modify-db-instance --db-instance-id ${operation.instanceId} ` +
        `--db-instance-class ${operation.previousClass}`;

    // ... other operations
  }
}
```

## Rate Limiting

Runbook enforces rate limits on mutations:

```yaml
safety:
  maxMutationsPerSession: 10
  cooldownBetweenCriticalMs: 60000  # 1 minute
```

### Session Limits

```
Session: 1234
Mutations: 8/10

[WARNING] Approaching mutation limit (8/10)
After 2 more mutations, this session will be read-only.
```

### Critical Cooldown

```
Last critical operation: 30 seconds ago
Cooldown required: 60 seconds

[WAITING] Cooldown in effect. 30 seconds remaining...
```

## Blocked Operations

Some operations can be permanently blocked:

```yaml
safety:
  blockedOperations:
    - terminate-instances --instance-ids '*'  # Mass termination
    - delete-db-cluster --skip-final-snapshot  # No backup
    - delete-bucket --force                    # Data loss
```

When a blocked operation is attempted:

```
╔════════════════════════════════════════════════════════════╗
║                    OPERATION BLOCKED                        ║
╠════════════════════════════════════════════════════════════╣
║                                                             ║
║  This operation is blocked by policy:                       ║
║  terminate-instances --instance-ids '*'                     ║
║                                                             ║
║  Reason: Mass termination is not permitted via Runbook      ║
║                                                             ║
║  To perform this operation, use the AWS Console or CLI      ║
║  directly with appropriate approvals.                       ║
║                                                             ║
╚════════════════════════════════════════════════════════════╝
```

## Audit Trail

All approvals are logged to the scratchpad:

```json
{
  "type": "approval_requested",
  "operation": "scale_ecs_service",
  "riskLevel": "high",
  "rollbackCommand": "aws ecs update-service...",
  "timestamp": "2024-01-15T15:30:00Z"
}
{
  "type": "approval_granted",
  "approver": "alice@company.com",
  "channel": "slack",
  "timestamp": "2024-01-15T15:30:45Z"
}
{
  "type": "operation_executed",
  "operation": "scale_ecs_service",
  "result": "success",
  "duration": 4523,
  "timestamp": "2024-01-15T15:30:50Z"
}
```

## Configuration

### Full Safety Configuration

```yaml
safety:
  # Which risk levels require approval
  requireApproval:
    - medium_risk
    - high_risk
    - critical

  # Operations that skip approval (use carefully)
  skipApproval:
    - describe
    - list
    - get
    - status

  # Operations that are blocked entirely
  blockedOperations:
    - terminate-instances --instance-ids '*'
    - delete-db-cluster --skip-final-snapshot

  # Rate limiting
  maxMutationsPerSession: 10
  cooldownBetweenCriticalMs: 60000

  # Approval timeout (abort if no response)
  approvalTimeoutMs: 300000  # 5 minutes

  # Require reason for denial
  requireDenialReason: true

  # Multi-approver for critical (requires 2 approvals)
  multiApproverForCritical: false
```

### Per-Operation Overrides

In skill definitions, you can override safety settings:

```yaml
# In a skill definition
steps:
  - id: scale-down
    action: scale_ecs_service
    requiresApproval: true  # Always require, even if config says skip
    riskLevel: high         # Explicit risk level
```

## Best Practices

### For Operators

1. **Review rollback commands** - Ensure you can undo the action
2. **Check impact scope** - Understand what resources are affected
3. **Consider timing** - Avoid high-risk operations during peak hours
4. **Document denials** - Explain why operations were denied

### For Configuration

1. **Start strict** - Require approval for all mutations initially
2. **Loosen gradually** - Add skip rules only after trust is established
3. **Never skip critical** - Critical operations should always require approval
4. **Use blocked operations** - Prevent obviously dangerous actions

## Next Steps

- [CLI Reference](/RunbookAI/cli/overview/) - Explore all commands
- [Skills](/RunbookAI/skills/overview/) - Understanding operational workflows
