---
title: Knowledge System Overview
description: Understanding Runbook's knowledge integration
---

The knowledge system is central to Runbook's effectiveness. It indexes your organizational knowledge—runbooks, post-mortems, architecture docs—and retrieves relevant information during investigations.

## Why Knowledge Matters

Without organizational knowledge, Runbook can only query infrastructure state. With knowledge, it can:

- **Recognize patterns** - "This looks like the database connection issue from last month"
- **Apply solutions** - "The runbook says to scale read replicas"
- **Learn from history** - "A similar incident was caused by a marketing campaign"
- **Provide context** - "According to the architecture docs, checkout-api depends on PgBouncer"

## Knowledge Types

| Type | Purpose | Example |
|------|---------|---------|
| **Runbook** | Operational procedures | Database troubleshooting steps |
| **Post-mortem** | Incident reviews | 2024-01 checkout outage analysis |
| **Architecture** | System documentation | Service dependency diagrams |
| **Known Issue** | Documented bugs | Redis connection pool bug |
| **Ownership** | Team assignments | checkout-api owned by Platform |
| **Environment** | Environment configs | Production uses us-east-1 |
| **Playbook** | Workflow definitions | Deployment checklist |
| **FAQ** | Common questions | How to access prod logs |

## How It Works

```
Knowledge Sources                    Retrieval
     │                                  │
     ├─ Filesystem (.md)               ┌┴┐
     ├─ Confluence                     │ │ ← Investigation query
     ├─ Notion                         │S│
     ├─ GitHub                         │e│
     └─ API                            │a│
           │                           │r│
           ▼                           │c│
    ┌──────────────┐                  │h│
    │   Indexer    │                  │ │
    │              │                  └┬┘
    │ • Parse docs │                   │
    │ • Extract    │                   ▼
    │   metadata   │            ┌──────────────┐
    │ • Generate   │            │   Results    │
    │   embeddings │            │              │
    └──────────────┘            │ • Runbooks   │
           │                    │ • Post-morts │
           ▼                    │ • Arch docs  │
    ┌──────────────┐            └──────────────┘
    │    Store     │                   │
    │              │                   ▼
    │ • SQLite DB  │            ┌──────────────┐
    │ • Full-text  │            │    Agent     │
    │ • Embeddings │            │              │
    │ • Graph      │            │ Uses context │
    └──────────────┘            │ to investigate│
                                └──────────────┘
```

## Search Capabilities

### Full-Text Search

Keyword-based search across all documents:

```bash
runbook knowledge search "connection timeout database"
```

### Semantic Search

Find conceptually related documents even without exact keywords:

```bash
runbook knowledge search "why is my API slow"
# Finds documents about latency, performance, bottlenecks
```

### Hybrid Search

Combines keyword and semantic search for best results:

```yaml
knowledge:
  retrieval:
    topK: 10
    rerank: true  # Re-rank results for relevance
```

### Filtered Search

Narrow results by metadata:

```bash
runbook knowledge search "timeout" --type runbook --service checkout-api
```

## Integration with Investigations

During investigations, Runbook automatically searches knowledge:

```
$ runbook investigate PD-12345

→ Gathering incident context...
Incident: High Error Rate - checkout-api

→ Searching knowledge base...
✓ search_knowledge (189ms)

Found relevant knowledge:
  📘 Runbook: "Database Connection Exhaustion" (85% match)
     Steps: Check connections → Scale replicas → Add pooler

  📕 Post-mortem: "2024-01-15 Checkout Outage" (72% match)
     Root cause: Marketing campaign caused traffic spike
     Resolution: Added read replicas, implemented PgBouncer

  📐 Architecture: "checkout-api Service" (68% match)
     Dependencies: PostgreSQL via PgBouncer

Applying knowledge to investigation...
```

## Quick Start

1. **Create knowledge directory**:
   ```bash
   mkdir -p .runbook/runbooks
   ```

2. **Add a runbook**:
   ```bash
   runbook knowledge add ./my-runbook.md --type runbook
   ```

3. **Sync knowledge**:
   ```bash
   runbook knowledge sync
   ```

4. **Search**:
   ```bash
   runbook knowledge search "database issues"
   ```

## Next Steps

- [Document Types](/RunbookAI/knowledge/document-types/) - Understanding each type
- [Sources](/RunbookAI/knowledge/sources/) - Configure knowledge sources
- [Writing Runbooks](/RunbookAI/knowledge/writing-runbooks/) - Best practices
