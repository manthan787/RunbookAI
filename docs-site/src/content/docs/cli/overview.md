---
title: CLI Overview
description: Complete reference for the Runbook command-line interface
---

Runbook provides a powerful CLI for investigating incidents, querying infrastructure, and executing operational workflows.

## Global Options

These options are available for all commands:

| Option | Description |
|--------|-------------|
| `--config <path>` | Path to config file (default: `.runbook/config.yaml`) |
| `--verbose` | Enable verbose output |
| `--json` | Output in JSON format |
| `--help` | Show help for command |
| `--version` | Show version number |

## Commands

### Core Commands

| Command | Description |
|---------|-------------|
| [`ask`](/RunbookAI/cli/ask/) | Ask natural language questions about infrastructure |
| [`investigate`](/RunbookAI/cli/investigate/) | Investigate incidents using hypothesis-driven analysis |
| [`chat`](/RunbookAI/cli/chat/) | Interactive multi-turn conversation |
| [`deploy`](/RunbookAI/cli/deploy/) | Deploy services using built-in skills |
| [`status`](/RunbookAI/cli/overview/#status) | Quick infrastructure health overview |

### Configuration Commands

| Command | Description |
|---------|-------------|
| [`init`](/RunbookAI/cli/init/) | Interactive setup wizard |
| [`config`](/RunbookAI/cli/config/) | View or modify configuration |

### Knowledge Commands

| Command | Description |
|---------|-------------|
| [`knowledge sync`](/RunbookAI/cli/knowledge/) | Sync knowledge from all sources |
| [`knowledge search`](/RunbookAI/cli/knowledge/) | Search the knowledge base |
| [`knowledge add`](/RunbookAI/cli/knowledge/) | Add a document to the knowledge base |
| [`knowledge validate`](/RunbookAI/cli/knowledge/) | Validate knowledge freshness |
| [`knowledge stats`](/RunbookAI/cli/knowledge/) | Show knowledge base statistics |

### Advanced Commands

| Command | Description |
|---------|-------------|
| [`webhook`](/RunbookAI/cli/webhook/) | Start Slack webhook server |

## Quick Examples

```bash
# Ask about infrastructure
runbook ask "What EC2 instances are running?"

# Investigate an incident
runbook investigate PD-12345

# Interactive chat
runbook chat

# Deploy a service
runbook deploy api-gateway --version 2.0.0

# Check status
runbook status

# Initialize configuration
runbook init

# Search knowledge
runbook knowledge search "database connection issues"
```

## Command: status

Get a quick overview of infrastructure health:

```bash
runbook status
```

Output:
```
Infrastructure Status
═════════════════════

AWS (us-east-1, us-west-2)
  EC2: 24 running, 2 stopped
  ECS: 8 services, all healthy
  RDS: 3 clusters, 1 warning
  Lambda: 15 functions

Kubernetes (production-cluster)
  Nodes: 8/8 Ready
  Pods: 142 running, 3 pending
  Deployments: 18 healthy

Incidents
  PagerDuty: 1 active (SEV2)
  OpsGenie: 0 active

Knowledge Base
  Documents: 127
  Last sync: 2 hours ago
```

### Options

| Option | Description |
|--------|-------------|
| `--aws` | Show only AWS status |
| `--k8s` | Show only Kubernetes status |
| `--incidents` | Show only incident status |
| `--json` | Output as JSON |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Configuration error |
| 3 | Authentication error |
| 4 | Tool execution error |
| 5 | Approval denied |
| 6 | Timeout |

## Environment Variables

The CLI respects these environment variables:

| Variable | Description |
|----------|-------------|
| `RUNBOOK_CONFIG` | Path to config file |
| `RUNBOOK_VERBOSE` | Enable verbose mode (`1` or `true`) |
| `RUNBOOK_NO_COLOR` | Disable color output |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |

## Shell Completion

Enable shell completion for better CLI experience:

```bash
# Bash
runbook completion bash >> ~/.bashrc

# Zsh
runbook completion zsh >> ~/.zshrc

# Fish
runbook completion fish > ~/.config/fish/completions/runbook.fish
```

## Next Steps

Explore individual commands:
- [ask](/RunbookAI/cli/ask/) - Query infrastructure
- [investigate](/RunbookAI/cli/investigate/) - Investigate incidents
- [chat](/RunbookAI/cli/chat/) - Interactive mode
