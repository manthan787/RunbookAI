# Claude Code Integration

RunbookAI integrates deeply with [Claude Code](https://claude.ai/claude-code), Anthropic's AI coding assistant, to provide contextual knowledge and investigation capabilities during your coding sessions.

## Overview

The integration provides three key features:

1. **Context Injection via Hooks** - Automatically inject relevant runbooks, known issues, and postmortems into Claude's context based on what you're discussing
2. **MCP Server** - Expose RunbookAI's knowledge base as tools that Claude Code can query on-demand
3. **Investigation Checkpoints** - Save and resume investigation state across sessions

## Quick Start

### 1. Install Claude Code Hooks

```bash
# Install hooks (project-scoped)
runbook integrations claude enable

# Verify installation
runbook integrations claude status
```

This adds hooks to `.claude/settings.json` that fire on key events during Claude Code sessions.

### 2. Start the MCP Server (Optional)

```bash
# Run MCP server for on-demand knowledge queries
runbook mcp serve
```

Or add to your Claude Code MCP configuration to auto-start.

## Context Injection

When hooks are enabled, RunbookAI automatically provides relevant context to Claude based on your conversation.

### How It Works

1. **SessionStart**: When Claude starts a new session, RunbookAI links it and shows available knowledge stats
2. **UserPromptSubmit**: When you ask Claude about something, RunbookAI:
   - Extracts services mentioned (e.g., "payment-service", "user-api")
   - Detects symptoms (e.g., "500 errors", "high latency", "timeouts")
   - Searches the knowledge base for relevant runbooks and known issues
   - Injects context as a system message

### Example

When you ask Claude:

> "The checkout-service is returning 500 errors and users are seeing high latency"

RunbookAI automatically injects:

```
## RunbookAI Context

**Detected Symptoms:** HTTP 500 errors, High latency
**Services Mentioned:** checkout

### Relevant Runbooks
- **Checkout Service Error Handling** (85% match)
  Services: checkout, payment
  Preview: This runbook covers common checkout service issues...

### Active Known Issues
- ⚠️ **Checkout Service Redis Connection Issues**
  Services: checkout, redis
  Known issue affecting checkout under high load...

---
_Use this knowledge to inform your investigation._
```

### Supported Patterns

**Service Extraction:**
- `*-service` (e.g., "payment-service" → "payment")
- `*-api` (e.g., "user-api" → "user")
- `*-worker` (e.g., "checkout-worker" → "checkout")
- `*-gateway` (e.g., "api-gateway" → "api")

**Symptom Detection:**
- HTTP errors: 500, 502, 503, 504
- Performance: timeout, latency, slow
- Resources: memory leak, high CPU, disk full
- Stability: crash, restart, OOM
- Connections: connection pool, connection refused

## MCP Server

The MCP (Model Context Protocol) server exposes RunbookAI's knowledge as tools that Claude Code can call on-demand.

### Starting the Server

```bash
# Start MCP server on stdio (for Claude Code integration)
runbook mcp serve

# List available tools
runbook mcp tools
```

### Available Tools

| Tool | Description |
|------|-------------|
| `search_runbooks` | Search runbooks by query and optional service filter |
| `get_known_issues` | Get active known issues for specific services or symptoms |
| `search_postmortems` | Search past incident postmortems for similar patterns |
| `get_knowledge_stats` | Get statistics about the knowledge base |
| `list_services` | List all services with documentation in the knowledge base |

### Tool Schemas

**search_runbooks**
```json
{
  "query": "string (required) - Search query",
  "services": "string[] (optional) - Filter by services",
  "limit": "number (optional, default: 5)"
}
```

**get_known_issues**
```json
{
  "services": "string[] (optional) - Filter by services",
  "symptoms": "string[] (optional) - Filter by symptoms",
  "severity": "string (optional) - Filter by severity (sev1, sev2, etc.)"
}
```

**search_postmortems**
```json
{
  "query": "string (required) - Search query",
  "services": "string[] (optional) - Filter by services",
  "limit": "number (optional, default: 3)"
}
```

### Claude Code Configuration

To automatically start the MCP server with Claude Code, add to your `claude_desktop_config.json` or project MCP config:

```json
{
  "mcpServers": {
    "runbook-ai": {
      "command": "npx",
      "args": ["runbook", "mcp", "serve"],
      "env": {}
    }
  }
}
```

## Investigation Checkpoints

Checkpoints allow you to save and resume investigation state across Claude Code sessions.

### CLI Commands

```bash
# List all checkpoints for an investigation
runbook checkpoint list --investigation inv-12345

# Show checkpoint details
runbook checkpoint show --id abc123def456

# Delete a checkpoint
runbook checkpoint delete --id abc123def456

# Delete all checkpoints for an investigation
runbook checkpoint delete-all --investigation inv-12345
```

### What's Saved

A checkpoint captures:

- **Phase**: Current investigation phase (triage, investigate, hypothesize, conclude, remediate)
- **Hypotheses**: All hypotheses with their status, confidence, and reasoning
- **Services Discovered**: Services identified during investigation
- **Symptoms Identified**: Symptoms detected from user prompts and logs
- **Evidence**: Supporting and refuting evidence gathered
- **Tool Call Count**: Number of tool calls made
- **Root Cause**: Identified root cause (if concluded)

### Checkpoint Storage

Checkpoints are stored in `.runbook/checkpoints/<investigation-id>/`:

```
.runbook/checkpoints/inv-12345/
├── abc123def456.json    # Individual checkpoint
├── def456abc123.json    # Another checkpoint
└── latest.json          # Pointer to latest checkpoint
```

## Safety Features

### PreToolUse Blocking

RunbookAI can block potentially dangerous commands before Claude executes them:

**Blocked Patterns:**
- `rm -rf /` - Dangerous file deletion
- `kubectl delete deployment/pod/service` - Kubernetes destructive operations
- `aws ec2/ecs/rds terminate/delete/stop` - AWS destructive operations
- `docker rm/stop/kill -f` - Docker force operations

When blocked, Claude receives:
```
⚠️ RunbookAI blocked potentially dangerous command.
Use 'runbook approve' to proceed with mutations.
```

### Enabling/Disabling Features

```bash
# Disable knowledge injection (hooks still fire but don't inject context)
# Edit .runbook/config.yaml:
# hooks:
#   enableKnowledgeInjection: false

# Disable incident detection
# hooks:
#   enableIncidentDetection: false
```

## Hook Events

RunbookAI handles these Claude Code hook events:

| Event | Description | RunbookAI Action |
|-------|-------------|------------------|
| `SessionStart` | New Claude session | Link session, show knowledge stats |
| `UserPromptSubmit` | User sends prompt | Extract services/symptoms, inject context |
| `PreToolUse` | Before tool execution | Block dangerous commands |
| `PostToolUse` | After tool execution | Track tool usage (future: learning) |
| `Stop` | Session ends | Save checkpoint (future) |
| `SubagentStop` | Subagent completes | Save task checkpoint (future) |

## Configuration

Add to `.runbook/config.yaml`:

```yaml
hooks:
  # Enable context injection from knowledge base
  enableKnowledgeInjection: true

  # Enable incident detection from PagerDuty/OpsGenie
  enableIncidentDetection: true

  # Maximum runbooks to show in context
  maxRunbooksToShow: 3

  # Maximum known issues to show
  maxKnownIssuesToShow: 3

mcp:
  # Port for MCP server (if using HTTP transport)
  port: 8765
```

## Troubleshooting

### Hooks Not Firing

1. Check hooks are installed:
   ```bash
   runbook integrations claude status
   ```

2. Verify `.claude/settings.json` contains hook configuration

3. Restart Claude Code session

### No Context Being Injected

1. Check knowledge base has documents:
   ```bash
   runbook knowledge search "test"
   ```

2. Verify knowledge injection is enabled in config

3. Check hook handler logs:
   ```bash
   cat .runbook/hooks/claude/latest.json
   ```

### MCP Server Not Starting

1. Check for port conflicts
2. Verify npm/bun is in PATH
3. Try running directly:
   ```bash
   runbook mcp serve 2>&1 | head -20
   ```

## Related Documentation

- [Knowledge Sources](./docs.html#knowledge) - Configure runbooks, postmortems, and other knowledge
- [Investigation](./AGENT_DESIGN.md) - How the investigation agent works
- [Slack Gateway](./SLACK_GATEWAY.md) - Slack integration for @runbookAI mentions
