<div align="center">

```
 ____              _                 _       _    ___
|  _ \ _   _ _ __ | |__   ___   ___ | | __  / \  |_ _|
| |_) | | | | '_ \| '_ \ / _ \ / _ \| |/ / / _ \  | |
|  _ <| |_| | | | | |_) | (_) | (_) |   < / ___ \ | |
|_| \_\\__,_|_| |_|_.__/ \___/ \___/|_|\_/_/   \_\___|

             Your AI SRE, always on call
```

[![CI](https://github.com/Runbook-Agent/RunbookAI/actions/workflows/ci.yml/badge.svg)](https://github.com/Runbook-Agent/RunbookAI/actions/workflows/ci.yml)

</div>

RunbookAI helps on-call engineers go from alert to likely root cause faster with hypothesis-driven investigation, runbook-aware context, and approval-gated remediation.

Built for SRE and platform teams operating AWS and Kubernetes who need speed without losing auditability.

## Try It Now (No API Keys Required)

See RunbookAI's hypothesis-driven investigation in action:

```bash
npx @runbook-agent/runbook demo
```

Watch the agent investigate a simulated incident—forming hypotheses, gathering evidence, and identifying root cause—all in your terminal.

```text
⚠  INCIDENT ALERT
   ID: DEMO-001
   High latency on checkout-api

▸ Gathering incident context...
  ┌─ get_incident_details
  └─ Severity: High, Error rate: 15%, P99 latency: 2,500ms

▸ Forming hypotheses...
  H1: Redis connection pool exhaustion (72%)
  H2: Database connection pool exhaustion (54%)

▸ Testing H1: Redis connection exhaustion...
  ✓ Evidence: Redis connections at 847/1000 (340% above baseline)
  ✓ Evidence: Traffic spike correlates with connection exhaustion

 ROOT CAUSE IDENTIFIED
  Redis connection pool exhaustion due to traffic spike
  Confidence: 94%
```

Use `--fast` for a quicker demo: `npx @runbook-agent/runbook demo --fast`

## Get Started

### Install

```bash
npm install -g @runbook-agent/runbook
```

Package: [`@runbook-agent/runbook`](https://www.npmjs.com/package/@runbook-agent/runbook)

### Configure

```bash
# Set your API key
export ANTHROPIC_API_KEY=your-api-key

# Run the setup wizard
runbook init
```

### Run Your First Investigation

```bash
runbook investigate PD-12345
```

Expected output:
```text
Investigation: PD-12345
Hypothesis: checkout-api latency spike caused by Redis connection exhaustion (confidence: 0.86)
Evidence: CloudWatch errors, Redis saturation, pod restart timeline
Next step: apply runbook "Redis Connection Exhaustion" (approval required)
```

### From Source (Development)

Prerequisites: Node.js 20+, Bun

```bash
git clone https://github.com/Runbook-Agent/RunbookAI.git runbook
cd runbook
bun install
bun run dev investigate PD-12345
```

## Why Teams Adopt RunbookAI
- Faster triage: Research-first and hypothesis-driven workflows reduce alert-to-understanding time.
- Safer execution: Mutating actions require approval and can include rollback guidance.
- Operational memory: Knowledge retrieval uses your runbooks, postmortems, and architecture notes.

## Why Teams Trust It
- Full audit trail of queries, hypotheses, and decisions.
- Approval gates for sensitive actions.
- Kubernetes access is read-only by default and can be explicitly enabled.

## Core Capabilities
- Hypothesis-driven incident investigation with branch/prune logic.
- Runtime skill execution with approval-aware workflow steps.
- Dynamic skill and knowledge wiring at runtime.
- Incident integrations for PagerDuty and OpsGenie.
- Claude Code integration with context injection and safety hooks.
- MCP server exposing searchable operational knowledge.

## Commands

Commands below use the installed `runbook` binary. During local development, use `bun run dev <command>`.

### `runbook demo`

Run a pre-scripted investigation demo showcasing RunbookAI's hypothesis-driven workflow. No API keys or configuration required.

```bash
runbook demo           # Normal speed
runbook demo --fast    # 3x speed
```

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
runbook investigate PD-12345 --learn
runbook investigate PD-12345 --learn --apply-runbook-updates
```

The agent will:
1. Gather incident context
2. Form initial hypotheses
3. Test each hypothesis with targeted queries
4. Branch deeper on strong evidence
5. Identify root cause with confidence level
6. Suggest remediation

With `--learn`, Runbook also writes learning artifacts to `.runbook/learning/<investigation-id>/`:
1. `postmortem-<incident>.md` draft
2. `knowledge-suggestions.json`
3. runbook update proposals (or direct updates with `--apply-runbook-updates`)

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

### Claude Code Integration

RunbookAI integrates deeply with [Claude Code](https://claude.ai/claude-code) to provide contextual knowledge during your AI-assisted debugging sessions.

#### `runbook integrations claude enable`

Install Claude Code hooks for automatic context injection:

```bash
# Project-scoped install (recommended)
runbook integrations claude enable

# Check installation
runbook integrations claude status
```

When enabled, RunbookAI automatically:
- **Injects relevant context**: Detects services and symptoms in your prompts and provides matching runbooks and known issues
- **Blocks dangerous commands**: Prevents accidental destructive operations (kubectl delete, rm -rf, etc.)
- **Tracks session state**: Maintains investigation context across prompts

#### `runbook mcp serve`

Start an MCP server exposing RunbookAI knowledge as tools Claude Code can query:

```bash
# Start MCP server
runbook mcp serve

# List available tools
runbook mcp tools
```

Available tools: `search_runbooks`, `get_known_issues`, `search_postmortems`, `get_knowledge_stats`, `list_services`

#### `runbook checkpoint` Commands

Save and resume investigation state across sessions:

```bash
# List checkpoints for an investigation
runbook checkpoint list --investigation inv-12345

# Show checkpoint details
runbook checkpoint show abc123def456 --investigation inv-12345

# Delete a specific checkpoint
runbook checkpoint delete abc123def456 --investigation inv-12345

# Delete all checkpoints for an investigation
runbook checkpoint delete --investigation inv-12345 --all
```

See [docs/CLAUDE_INTEGRATION.md](./docs/CLAUDE_INTEGRATION.md) for full documentation.

Generate learning artifacts directly from a stored Claude session:

```bash
runbook integrations claude learn <session-id> --incident-id PD-123
```

See storage and ingestion architecture in [docs/CLAUDE_SESSION_STORAGE_PROPOSAL.md](./docs/CLAUDE_SESSION_STORAGE_PROPOSAL.md).

## Configuration

Use the setup wizard to generate and update config files:

```bash
runbook init
```

Example output (abridged):

```text
═══════════════════════════════════════════
 Runbook Setup Wizard
═══════════════════════════════════════════
Step 1: Choose your AI provider
Step 2: Enter your API key
...
 Setup Complete!
Configuration complete! Your settings have been saved to .runbook/services.yaml
```

This writes `.runbook/config.yaml` and `.runbook/services.yaml`. A reference `config.yaml` looks like:

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

integrations:
  claude:
    sessionStorage:
      # local | s3
      backend: local
      # keep a local copy even if backend is s3
      mirrorLocal: true
      localBaseDir: .runbook/hooks/claude
      s3:
        bucket: your-runbook-session-logs
        prefix: runbook/hooks/claude
        region: us-east-1
        # optional for MinIO/custom S3-compatible endpoints
        endpoint: https://s3.amazonaws.com
        forcePathStyle: false
```

See [PLAN.md](./PLAN.md) for full configuration options.

## Incident Simulation

Use the built-in simulation utilities to stage deterministic chat + investigate demos:

```bash
# Create simulation runbooks and sync knowledge
bun run simulate:setup

# Optional: provision failing AWS resources + trigger PagerDuty incident
bun run simulate:setup -- --with-aws --create-pd-incident

# Cleanup simulation infra/resources
bun run simulate:cleanup
```

Detailed guide: [docs/SIMULATE_INCIDENTS.md](./docs/SIMULATE_INCIDENTS.md)

## Investigation Evaluation

Run real-loop investigation benchmarks against fixture datasets:

```bash
bun run eval:investigate -- \
  --fixtures examples/evals/rcaeval-fixtures.generated.json \
  --out .runbook/evals/rcaeval-report.json
```

Run all benchmark adapters in one command (RCAEval + Rootly + TraceRCA):

```bash
bun run eval:all -- \
  --out-dir .runbook/evals/all-benchmarks \
  --rcaeval-input examples/evals/rcaeval-input.sample.json \
  --tracerca-input examples/evals/tracerca-input.sample.json
```

`eval:all` now auto-runs dataset bootstrap (`src/eval/setup-datasets.ts`) before benchmarking.
It will attempt to clone required public dataset repos under `examples/evals/datasets/`, then continue
with available local inputs and fallback fixtures when network/downloads are unavailable.

To run without bootstrap:

```bash
bun run eval:all -- --no-setup
```

This generates per-benchmark reports plus an aggregate summary:
- `.runbook/evals/all-benchmarks/rcaeval-report.json`
- `.runbook/evals/all-benchmarks/rootly-report.json`
- `.runbook/evals/all-benchmarks/tracerca-report.json`
- `.runbook/evals/all-benchmarks/summary.json`

See [docs/INVESTIGATION_EVAL.md](./docs/INVESTIGATION_EVAL.md) for dataset setup and converter workflows.

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

## Release Process

This repository uses [Release Please](https://github.com/googleapis/release-please) for automated versioning and GitHub releases.

1. Merge regular PRs into `main`.
2. `Release Please` workflow updates or opens a release PR with version bumps + changelog updates.
3. Merge that release PR.
4. Release Please creates a git tag (`vX.Y.Z`) and publishes a GitHub Release.
5. In the same workflow run, npm publish executes automatically when enabled.

### Workflows

- `/.github/workflows/release-please.yml`
  - Trigger: push to `main` (or manual dispatch)
  - Responsibility: maintain release PR, create tags/releases after release PR merge, then publish to npm when a release is created

### One-Command Release Trigger

Use this local command to run release checks and trigger Release Please:

```bash
npm run release
```

Prerequisites:
- `gh` CLI installed and authenticated (`gh auth login`)
- Clean local working tree on `main`
- Local `main` synced with `origin/main`

Helper variants:
- `npm run release:dry-run` to validate preconditions without triggering workflow
- `npm run release:skip-checks` to bypass local checks (typecheck/lint/test/build)

### Org Policy Compatibility

If your GitHub organization blocks write permissions for `GITHUB_TOKEN`, set a repo secret:
- `RELEASE_PLEASE_TOKEN` (PAT or fine-grained token with permission to write contents/pull requests/issues)

The release workflow automatically prefers `RELEASE_PLEASE_TOKEN` when present.

### npm Publish Setup (Optional)

Use npm Trusted Publishing (OIDC), then enable publishing:
- npm package settings: add this repository/workflow as a trusted publisher
  - Provider: GitHub Actions
  - Repository: `Runbook-Agent/RunbookAI`
  - Workflow filename: `release-please.yml`
- GitHub repo variable: `NPM_PUBLISH_ENABLED=true`

Notes:
- No npm token is required in GitHub secrets.
- Publish is skipped unless `NPM_PUBLISH_ENABLED=true`.
- The release tag must match `package.json` version.
- Ensure package name/access are valid for npm before enabling publish (currently `@runbook-agent/runbook` in `package.json`).
- If npm publish logs show `Access token expired or revoked`, remove `NODE_AUTH_TOKEN`/`NPM_TOKEN` secrets at org/repo/environment level so trusted publishing can use OIDC.

### Version Bump Rules

Release Please uses Conventional Commits for semver bumping:
- `fix:` -> patch
- `feat:` -> minor
- `feat!:` or `BREAKING CHANGE:` -> major

## What's New
- Dynamic runtime skills now execute workflow steps with approval hooks.
- Kubernetes tooling is available as a read-only query surface and can be gated with `providers.kubernetes.enabled`.
- Investigation evaluation now supports RCAEval, Rootly, and TraceRCA via a unified runner (`bun run eval:all`).
- Incident simulation tooling uses generic scripts: `bun run simulate:setup` and `bun run simulate:cleanup`.
- Claude Code integration includes context hooks, checkpoints, and MCP knowledge tools.
- Full implementation details: [docs/CHANGES_2026-02-08.md](./docs/CHANGES_2026-02-08.md) and [CODEX_PLAN.md](./CODEX_PLAN.md)

## License

MIT
