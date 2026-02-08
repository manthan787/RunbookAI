---
title: Knowledge Tools
description: Knowledge base search tool reference
---

Tool for searching organizational knowledge.

## search_knowledge

Search runbooks, post-mortems, and documentation.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query |
| `limit` | integer | No | Max results (default: 10) |
| `typeFilter` | string[] | No | Document types to include |
| `serviceFilter` | string[] | No | Services to filter by |
| `tagFilter` | string[] | No | Tags to filter by |

### Examples

**Basic Search**
```
search_knowledge:
  query: "database connection timeout"
```

**Filtered Search**
```
search_knowledge:
  query: "high latency"
  typeFilter: ["runbook", "postmortem"]
  serviceFilter: ["checkout-api"]
  limit: 5
```

**Service-Specific**
```
search_knowledge:
  query: "troubleshooting"
  serviceFilter: ["payment-service", "checkout-api"]
```

### Response Structure

```typescript
{
  runbooks: [
    {
      id: "kb-abc123",
      title: "Database Connection Exhaustion",
      type: "runbook",
      services: ["checkout-api"],
      relevance: 0.92,
      preview: "When connections are exhausted...",
      path: ".runbook/runbooks/database.md"
    }
  ],
  postmortems: [
    {
      id: "kb-def456",
      title: "2024-01-15 Checkout Outage",
      type: "postmortem",
      services: ["checkout-api"],
      relevance: 0.78,
      preview: "Root cause was traffic spike...",
      path: "github:myorg/postmortems/2024-01-15.md"
    }
  ],
  architecture: [...],
  knownIssues: [...]
}
```

## Automatic Search

During investigations, knowledge is searched automatically:

```
$ runbook investigate PD-12345

Incident: High Error Rate - checkout-api

→ Searching knowledge base...

Automatic queries generated:
  1. "checkout-api high error rate"
  2. "checkout-api troubleshooting"
  3. Symptom-based: "connection timeout", "5xx errors"

Found:
  📘 Runbook: "Database Connection Exhaustion" (92%)
  📕 Post-mortem: "2024-01-15 Checkout Outage" (78%)
```

## Search Strategies

### Symptom-Based

Search using error messages:

```
search_knowledge:
  query: "Connection timeout after 30000ms"
```

### Service-Based

Find all docs for a service:

```
search_knowledge:
  query: ""
  serviceFilter: ["checkout-api"]
  typeFilter: ["runbook"]
```

### Historical

Find similar past incidents:

```
search_knowledge:
  query: "high error rate traffic spike"
  typeFilter: ["postmortem"]
```

## Integration with Agent

The agent uses knowledge context to:

1. **Form better hypotheses** - Match symptoms to known patterns
2. **Apply proven solutions** - Use runbook steps
3. **Avoid past mistakes** - Learn from post-mortems
4. **Understand dependencies** - Use architecture docs

```
Without knowledge:
  "The database has high connections. Try restarting."

With knowledge:
  "This matches the 'Database Connection Exhaustion' runbook.
   According to the runbook:
   1. Check for traffic spike (confirmed: 3x normal)
   2. Scale read replicas
   3. Enable PgBouncer for pooling

   Similar incident occurred on 2024-01-15 due to
   marketing campaign. Resolution was adding read replicas."
```
