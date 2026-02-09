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

### `runbook knowledge auth google`

Authenticate with Google Drive for knowledge sync.

```bash
# Set up OAuth credentials first
export GOOGLE_CLIENT_ID=your-client-id
export GOOGLE_CLIENT_SECRET=your-client-secret

# Run authentication flow
runbook knowledge auth google
```

This opens a browser for Google OAuth consent and saves the refresh token to your config.

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

    # Confluence Cloud/Server
    - type: confluence
      baseUrl: https://mycompany.atlassian.net
      spaceKey: SRE
      labels: [runbook, postmortem]
      auth:
        email: ${CONFLUENCE_EMAIL}
        apiToken: ${CONFLUENCE_API_TOKEN}

    # Google Drive (requires OAuth - run `runbook knowledge auth google`)
    - type: google_drive
      folderIds: ['your-folder-id']
      clientId: ${GOOGLE_CLIENT_ID}
      clientSecret: ${GOOGLE_CLIENT_SECRET}
      refreshToken: ${GOOGLE_REFRESH_TOKEN}
      includeSubfolders: true
```

See [PLAN.md](./PLAN.md) for full configuration options.

## Investigation Evaluation

Run real-loop investigation benchmarks against fixture datasets:

```bash
npm run eval:investigate -- \
  --fixtures examples/evals/rcaeval-fixtures.generated.json \
  --out .runbook/evals/rcaeval-report.json
```

Run all benchmark adapters in one command (RCAEval + Rootly + TraceRCA):

```bash
npm run eval:all -- \
  --out-dir .runbook/evals/all-benchmarks \
  --rcaeval-input examples/evals/rcaeval-input.sample.json \
  --tracerca-input examples/evals/tracerca-input.sample.json
```

This generates per-benchmark reports plus an aggregate summary:
- `.runbook/evals/all-benchmarks/rcaeval-report.json`
- `.runbook/evals/all-benchmarks/rootly-report.json`
- `.runbook/evals/all-benchmarks/tracerca-report.json`
- `.runbook/evals/all-benchmarks/summary.json`

See [docs/INVESTIGATION_EVAL.md](./docs/INVESTIGATION_EVAL.md) for dataset setup and converter workflows.

## Recent Changes

- **Knowledge Sources**: Added Confluence and Google Drive integrations for syncing runbooks and architecture docs
  - Confluence: REST API v2 with label filtering, HTML→markdown conversion
  - Google Drive: OAuth2 flow, Google Docs/Sheets export, incremental sync
  - New command: `runbook knowledge auth google` for OAuth setup
- Investigation eval harness now supports RCAEval, Rootly logs, and TraceRCA conversion with a unified multi-benchmark runner (`npm run eval:all`) and per-benchmark JSON reports.
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
