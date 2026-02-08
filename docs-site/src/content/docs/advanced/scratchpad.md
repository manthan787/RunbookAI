---
title: Scratchpad & Audit Trail
description: Understanding Runbook's audit logging
---

Every Runbook action is logged to a JSONL scratchpad for complete auditability.

## Purpose

The scratchpad provides:

- **Full audit trail** - Every decision documented
- **Debugging** - Understand why investigations concluded as they did
- **Learning** - Review past investigations for improvement
- **Compliance** - Evidence for audits and reviews

## Location

Scratchpad files are stored in:

```
.runbook/scratchpad/
├── session-abc123.jsonl
├── session-def456.jsonl
└── session-ghi789.jsonl
```

Each session (investigation, chat, etc.) creates a separate file.

## Entry Types

### Session Lifecycle

```json
{"type":"session_start","sessionId":"abc123","query":"Investigate PD-12345","timestamp":"2024-01-15T15:00:00Z"}
{"type":"session_end","sessionId":"abc123","status":"completed","duration":45000,"timestamp":"2024-01-15T15:00:45Z"}
```

### Tool Execution

```json
{"type":"tool_start","tool":"aws_query","args":{"service":"rds","operation":"describe-db-instances"},"timestamp":"..."}
{"type":"tool_end","tool":"aws_query","duration":234,"success":true,"resultSummary":"Found 3 instances","timestamp":"..."}
{"type":"tool_error","tool":"aws_query","error":"Access denied","timestamp":"..."}
```

### Hypothesis Management

```json
{"type":"hypothesis_formed","id":"h1","description":"Database connection exhaustion","probability":0.45,"timestamp":"..."}
{"type":"hypothesis_tested","id":"h1","evidence":"strong","details":"Connections at 95%","timestamp":"..."}
{"type":"hypothesis_confirmed","id":"h1","confidence":0.92,"timestamp":"..."}
{"type":"hypothesis_pruned","id":"h2","reason":"No evidence of deployment correlation","timestamp":"..."}
```

### Evidence

```json
{"type":"evidence_gathered","hypothesis":"h1","source":"aws_query","strength":"strong","data":{"connections":95,"limit":100},"timestamp":"..."}
```

### Thinking

```json
{"type":"thinking","content":"The high connection count suggests pool exhaustion. Checking traffic patterns next.","timestamp":"..."}
```

### Approvals

```json
{"type":"approval_requested","operation":"scale_ecs_service","riskLevel":"high","timestamp":"..."}
{"type":"approval_granted","approver":"alice@company.com","channel":"slack","timestamp":"..."}
{"type":"approval_denied","approver":"bob@company.com","reason":"Need to check with team first","timestamp":"..."}
```

### Remediation

```json
{"type":"remediation_suggested","actions":[{"skill":"scale-service","params":{}}],"timestamp":"..."}
{"type":"remediation_executed","skill":"scale-service","result":"success","duration":4500,"timestamp":"..."}
```

## Storage Tiers

### Full

Complete tool results stored in context:

```json
{"type":"tool_end","tier":"full","result":{"instances":[{"id":"i-abc","state":"running"},...]},...}
```

### Compact

Summarized to save tokens:

```json
{"type":"tool_end","tier":"compact","resultSummary":"12 running EC2 instances","fullResultRef":"results/abc123.json",...}
```

### Cleared

Archived but available for drill-down:

```json
{"type":"tool_end","tier":"cleared","resultRef":"archive/session-abc/tool-5.json",...}
```

## Viewing Scratchpad

### CLI

```bash
# List sessions
runbook scratchpad list

# View session
runbook scratchpad show session-abc123

# Search across sessions
runbook scratchpad search "database connection"
```

### Programmatic

```typescript
import { Scratchpad } from 'runbook';

const scratchpad = new Scratchpad('session-abc123');

// Get all entries
const entries = await scratchpad.getEntries();

// Filter by type
const hypotheses = entries.filter(e => e.type.startsWith('hypothesis_'));

// Get timeline
const timeline = await scratchpad.getTimeline();
```

## Retention

Configure retention policy:

```yaml
scratchpad:
  retentionDays: 90          # Keep for 90 days
  compressAfterDays: 7       # Compress after 7 days
  archivePath: .runbook/archive/
```

## Example Session

```jsonl
{"type":"session_start","sessionId":"inv-12345","query":"Investigate PD-12345","timestamp":"2024-01-15T15:00:00Z"}
{"type":"tool_start","tool":"pagerduty_get_incident","args":{"incident_id":"PD-12345"},"timestamp":"2024-01-15T15:00:00.100Z"}
{"type":"tool_end","tool":"pagerduty_get_incident","duration":245,"success":true,"timestamp":"2024-01-15T15:00:00.345Z"}
{"type":"tool_start","tool":"search_knowledge","args":{"query":"checkout-api high error rate"},"timestamp":"2024-01-15T15:00:00.400Z"}
{"type":"tool_end","tool":"search_knowledge","duration":189,"success":true,"resultSummary":"Found 3 relevant documents","timestamp":"2024-01-15T15:00:00.589Z"}
{"type":"hypothesis_formed","id":"h1","description":"Database connection exhaustion","probability":0.45,"timestamp":"2024-01-15T15:00:01.000Z"}
{"type":"hypothesis_formed","id":"h2","description":"Recent deployment bug","probability":0.25,"timestamp":"2024-01-15T15:00:01.100Z"}
{"type":"thinking","content":"Starting with H1 due to higher probability and runbook match","timestamp":"2024-01-15T15:00:01.200Z"}
{"type":"tool_start","tool":"aws_query","args":{"service":"rds","operation":"describe"},"timestamp":"2024-01-15T15:00:01.300Z"}
{"type":"tool_end","tool":"aws_query","duration":234,"success":true,"timestamp":"2024-01-15T15:00:01.534Z"}
{"type":"evidence_gathered","hypothesis":"h1","strength":"strong","data":{"connections":95,"limit":100},"timestamp":"2024-01-15T15:00:01.600Z"}
{"type":"hypothesis_confirmed","id":"h1","confidence":0.92,"timestamp":"2024-01-15T15:00:02.000Z"}
{"type":"hypothesis_pruned","id":"h2","reason":"No deployment in error window","timestamp":"2024-01-15T15:00:02.100Z"}
{"type":"remediation_suggested","actions":[{"skill":"scale-service"}],"timestamp":"2024-01-15T15:00:02.500Z"}
{"type":"approval_requested","operation":"scale_rds","riskLevel":"high","timestamp":"2024-01-15T15:00:03.000Z"}
{"type":"approval_granted","approver":"alice@company.com","timestamp":"2024-01-15T15:00:45.000Z"}
{"type":"remediation_executed","skill":"scale-service","result":"success","timestamp":"2024-01-15T15:01:00.000Z"}
{"type":"session_end","sessionId":"inv-12345","status":"completed","rootCause":"Database connection exhaustion","confidence":0.92,"duration":60000,"timestamp":"2024-01-15T15:01:00.000Z"}
```
