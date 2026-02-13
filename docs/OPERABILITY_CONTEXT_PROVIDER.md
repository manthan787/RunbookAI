# Operability Context Provider Contract

This document defines the provider abstraction for ingesting and querying operability context from external platforms (for example Sourcegraph and checkpoint systems) while keeping RunbookAI runtime logic provider-agnostic.

## Goals

1. Support mature third-party context systems before building a full standalone context platform.
2. Keep deterministic claim-vs-fact reconciliation in RunbookAI.
3. Preserve provenance and confidence for every context answer.

## Core Contract

Implementation types live in:

- `src/providers/operability-context/types.ts`
- `src/providers/operability-context/registry.ts`
- `src/providers/operability-context/reconcile.ts`

Provider shape:

```ts
interface OperabilityContextProvider {
  id: string;
  displayName: string;
  capabilities: OperabilityContextCapability[];

  healthcheck(): Promise<ProviderHealth>;

  ingestChangeSessionStart(input: AgentChangeClaim): Promise<ProviderAck>;
  ingestChangeCheckpoint(input: AgentChangeClaim): Promise<ProviderAck>;
  ingestChangeSessionEnd(input: AgentChangeClaim): Promise<ProviderAck>;
  ingestPullRequestEvent?(input: PullRequestIngestEvent): Promise<ProviderAck>;

  getServiceContext?(query: ServiceContextQuery): Promise<ProviderResult<ServiceContextRecord>>;
  getIncidentContext?(query: IncidentContextQuery): Promise<ProviderResult<IncidentContextRecord>>;
  getDiffBlastRadius?(query: DiffBlastRadiusQuery): Promise<ProviderResult<DiffBlastRadiusResult>>;
  getOperabilityGaps?(query: OperabilityGapsQuery): Promise<ProviderResult<OperabilityGapsResult>>;
  validatePROperability?(
    query: PROperabilityValidationQuery
  ): Promise<ProviderResult<PROperabilityValidationResult>>;
  reconcileClaimWithFact?(
    claim: AgentChangeClaim,
    fact: VerifiedChangeFact
  ): Promise<ProviderResult<ReconciledChangeSummary>>;
}
```

## Required Data Behavior

1. Session ingestion accepts structured claims (`start`, `checkpoint`, `end`).
2. PR ingestion is optional webhook fallback.
3. Query methods are capability-driven and may be partially implemented.
4. Every response includes:
   - `confidence.value` in `[0..1]`
   - `provenance[]` with provider/source/record IDs.

## Claim vs Fact Reconciliation

Runbook includes a deterministic fallback reconciler in `reconcile.ts` that computes:

1. Delta: files/services/tests/risk/rollout/rollback mismatches.
2. Trust score: weighted claim-vs-fact alignment.
3. Confidence score: trust + provenance depth + open risk.

Providers can override reconciliation, but the built-in fallback always exists.

## Provider Registry and Fusion

`OperabilityContextProviderRegistry` supports:

1. Multi-provider registration.
2. Capability-based routing.
3. Confidence-based best-result selection.
4. Health checks and ingest fan-out.

For a query, Runbook can:

1. Call all providers that support capability.
2. Rank successful responses by confidence.
3. Use highest-confidence result while retaining all results for auditing.

## Configuration

Runbook config supports provider gating:

```yaml
providers:
  operabilityContext:
    enabled: true
    adapter: sourcegraph # none | sourcegraph | entireio | custom
    baseUrl: https://context.company.internal
    apiKey: ${RUNBOOK_OPERABILITY_CONTEXT_API_KEY}
    timeoutMs: 5000
```

Validation rules:

1. `enabled: true` requires adapter not `none`.
2. `enabled: true` requires `baseUrl` (or `RUNBOOK_OPERABILITY_CONTEXT_URL` env).
3. Non-`custom` adapters require API key (or `RUNBOOK_OPERABILITY_CONTEXT_API_KEY` env).

## Recommended Adapter Rollout

1. Start with 1 provider (for example Sourcegraph) + PR webhook fallback.
2. Add checkpoint/session provider as second adapter.
3. Compare confidence and claim-fact deltas before enabling hard CI gating.

## Ingestion Modes in RunbookAI

Runbook now supports both automatic and manual ingestion paths:

1. Automatic via Claude hooks:
   - `runbook integrations claude hook` now maps hook events to stages:
     - `SessionStart` -> `start`
     - `UserPromptSubmit` / `PreToolUse` / `PostToolUse` -> `checkpoint`
     - `Stop` / `SubagentStop` -> `end`
   - Dispatches to `POST /v1/ingest/change-session/<stage>`.
   - Failures are queued under `.runbook/operability-context/spool/`.

2. Manual CLI:
   - `runbook operability ingest start --session-id <id> ...`
   - `runbook operability ingest checkpoint --session-id <id> ...`
   - `runbook operability ingest end --session-id <id> ...`
   - `runbook operability replay`
   - `runbook operability status`

This gives teams an always-on default path (hooks/webhooks/CI) with manual replay/backfill for reliability.

Setup details and operational commands are documented in:

- `docs/OPERABILITY_INGESTION.md`

## Next Integration Steps

1. Add concrete adapters under `src/providers/operability-context/adapters/`.
2. Wire registry construction in runtime bootstrap (`src/cli.tsx`).
3. Add an agent tool (`operability_context_query`) backed by the registry.
4. Extend evals to compare investigation quality with context provider enabled vs disabled.
