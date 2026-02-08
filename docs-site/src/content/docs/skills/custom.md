---
title: Custom Skills
description: Create your own skills
---

Create custom skills to encode your organization's operational procedures.

## Skill Location

Place custom skills in:

```
.runbook/skills/
├── my-skill.yaml
├── another-skill.yaml
└── team/
    └── team-specific-skill.yaml
```

Configure the path:

```yaml
skills:
  customPath: .runbook/skills/
```

## Skill Schema

```yaml
# Metadata
id: unique-skill-id          # Required, lowercase with dashes
name: Human Readable Name     # Required
description: What this skill does
version: 1.0.0

# Parameters the skill accepts
parameters:
  - name: param_name
    description: What this parameter is for
    type: string | integer | boolean | array
    required: true | false
    default: optional-default-value

# Execution steps
steps:
  - id: step-id
    name: Step Name
    action: tool_name
    parameters:
      key: value
    condition: optional-condition
    requiresApproval: false
    onError: continue | abort | retry
    retryCount: 3
    timeout: 30000

# Risk classification
riskLevel: low | medium | high | critical

# Rollback command
rollback:
  command: "command to undo changes"
```

## Example: Database Backup Skill

```yaml
id: backup-database
name: Backup Database
description: Create a manual RDS snapshot
version: 1.0.0

parameters:
  - name: db_identifier
    description: RDS instance or cluster identifier
    type: string
    required: true
  - name: snapshot_name
    description: Name for the snapshot
    type: string
    required: false
    default: "manual-{{ timestamp }}"

steps:
  - id: check-db-status
    name: Verify database is available
    action: aws_query
    parameters:
      service: rds
      operation: describe-db-instances
      DBInstanceIdentifier: "{{ db_identifier }}"
    onError: abort

  - id: check-existing-snapshots
    name: Check for recent snapshots
    action: aws_query
    parameters:
      service: rds
      operation: describe-db-snapshots
      DBInstanceIdentifier: "{{ db_identifier }}"
      MaxRecords: 5

  - id: create-snapshot
    name: Create snapshot
    action: aws_query
    requiresApproval: true
    parameters:
      service: rds
      operation: create-db-snapshot
      DBInstanceIdentifier: "{{ db_identifier }}"
      DBSnapshotIdentifier: "{{ snapshot_name }}"

  - id: wait-for-snapshot
    name: Wait for snapshot completion
    action: aws_query
    parameters:
      service: rds
      operation: wait-db-snapshot-available
      DBSnapshotIdentifier: "{{ snapshot_name }}"
    timeout: 600000  # 10 minutes

  - id: verify-snapshot
    name: Verify snapshot
    action: aws_query
    parameters:
      service: rds
      operation: describe-db-snapshots
      DBSnapshotIdentifier: "{{ snapshot_name }}"

riskLevel: medium
rollback:
  command: "aws rds delete-db-snapshot --db-snapshot-identifier {{ snapshot_name }}"
```

## Template Syntax

Use Jinja2-style templating:

### Variable Interpolation

```yaml
parameters:
  message: "Deploying {{ service_name }} version {{ version }}"
```

### Step Results

```yaml
steps:
  - id: get-count
    name: Get current count
    action: aws_query
    # ...

  - id: use-result
    name: Use previous result
    parameters:
      current: "{{ steps.get-count.result.services[0].runningCount }}"
```

### Built-in Variables

| Variable | Description |
|----------|-------------|
| `{{ timestamp }}` | Current ISO timestamp |
| `{{ date }}` | Current date (YYYY-MM-DD) |
| `{{ user }}` | Current user |
| `{{ session_id }}` | Runbook session ID |

## Conditions

Execute steps conditionally:

```yaml
steps:
  - id: scale-if-needed
    name: Scale if below target
    condition: "{{ current_count < target_count }}"
    action: aws_query
    # ...

  - id: skip-if-healthy
    name: Skip if already healthy
    condition: "{{ health_check.result.status != 'healthy' }}"
    action: troubleshoot
    # ...
```

### Condition Operators

```yaml
# Comparisons
condition: "{{ count > 5 }}"
condition: "{{ status == 'running' }}"
condition: "{{ name != 'excluded' }}"

# Boolean
condition: "{{ enabled and not maintenance }}"
condition: "{{ errors > 0 or warnings > 10 }}"

# String operations
condition: "{{ 'prod' in environment }}"
condition: "{{ name.startswith('api-') }}"
```

## Error Handling

Control behavior on errors:

```yaml
steps:
  - id: optional-step
    name: Optional enhancement
    action: some_action
    onError: continue  # Don't fail the skill

  - id: critical-step
    name: Must succeed
    action: important_action
    onError: abort  # Fail the skill immediately

  - id: retry-step
    name: Retry on failure
    action: flaky_action
    onError: retry
    retryCount: 3
    retryDelayMs: 5000
```

## Approval Gates

Pause for human approval:

```yaml
steps:
  - id: dangerous-operation
    name: Delete old data
    action: delete_data
    requiresApproval: true
    approvalMessage: "This will delete data older than 90 days"
```

When reached, execution pauses until approved via:
- CLI prompt
- Slack button
- API call

## Timeouts

Set step-level timeouts:

```yaml
steps:
  - id: long-operation
    name: Wait for deployment
    action: wait_for_stable
    timeout: 600000  # 10 minutes in ms
```

Skill-level timeout:

```yaml
id: my-skill
timeout: 1800000  # 30 minutes for entire skill
```

## Actions Reference

Skills can use any Runbook tool as an action:

| Action | Description |
|--------|-------------|
| `aws_query` | AWS API operations |
| `kubernetes_query` | Kubernetes operations |
| `slack_post_message` | Post to Slack |
| `slack_send_approval_request` | Request approval |
| `search_knowledge` | Search knowledge base |
| `validate` | Validate conditions |
| `wait` | Wait for time/condition |
| `http_request` | Generic HTTP calls |

## Testing Skills

Validate skill syntax:

```bash
runbook skill validate .runbook/skills/my-skill.yaml
```

Dry run:

```bash
runbook skill run my-skill --dry-run \
  --param db_identifier=prod-db
```

## Next Steps

- [Execution Model](/RunbookAI/skills/execution/) - How skills run
- [Built-in Skills](/RunbookAI/skills/builtin/) - Reference implementations
