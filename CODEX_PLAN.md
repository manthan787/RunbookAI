# CODEX Execution Plan

## Goal
Build RunbookAI toward a true "24/7 on-call engineer" platform: always-on incident operations, deep surface integrations, safe remediation, and auditable execution.

## Working Rules
- Execute phases sequentially without waiting for manual confirmation.
- Update this file at the end of each phase with:
  - `Status`
  - `Completed Work`
  - `Code Changes`
  - `Validation`
  - `Next Phase`

---

## Phase 0: Baseline and Plan
Status: `COMPLETED`

### Deliverables
- Create a detailed execution roadmap.
- Define phase boundaries and success criteria.

### Success Criteria
- Plan is committed in `CODEX_PLAN.md`.
- First implementation phase starts immediately after planning.

---

## Phase 1: Runtime Skill Execution (Foundational)
Status: `COMPLETED`

### Problem
The `skill` tool currently loads and returns skill metadata but does not execute workflows.

### Deliverables
- Wire `skill` tool to execute workflows through `SkillExecutor`.
- Add approval callback handling for `requiresApproval` steps.
- Return step-by-step execution results and final status to the agent.

### Success Criteria
- Calling `skill` with valid args runs actual skill steps.
- Steps requiring approval trigger the existing approval flow.
- Errors include clear step-level context.

### Planned Files
- `src/tools/registry.ts`

---

## Phase 2: Dynamic Skills + Knowledge in Agent Runtime
Status: `COMPLETED`

### Problem
CLI runtime uses hardcoded skills and does not pass a knowledge retriever to the `Agent` path used by `ask`/`investigate`.

### Deliverables
- Load built-in + user skills from `skillRegistry` for runtime tool prompting.
- Inject a knowledge retriever adapter into `Agent` in both TTY and non-TTY paths.
- Keep behavior backward compatible.

### Success Criteria
- Agent prompt skill list reflects actual registry content.
- Knowledge retrieval events can trigger during runs.
- No regressions for existing commands.

### Planned Files
- `src/cli.tsx`

---

## Phase 3: Incident Provider Config Parity
Status: `COMPLETED`

### Problem
Onboarding supports OpsGenie, but core config schema/validation only models PagerDuty + Slack.

### Deliverables
- Add OpsGenie to main incident config schema.
- Add validation for OpsGenie API key when enabled.

### Success Criteria
- `loadConfig` returns typed OpsGenie config.
- Enabling OpsGenie without key produces a clear config error.

### Planned Files
- `src/utils/config.ts`

---

## Phase 4: Kubernetes as First-Class Operational Surface
Status: `COMPLETED`

### Problem
Kubernetes client exists but is not exposed as an agent tool.

### Deliverables
- Add read-focused Kubernetes query tool(s) to registry.
- Register in tool categories for agent discoverability.
- Support core actions: availability/context, pods, deployments, nodes, events.

### Success Criteria
- Agent can call Kubernetes tools directly.
- Tool output is structured and safe (read-only for this phase).

### Planned Files
- `src/tools/registry.ts`

---

## Phase 5: Validation and Stabilization
Status: `COMPLETED`

### Deliverables
- Run targeted tests and typecheck.
- Fix regressions from phases 1-4.
- Update this plan with final status and residual risks.

### Success Criteria
- Test suite and typecheck pass for touched areas.
- Known gaps are documented.

### Planned Commands
- `npm run test`
- `npm run typecheck`

---

## Phase 6: Kubernetes Tool Gating via Init/Config
Status: `COMPLETED`

### Deliverables
- Add Kubernetes enable/disable selection to onboarding.
- Persist Kubernetes provider flag in main config.
- Gate runtime tool registration so Kubernetes tools are only exposed when enabled.

### Success Criteria
- `runbook init` captures Kubernetes stack usage.
- `.runbook/config.yaml` stores `providers.kubernetes.enabled`.
- Runtime agent excludes `kubernetes_query` when disabled.

---

## Progress Log

### 2026-02-08 - Phase 0 Update
- Status: `COMPLETED`
- Completed Work:
  - Authored `CODEX_PLAN.md` with a phased roadmap and success criteria.
  - Defined execution rules and progress logging format.
- Next Phase: `Phase 1`

### 2026-02-08 - Phase 1 Update
- Status: `COMPLETED`
- Completed Work:
  - Wired `skill` tool to execute real workflows through `SkillExecutor`.
  - Added approval callback integration for steps marked `requiresApproval`.
  - Added runtime loading of user skills before invocation.
  - Returned structured execution results (status, per-step output, duration, errors).
- Code Changes:
  - `src/tools/registry.ts`
- Validation:
  - Pending full typecheck in final validation phase.
- Next Phase: `Phase 2`

### 2026-02-08 - Phase 2 Update
- Status: `COMPLETED`
- Completed Work:
  - Replaced hardcoded runtime skill list with registry-driven skill IDs.
  - Added user-skill loading for runtime prompt/tool awareness.
  - Injected a knowledge retriever adapter into runtime `Agent` construction.
  - Applied runtime agent creation path consistently in TTY and non-TTY modes.
- Code Changes:
  - `src/cli.tsx`
- Validation:
  - Pending full typecheck in final validation phase.
- Next Phase: `Phase 3`

### 2026-02-08 - Phase 3 Update
- Status: `COMPLETED`
- Completed Work:
  - Added OpsGenie to the main incident config schema.
  - Added config validation for missing OpsGenie API key when enabled.
- Code Changes:
  - `src/utils/config.ts`
- Validation:
  - Pending full typecheck in final validation phase.
- Next Phase: `Phase 4`

### 2026-02-08 - Phase 4 Update
- Status: `COMPLETED`
- Completed Work:
  - Added `kubernetes_query` as a first-class tool in the registry.
  - Implemented read-only actions: `status`, `contexts`, `namespaces`, `pods`, `deployments`, `nodes`, `events`, `top_pods`, `top_nodes`.
  - Registered Kubernetes tool category for agent discoverability.
- Code Changes:
  - `src/tools/registry.ts`
- Validation:
  - Pending full typecheck and test run in Phase 5.
- Next Phase: `Phase 5`

### 2026-02-08 - Phase 5 Update
- Status: `COMPLETED`
- Completed Work:
  - Ran `npm run typecheck` successfully.
  - Ran `npm run test` successfully.
  - Confirmed touched-phase changes are green with current test suite.
- Validation:
  - `tsc --noEmit`: passed
  - `vitest run`: passed (8 files, 241 tests)
- Next Phase: `DONE`

### 2026-02-08 - Phase 6 Update
- Status: `COMPLETED`
- Completed Work:
  - Added Kubernetes onboarding question in setup wizard flow.
  - Saved `providers.kubernetes.enabled` in generated main config.
  - Added runtime tool filtering to hide `kubernetes_query` unless enabled.
- Code Changes:
  - `src/config/onboarding.ts`
  - `src/cli/setup-wizard.tsx`
  - `src/utils/config.ts`
  - `src/cli.tsx`
- Validation:
  - `npm run typecheck`: passed
  - `npm run test`: passed (8 files, 241 tests)
- Runtime gating smoke query: `kubernetes_query` absent when disabled, present when enabled
- Config save smoke query: `providers.kubernetes.enabled` persisted correctly for true/false
- Next Phase: `DONE`

### 2026-02-08 - Phase 7 Update
- Status: `COMPLETED`
- Completed Work:
  - Setup wizard now hydrates previously configured profile values from existing config files.
  - Wizard steps show current values and allow Enter-to-keep progression without re-entry.
  - Step focus now defaults to previously selected option for single-select prompts.
  - Existing-profile detection now only activates when config files are actually present.
- Code Changes:
  - `src/cli/setup-wizard.tsx`
- Validation:
  - `npm run typecheck`: passed
  - `npm run test`: passed (8 files, 241 tests)
- Next Phase: `DONE`

### 2026-02-08 - Phase 8 Update
- Status: `COMPLETED`
- Completed Work:
  - Fixed runtime tool gating bypass in chat mode.
  - Chat now uses registry-driven skills and config-filtered tools.
  - Chat now wires knowledge retrieval (same behavior class as ask/investigate).
  - Chat header now shows Kubernetes enabled/disabled state for quick verification.
- Code Changes:
  - `src/cli/chat.tsx`
- Validation:
  - `npm run typecheck`: passed
  - `npm run test`: passed (8 files, 241 tests)
- Next Phase: `DONE`
