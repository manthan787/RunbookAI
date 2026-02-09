# Investigate Agent Evaluation Harness

This document defines a practical benchmark loop for the `runbook investigate` agent.

## Goals

- Measure root-cause quality and safety over time.
- Catch regressions before shipping prompt/tool/runtime changes.
- Support both offline replay and shadow-mode evaluation.

## Harness components

- Runner: `src/eval/investigation-benchmark.ts`
- Scoring: `src/eval/scoring.ts`
- RCAEval converter: `src/eval/rcaeval-to-fixtures.ts`
- Rootly logs converter: `src/eval/rootly-logs-to-fixtures.ts`
- TraceRCA converter: `src/eval/tracerca-to-fixtures.ts`
- Unified benchmark runner: `src/eval/run-all-benchmarks.ts`
- Sample fixtures: `examples/evals/investigation-fixtures.sample.json`
- RCAEval input sample: `examples/evals/rcaeval-input.sample.json`

## Fixture format

```json
{
  "version": "1.0",
  "passThreshold": 0.7,
  "cases": [
    {
      "id": "case-id",
      "incidentId": "PD-123",
      "query": "Investigate incident PD-123",
      "context": "Additional logs or timeline",
      "tags": ["redis", "latency"],
      "expected": {
        "rootCause": "optional exact phrase",
        "rootCauseKeywords": ["redis", "connection pool"],
        "affectedServices": ["checkout-api", "redis"],
        "confidenceAtLeast": "medium",
        "requiredPhrases": ["evidence"],
        "forbiddenPhrases": ["drop database"]
      },
      "execute": {
        "maxIterations": 6,
        "autoRemediate": false
      }
    }
  ]
}
```

## Run benchmark

```bash
npm run eval:investigate -- --fixtures examples/evals/investigation-fixtures.sample.json
```

Optional flags:

- `--out <path>`: output report JSON path
- `--limit <n>`: run first N cases
- `--offline`: score from fixture `mockResult` fields (no live model/tool execution)

Example:

```bash
npm run eval:investigate -- \
  --fixtures examples/evals/investigation-fixtures.sample.json \
  --out .runbook/evals/nightly.json \
  --limit 20
```

## Output report

The runner writes a JSON report with:

- case-level scores
- pass/fail by threshold
- event counts (phase changes, hypotheses, queries, evaluations)
- aggregate pass rate and average score

## Scoring model (draft)

Current overall score is an average of available components:

- root-cause correctness (`rootCause` / `rootCauseKeywords`)
- affected-service coverage (`affectedServices`)
- confidence floor (`confidenceAtLeast`)
- phrase compliance (`requiredPhrases`, `forbiddenPhrases`)

## Recommended rollout

1. Build 30-100 replay cases from postmortems.
2. Establish baseline pass rate on current `main`.
3. Add CI gate for regressions:
   - fail if pass rate drops >5%
   - fail if safety phrase compliance drops below 0.98
4. Add weekly shadow evaluation against real incidents.

## RCAEval adapter workflow

Convert RCAEval-style rows into Runbook fixtures:

```bash
npm run eval:convert:rcaeval -- \
  --input examples/evals/rcaeval-input.sample.json \
  --out examples/evals/rcaeval-fixtures.generated.json
```

Generate fixtures with synthetic `mockResult` values for offline scoring:

```bash
npm run eval:convert:rcaeval -- \
  --input examples/evals/rcaeval-input.sample.json \
  --out examples/evals/rcaeval-fixtures.generated.json \
  --include-mock-result
```

Then run:

```bash
npm run eval:investigate -- \
  --fixtures examples/evals/rcaeval-fixtures.generated.json \
  --offline
```

## Unified benchmark run

Run all benchmark adapters (RCAEval, Rootly, TraceRCA) with per-benchmark reports:

```bash
npm run eval:all -- \
  --out-dir .runbook/evals/all-benchmarks \
  --limit 5
```

Useful options:

- `--offline`: run benchmark scoring from fixture `mockResult` where available
- `--benchmarks rcaeval,rootly,tracerca`: run selected benchmarks only
- `--rcaeval-input <path>`: custom RCAEval source file
- `--tracerca-input <path>`: TraceRCA source file (`.json/.jsonl/.csv/.tsv`)
- `--rootly-limit-per-dataset <n>`: limit generated cases per Rootly log source

Outputs:

- `.runbook/evals/all-benchmarks/rcaeval-report.json`
- `.runbook/evals/all-benchmarks/rootly-report.json`
- `.runbook/evals/all-benchmarks/tracerca-report.json`
- `.runbook/evals/all-benchmarks/summary.json`

## Open datasets (recommended)

- RCAEval benchmark (RE1/RE2/RE3): https://github.com/phamquiluan/RCAEval
- RCAEval dataset DOI (Zenodo): https://doi.org/10.5281/zenodo.14590730
- TraceRCA dataset/code (trace-based RCA on TrainTicket): https://github.com/NetManAIOps/TraceRCA
- AIOps Challenge 2020 dataset (metrics + traces + fault annotations): https://github.com/NetManAIOps/AIOps-Challenge-2020-Data
- Nezha multimodal RCA dataset repo (OnlineBoutique + TrainTicket labels): https://github.com/IntelligentDDS/Nezha
- Rootly open logs dataset (incident log analysis supplement): https://github.com/Rootly-AI-Labs/logs-dataset

## Notes

- This harness exercises the structured investigation orchestrator path.
- It requires the same provider credentials as normal runtime usage.
- Keep fixture context time-bounded to what was known at incident time.
