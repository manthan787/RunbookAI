---
title: Architecture
description: Understanding Runbook's architecture and design principles
---

Runbook is built on a modular architecture that separates concerns between investigation logic, tool execution, knowledge retrieval, and safety controls.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         CLI Layer                            │
│   ask | investigate | chat | deploy | knowledge | init       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        Agent Core                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  Hypothesis  │  │ Investigation│  │   Context    │       │
│  │    Engine    │  │  Orchestrator│  │  Compactor   │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   Evidence   │  │    State     │  │  Scratchpad  │       │
│  │   Evaluator  │  │   Machine    │  │   (Audit)    │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  Tool Layer   │    │   Knowledge   │    │    Safety     │
│               │    │    System     │    │   Controls    │
│ ┌───────────┐ │    │               │    │               │
│ │    AWS    │ │    │ ┌───────────┐ │    │ ┌───────────┐ │
│ │ (40+ svc) │ │    │ │  Retriever│ │    │ │  Approval │ │
│ └───────────┘ │    │ └───────────┘ │    │ │   Flow    │ │
│ ┌───────────┐ │    │ ┌───────────┐ │    │ └───────────┘ │
│ │Kubernetes │ │    │ │  Sources  │ │    │ ┌───────────┐ │
│ │  (read)   │ │    │ └───────────┘ │    │ │   Risk    │ │
│ └───────────┘ │    │ ┌───────────┐ │    │ │ Classifier│ │
│ ┌───────────┐ │    │ │   Store   │ │    │ └───────────┘ │
│ │ Incident  │ │    │ │ (SQLite)  │ │    │               │
│ │(PD/OG/Slk)│ │    │ └───────────┘ │    │               │
│ └───────────┘ │    │               │    │               │
│ ┌───────────┐ │    │               │    │               │
│ │Observabil.│ │    │               │    │               │
│ │(DD/Prom)  │ │    │               │    │               │
│ └───────────┘ │    │               │    │               │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
                    ┌───────────────┐
                    │   LLM Layer   │
                    │   (pi-ai)     │
                    │               │
                    │  Anthropic    │
                    │  OpenAI       │
                    │  Google       │
                    │  Mistral      │
                    │  Groq / xAI   │
                    └───────────────┘
```

## Core Components

### Agent Core

The central orchestration layer that coordinates investigations:

| Component | Purpose |
|-----------|---------|
| **Hypothesis Engine** | Forms, branches, and prunes hypotheses based on evidence |
| **Investigation Orchestrator** | Coordinates the investigation workflow through phases |
| **State Machine** | Manages transitions between investigation phases |
| **Evidence Evaluator** | Classifies evidence strength (strong/weak/none) |
| **Context Compactor** | Summarizes verbose data to stay within token limits |
| **Scratchpad** | Records all decisions for audit trail |

### Tool Layer

Executes operations against external systems:

```typescript
// Tool interface
interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}
```

**Tool Categories:**
- **AWS** (40+ services): EC2, ECS, RDS, Lambda, CloudWatch, etc.
- **Kubernetes**: Read-only cluster operations
- **Incident**: PagerDuty, OpsGenie integration
- **Observability**: Datadog, Prometheus queries
- **Skills**: Execute multi-step workflows

### Knowledge System

Indexes and retrieves organizational knowledge:

```
Knowledge Sources → Indexer → SQLite Store → Retriever → Agent
     │                            │
     │                            ├─ Full-text search
     │                            ├─ Semantic search
     │                            └─ Graph queries
     │
     ├─ Filesystem (.md, .yaml)
     ├─ Confluence
     ├─ Notion
     ├─ GitHub
     └─ API endpoints
```

### Safety Controls

Ensures operations are reviewed before execution:

```
Operation → Risk Classifier → Approval Decision → Execute/Abort
                 │                    │
                 │                    ├─ CLI prompt
                 │                    └─ Slack button
                 │
                 ├─ Critical: delete, terminate, drop
                 ├─ High: restart, deploy, scale down
                 ├─ Medium: modify non-prod
                 └─ Low: describe, list, read
```

## Data Flow

### Investigation Flow

```
1. Incident Input
   └─ PagerDuty/OpsGenie alert or user query

2. Knowledge Retrieval
   ├─ Search for relevant runbooks
   ├─ Find similar post-mortems
   └─ Load architecture context

3. Hypothesis Formation
   ├─ Generate 3-5 testable theories
   └─ Prioritize by likelihood

4. Investigation Loop (max depth: 4)
   ├─ Select hypothesis to test
   ├─ Generate targeted queries
   ├─ Execute tool calls
   ├─ Evaluate evidence strength
   └─ Branch (strong) or prune (none)

5. Conclusion
   ├─ Identify root cause
   ├─ Assign confidence score
   └─ Suggest remediation

6. Remediation (with approval)
   ├─ Match to skills/runbooks
   ├─ Request approval
   └─ Execute with rollback
```

### Event Streaming

The agent emits events throughout execution:

```typescript
type AgentEvent =
  | { type: 'thinking'; content: string }
  | { type: 'tool_start'; name: string; args: unknown }
  | { type: 'tool_end'; name: string; result: unknown; duration: number }
  | { type: 'tool_error'; name: string; error: string }
  | { type: 'hypothesis_formed'; hypothesis: Hypothesis }
  | { type: 'hypothesis_pruned'; id: string; reason: string }
  | { type: 'hypothesis_confirmed'; id: string; confidence: number }
  | { type: 'evidence_gathered'; strength: 'strong' | 'weak' | 'none' }
  | { type: 'remediation_suggested'; actions: Action[] }
  | { type: 'approval_requested'; operation: Operation }
  | { type: 'complete'; result: InvestigationResult };
```

## Design Principles

### 1. Research-First

Runbook always gathers context before suggesting actions. It never jumps to conclusions without evidence.

```
❌ Alert fires → Immediately restart service
✓ Alert fires → Gather metrics → Form hypotheses → Test → Act
```

### 2. Hypothesis-Driven

Instead of following rigid playbooks, Runbook forms multiple theories and tests them systematically:

```
Hypotheses:
  H1: Database overload (probability: 0.6)
  H2: Network partition (probability: 0.2)
  H3: Code regression (probability: 0.2)

Testing H1...
Evidence: STRONG (connections at 95%)
Confidence updated: 0.85

Pruning H2 and H3 (no supporting evidence)
```

### 3. Safety-First

All mutations require explicit approval with clear rollback paths:

```
[APPROVAL REQUIRED]
Operation: Scale ECS service from 2 to 4 tasks
Risk Level: HIGH
Rollback: aws ecs update-service --desired-count 2
```

### 4. Knowledge-Integrated

Organizational knowledge is retrieved and injected into investigations:

```
Found relevant context:
- Runbook: "Database Connection Exhaustion" (85% match)
- Post-mortem: "2024-01-15 Checkout Outage" (similar symptoms)
- Architecture: checkout-api depends on PostgreSQL via PgBouncer
```

### 5. Observable

Every decision is logged to a JSONL scratchpad for full auditability:

```json
{"type":"init","query":"Investigate PD-12345","timestamp":"..."}
{"type":"tool_result","tool":"pagerduty_get_incident","duration":245}
{"type":"hypothesis_formed","id":"h1","description":"DB overload"}
{"type":"evidence_gathered","hypothesis":"h1","strength":"strong"}
{"type":"hypothesis_confirmed","id":"h1","confidence":0.85}
```

## File Structure

```
src/
├── agent/                  # Core investigation logic
│   ├── agent.ts           # Main Agent class
│   ├── hypothesis.ts      # Hypothesis tree management
│   ├── prompts.ts         # LLM prompt templates
│   ├── scratchpad.ts      # Audit trail logging
│   ├── approval.ts        # Risk classification
│   ├── confidence.ts      # Evidence evaluation
│   └── state-machine.ts   # Phase transitions
│
├── tools/                  # Tool implementations
│   ├── registry.ts        # Central tool registry
│   ├── aws/               # AWS service tools
│   ├── incident/          # PagerDuty, OpsGenie, Slack
│   └── observability/     # Datadog, Prometheus
│
├── knowledge/              # Knowledge system
│   ├── retriever/         # Search orchestration
│   ├── sources/           # Document loaders
│   └── store/             # SQLite + vector storage
│
├── skills/                 # Workflow system
│   ├── registry.ts        # Skill discovery
│   ├── executor.ts        # Step execution
│   └── builtin/           # Built-in skills
│
├── providers/              # Cloud provider clients
│   ├── aws/               # AWS SDK wrapper
│   └── kubernetes/        # kubectl wrapper
│
└── cli/                    # CLI interface
    ├── cli.tsx            # Main CLI
    └── components/        # Terminal UI components
```

## Next Steps

- [Investigation Flow](/RunbookAI/concepts/investigation-flow/) - Deep dive into the investigation process
- [Hypothesis System](/RunbookAI/concepts/hypothesis/) - Understanding hypothesis-driven investigation
