# Claude Session Storage + Learning Ingestion

## Goal

Let teams using Claude-based coding/on-call agents store session logs in a location they choose, then run Runbook learning loops on those sessions to generate:
- postmortems
- runbook updates/proposals
- new knowledge documents

This makes Runbook usable without forcing teams to change their daily agent tooling.

## Design Summary

### 1) Pluggable storage backend

Runbook persists Claude hook events through a storage abstraction with configurable backend:
- `local` (default): `.runbook/hooks/claude`
- `s3`: centralized object storage

Optional `mirrorLocal` keeps local artifacts even when `s3` is the primary backend.

### 2) Hook persistence flow

Claude hook callback (`runbook integrations claude hook`) now:
1. loads Runbook config
2. builds storage backend from `integrations.claude.sessionStorage`
3. persists event via selected backend(s)

### 3) Learning-loop ingestion from session logs

New command:

```bash
runbook integrations claude learn <session-id> [--incident-id <id>] [--query <text>] [--apply-runbook-updates]
```

This command:
1. loads stored session events from configured backend
2. converts them into learning timeline events
3. synthesizes investigation metadata
4. runs the existing learning loop pipeline

## Config

```yaml
integrations:
  claude:
    sessionStorage:
      backend: local # local | s3
      mirrorLocal: true
      localBaseDir: .runbook/hooks/claude
      s3:
        bucket: your-runbook-session-logs
        prefix: runbook/hooks/claude
        region: us-east-1
        endpoint: https://s3.amazonaws.com # optional
        forcePathStyle: false
```

Validation:
- if `backend: s3`, `s3.bucket` is required.

## Why This Enables Adoption

- Works with existing Claude workflows; no custom UI required.
- Supports centralized storage for multi-team auditability.
- Keeps default local behavior for zero-friction setup.
- Connects agent sessions directly to postmortem/runbook learning outputs.

## Roadmap

### Implemented in this phase
- Storage abstraction
- `local` backend
- `s3` backend
- hook persistence routing through configured backend
- learning-loop ingestion command for stored sessions

### Next phases
- GitHub backend (repo issues/artifacts/JSONL blobs)
- retention policy + compaction
- PII redaction hooks before persist
- cross-session incident clustering and retrieval
