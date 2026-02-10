#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

WITH_AWS=0
CREATE_PD_INCIDENT=0
FORCE_ALARM=1
SKIP_SYNC=0
REGION="${AWS_REGION:-us-east-1}"
PREFIX="${RUNBOOK_DEMO_PREFIX:-runbook-yc-demo}"

usage() {
  cat <<USAGE
Usage: scripts/demo/setup-yc-demo.sh [options]

Creates demo knowledge documents for chat, then optionally provisions a controlled AWS failure
scenario for recording runbook investigate.

Options:
  --with-aws             Provision AWS demo resources (Lambda + CloudWatch alarm)
  --create-pd-incident   Create a PagerDuty incident (requires --with-aws and PD env vars)
  --no-force-alarm       Do not force CloudWatch alarm state to ALARM immediately
  --skip-sync            Skip running "npm run dev -- knowledge sync"
  --region <region>      AWS region (default: AWS_REGION or us-east-1)
  --prefix <prefix>      Resource prefix (default: runbook-yc-demo)
  -h, --help             Show this help

Required env for --create-pd-incident:
  Preferred (Events API):
    PAGERDUTY_EVENTS_ROUTING_KEY
    Optional: PAGERDUTY_API_KEY (used to auto-discover incident ID after trigger)

  Legacy (Incidents API create):
    PAGERDUTY_API_KEY
    PAGERDUTY_SERVICE_ID
    PAGERDUTY_FROM_EMAIL
USAGE
}

log() {
  printf '[demo-setup] %s\n' "$*"
}

warn() {
  printf '[demo-setup] WARN: %s\n' "$*" >&2
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '[demo-setup] ERROR: missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --with-aws)
        WITH_AWS=1
        ;;
      --create-pd-incident)
        CREATE_PD_INCIDENT=1
        ;;
      --no-force-alarm)
        FORCE_ALARM=0
        ;;
      --skip-sync)
        SKIP_SYNC=1
        ;;
      --region)
        if [[ $# -lt 2 ]]; then
          echo 'Missing value for --region' >&2
          exit 1
        fi
        shift
        REGION="${1:-}"
        if [[ -z "$REGION" ]]; then
          echo 'Missing value for --region' >&2
          exit 1
        fi
        ;;
      --prefix)
        if [[ $# -lt 2 ]]; then
          echo 'Missing value for --prefix' >&2
          exit 1
        fi
        shift
        PREFIX="${1:-}"
        if [[ -z "$PREFIX" ]]; then
          echo 'Missing value for --prefix' >&2
          exit 1
        fi
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        echo "Unknown option: $1" >&2
        usage
        exit 1
        ;;
    esac
    shift
  done

  if [[ "$CREATE_PD_INCIDENT" -eq 1 && "$WITH_AWS" -ne 1 ]]; then
    echo '--create-pd-incident requires --with-aws' >&2
    exit 1
  fi
}

setup_demo_knowledge() {
  local runbook_dir="$ROOT_DIR/.runbook/runbooks/yc-demo"
  mkdir -p "$runbook_dir"

  log "Writing demo runbooks to $runbook_dir"

  cat > "$runbook_dir/checkout-command-failure-runbook.md" <<'RUNBOOK'
---
type: runbook
title: Checkout API - Exit Code 127 (command not found) Incident Runbook
services:
  - checkout-api
  - checkout-worker
symptoms:
  - "Spike in 5xx responses from checkout-api"
  - "Container restarts with exit code 127"
  - "Logs contain: command not found"
severity: sev2
tags:
  - checkout
  - kubernetes
  - ecs
  - deployment
  - command-failure
author: SRE Team
lastValidated: 2026-02-10
---

# Checkout API - Exit Code 127 (command not found)

## When to use this runbook
Use this runbook when checkout requests fail and workload logs show command execution errors like `command not found` or `exit code 127`.

## Impact
- Checkout requests fail or return elevated 5xx rates.
- Background order finalization may backlog.

## Triage Checklist (5 minutes)
1. Confirm alarm scope and blast radius.
2. Inspect the latest deployment revision for checkout-api.
3. Check pod/task logs for startup command failures.
4. Verify image tag and container entrypoint configuration.

## High-Signal Log Patterns
- `exec: \"migrate-db\": executable file not found in $PATH`
- `/bin/sh: migrate-db: not found`
- `Process exited with status 127`

## Likely Root Cause
A deployment changed the startup command from the stable entrypoint to a missing binary (`migrate-db`) not included in the image.

## Immediate Mitigation
1. Roll back to the previous known-good image revision.
2. If rollback is blocked, override startup command to the stable command:

```bash
# ECS example
aws ecs update-service \
  --cluster prod-core \
  --service checkout-api \
  --force-new-deployment
```

```bash
# Kubernetes example
kubectl -n checkout set image deploy/checkout-api \
  checkout-api=ghcr.io/acme/checkout-api:<last-known-good-tag>
```

3. Monitor:
- 5xx rate drops below alert threshold
- Restart count stabilizes
- Checkout latency returns to baseline

## Validation
- No `command not found` log lines for 10 minutes.
- Error-rate alarm returns to `OK`.
- P95 checkout latency < 600 ms.

## Permanent Fix
- Add CI validation to verify configured startup command exists in image.
- Add deployment policy gate that blocks unknown entrypoints.
RUNBOOK

  cat > "$runbook_dir/checkout-known-issue-command-not-found.md" <<'KNOWN_ISSUE'
---
type: known_issue
title: Checkout startup command missing in container image
services:
  - checkout-api
  - checkout-worker
symptoms:
  - "exit code 127"
  - "command not found"
  - "checkout 5xx spike"
severity: sev2
tags:
  - known-issue
  - deployment
author: SRE Team
lastValidated: 2026-02-10
---

# Known Issue: Checkout startup command missing in image

A bad release can reference `migrate-db` in startup scripts when the binary is not packaged.

## Workaround
- Roll back to previous image revision.
- Re-deploy with explicit stable entrypoint.

## Detection
- CloudWatch alarm on function/task Errors > 1 for 1 minute.
- Logs show `executable file not found`.
KNOWN_ISSUE

  cat > "$runbook_dir/checkout-postmortem-2026-01-command-failure.md" <<'POSTMORTEM'
---
type: postmortem
title: Postmortem - Checkout API command-not-found deploy regression
incidentId: PM-2026-01-17
incidentDate: 2026-01-17
services:
  - checkout-api
  - checkout-worker
rootCause: Startup command in release manifest referenced missing binary (migrate-db).
severity: sev2
duration: 22m
author: SRE Team
actionItems:
  - Add image-entrypoint smoke test in CI.
  - Add deployment policy check for approved startup commands.
---

# Summary
A deployment regression changed startup command for checkout-api and worker pods, causing repeated crashes and user-facing checkout failures.

# Root Cause
Release manifest drift introduced `migrate-db` command not available in the image.

# What worked
Fast rollback and alarm-driven detection limited incident duration.

# Preventive actions
CI guardrails and deployment policy checks for command integrity.
POSTMORTEM
}

run_knowledge_sync() {
  if [[ "$SKIP_SYNC" -eq 1 ]]; then
    warn 'Skipping knowledge sync (--skip-sync)'
    return
  fi

  require_cmd node
  log 'Syncing knowledge index'
  if ! node --import tsx "$ROOT_DIR/src/cli.tsx" knowledge sync; then
    warn 'Direct tsx invocation failed; falling back to npm script'
    require_cmd npm
    npm run dev -- knowledge sync
  fi
}

setup_aws_failure() {
  require_cmd aws
  require_cmd zip

  local role_name="${PREFIX}-lambda-role"
  local function_name="${PREFIX}-failing-worker"
  local rule_name="${PREFIX}-every-minute"
  local alarm_name="${PREFIX}-lambda-errors"
  local topic_name="${PREFIX}-alerts"
  local log_group_name="/aws/lambda/${function_name}"

  log "Checking AWS credentials in region ${REGION}"
  aws sts get-caller-identity --output json >/dev/null

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "${tmp_dir:-}"' EXIT

  cat > "$tmp_dir/lambda_function.py" <<'PY'
import os
import subprocess

BAD_COMMAND = os.environ.get("DEMO_BAD_COMMAND", "migrate-db")


def handler(event, context):
    print(f"Running failing demo command: {BAD_COMMAND}")
    subprocess.run([BAD_COMMAND, "--version"], check=True, capture_output=True, text=True)
    return {"ok": True}
PY

  (
    cd "$tmp_dir"
    zip -q function.zip lambda_function.py
  )

  local role_arn=""
  if role_arn="$(aws iam get-role --role-name "$role_name" --query 'Role.Arn' --output text 2>/dev/null)"; then
    log "Using existing IAM role: $role_name"
  else
    log "Creating IAM role: $role_name"
    cat > "$tmp_dir/trust-policy.json" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
JSON

    role_arn="$(aws iam create-role \
      --role-name "$role_name" \
      --assume-role-policy-document "file://$tmp_dir/trust-policy.json" \
      --query 'Role.Arn' \
      --output text)"

    aws iam attach-role-policy \
      --role-name "$role_name" \
      --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

    log 'Waiting for IAM role propagation (10s)'
    sleep 10
  fi

  if aws lambda get-function --function-name "$function_name" --region "$REGION" >/dev/null 2>&1; then
    log "Updating existing Lambda: $function_name"
    aws lambda update-function-code \
      --function-name "$function_name" \
      --zip-file "fileb://$tmp_dir/function.zip" \
      --region "$REGION" >/dev/null

    aws lambda update-function-configuration \
      --function-name "$function_name" \
      --runtime python3.11 \
      --handler lambda_function.handler \
      --timeout 15 \
      --memory-size 128 \
      --environment "Variables={DEMO_BAD_COMMAND=migrate-db}" \
      --region "$REGION" >/dev/null
  else
    log "Creating Lambda: $function_name"
    aws lambda create-function \
      --function-name "$function_name" \
      --runtime python3.11 \
      --role "$role_arn" \
      --handler lambda_function.handler \
      --zip-file "fileb://$tmp_dir/function.zip" \
      --timeout 15 \
      --memory-size 128 \
      --environment "Variables={DEMO_BAD_COMMAND=migrate-db}" \
      --region "$REGION" >/dev/null
  fi

  local function_arn
  function_arn="$(aws lambda get-function --function-name "$function_name" --region "$REGION" --query 'Configuration.FunctionArn' --output text)"

  log "Creating/updating EventBridge schedule: $rule_name"
  aws events put-rule \
    --name "$rule_name" \
    --schedule-expression 'rate(1 minute)' \
    --state ENABLED \
    --region "$REGION" >/dev/null

  aws events put-targets \
    --rule "$rule_name" \
    --targets "[{\"Id\":\"1\",\"Arn\":\"${function_arn}\"}]" \
    --region "$REGION" >/dev/null

  if ! aws lambda add-permission \
    --function-name "$function_name" \
    --statement-id "${rule_name}-invoke" \
    --action lambda:InvokeFunction \
    --principal events.amazonaws.com \
    --source-arn "arn:aws:events:${REGION}:$(aws sts get-caller-identity --query Account --output text):rule/${rule_name}" \
    --region "$REGION" >/dev/null 2>&1; then
    warn 'Lambda invoke permission already exists; continuing'
  fi

  local topic_arn
  topic_arn="$(aws sns create-topic --name "$topic_name" --region "$REGION" --query 'TopicArn' --output text)"

  log "Creating/updating CloudWatch alarm: $alarm_name"
  aws cloudwatch put-metric-alarm \
    --alarm-name "$alarm_name" \
    --alarm-description 'Runbook YC demo alarm: failing command not found in Lambda worker' \
    --namespace AWS/Lambda \
    --metric-name Errors \
    --dimensions "Name=FunctionName,Value=${function_name}" \
    --statistic Sum \
    --period 60 \
    --evaluation-periods 1 \
    --datapoints-to-alarm 1 \
    --threshold 1 \
    --comparison-operator GreaterThanOrEqualToThreshold \
    --treat-missing-data notBreaching \
    --alarm-actions "$topic_arn" \
    --region "$REGION"

  log 'Invoking Lambda once to seed failure logs/metrics'
  aws lambda invoke \
    --function-name "$function_name" \
    --region "$REGION" \
    "$tmp_dir/invoke-output.json" >/dev/null || true

  if [[ "$FORCE_ALARM" -eq 1 ]]; then
    log 'Forcing alarm state to ALARM for deterministic demo timing'
    aws cloudwatch set-alarm-state \
      --alarm-name "$alarm_name" \
      --state-value ALARM \
      --state-reason "Runbook YC demo forced ALARM at $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      --region "$REGION"
  fi

  mkdir -p "$ROOT_DIR/.runbook/demo"
  cat > "$ROOT_DIR/.runbook/demo/yc-demo.env" <<ENV
AWS_REGION=${REGION}
RUNBOOK_DEMO_PREFIX=${PREFIX}
RUNBOOK_DEMO_FUNCTION=${function_name}
RUNBOOK_DEMO_RULE=${rule_name}
RUNBOOK_DEMO_ALARM=${alarm_name}
RUNBOOK_DEMO_TOPIC=${topic_arn}
RUNBOOK_DEMO_LOG_GROUP=${log_group_name}
ENV

  log "AWS demo resources ready. Wrote .runbook/demo/yc-demo.env"
}

create_pagerduty_incident() {
  require_cmd curl
  require_cmd node

  local routing_key="${PAGERDUTY_EVENTS_ROUTING_KEY:-}"
  local api_key="${PAGERDUTY_API_KEY:-}"
  local service_id="${PAGERDUTY_SERVICE_ID:-}"
  local from_email="${PAGERDUTY_FROM_EMAIL:-}"

  local function_name="${PREFIX}-failing-worker"
  local alarm_name="${PREFIX}-lambda-errors"
  local incident_title="[Runbook Demo] checkout-api command not found causing failures"

  mkdir -p "$ROOT_DIR/.runbook/demo"

  if [[ -n "$routing_key" ]]; then
    log 'Triggering PagerDuty alert via Events API'
    local events_payload
    events_payload="$(cat <<JSON
{
  "payload": {
    "summary": "${incident_title}",
    "severity": "critical",
    "source": "CloudWatch alarm ${alarm_name} / Lambda ${function_name}"
  },
  "routing_key": "${routing_key}",
  "event_action": "trigger"
}
JSON
)"

    local event_response
    event_response="$(curl -sS -X POST "https://events.pagerduty.com/v2/enqueue" \
      -H 'Content-Type: application/json' \
      -d "$events_payload")"

    local dedup_key
    dedup_key="$(printf '%s' "$event_response" | node -e 'let data="";process.stdin.on("data",(c)=>data+=c);process.stdin.on("end",()=>{try{const json=JSON.parse(data);if(json.dedup_key){process.stdout.write(String(json.dedup_key));}}catch(e){}});')"

    if [[ -n "$dedup_key" ]]; then
      echo "PAGERDUTY_DEMO_EVENT_DEDUP_KEY=${dedup_key}" >> "$ROOT_DIR/.runbook/demo/yc-demo.env"
    fi

    if [[ -n "$api_key" ]]; then
      log 'Looking up latest triggered PagerDuty incident ID'
      local incidents_response
      incidents_response="$(curl -sS -G "https://api.pagerduty.com/incidents" \
        -H "Authorization: Token token=${api_key}" \
        -H 'Accept: application/vnd.pagerduty+json;version=2' \
        --data-urlencode 'statuses[]=triggered' \
        --data-urlencode 'statuses[]=acknowledged' \
        --data-urlencode 'limit=25')"

      local pd_incident_id
      pd_incident_id="$(printf '%s' "$incidents_response" | node -e 'let data="";process.stdin.on("data",(c)=>data+=c);process.stdin.on("end",()=>{try{const json=JSON.parse(data);const incidents=Array.isArray(json.incidents)?json.incidents:[];const match=incidents.find((i)=>typeof i.title==="string"&&i.title.includes("[Runbook Demo]"))||incidents[0];if(match&&match.id)process.stdout.write(String(match.id));}catch(e){}});')"

      local pd_incident_number
      pd_incident_number="$(printf '%s' "$incidents_response" | node -e 'let data="";process.stdin.on("data",(c)=>data+=c);process.stdin.on("end",()=>{try{const json=JSON.parse(data);const incidents=Array.isArray(json.incidents)?json.incidents:[];const match=incidents.find((i)=>typeof i.title==="string"&&i.title.includes("[Runbook Demo]"))||incidents[0];if(match&&match.incident_number)process.stdout.write(String(match.incident_number));}catch(e){}});')"

      if [[ -n "$pd_incident_id" ]]; then
        {
          echo "PAGERDUTY_DEMO_INCIDENT_ID=${pd_incident_id}"
          echo "PAGERDUTY_DEMO_INCIDENT_NUMBER=${pd_incident_number}"
        } >> "$ROOT_DIR/.runbook/demo/yc-demo.env"
        log "PagerDuty incident resolved: ${pd_incident_id} (number: ${pd_incident_number})"
      else
        warn 'Could not resolve incident ID from PagerDuty API response. You can still use the triggered alert in PagerDuty UI.'
      fi
    else
      warn 'PAGERDUTY_API_KEY not set, so incident ID auto-discovery is skipped.'
      warn 'Set PAGERDUTY_API_KEY and rerun --create-pd-incident to auto-store incident ID in .runbook/demo/yc-demo.env.'
    fi

    return
  fi

  if [[ -z "$api_key" || -z "$service_id" || -z "$from_email" ]]; then
    echo 'Missing PagerDuty env vars. Provide PAGERDUTY_EVENTS_ROUTING_KEY, or set PAGERDUTY_API_KEY + PAGERDUTY_SERVICE_ID + PAGERDUTY_FROM_EMAIL.' >&2
    exit 1
  fi

  local pd_payload
  pd_payload="$(cat <<JSON
{
  "incident": {
    "type": "incident",
    "title": "${incident_title}",
    "service": {
      "id": "${service_id}",
      "type": "service_reference"
    },
    "urgency": "high",
    "body": {
      "type": "incident_body",
      "details": "CloudWatch alarm ${alarm_name} is ALARM. Lambda ${function_name} is failing with command-not-found (exit code 127)."
    }
  }
}
JSON
)"

  log 'Creating PagerDuty incident'
  local response
  response="$(curl -sS -X POST "https://api.pagerduty.com/incidents" \
    -H "Authorization: Token token=${api_key}" \
    -H 'Accept: application/vnd.pagerduty+json;version=2' \
    -H 'Content-Type: application/json' \
    -H "From: ${from_email}" \
    -d "$pd_payload")"

  local pd_incident_id
  pd_incident_id="$(printf '%s' "$response" | node -e 'let data="";process.stdin.on("data",(c)=>data+=c);process.stdin.on("end",()=>{try{const json=JSON.parse(data);if(!json.incident||!json.incident.id){process.stderr.write(data);process.exit(2);}process.stdout.write(json.incident.id);}catch(e){process.stderr.write(data);process.exit(2);}});')"

  local pd_incident_number
  pd_incident_number="$(printf '%s' "$response" | node -e 'let data="";process.stdin.on("data",(c)=>data+=c);process.stdin.on("end",()=>{const json=JSON.parse(data);process.stdout.write(String(json.incident && json.incident.incident_number ? json.incident.incident_number : ""));});')"

  {
    echo "PAGERDUTY_DEMO_INCIDENT_ID=${pd_incident_id}"
    echo "PAGERDUTY_DEMO_INCIDENT_NUMBER=${pd_incident_number}"
  } >> "$ROOT_DIR/.runbook/demo/yc-demo.env"

  log "PagerDuty incident created: ${pd_incident_id} (number: ${pd_incident_number})"
}

print_next_steps() {
  local demo_incident_id="DEMO-checkout-command-not-found"
  if [[ -f "$ROOT_DIR/.runbook/demo/yc-demo.env" ]]; then
    local pd_id
    pd_id="$(grep '^PAGERDUTY_DEMO_INCIDENT_ID=' "$ROOT_DIR/.runbook/demo/yc-demo.env" | tail -n 1 | cut -d '=' -f 2- || true)"
    if [[ -n "$pd_id" ]]; then
      demo_incident_id="$pd_id"
    fi
  fi

  cat <<STEPS

Demo assets are ready.

Chat demo commands:
  npm run dev -- knowledge search "checkout command not found exit code 127"
  npm run dev -- ask "What does the runbook say for checkout-api command not found incidents?"
  npm run dev -- chat

Suggested prompts inside chat:
  - "Summarize the runbook for checkout-api exit code 127 and give me a 5-minute triage plan."
  - "What rollback and validation steps should I run for a command-not-found deploy failure?"

Investigate demo command:
  npm run dev -- investigate ${demo_incident_id} --verbose

If you provisioned AWS demo infra, useful context to mention on-screen:
  - Alarm name: ${PREFIX}-lambda-errors
  - Function: ${PREFIX}-failing-worker

Cleanup command when done:
  scripts/demo/cleanup-yc-demo.sh --region ${REGION} --prefix ${PREFIX}
STEPS
}

main() {
  parse_args "$@"

  setup_demo_knowledge
  run_knowledge_sync

  if [[ "$WITH_AWS" -eq 1 ]]; then
    setup_aws_failure
    if [[ "$CREATE_PD_INCIDENT" -eq 1 ]]; then
      create_pagerduty_incident
    fi
  fi

  print_next_steps
}

main "$@"
