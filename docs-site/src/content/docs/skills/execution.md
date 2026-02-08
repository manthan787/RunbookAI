---
title: Execution Model
description: How skills are executed
---

Understanding how skills execute helps you write better skills and debug issues.

## Execution Flow

```
┌───────────────────────────────────────────────────────────┐
│                    Skill Invocation                        │
│  runbook deploy checkout-api --version 1.2.3              │
└───────────────────────────────────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────┐
│                   Parameter Validation                     │
│  • Check required parameters present                       │
│  • Apply defaults                                          │
│  • Validate types                                          │
└───────────────────────────────────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────┐
│                    Step Execution                          │
│  For each step:                                            │
│    1. Evaluate condition                                   │
│    2. Resolve templates                                    │
│    3. Check if approval required                           │
│    4. Execute action                                       │
│    5. Handle errors                                        │
│    6. Store result                                         │
└───────────────────────────────────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────┐
│                      Completion                            │
│  • Success: Return results                                 │
│  • Failure: Return error + partial results                 │
│  • All logged to scratchpad                               │
└───────────────────────────────────────────────────────────┘
```

## Step Lifecycle

### 1. Condition Evaluation

Before executing, the step's condition is evaluated:

```yaml
- id: scale-if-needed
  condition: "{{ current_count < target_count }}"
  # Only runs if condition is true
```

If condition is false, the step is skipped.

### 2. Template Resolution

All parameters are resolved:

```yaml
parameters:
  cluster: "{{ cluster }}"
  service: "{{ service_name }}"
  desiredCount: "{{ target_count }}"
```

Variables available:
- Skill parameters
- Previous step results (`steps.<id>.result`)
- Built-in variables (`timestamp`, `user`, etc.)

### 3. Approval Check

If `requiresApproval: true`:

```
╔════════════════════════════════════════════════════════════╗
║                    APPROVAL REQUIRED                        ║
╠════════════════════════════════════════════════════════════╣
║  Skill: deploy-service                                      ║
║  Step: execute-deployment                                   ║
║                                                             ║
║  Action: Deploy checkout-api v1.2.3 to production          ║
║  Risk: HIGH                                                 ║
╚════════════════════════════════════════════════════════════╝

Waiting for approval...
```

Execution pauses until:
- User approves (execution continues)
- User denies (skill aborts)
- Timeout (skill aborts)

### 4. Action Execution

The action (tool) is called:

```typescript
const result = await toolRegistry.execute(step.action, resolvedParams);
```

Execution time is tracked and logged.

### 5. Error Handling

On error, behavior depends on `onError`:

| Value | Behavior |
|-------|----------|
| `abort` (default) | Stop skill, mark as failed |
| `continue` | Log error, continue to next step |
| `retry` | Retry up to `retryCount` times |

### 6. Result Storage

Step result is stored for later use:

```typescript
context.steps[step.id] = {
  result: actionResult,
  duration: executionTime,
  status: 'success' | 'error' | 'skipped',
};
```

## Context Object

Throughout execution, a context object tracks state:

```typescript
interface SkillContext {
  // Skill metadata
  skillId: string;
  sessionId: string;
  startTime: Date;

  // Parameters
  params: Record<string, unknown>;

  // Step results
  steps: Record<string, StepResult>;

  // Execution state
  currentStep: string;
  status: 'running' | 'paused' | 'completed' | 'failed';

  // Approval state
  pendingApproval?: ApprovalRequest;
}
```

## Approval Flow

### Requesting Approval

```typescript
// When requiresApproval is true
const approval = await approvalService.request({
  skillId: context.skillId,
  stepId: step.id,
  action: step.action,
  parameters: resolvedParams,
  riskLevel: skill.riskLevel,
  rollbackCommand: skill.rollback?.command,
});
```

### Approval Channels

1. **CLI**: Interactive prompt
2. **Slack**: Button in channel
3. **API**: Programmatic approval

### Approval States

```
PENDING → APPROVED → (execution continues)
        → DENIED → (skill aborts)
        → TIMEOUT → (skill aborts)
```

## Error Recovery

### Retry Logic

```yaml
- id: flaky-step
  action: external_api
  onError: retry
  retryCount: 3
  retryDelayMs: 5000
  retryBackoff: exponential  # or 'linear', 'constant'
```

Retry sequence:
1. First attempt fails
2. Wait 5s, retry
3. Second attempt fails
4. Wait 10s (exponential), retry
5. Third attempt fails
6. Wait 20s, retry
7. Fourth attempt fails → step fails

### Partial Failure

When a skill fails partway through:

```typescript
{
  status: 'failed',
  completedSteps: ['step-1', 'step-2'],
  failedStep: 'step-3',
  error: 'Connection timeout',
  partialResults: { ... },
  rollbackCommand: 'aws ecs update-service --desired-count 4',
}
```

## Audit Trail

All execution is logged:

```json
{"type": "skill_start", "skillId": "deploy-service", "params": {...}}
{"type": "step_start", "stepId": "check-current", "action": "aws_query"}
{"type": "step_end", "stepId": "check-current", "duration": 234, "status": "success"}
{"type": "approval_requested", "stepId": "deploy", "channel": "slack"}
{"type": "approval_granted", "approver": "alice@company.com"}
{"type": "step_start", "stepId": "deploy", "action": "aws_query"}
{"type": "step_end", "stepId": "deploy", "duration": 1234, "status": "success"}
{"type": "skill_complete", "status": "success", "duration": 12345}
```

## Parallel Execution

By default, steps run sequentially. For parallel execution:

```yaml
steps:
  - id: parallel-group
    parallel: true
    steps:
      - id: check-service-a
        action: health_check
        parameters: { service: service-a }
      - id: check-service-b
        action: health_check
        parameters: { service: service-b }
      - id: check-service-c
        action: health_check
        parameters: { service: service-c }

  - id: after-parallel
    name: Continue after all parallel steps complete
    # ...
```

## Timeouts

### Step Timeout

```yaml
- id: long-step
  timeout: 300000  # 5 minutes
```

### Skill Timeout

```yaml
id: my-skill
timeout: 1800000  # 30 minutes total
```

### Approval Timeout

```yaml
- id: needs-approval
  requiresApproval: true
  approvalTimeout: 600000  # 10 minutes to approve
```

## Cancellation

Skills can be cancelled:

```bash
# Cancel running skill
runbook skill cancel session-abc123
```

On cancellation:
1. Current step completes (not interrupted)
2. No further steps execute
3. Rollback command is shown
4. Status set to 'cancelled'

## Next Steps

- [Custom Skills](/RunbookAI/skills/custom/) - Create your own skills
- [Safety & Approvals](/RunbookAI/concepts/safety/) - Approval system details
