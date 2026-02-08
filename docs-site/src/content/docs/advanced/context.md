---
title: Context Engineering
description: How Runbook manages context efficiently
---

Context engineering ensures Runbook stays effective even with large investigations by managing token usage intelligently.

## The Challenge

LLMs have context limits. A typical investigation might involve:

- Incident details (500 tokens)
- Knowledge base results (2,000 tokens)
- 10+ tool calls with results (10,000+ tokens)
- Hypothesis tracking (1,000 tokens)

Without management, context quickly exceeds limits.

## Context Management Strategies

### 1. Progressive Disclosure

Information is revealed as needed:

```
Initial Context:
  - Incident summary
  - Top 3 knowledge matches (summaries only)
  - Service topology

On Demand:
  - Full knowledge documents
  - Detailed tool results
  - Historical data
```

### 2. Just-in-Time Retrieval

Knowledge is retrieved when relevant:

```
Phase: Triage
  → Retrieve incident-related runbooks

Phase: Investigate Hypothesis H1 (Database)
  → Retrieve database-specific docs

Phase: Investigate Hypothesis H2 (Deployment)
  → Retrieve deployment docs

Not all knowledge loaded upfront.
```

### 3. Result Summarization

Verbose tool results are summarized:

```
Before (Raw):
{
  "Reservations": [{
    "Instances": [{
      "InstanceId": "i-abc123",
      "InstanceType": "t3.medium",
      "State": {"Name": "running"},
      "Tags": [{"Key": "Name", "Value": "prod-api-1"}, ...],
      "NetworkInterfaces": [...],
      // ... 500 more lines
    }, ...]
  }]
}

After (Summarized):
"12 running EC2 instances: prod-api-1 (t3.medium), prod-api-2 (t3.large), ..."
```

### 4. Context Compaction

When approaching limits, older context is compacted:

```
Original (10,000 tokens):
  - Full hypothesis tree
  - All tool results
  - Complete evidence

Compacted (2,000 tokens):
  - Confirmed hypotheses only
  - Key evidence summaries
  - Current state

Full details available in scratchpad if needed.
```

## Token Budgets

Configure token limits:

```yaml
agent:
  contextThresholdTokens: 100000  # Trigger compaction
  maxContextTokens: 128000        # Hard limit
  reserveTokens: 8000             # Reserve for response
```

### Budget Allocation

```
Total: 128,000 tokens
├─ System prompt: 2,000
├─ Conversation history: 30,000
├─ Knowledge context: 20,000
├─ Tool results: 40,000
├─ Hypothesis state: 10,000
├─ Working memory: 18,000
└─ Response reserve: 8,000
```

## Summarization

### Tool Summarizer

Compresses verbose tool output:

```typescript
// Example: CloudWatch metrics
const raw = {
  MetricDataResults: [
    { Id: 'cpu', Timestamps: [...100 items...], Values: [...100 items...] },
    { Id: 'mem', Timestamps: [...100 items...], Values: [...100 items...] },
  ]
};

const summarized = toolSummarizer.summarize('cloudwatch_get_metrics', raw);
// "CPU: avg 45%, peak 78% (2h ago). Memory: avg 62%, stable."
```

### Hypothesis Summarizer

Compresses hypothesis tree:

```
Full Tree:
  H1: Database exhaustion [0.92]
    H1.1: Traffic spike [0.88]
      Evidence: 3x traffic, started 14:32
    H1.2: Pool config [PRUNED]
  H2: Deployment [PRUNED]
  H3: Payment svc [PRUNED]

Compacted:
  Confirmed: Database exhaustion due to traffic spike (0.92)
  Pruned: Deployment, payment service (no evidence)
```

## Memory Tiers

### Working Memory

Current turn context:
- Active hypothesis
- Recent tool results
- Immediate next steps

### Short-Term Memory

Recent history (last 5-10 turns):
- Summarized tool results
- Hypothesis updates
- Key findings

### Long-Term Memory

Scratchpad (persisted):
- Complete audit trail
- Full tool results
- Available for recall

## Smart Retrieval

### Relevance Scoring

Documents are scored for current context:

```typescript
score = baseRelevance
  * recencyBoost        // Recent docs preferred
  * serviceMatch        // Matching service names
  * symptomMatch        // Matching symptoms
  * hypothesisRelevance // Related to current hypothesis
```

### Re-ranking

Retrieved documents are re-ranked:

```yaml
knowledge:
  retrieval:
    rerank: true
    rerankModel: cross-encoder  # More accurate than embeddings
```

## Configuration

```yaml
agent:
  # Token management
  contextThresholdTokens: 100000
  maxContextTokens: 128000

  # Summarization
  summarizeToolResults: true
  summarizeAfterTokens: 1000  # Summarize results > 1000 tokens

  # Compaction
  compactAfterTurns: 10
  keepRecentTurns: 3

  # Memory
  memoryTiers:
    working: 20000    # Tokens for working memory
    shortTerm: 40000  # Tokens for short-term
```

## Debugging

View context usage:

```bash
runbook chat --debug-context
```

Shows:
```
Context Usage:
  System: 2,134 / 2,000 (107%)
  History: 28,456 / 30,000 (95%)
  Knowledge: 15,234 / 20,000 (76%)
  Tools: 32,100 / 40,000 (80%)
  Hypothesis: 8,900 / 10,000 (89%)
  Working: 12,345 / 18,000 (69%)
  Total: 99,169 / 128,000 (77%)

Next action: Continue (under threshold)
```
