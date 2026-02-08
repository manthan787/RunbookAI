---
title: Tools Overview
description: Understanding Runbook's tool system
---

Tools are the building blocks that enable Runbook to interact with your infrastructure. Each tool provides specific capabilities that the agent uses during investigations and operations.

## How Tools Work

```
User Query: "What EC2 instances are running?"
                    │
                    ▼
            ┌──────────────┐
            │    Agent     │
            │              │
            │ Interprets   │
            │ query and    │
            │ selects tool │
            └──────────────┘
                    │
                    ▼
            ┌──────────────┐
            │ Tool Call    │
            │              │
            │ aws_query    │
            │ service: ec2 │
            │ op: describe │
            └──────────────┘
                    │
                    ▼
            ┌──────────────┐
            │  AWS API     │
            │              │
            │ Returns      │
            │ instances    │
            └──────────────┘
                    │
                    ▼
            ┌──────────────┐
            │   Format     │
            │              │
            │ Present to   │
            │ user         │
            └──────────────┘
```

## Tool Categories

| Category | Purpose | Examples |
|----------|---------|----------|
| **AWS** | Cloud infrastructure | aws_query, aws_cli |
| **Kubernetes** | Container orchestration | kubernetes_query |
| **Incident** | Alert management | pagerduty_*, opsgenie_*, slack_* |
| **Observability** | Metrics and logs | datadog_*, prometheus_* |
| **Knowledge** | Documentation | search_knowledge |
| **Skills** | Workflows | skill |

## Tool Interface

Every tool follows a consistent interface:

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ParameterSchema>;
    required: string[];
  };
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}
```

## Tool Execution

### Successful Execution

```
→ aws_query (EC2 instances)
✓ aws_query (312ms)

Found 12 running instances...
```

### Error Handling

```
→ aws_query (RDS instances)
✗ aws_query: Access denied (245ms)

The AWS credentials don't have permission for rds:DescribeDBInstances
```

## Tool Filtering

Tools are filtered based on configuration:

```yaml
providers:
  aws:
    enabled: true   # AWS tools available
  kubernetes:
    enabled: false  # Kubernetes tools hidden
```

Only enabled tools are available to the agent.

## Parallel Execution

Independent tool calls run in parallel:

```
Query: "Show EC2, RDS, and ECS status"

→ aws_query (EC2) ─────┐
→ aws_query (RDS) ─────┼── Parallel execution
→ aws_query (ECS) ─────┘
✓ All completed (max: 312ms)
```

## Tool Results

Results are structured for agent consumption:

```typescript
interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  duration: number;
  metadata?: {
    cached?: boolean;
    partial?: boolean;
  };
}
```

## Custom Tools

Register custom tools for specialized needs:

```typescript
import { registerTool } from 'runbook';

registerTool({
  name: 'my_custom_tool',
  description: 'Does something specific to my org',
  parameters: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: 'First param' },
    },
    required: ['param1'],
  },
  execute: async (args) => {
    // Custom logic
    return { result: 'success' };
  },
});
```

## Tool Documentation

Each tool category has detailed documentation:

- [AWS Tools](/RunbookAI/tools/aws/) - 40+ AWS services
- [Kubernetes Tools](/RunbookAI/tools/kubernetes/) - Cluster operations
- [Incident Tools](/RunbookAI/tools/incident/) - PagerDuty, OpsGenie, Slack
- [Observability Tools](/RunbookAI/tools/observability/) - Datadog, Prometheus
- [Knowledge Tools](/RunbookAI/tools/knowledge/) - Knowledge base search

## Next Steps

Explore specific tool categories for detailed parameters and examples.
