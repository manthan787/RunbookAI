---
title: knowledge
description: Manage the knowledge base
---

The `knowledge` command manages Runbook's knowledge base—your organizational runbooks, post-mortems, architecture docs, and more.

## Usage

```bash
runbook knowledge <subcommand> [options]
```

## Subcommands

| Command | Description |
|---------|-------------|
| `sync` | Sync knowledge from all configured sources |
| `search` | Search the knowledge base |
| `add` | Add a document to the knowledge base |
| `remove` | Remove a document |
| `validate` | Check for stale or outdated documents |
| `stats` | Show knowledge base statistics |

## sync

Sync documents from all configured knowledge sources:

```bash
$ runbook knowledge sync

Syncing knowledge from 3 sources...

[1/3] Filesystem (.runbook/runbooks/)
  → Scanning for documents...
  ✓ Found 45 documents
  ✓ 3 new, 2 updated, 40 unchanged

[2/3] GitHub (myorg/infrastructure:docs/runbooks)
  → Fetching from GitHub...
  ✓ Found 23 documents
  ✓ 1 new, 0 updated, 22 unchanged

[3/3] Confluence (SRE space)
  → Fetching from Confluence...
  ✓ Found 67 documents
  ✓ 5 new, 3 updated, 59 unchanged

Sync complete:
  Total documents: 135
  New: 9
  Updated: 5
  Unchanged: 121

Generating embeddings for 14 documents...
✓ Embeddings generated (4.2s)
```

### Options

| Option | Description |
|--------|-------------|
| `--source <name>` | Sync only from specific source |
| `--force` | Re-sync all documents, even unchanged |
| `--dry-run` | Show what would be synced |

## search

Search the knowledge base:

```bash
$ runbook knowledge search "database connection timeout"

Found 5 relevant documents:

[1] Database Connection Exhaustion (Runbook)
    Match: 92%
    Services: checkout-api, payment-service
    Last updated: 2024-01-10
    Path: .runbook/runbooks/database-connection-exhaustion.md

[2] 2024-01-15 Checkout Outage (Post-mortem)
    Match: 78%
    Services: checkout-api
    Last updated: 2024-01-16
    Path: github:myorg/infrastructure/postmortems/2024-01-15.md

[3] PostgreSQL Configuration (Architecture)
    Match: 65%
    Services: all
    Last updated: 2023-12-01
    Path: confluence:SRE/PostgreSQL-Config

[4] Connection Pool Tuning (Runbook)
    Match: 61%
    Services: api-gateway, checkout-api
    Last updated: 2023-11-15
    Path: .runbook/runbooks/connection-pool-tuning.md

[5] Database Slow Queries (Known Issue)
    Match: 54%
    Services: payment-service
    Last updated: 2024-01-05
    Path: .runbook/known-issues/slow-queries.md

To view a document: runbook knowledge show <path>
```

### Options

| Option | Description |
|--------|-------------|
| `--service <name>` | Filter by service |
| `--type <type>` | Filter by document type |
| `--limit <n>` | Max results (default: 10) |
| `--json` | Output as JSON |

### Search by Type

```bash
# Only runbooks
runbook knowledge search "timeout" --type runbook

# Only post-mortems
runbook knowledge search "outage" --type postmortem

# Only for specific service
runbook knowledge search "scaling" --service checkout-api
```

## add

Add a document to the knowledge base:

```bash
$ runbook knowledge add ./my-runbook.md --type runbook

Adding document: my-runbook.md

Parsing frontmatter...
  Title: High CPU Troubleshooting
  Services: api-gateway, worker-service
  Tags: cpu, performance, troubleshooting

Validating structure...
  ✓ Has problem description
  ✓ Has diagnosis steps
  ✓ Has resolution steps
  ✓ Has rollback procedure

Generating embeddings...
  ✓ Embeddings generated

Document added successfully:
  ID: kb-a1b2c3d4
  Type: runbook
  Path: .runbook/runbooks/high-cpu-troubleshooting.md
```

### Options

| Option | Description |
|--------|-------------|
| `--type <type>` | Document type (runbook, postmortem, etc.) |
| `--service <name>` | Associated service(s) |
| `--tags <tags>` | Comma-separated tags |
| `--validate` | Only validate, don't add |

### Document Format

Documents should have YAML frontmatter:

```markdown
---
type: runbook
title: High CPU Troubleshooting
services:
  - api-gateway
  - worker-service
tags:
  - cpu
  - performance
severity: sev2
author: platform-team
lastValidated: 2024-01-15
---

# High CPU Troubleshooting

## Problem Description
...

## Diagnosis Steps
...

## Resolution
...

## Rollback
...
```

## remove

Remove a document from the knowledge base:

```bash
$ runbook knowledge remove kb-a1b2c3d4

Removing document: kb-a1b2c3d4
  Title: High CPU Troubleshooting
  Type: runbook

Are you sure? [y/N] y

✓ Document removed from knowledge base
✓ Embeddings cleared

Note: Source file not deleted. To delete:
  rm .runbook/runbooks/high-cpu-troubleshooting.md
```

## validate

Check for stale or problematic documents:

```bash
$ runbook knowledge validate

Validating 135 documents...

Stale Documents (not validated in 90+ days):
  [1] Database Backup Procedures
      Last validated: 2023-09-15 (120 days ago)
      Action: Review and update

  [2] Legacy API Migration Guide
      Last validated: 2023-08-01 (165 days ago)
      Action: Consider archiving

Missing Information:
  [3] Payment Service Architecture
      Missing: rollback procedures
      Action: Add rollback section

  [4] Redis Cache Configuration
      Missing: service associations
      Action: Add services field

Orphaned Documents (reference non-existent services):
  [5] Old Checkout v1 Runbook
      References: checkout-api-v1 (not found)
      Action: Update or archive

Summary:
  Total: 135
  Valid: 130
  Stale: 2
  Incomplete: 2
  Orphaned: 1

Run with --fix to auto-remediate where possible.
```

### Options

| Option | Description |
|--------|-------------|
| `--days <n>` | Consider stale after N days (default: 90) |
| `--fix` | Auto-fix issues where possible |
| `--json` | Output as JSON |

## stats

Show knowledge base statistics:

```bash
$ runbook knowledge stats

Knowledge Base Statistics
═════════════════════════

Documents by Type:
  Runbooks:      45 (33%)
  Post-mortems:  32 (24%)
  Architecture:  28 (21%)
  Known Issues:  18 (13%)
  FAQs:          12 (9%)

Documents by Source:
  Filesystem:    45
  GitHub:        23
  Confluence:    67

Top Services Covered:
  checkout-api:     34 documents
  payment-service:  28 documents
  api-gateway:      22 documents
  order-service:    18 documents
  auth-service:     15 documents

Freshness:
  Updated this week:   12
  Updated this month:  34
  Older than 90 days:  28

Storage:
  Documents: 135
  Embeddings: 135 (all indexed)
  Database size: 24.5 MB

Last sync: 2 hours ago
```

## Best Practices

### Document Organization

```
.runbook/
├── runbooks/
│   ├── database/
│   │   ├── connection-exhaustion.md
│   │   └── replication-lag.md
│   ├── services/
│   │   ├── checkout-api.md
│   │   └── payment-service.md
│   └── infrastructure/
│       ├── scaling.md
│       └── failover.md
├── postmortems/
│   ├── 2024/
│   │   ├── 01-15-checkout-outage.md
│   │   └── 01-22-database-failure.md
└── architecture/
    ├── service-topology.md
    └── data-flow.md
```

### Frontmatter Standards

Always include:
- `type`: Document type
- `services`: Related services
- `lastValidated`: When last reviewed

```yaml
---
type: runbook
title: Descriptive Title
services: [service-a, service-b]
tags: [relevant, tags]
severity: sev1 | sev2 | sev3
author: team-name
lastValidated: 2024-01-15
---
```

## Next Steps

- [Writing Runbooks](/RunbookAI/knowledge/writing-runbooks/) - Best practices for runbooks
- [Knowledge Sources](/RunbookAI/knowledge/sources/) - Configure knowledge sources
