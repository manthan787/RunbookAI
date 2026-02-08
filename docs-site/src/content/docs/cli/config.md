---
title: config
description: View and modify Runbook configuration
---

The `config` command displays and modifies your Runbook configuration.

## Usage

```bash
runbook config [options]
```

## View Configuration

### Full Configuration

```bash
$ runbook config

Current Configuration (.runbook/config.yaml)
═════════════════════════════════════════════

LLM:
  Provider: anthropic
  Model: claude-opus-4-5-20251101
  API Key: ••••••••••••3f8a (set)

AWS:
  Enabled: true
  Regions: us-east-1, us-west-2
  Profile: production

Kubernetes:
  Enabled: true
  Context: production-east
  Namespace: default

Incident Management:
  PagerDuty: enabled
  OpsGenie: enabled
  Slack: enabled (#incidents)

Knowledge:
  Sources: 1 configured
  Store: .runbook/knowledge.db (24.5 MB)
  Documents: 135

Safety:
  Approval required: all levels
  Max mutations: 10/session
  Critical cooldown: 60s
```

### Specific Sections

```bash
# Show AWS configuration
runbook config --providers

# Show services/integrations
runbook config --services

# Show safety settings
runbook config --safety
```

### Validate Configuration

```bash
$ runbook config --validate

Validating configuration...

✓ LLM provider configured
✓ API key valid
✓ AWS credentials valid for 2 regions
✓ Kubernetes context accessible
✓ PagerDuty API key valid
✓ OpsGenie API key valid
✓ Slack bot token valid
✓ Knowledge store accessible

All checks passed!
```

## Modify Configuration

### Set Values

```bash
# Set LLM model
runbook config --set llm.model=claude-sonnet-4-20250514

# Enable Kubernetes
runbook config --set providers.kubernetes.enabled=true

# Add a region
runbook config --set providers.aws.regions+=eu-west-1

# Change safety setting
runbook config --set safety.maxMutationsPerSession=20
```

### Interactive Edit

```bash
$ runbook config --edit

Opening configuration in editor...
[Opens $EDITOR with config.yaml]

Configuration updated:
  Changed: llm.model (claude-opus-4-5-20251101 → claude-sonnet-4-20250514)
  Changed: safety.maxMutationsPerSession (10 → 15)
```

## Options

| Option | Description |
|--------|-------------|
| `--providers` | Show only provider configuration |
| `--services` | Show only service/integration configuration |
| `--safety` | Show only safety settings |
| `--set <key=value>` | Set a configuration value |
| `--edit` | Open configuration in editor |
| `--validate` | Validate configuration |
| `--json` | Output as JSON |
| `--path` | Show configuration file path |

## Configuration Keys

### LLM Settings

| Key | Description |
|-----|-------------|
| `llm.provider` | anthropic, openai, google, etc. |
| `llm.model` | Model name |
| `llm.apiKey` | API key (or env var reference) |

### Provider Settings

| Key | Description |
|-----|-------------|
| `providers.aws.enabled` | Enable AWS integration |
| `providers.aws.regions` | List of AWS regions |
| `providers.aws.profile` | AWS CLI profile |
| `providers.kubernetes.enabled` | Enable Kubernetes |
| `providers.kubernetes.context` | kubectl context |
| `providers.kubernetes.namespace` | Default namespace |

### Incident Settings

| Key | Description |
|-----|-------------|
| `incident.pagerduty.enabled` | Enable PagerDuty |
| `incident.pagerduty.apiKey` | PagerDuty API key |
| `incident.opsgenie.enabled` | Enable OpsGenie |
| `incident.slack.enabled` | Enable Slack |
| `incident.slack.botToken` | Slack bot token |
| `incident.slack.defaultChannel` | Default notification channel |

### Safety Settings

| Key | Description |
|-----|-------------|
| `safety.requireApproval` | List of risk levels requiring approval |
| `safety.maxMutationsPerSession` | Max write operations per session |
| `safety.cooldownBetweenCriticalMs` | Milliseconds between critical ops |

## Environment Variable Resolution

Configuration supports environment variable interpolation:

```yaml
llm:
  apiKey: ${ANTHROPIC_API_KEY}

providers:
  aws:
    profile: ${AWS_PROFILE:-default}  # With default value
```

Check resolved values:

```bash
$ runbook config --resolved

LLM:
  API Key: sk-ant-...3f8a (resolved from ANTHROPIC_API_KEY)

AWS:
  Profile: production (resolved from AWS_PROFILE)
```

## Configuration Precedence

Values are resolved in order (highest priority first):

1. Command-line flags (`--set`)
2. Environment variables
3. Configuration file (`.runbook/config.yaml`)
4. Default values

```bash
# Override via command line
runbook ask "query" --region us-west-2

# Override via environment
AWS_REGION=us-west-2 runbook ask "query"

# Use config file value
runbook ask "query"  # Uses providers.aws.regions[0]
```

## Export/Import

### Export Configuration

```bash
# Export to JSON
runbook config --json > config-backup.json

# Export without secrets
runbook config --json --no-secrets > config-public.json
```

### Import Configuration

```bash
# Import from backup
runbook config --import config-backup.json

# Merge with existing
runbook config --import new-settings.json --merge
```

## Next Steps

- [Configuration Reference](/RunbookAI/getting-started/configuration/) - Full configuration documentation
- [init](/RunbookAI/cli/init/) - Interactive setup wizard
