---
title: init
description: Interactive setup wizard for Runbook
---

The `init` command runs an interactive setup wizard that guides you through configuring Runbook for your environment.

## Usage

```bash
runbook init [options]
```

## Interactive Wizard

```bash
$ runbook init

╔════════════════════════════════════════════════════════════╗
║                    Runbook Setup Wizard                     ║
║  Let's configure Runbook for your environment.              ║
╚════════════════════════════════════════════════════════════╝

Step 1: LLM Provider
────────────────────
Which AI provider would you like to use?

  ❯ Anthropic (Claude) - Recommended
    OpenAI (GPT-4)
    Google (Gemini)
    Mistral
    Other

Selected: Anthropic

Enter your Anthropic API key:
  (or press Enter to use ANTHROPIC_API_KEY env var)
  > ********

✓ API key validated

Which model would you like to use?
  ❯ claude-opus-4-5-20251101 (Most capable, higher cost)
    claude-sonnet-4-20250514 (Balanced)
    claude-3-haiku (Fastest, lowest cost)

Selected: claude-opus-4-5-20251101

Step 2: Cloud Providers
───────────────────────
Which cloud providers do you use?

  [x] AWS
  [ ] Google Cloud
  [ ] Azure
  [x] Kubernetes

AWS Configuration:
  Which regions? (comma-separated)
  > us-east-1, us-west-2

  AWS Profile (or Enter for default):
  > production

  ✓ AWS credentials validated for 2 regions

Kubernetes Configuration:
  Which context? (current: production-east)
  > production-east

  Default namespace?
  > default

  ✓ Kubernetes connection validated

Step 3: Incident Management
───────────────────────────
Which incident management tools do you use?

  [x] PagerDuty
  [x] OpsGenie
  [x] Slack

PagerDuty Configuration:
  API Key: ********
  ✓ PagerDuty connected (3 services found)

OpsGenie Configuration:
  API Key: ********
  Region: US
  ✓ OpsGenie connected

Slack Configuration:
  Bot Token: xoxb-********
  ✓ Slack connected

  Default channel for notifications:
  > #incidents

  Channel for approval requests:
  > #runbook-approvals

Step 4: Knowledge Sources
─────────────────────────
Where do you store operational documentation?

  [x] Local filesystem
  [ ] Confluence
  [ ] Notion
  [ ] GitHub repository

Local filesystem path:
  > .runbook/runbooks/

  ✓ Directory created
  ✓ Example runbook added

Step 5: Safety Settings
───────────────────────
Configure approval requirements:

  Require approval for:
  [x] Low risk operations
  [x] Medium risk operations
  [x] High risk operations
  [x] Critical operations

  Max mutations per session:
  > 10

  Cooldown between critical operations (seconds):
  > 60

═══════════════════════════════════════════════════════════════
                    Configuration Complete
═══════════════════════════════════════════════════════════════

Created files:
  .runbook/config.yaml        - Main configuration
  .runbook/runbooks/          - Runbook directory
  .runbook/runbooks/example.md - Example runbook

Next steps:
  1. Add your runbooks to .runbook/runbooks/
  2. Run: runbook knowledge sync
  3. Try: runbook ask "What EC2 instances are running?"

For help: runbook --help
```

## Options

| Option | Description |
|--------|-------------|
| `--template <name>` | Use a pre-configured template |
| `--regions <list>` | Pre-set AWS regions |
| `--non-interactive` | Use defaults, don't prompt |
| `--force` | Overwrite existing configuration |

## Templates

Use templates for faster setup:

```bash
# ECS + RDS focused template
runbook init --template ecs-rds

# Full enterprise stack
runbook init --template enterprise --regions us-east-1,us-west-2,eu-west-1

# Kubernetes-focused
runbook init --template kubernetes

# Minimal (just LLM)
runbook init --template minimal
```

### Available Templates

| Template | Includes |
|----------|----------|
| `minimal` | LLM only, no integrations |
| `ecs-rds` | AWS (ECS, RDS, CloudWatch) |
| `kubernetes` | Kubernetes-focused |
| `enterprise` | All integrations, strict safety |
| `startup` | Lightweight, fewer approvals |

## Editing Existing Configuration

If configuration already exists, init offers to edit:

```bash
$ runbook init

Existing configuration found at .runbook/config.yaml

What would you like to do?
  ❯ Edit existing configuration
    Start fresh (backup existing)
    Cancel

Editing existing configuration...

Current settings:
  LLM: anthropic/claude-opus-4-5-20251101
  AWS: us-east-1, us-west-2
  Kubernetes: enabled
  PagerDuty: enabled
  Slack: enabled

What would you like to modify?
  [ ] LLM Provider
  [x] AWS Regions
  [ ] Kubernetes
  [ ] Incident Management
  [x] Safety Settings

AWS Regions (current: us-east-1, us-west-2):
  > us-east-1, us-west-2, eu-west-1

Safety Settings:
  Current max mutations: 10
  New value (Enter to keep): 15

✓ Configuration updated
```

## Non-Interactive Mode

For CI/CD or scripted setup:

```bash
# Use all defaults
runbook init --non-interactive

# With specific options
runbook init --non-interactive \
  --template enterprise \
  --regions us-east-1,us-west-2
```

Required environment variables for non-interactive:
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`
- `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (if using AWS)
- `PAGERDUTY_API_KEY` (if using PagerDuty)

## Generated Configuration

Example generated `.runbook/config.yaml`:

```yaml
# Generated by runbook init
# 2024-01-15T15:30:00Z

llm:
  provider: anthropic
  model: claude-opus-4-5-20251101
  apiKey: ${ANTHROPIC_API_KEY}

providers:
  aws:
    enabled: true
    regions:
      - us-east-1
      - us-west-2
    profile: production

  kubernetes:
    enabled: true
    context: production-east
    namespace: default

incident:
  pagerduty:
    enabled: true
    apiKey: ${PAGERDUTY_API_KEY}

  opsgenie:
    enabled: true
    apiKey: ${OPSGENIE_API_KEY}

  slack:
    enabled: true
    botToken: ${SLACK_BOT_TOKEN}
    defaultChannel: "#incidents"
    approvalChannel: "#runbook-approvals"

knowledge:
  sources:
    - type: filesystem
      path: .runbook/runbooks/
      watch: true

  store:
    type: local
    path: .runbook/knowledge.db

safety:
  requireApproval:
    - low_risk
    - medium_risk
    - high_risk
    - critical
  maxMutationsPerSession: 10
  cooldownBetweenCriticalMs: 60000
```

## Next Steps

After running init:

1. Add runbooks to `.runbook/runbooks/`
2. Sync knowledge: `runbook knowledge sync`
3. Test configuration: `runbook config`
4. Try a query: `runbook ask "Show infrastructure status"`
