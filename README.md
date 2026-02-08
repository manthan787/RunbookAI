<div align="center">

```
 ____              _                 _       _    ___
|  _ \ _   _ _ __ | |__   ___   ___ | | __  / \  |_ _|
| |_) | | | | '_ \| '_ \ / _ \ / _ \| |/ / / _ \  | |
|  _ <| |_| | | | | |_) | (_) | (_) |   < / ___ \ | |
|_| \_\\__,_|_| |_|_.__/ \___/ \___/|_|\_/_/   \_\___|

             Your AI SRE, always on call
```

[![CI](https://github.com/manthan787/RunbookAI/actions/workflows/ci.yml/badge.svg)](https://github.com/manthan787/RunbookAI/actions/workflows/ci.yml)

</div>

An AI-powered SRE assistant that investigates incidents, executes runbooks, and manages cloud infrastructure using a research-first, hypothesis-driven methodology.

## Features

- **Hypothesis-Driven Investigation**: Forms and tests hypotheses about incidents, branches on strong evidence, prunes dead ends
- **Research-First Operations**: Always gathers context before suggesting changes
- **Knowledge Integration**: Indexes and retrieves organizational runbooks, post-mortems, and architecture docs
- **Dynamic Skill Execution**: Built-in and user-defined skills are loaded at runtime and executed step-by-step with approval hooks
- **Kubernetes Query Surface**: First-class read-only Kubernetes operations for cluster status, workloads, and events
- **Incident Provider Parity**: PagerDuty and OpsGenie are both supported in core config validation
- **Full Audit Trail**: Every tool call, hypothesis, and decision is logged
- **Safety First**: Mutations require approval with rollback commands

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/runbook.git
cd runbook

# Install dependencies
bun install

# Set up configuration
mkdir -p .runbook
cp examples/config.yaml .runbook/config.yaml
# Edit .runbook/config.yaml with your settings

# Set your API key
export ANTHROPIC_API_KEY=your-api-key
```

## Quick Start

```bash
# Ask about your infrastructure
bun run dev ask "What EC2 instances are running in prod?"

# Ask about Kubernetes state
bun run dev ask "Show cluster status, top nodes, and any warning events"

# Investigate an incident
bun run dev investigate PD-12345

# Investigate + execute remediation steps via skills
bun run dev investigate PD-12345 --auto-remediate

# Get a status overview
bun run dev status
```

## Commands

### `runbook ask <query>`

Ask questions about your infrastructure in natural language.

```bash
runbook ask "What's the status of the checkout-api service?"
runbook ask "Show me RDS instances with high CPU"
runbook ask "Who owns the payments service?"
```

### `runbook investigate <incident-id>`

Perform a hypothesis-driven investigation of a PagerDuty or OpsGenie incident.

```bash
runbook investigate PD-12345
runbook investigate PD-12345 --auto-remediate
```

The agent will:
1. Gather incident context
2. Form initial hypotheses
3. Test each hypothesis with targeted queries
4. Branch deeper on strong evidence
5. Identify root cause with confidence level
6. Suggest remediation

### `runbook status`

Get a quick overview of your infrastructure health.

### `runbook knowledge sync`

Sync knowledge from all configured sources (runbooks, post-mortems, etc.).

### `runbook knowledge search <query>`

Search the knowledge base.

```bash
runbook knowledge search "redis connection timeout"
```

### `runbook slack-gateway`

Start Slack mention/event handling for `@runbookAI` requests in alert channels.

```bash
# Local development (Socket Mode)
runbook slack-gateway --mode socket

# HTTP Events API mode
runbook slack-gateway --mode http --port 3001
```

See setup details in [docs/SLACK_GATEWAY.md](./docs/SLACK_GATEWAY.md).

## Configuration

Create `.runbook/config.yaml`:

```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-20250514

providers:
  aws:
    enabled: true
    regions: [us-east-1, us-west-2]
  kubernetes:
    enabled: false

incident:
  pagerduty:
    enabled: true
    apiKey: ${PAGERDUTY_API_KEY}
  opsgenie:
    enabled: false
    apiKey: ${OPSGENIE_API_KEY}
  slack:
    enabled: false
    botToken: ${SLACK_BOT_TOKEN}
    appToken: ${SLACK_APP_TOKEN}
    signingSecret: ${SLACK_SIGNING_SECRET}
    events:
      enabled: false
      mode: socket
      port: 3001
      alertChannels: [C01234567]
      allowedUsers: [U01234567]
      requireThreadedMentions: true

knowledge:
  sources:
    - type: filesystem
      path: .runbook/runbooks/
      watch: true
```

See [PLAN.md](./PLAN.md) for full configuration options.

## Recent Changes

- Skill execution now runs real workflows via `SkillExecutor` through the `skill` tool.
- CLI runtime now loads dynamic skills from registry and injects knowledge retrieval into agent runtime.
- Main config schema now includes OpsGenie under `incident.opsgenie` with validation.
- Added `kubernetes_query` tool with read-only actions:
  - `status`, `contexts`, `namespaces`, `pods`, `deployments`, `nodes`, `events`, `top_pods`, `top_nodes`
- Detailed implementation log: [CODEX_PLAN.md](./CODEX_PLAN.md)

## Adding Runbooks

Create markdown files in `.runbook/runbooks/` with frontmatter:

```markdown
---
type: runbook
services: [checkout-api, cart-service]
symptoms:
  - "Redis connection timeout"
  - "Connection pool exhausted"
severity: sev2
---

# Redis Connection Exhaustion

## Symptoms
...

## Quick Diagnosis
...

## Mitigation Steps
...
```

See `examples/runbooks/` for examples.

## Architecture

```
Query/Incident
    ↓
Knowledge Retrieval (runbooks, post-mortems)
    ↓
Hypothesis Formation
    ↓
Targeted Evidence Gathering
    ↓
Branch (strong evidence) / Prune (no evidence)
    ↓
Root Cause + Confidence
    ↓
Remediation (with approval)
    ↓
Scratchpad (full audit trail)
```

## Development

```bash
# Run in development mode
bun run dev ask "test query"

# Type check
bun run typecheck

# Lint
bun run lint

# Format
bun run format
```

## License

MIT
