# Runbook

An AI-powered SRE assistant that investigates incidents, executes runbooks, and manages cloud infrastructure using a research-first, hypothesis-driven methodology.

## Features

- **Hypothesis-Driven Investigation**: Forms and tests hypotheses about incidents, branches on strong evidence, prunes dead ends
- **Research-First Operations**: Always gathers context before suggesting changes
- **Knowledge Integration**: Indexes and retrieves organizational runbooks, post-mortems, and architecture docs
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

# Investigate an incident
bun run dev investigate PD-12345

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

incident:
  pagerduty:
    enabled: true
    api_key: ${PAGERDUTY_API_KEY}

knowledge:
  sources:
    - type: filesystem
      path: .runbook/runbooks/
      watch: true
```

See [PLAN.md](./PLAN.md) for full configuration options.

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
