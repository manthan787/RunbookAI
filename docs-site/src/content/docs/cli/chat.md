---
title: chat
description: Interactive multi-turn conversation mode
---

The `chat` command opens an interactive session where you can have multi-turn conversations with Runbook. This is ideal for complex investigations, exploratory queries, and when you need to drill down into issues.

## Usage

```bash
runbook chat [options]
```

## Interactive Session

```
$ runbook chat

╔════════════════════════════════════════════════════════════╗
║                    Runbook Chat                             ║
║  Type your questions. Use /help for commands.               ║
╚════════════════════════════════════════════════════════════╝

runbook> What's the current state of production?

→ Querying infrastructure...
✓ aws_query (EC2) (145ms)
✓ aws_query (ECS) (167ms)
✓ aws_query (RDS) (134ms)

Production Overview:
  EC2: 24 instances running
  ECS: 8 services, 42 tasks
  RDS: 3 clusters, all healthy

Everything looks healthy. Any specific service you'd like to check?

runbook> Show me the checkout API details

→ Querying ECS service...
✓ aws_query (service details) (178ms)

checkout-api (ECS Service):
  Cluster: prod-east
  Tasks: 4 running, 0 pending
  CPU: 45% average
  Memory: 62% average
  Last deployment: 2 hours ago
  Health: All tasks healthy

runbook> What about the database it connects to?

→ Looking up service dependencies...
→ Querying RDS...
✓ aws_query (RDS metrics) (156ms)

checkout-api → prod-checkout-db (PostgreSQL):
  Instance: db.r5.xlarge
  Connections: 45/100 (45%)
  CPU: 32%
  Storage: 234 GB / 500 GB
  Replication: 2 read replicas, lag < 1s

runbook> The error rate seems high, investigate

→ Switching to investigation mode...
✓ cloudwatch_query (errors) (234ms)

Investigating high error rate...

Error Rate Analysis:
  Current: 2.3% (elevated)
  Baseline: 0.5%
  Started: 15 minutes ago

Forming hypotheses...
  H1: Database connection timeouts (P: 0.4)
  H2: Upstream API failures (P: 0.3)
  H3: Memory pressure (P: 0.2)

Testing H1...
✓ aws_query (connection metrics) (145ms)

Evidence: WEAK
  Connections at 45% (not exhausted)
  No timeout errors in logs

Testing H2...
✓ aws_query (upstream health) (167ms)

Evidence: STRONG
  payment-api returning 503s
  Started 17 minutes ago

Root cause likely: payment-api degradation
Confidence: HIGH (0.82)

Would you like me to investigate payment-api?

runbook> Yes

→ Investigating payment-api...
...
```

## Chat Commands

Within the chat session, use these commands:

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/clear` | Clear conversation history |
| `/history` | Show conversation history |
| `/save <file>` | Save conversation to file |
| `/load <file>` | Load conversation from file |
| `/context` | Show current context (services, hypotheses) |
| `/reset` | Reset context and start fresh |
| `/exit` or `/quit` | Exit chat mode |

### Context Commands

| Command | Description |
|---------|-------------|
| `/service <name>` | Set focus to a specific service |
| `/cluster <name>` | Set focus to a Kubernetes cluster |
| `/region <name>` | Set AWS region |
| `/incident <id>` | Load incident context |

### Investigation Commands

| Command | Description |
|---------|-------------|
| `/investigate` | Start hypothesis-driven investigation |
| `/hypotheses` | Show current hypotheses |
| `/evidence` | Show gathered evidence |
| `/conclude` | Force conclusion with current evidence |

## Options

| Option | Description |
|--------|-------------|
| `--verbose, -v` | Show detailed execution |
| `--context <file>` | Load context from file |
| `--incident <id>` | Start with incident context |
| `--service <name>` | Start with service focus |

## Conversation Modes

### Exploratory Mode (default)

Free-form questions and answers:

```
runbook> Tell me about our infrastructure
runbook> What services are most resource-intensive?
runbook> Compare staging and production configs
```

### Investigation Mode

Triggered by `/investigate` or when issues are detected:

```
runbook> /investigate high error rate

Starting investigation...
Phase: Triage
...
```

### Remediation Mode

Triggered when taking actions:

```
runbook> Scale up the checkout API

[APPROVAL REQUIRED]
Operation: Scale checkout-api (4 → 8 tasks)
Risk: HIGH
Rollback: aws ecs update-service --desired-count 4

Approve? [y/N]
```

## Context Preservation

Chat mode maintains context across turns:

```
runbook> Check the checkout API
[Shows checkout-api info]

runbook> What about its database?
[Remembers we're talking about checkout-api]
[Shows checkout-api's database]

runbook> Scale it up
[Knows "it" refers to checkout-api]
```

### Resetting Context

```
runbook> /reset

Context cleared. Starting fresh conversation.

runbook> Check the payment API
[New context established]
```

## Multi-Service Investigations

Track multiple services simultaneously:

```
runbook> /service checkout-api
Context: checkout-api

runbook> And also track payment-api
Context: checkout-api, payment-api

runbook> Show status
[Shows both services]

runbook> /context
Current context:
  Services: checkout-api, payment-api
  Region: us-east-1
  Hypotheses: none
  Evidence: none
```

## Session Management

### Saving Sessions

```
runbook> /save my-investigation.json

Session saved to my-investigation.json
Includes:
  - Conversation history (23 turns)
  - Context (2 services)
  - Evidence gathered (5 pieces)
```

### Loading Sessions

```bash
runbook chat --context my-investigation.json
```

Or within chat:
```
runbook> /load my-investigation.json

Session loaded:
  - 23 conversation turns
  - Context: checkout-api, payment-api
  - Evidence: 5 pieces

Last message: "Would you like me to investigate payment-api?"

Continuing conversation...
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+C` | Cancel current query |
| `Ctrl+D` | Exit chat |
| `Up/Down` | Navigate history |
| `Tab` | Autocomplete commands |

## Integration with Tools

Chat mode integrates seamlessly with all Runbook tools:

```
runbook> Search the knowledge base for connection pooling

→ Searching knowledge...
✓ search_knowledge (189ms)

Found 3 relevant documents:
1. Runbook: "Database Connection Pooling"
2. Architecture: "PgBouncer Configuration"
3. Post-mortem: "2023-11 Connection Exhaustion"

Would you like me to summarize any of these?

runbook> Summarize the first one

From "Database Connection Pooling":

Purpose: Handle database connection exhaustion

When to use:
- Connection count > 80% of limit
- High connection wait times
- Timeout errors in application logs

Steps:
1. Check current connection usage
2. Identify connection-holding queries
3. Configure PgBouncer if not present
4. Adjust pool size parameters

Related: payment-api, checkout-api, order-service
```

## Tips

1. **Be conversational** - Chat mode understands context from previous turns
2. **Use commands** - `/service` and `/incident` set helpful context
3. **Save important sessions** - Investigations can be resumed later
4. **Ask for clarification** - "What do you mean by X?" works
5. **Request specific formats** - "Show that as a table" or "Give me the commands"

## Next Steps

- [deploy](/RunbookAI/cli/deploy/) - Deploy services
- [knowledge](/RunbookAI/cli/knowledge/) - Manage knowledge base
