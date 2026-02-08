---
title: Skills Overview
description: Understanding Runbook's skill system
---

Skills are reusable, multi-step workflows that encode operational expertise. They provide structured, auditable execution of common tasks like deployments, scaling, and investigations.

## What Are Skills?

Skills are like enhanced runbooks that can be executed automatically:

- **Defined in YAML** - Human-readable workflow definitions
- **Step-by-step** - Execute actions in sequence with conditions
- **Approval gates** - Pause for human approval when needed
- **Error handling** - Retry, continue, or abort on failures
- **Audit trail** - Full logging of all actions

## Example Skill

```yaml
id: scale-service
name: Scale Service
description: Safely scale an ECS or Kubernetes service
version: 1.0.0

parameters:
  - name: service_name
    description: Name of the service to scale
    type: string
    required: true
  - name: target_count
    description: Target number of replicas
    type: integer
    required: true
  - name: cluster
    description: ECS cluster or K8s namespace
    type: string
    required: true

steps:
  - id: check-current-state
    name: Check current state
    action: aws_query
    parameters:
      service: ecs
      operation: describe-services
      cluster: "{{ cluster }}"
      services: ["{{ service_name }}"]

  - id: validate-target
    name: Validate target count
    condition: "{{ steps.check-current-state.result.services[0].runningCount != target_count }}"
    action: validate
    parameters:
      rules:
        - "{{ target_count > 0 }}"
        - "{{ target_count <= 100 }}"

  - id: request-approval
    name: Request approval
    action: slack_send_approval_request
    requiresApproval: true
    parameters:
      message: "Scale {{ service_name }} from {{ current_count }} to {{ target_count }} replicas"
      riskLevel: high

  - id: execute-scale
    name: Scale service
    action: aws_query
    parameters:
      service: ecs
      operation: update-service
      cluster: "{{ cluster }}"
      service: "{{ service_name }}"
      desiredCount: "{{ target_count }}"

  - id: wait-for-stability
    name: Wait for service stability
    action: aws_query
    parameters:
      service: ecs
      operation: wait-services-stable
      cluster: "{{ cluster }}"
      services: ["{{ service_name }}"]
    timeout: 300000

  - id: verify-health
    name: Verify service health
    action: health_check
    parameters:
      service: "{{ service_name }}"
      threshold: 0.95

riskLevel: high
rollback:
  command: "aws ecs update-service --cluster {{ cluster }} --service {{ service_name }} --desired-count {{ original_count }}"
```

## How Skills Execute

```
Skill Invocation
       │
       ▼
┌──────────────┐
│ Parse Params │ ← Validate required parameters
└──────────────┘
       │
       ▼
┌──────────────┐
│   Step 1     │ ← Execute, check condition
└──────────────┘
       │
       ▼
┌──────────────┐
│   Step 2     │ ← May require approval
└──────────────┘
       │
   [Approval]  ← Human reviews, approves/denies
       │
       ▼
┌──────────────┐
│   Step 3     │ ← Continue on approval
└──────────────┘
       │
       ▼
   Complete/Fail
```

## Skill Categories

| Category | Skills |
|----------|--------|
| **Investigation** | investigate-incident |
| **Deployment** | deploy-service, rollback-deployment |
| **Scaling** | scale-service |
| **Troubleshooting** | troubleshoot-service |
| **Cost** | cost-analysis, investigate-cost-spike |
| **Security** | security-audit |

## Using Skills

### Via CLI

```bash
# Deploy a service
runbook deploy checkout-api --version 1.2.3

# Scale a service
runbook ask "Scale checkout-api to 8 replicas"

# Run investigation skill
runbook investigate PD-12345
```

### Via Agent

During investigations, Runbook automatically identifies and uses relevant skills:

```
Root cause identified: Traffic spike
Remediation: Scale RDS read replicas

Matched skill: scale-service
Parameters:
  service_name: prod-db
  target_count: 4
  cluster: prod

[Execute skill?] [y/N]
```

## Skill Resolution

When Runbook needs to perform an action, it:

1. **Identifies action type** - Scale, deploy, investigate, etc.
2. **Searches skills** - Find matching skill by ID or action
3. **Validates parameters** - Ensure required params are available
4. **Executes skill** - Run steps with approval gates

## Configuration

```yaml
skills:
  # Enable skill system
  enabled: true

  # Built-in skills
  builtinEnabled: true

  # Custom skills directory
  customPath: .runbook/skills/

  # Default approval behavior
  defaultApproval: required  # required, optional, skip
```

## Next Steps

- [Built-in Skills](/RunbookAI/skills/builtin/) - Available skills
- [Custom Skills](/RunbookAI/skills/custom/) - Create your own
- [Execution Model](/RunbookAI/skills/execution/) - How skills run
