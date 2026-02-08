---
title: Search & Retrieval
description: Searching and using the knowledge base
---

Runbook provides powerful search capabilities combining keyword matching, semantic understanding, and metadata filtering.

## Search Methods

### Full-Text Search

Traditional keyword-based search:

```bash
runbook knowledge search "database connection timeout"
```

Matches documents containing these words, with relevance scoring based on:
- Term frequency
- Field weights (title > content)
- Exact phrase matches

### Semantic Search

Finds conceptually related documents:

```bash
runbook knowledge search "my API is slow"
```

Even without exact keywords, finds documents about:
- Latency issues
- Performance troubleshooting
- Bottleneck analysis

### Hybrid Search

Combines both methods for best results:

```yaml
knowledge:
  retrieval:
    hybridSearch: true
    keywordWeight: 0.4
    semanticWeight: 0.6
```

## Filtering

### By Document Type

```bash
# Only runbooks
runbook knowledge search "timeout" --type runbook

# Multiple types
runbook knowledge search "scaling" --type runbook,postmortem
```

### By Service

```bash
# Single service
runbook knowledge search "errors" --service checkout-api

# Multiple services
runbook knowledge search "database" --service checkout-api,payment-service
```

### By Tags

```bash
runbook knowledge search "connection" --tags database,postgresql
```

### Combined Filters

```bash
runbook knowledge search "timeout" \
  --type runbook \
  --service checkout-api \
  --tags database
```

## Search Results

```
$ runbook knowledge search "database connection timeout"

Found 5 relevant documents:

[1] Database Connection Exhaustion (Runbook)
    Match: 92%
    Services: checkout-api, payment-service
    Last updated: 2024-01-10
    Path: .runbook/runbooks/database-connection-exhaustion.md

    Preview: "When the database connection pool becomes exhausted,
    applications experience timeout errors..."

[2] 2024-01-15 Checkout Outage (Post-mortem)
    Match: 78%
    Services: checkout-api
    Last updated: 2024-01-16
    Path: github:myorg/postmortems/2024-01-15.md

    Preview: "Root cause was database connection exhaustion due to
    traffic spike from marketing campaign..."

[3] PostgreSQL Configuration (Architecture)
    Match: 65%
    Services: all
    Last updated: 2023-12-01
    Path: confluence:SRE/PostgreSQL-Config

    Preview: "Default connection pool size is 10. Max connections
    per RDS instance is 100..."
```

## Viewing Documents

```bash
# View full document
runbook knowledge show .runbook/runbooks/database-connection-exhaustion.md

# View by ID
runbook knowledge show kb-abc123
```

## Re-ranking

Results are re-ranked for relevance:

```yaml
knowledge:
  retrieval:
    rerank: true
    rerankModel: cross-encoder  # or 'llm'
```

Re-ranking considers:
- Query-document relevance
- Recency (newer docs preferred)
- Service affinity (if querying about checkout-api, prefer related docs)

## Retrieval Configuration

```yaml
knowledge:
  retrieval:
    # Number of initial results
    topK: 20

    # After re-ranking
    finalK: 5

    # Search weights
    keywordWeight: 0.4
    semanticWeight: 0.6

    # Re-ranking
    rerank: true
    rerankModel: cross-encoder

    # Boost factors
    recencyBoost: 0.1  # Boost newer documents
    serviceBoost: 0.2   # Boost matching service
```

## API Usage

For programmatic access:

```typescript
import { KnowledgeRetriever } from 'runbook';

const retriever = new KnowledgeRetriever(config);

const results = await retriever.search('database timeout', {
  limit: 10,
  typeFilter: ['runbook', 'postmortem'],
  serviceFilter: ['checkout-api'],
});

// results.runbooks: Runbook[]
// results.postmortems: PostMortem[]
// results.architecture: Architecture[]
```

## Integration with Investigations

During investigations, search happens automatically:

```
$ runbook investigate PD-12345

Incident: High Error Rate - checkout-api

→ Searching knowledge base...

Automatic queries:
  1. "checkout-api high error rate"
  2. "checkout-api troubleshooting"
  3. Symptoms: "connection timeout", "5xx errors"

Found:
  📘 Runbook: "Database Connection Exhaustion" (85% match)
  📕 Post-mortem: "2024-01-15 Checkout Outage" (72% match)

Applying knowledge to hypothesis formation...
```

## Search Tips

1. **Be specific**: "checkout-api database timeout" > "timeout"
2. **Use service names**: Include service names for better matches
3. **Try variations**: If no results, try synonyms or related terms
4. **Check filters**: Narrow filters may exclude relevant results
5. **Update regularly**: Stale knowledge leads to poor results

## Next Steps

- [Writing Runbooks](/RunbookAI/knowledge/writing-runbooks/) - Create effective runbooks
- [Document Types](/RunbookAI/knowledge/document-types/) - Understanding types
