#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

REGION="${AWS_REGION:-us-east-1}"
PREFIX="${RUNBOOK_DEMO_PREFIX:-runbook-yc-demo}"

usage() {
  cat <<USAGE
Usage: scripts/demo/cleanup-yc-demo.sh [options]

Deletes AWS resources created by scripts/demo/setup-yc-demo.sh --with-aws.

Options:
  --region <region>   AWS region (default: AWS_REGION or us-east-1)
  --prefix <prefix>   Resource prefix (default: runbook-yc-demo)
  -h, --help          Show this help
USAGE
}

log() {
  printf '[demo-cleanup] %s\n' "$*"
}

warn() {
  printf '[demo-cleanup] WARN: %s\n' "$*" >&2
}

load_env_file() {
  local env_file="$ROOT_DIR/.runbook/demo/yc-demo.env"
  if [[ -f "$env_file" ]]; then
    # shellcheck disable=SC1090
    source "$env_file"
    REGION="${AWS_REGION:-$REGION}"
    PREFIX="${RUNBOOK_DEMO_PREFIX:-$PREFIX}"
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
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
}

resource_exists_lambda() {
  aws lambda get-function --function-name "$1" --region "$REGION" >/dev/null 2>&1
}

resource_exists_rule() {
  aws events describe-rule --name "$1" --region "$REGION" >/dev/null 2>&1
}

resource_exists_alarm() {
  local count
  count="$(aws cloudwatch describe-alarms --alarm-names "$1" --region "$REGION" --query 'length(MetricAlarms)' --output text 2>/dev/null || echo 0)"
  [[ "$count" != "0" && "$count" != "None" ]]
}

main() {
  load_env_file
  parse_args "$@"

  if ! command -v aws >/dev/null 2>&1; then
    echo 'aws CLI is required for cleanup' >&2
    exit 1
  fi

  aws sts get-caller-identity --output json >/dev/null

  local role_name="${PREFIX}-lambda-role"
  local function_name="${PREFIX}-failing-worker"
  local rule_name="${PREFIX}-every-minute"
  local alarm_name="${PREFIX}-lambda-errors"
  local topic_name="${PREFIX}-alerts"

  if resource_exists_rule "$rule_name"; then
    log "Removing EventBridge targets/rule: $rule_name"
    aws events remove-targets --rule "$rule_name" --ids '1' --force --region "$REGION" >/dev/null 2>&1 || true
    aws events delete-rule --name "$rule_name" --force --region "$REGION" >/dev/null 2>&1 || true
  else
    warn "Rule not found: $rule_name"
  fi

  if resource_exists_alarm "$alarm_name"; then
    log "Deleting CloudWatch alarm: $alarm_name"
    aws cloudwatch delete-alarms --alarm-names "$alarm_name" --region "$REGION"
  else
    warn "Alarm not found: $alarm_name"
  fi

  if resource_exists_lambda "$function_name"; then
    log "Deleting Lambda: $function_name"
    aws lambda delete-function --function-name "$function_name" --region "$REGION"
  else
    warn "Lambda not found: $function_name"
  fi

  log "Deleting SNS topic if present: $topic_name"
  while IFS= read -r topic_arn; do
    if [[ -n "$topic_arn" ]]; then
      aws sns delete-topic --topic-arn "$topic_arn" --region "$REGION" >/dev/null 2>&1 || true
    fi
  done < <(aws sns list-topics --region "$REGION" --query "Topics[?contains(TopicArn, ':${topic_name}')].TopicArn" --output text 2>/dev/null | tr '\t' '\n')

  if aws iam get-role --role-name "$role_name" >/dev/null 2>&1; then
    log "Detaching policy and deleting IAM role: $role_name"
    aws iam detach-role-policy \
      --role-name "$role_name" \
      --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole >/dev/null 2>&1 || true
    aws iam delete-role --role-name "$role_name" >/dev/null 2>&1 || true
  else
    warn "IAM role not found: $role_name"
  fi

  if [[ -f "$ROOT_DIR/.runbook/demo/yc-demo.env" ]]; then
    rm -f "$ROOT_DIR/.runbook/demo/yc-demo.env"
  fi

  log 'Cleanup complete'
}

main "$@"
