# Operability Context Ingestion

RunbookAI now supports a hybrid ingestion flow for coding-session change intelligence:

1. Automatic ingestion from Claude hook events.
2. Manual CLI ingestion for custom agents/backfills.
3. Local spool + replay when provider APIs are unavailable.

This doc explains how teams should set it up in practice.

## 1) Configure Provider Access

Set `.runbook/config.yaml`:

```yaml
providers:
  operabilityContext:
    enabled: true
    adapter: sourcegraph # none | sourcegraph | entireio | custom
    baseUrl: https://context.company.internal
    apiKey: ${RUNBOOK_OPERABILITY_CONTEXT_API_KEY}
    timeoutMs: 5000
    requestHeaders:
      x-org: acme
```

Environment fallbacks:

- `RUNBOOK_OPERABILITY_CONTEXT_URL`
- `RUNBOOK_OPERABILITY_CONTEXT_API_KEY`

## 2) Automatic Ingestion (Claude Hooks)

If Claude hooks are enabled (`runbook integrations claude enable`), Runbook forwards hook events to operability ingestion:

- `SessionStart` -> `start`
- `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`, `Notification` -> `checkpoint`
- `Stop`, `SubagentStop` -> `end`

The same hook still persists session artifacts under `.runbook/hooks/claude/`.

## 3) Manual Ingestion (CLI)

Use manual commands for non-Claude agents or backfill:

```bash
runbook operability ingest start \
  --session-id codex-2026-02-13-001 \
  --agent codex \
  --intent "Refactor checkout retry path" \
  --services checkout,payment

runbook operability ingest checkpoint \
  --session-id codex-2026-02-13-001 \
  --files src/checkout/retry.ts,src/payment/client.ts \
  --tests "npm run test -- checkout"

runbook operability ingest end \
  --session-id codex-2026-02-13-001 \
  --risk high \
  --rollout-plan "Canary 10% then 50%" \
  --rollback-plan "Revert deployment"
```

Status and replay:

```bash
runbook operability status
runbook operability replay
runbook operability replay --limit 50
```

## 4) Queueing and Replay Behavior

If dispatch fails (network/provider outage), Runbook stores queue entries in:

`.runbook/operability-context/spool/`

Each queue file contains:

- stage (`start|checkpoint|end`)
- endpoint
- claim payload
- attempts + last error metadata

`runbook operability replay` re-sends queued entries and deletes successful files.

## 5) Provider Endpoint Contract

Runbook sends:

`POST /v1/ingest/change-session/<stage>`

Headers:

- `Content-Type: application/json`
- `Authorization: Bearer <apiKey>` (if configured)
- any configured `requestHeaders`

Body shape:

```json
{
  "adapter": "sourcegraph",
  "stage": "checkpoint",
  "claim": {
    "session": {
      "sessionId": "sess-123",
      "agent": "claude",
      "repository": "RunbookAI",
      "branch": "feature/foo",
      "baseSha": "abc123",
      "headSha": "def456",
      "startedAt": "2026-02-13T01:00:00.000Z"
    },
    "capturedAt": "2026-02-13T01:05:00.000Z",
    "intentSummary": "Investigate checkout 500s",
    "filesTouchedClaimed": ["src/checkout/retry.ts"],
    "servicesClaimed": ["checkout"],
    "riskClaimed": "high",
    "testsRunClaimed": ["npm run test -- checkout"],
    "unknowns": []
  }
}
```

Provider should return any `2xx` response to acknowledge ingestion.

## 6) Recommended Team Rollout

1. Enable provider config in one pilot repo.
2. Enable Claude hooks for pilot users.
3. Keep CI ingestion as source-of-truth verification path.
4. Monitor spool growth with `runbook operability status`.
5. Alert when replay failures persist.

## 7) Troubleshooting

1. `operability status` shows disabled:
   - set `providers.operabilityContext.enabled: true`.
2. queue keeps growing:
   - verify `baseUrl` and API auth.
   - inspect provider logs for `POST /v1/ingest/change-session/*`.
3. ingestion skipped in Claude hook:
   - ensure hook payload includes `session_id` and `hook_event_name`.
