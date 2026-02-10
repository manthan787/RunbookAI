# YC Demo Setup (Chat + Investigate)

This guide gives you a deterministic setup for recording two flows:

1. Chat/ask using ingested runbooks.
2. `runbook investigate` on a controlled failing-command incident.

## 1) Create Demo Assets

```bash
scripts/demo/setup-yc-demo.sh
```

What this does:
- Creates realistic knowledge docs under `.runbook/runbooks/yc-demo/`.
- Runs `npm run dev -- knowledge sync` to ingest them.

## 2) Optional: Provision AWS Failing Infra

```bash
scripts/demo/setup-yc-demo.sh --with-aws
```

What this adds:
- A Lambda function that intentionally fails with command-not-found.
- An EventBridge rule that invokes it every minute.
- A CloudWatch alarm set to ALARM for deterministic recording.

## 3) Optional: Create PagerDuty Incident

If you want a real incident ID for the demo:

```bash
export PAGERDUTY_EVENTS_ROUTING_KEY=...
export PAGERDUTY_API_KEY=... # optional but recommended so script can auto-store incident ID
scripts/demo/setup-yc-demo.sh --with-aws --create-pd-incident
```

The script triggers via PagerDuty Events API and, when `PAGERDUTY_API_KEY` is set, writes the incident ID to `.runbook/demo/yc-demo.env`.

If you want `pagerduty_*` tools available at runtime, ensure `.runbook/config.yaml` includes:

```yaml
incident:
  pagerduty:
    enabled: true
    apiKey: ${PAGERDUTY_API_KEY}
```

## Recording Script

### A) Chat / knowledge demo

```bash
npm run dev -- knowledge search "checkout command not found exit code 127"
npm run dev -- ask "What does the runbook say for checkout-api command not found incidents?"
npm run dev -- chat
```

Suggested live prompts in chat:
- "Summarize the runbook for checkout-api exit code 127 and give me a 5-minute triage plan."
- "What rollback and validation steps should I run for a command-not-found deploy failure?"

### B) Investigate demo

Use either:
- PagerDuty incident ID from `.runbook/demo/yc-demo.env`, or
- Synthetic ID: `DEMO-checkout-command-not-found`

```bash
npm run dev -- investigate <incident-id> --verbose
```

## Cleanup

```bash
scripts/demo/cleanup-yc-demo.sh
```

Or explicit values:

```bash
scripts/demo/cleanup-yc-demo.sh --region us-east-1 --prefix runbook-yc-demo
```
