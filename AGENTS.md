# AGENTS Context Log

## Purpose
This file preserves implementation context from the latest RunbookAI build-out so future agent sessions can continue without losing decisions or wiring details.

## Session Summary (2026-02-08)
The codebase was extended from "planned capabilities" to active runtime behavior in four core areas:
- Skill execution
- Runtime skill/knowledge wiring
- Kubernetes provider gating
- Init wizard profile editing/hydration

All changes were validated with:
- `npm run typecheck`
- `npm run test` (8 files, 241 tests)

---

## 1) Runtime Skill Execution (Now Active)

### What changed
- The `skill` tool now executes workflows via `SkillExecutor` instead of returning metadata only.
- User skills are loaded at runtime before invocation.
- `requiresApproval` skill steps trigger approval flow.
- Execution returns step-by-step status, duration, outputs, and errors.

### File
- `src/tools/registry.ts`

### Impact
- Skills are now operational workflows, not static descriptors.

---

## 2) Runtime Agent Wiring (Dynamic Skills + Knowledge)

### What changed
- Removed hardcoded skill list in CLI runtime paths.
- Runtime now loads skill IDs from `skillRegistry`.
- Added knowledge retriever adapter into runtime `Agent`.
- Applied in ask/investigate/simple text modes.

### Files
- `src/cli.tsx`

### Impact
- Prompt skill list reflects actual registry/user skills.
- Agent can retrieve knowledge during normal runtime.

---

## 3) Incident Config Parity (OpsGenie)

### What changed
- Added `incident.opsgenie` to core config schema.
- Added validation error when OpsGenie is enabled without API key.

### File
- `src/utils/config.ts`

### Impact
- Onboarding and runtime validation are now aligned for incident providers.

---

## 4) Kubernetes Tooling Added

### What changed
- Added `kubernetes_query` tool with read-only actions:
  - `status`
  - `contexts`
  - `namespaces`
  - `pods`
  - `deployments`
  - `nodes`
  - `events`
  - `top_pods`
  - `top_nodes`
- Registered Kubernetes category in tool registry.

### File
- `src/tools/registry.ts`

### Impact
- Kubernetes is a first-class operational surface (read-only phase).

---

## 5) Kubernetes Tool Gating (to reduce tool overload)

### What changed
- Added config gate: `providers.kubernetes.enabled`.
- Runtime tool filtering now excludes `kubernetes_query` when disabled.
- Implemented shared helper for tool filtering.
- Fixed chat mode bypass so chat also respects tool gating.

### Files
- `src/utils/config.ts`
- `src/cli/runtime-tools.ts`
- `src/cli.tsx`
- `src/cli/chat.tsx`

### Impact
- Kubernetes tools are only in prompt/tool list when explicitly enabled.

---

## 6) Init Wizard Improvements (Existing Profile Editing)

### What changed
- Setup wizard now detects existing `.runbook/config.yaml|yml` and `.runbook/services.yaml`.
- Hydrates prior choices as defaults (LLM/provider, regions, services, incidents, Kubernetes, etc.).
- Single-select steps default focus to prior value, so Enter can keep-and-continue.
- Existing values are shown as `Current: ...`.

### Files
- `src/cli/setup-wizard.tsx`
- `src/config/onboarding.ts`

### Impact
- `runbook init` is now edit-friendly for existing setups, not only first-time setup.

---

## 7) Onboarding/SaveConfig Enhancements

### What changed
- Added Kubernetes question in onboarding prompts.
- Save path now persists `providers.kubernetes.enabled` into `.runbook/config.yaml`.
- Added `useKubernetes` in onboarding answer model.

### Files
- `src/config/onboarding.ts`
- `src/cli/setup-wizard.tsx`

### Impact
- User choice during init directly controls runtime tool exposure.

---

## 8) Documentation Added/Updated

### Added
- `CODEX_PLAN.md` (phase-by-phase implementation log)
- `docs/CHANGES_2026-02-08.md` (technical changelog)
- `src/cli/runtime-tools.ts` (new runtime helper)

### Updated
- `README.md`:
  - New features section entries
  - Updated config examples (camelCase keys)
  - Added `providers.kubernetes.enabled`
  - Added recent changes section

---

## 9) Key Behavioral Guarantees

1. If `providers.kubernetes.enabled: false`:
- `kubernetes_query` is filtered from runtime tools.
- It should not appear in system prompt/tool list for ask/investigate/chat.

2. If `providers.kubernetes.enabled: true`:
- `kubernetes_query` is available to runtime agent.

3. Init wizard with existing profile:
- Loads prior values.
- Allows fast Enter-to-keep progression.

---

## 10) References
- `CODEX_PLAN.md`
- `docs/CHANGES_2026-02-08.md`

---

## Session Summary (2026-02-09)
Investigation evaluation tooling was expanded to support cross-dataset benchmarks and robust real-loop scoring.

All changes were validated with:
- `npm run eval:all -- --benchmarks tracerca --tracerca-input examples/evals/tracerca-input.sample.json --out-dir .runbook/evals/all-benchmarks --limit 2`

---

## 11) Investigation Eval Resilience (Parser + Scoring)

### What changed
- LLM parser now tolerates common provider shape drift:
  - nullable `queries[].service`
  - nullable remediation fields (`command`, `rollbackCommand`, `matchingSkill`, `matchingRunbook`)
  - string-or-array normalization for conclusion fields like `unknowns`/`alternativeExplanations`
- Scoring now uses weighted dimensions and service alias normalization to reduce false negatives from naming variants.

### Files
- `src/agent/llm-parser.ts`
- `src/agent/__tests__/llm-parser.test.ts`
- `src/eval/scoring.ts`
- `src/eval/__tests__/scoring.test.ts`

### Impact
- Fewer eval hard-fails due to strict schema mismatches.
- More stable benchmark numbers when service naming differs across datasets.

---

## 12) Environment-Aware Investigation Tool Use

### What changed
- Investigation orchestrator now accepts runtime `availableTools` and adapts telemetry query tool selection when defaults are unavailable.
- Structured investigation path passes runtime tool availability into orchestrator.

### Files
- `src/agent/investigation-orchestrator.ts`
- `src/agent/state-machine.ts`
- `src/cli.tsx`
- `src/eval/investigation-benchmark.ts`

### Impact
- Better behavior across heterogeneous provider environments during investigations and evals.

---

## 13) Multi-Dataset Benchmarking (RCAEval + Rootly + TraceRCA)

### What changed
- Added TraceRCA converter for `.json/.jsonl/.csv/.tsv` sources.
- Added unified runner to execute selected benchmarks and emit per-benchmark reports and summary.
- Added npm scripts:
  - `eval:convert:tracerca`
  - `eval:all`

### Files
- `src/eval/tracerca-to-fixtures.ts`
- `src/eval/run-all-benchmarks.ts`
- `package.json`
- `examples/evals/tracerca-input.sample.json`
- `docs/INVESTIGATION_EVAL.md`

### Impact
- One command can now run all supported evaluation datasets and produce comparable per-benchmark outputs.

---

## 14) Evaluation Output Contract

Unified benchmark output directory:
- `.runbook/evals/all-benchmarks/rcaeval-report.json`
- `.runbook/evals/all-benchmarks/rootly-report.json`
- `.runbook/evals/all-benchmarks/tracerca-report.json`
- `.runbook/evals/all-benchmarks/summary.json`

Behavioral guarantees:
1. Missing dataset input for a benchmark yields `skipped` status with a reason.
2. Converter failures are surfaced as `failed` with command logs.
3. Benchmark reports are always emitted per benchmark run path when investigation execution completes.
