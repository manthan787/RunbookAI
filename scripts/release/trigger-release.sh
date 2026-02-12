#!/usr/bin/env bash

set -euo pipefail

SKIP_CHECKS=0
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: npm run release -- [--skip-checks] [--dry-run]

Options:
  --skip-checks  Skip local typecheck/lint/test/build before triggering release.
  --dry-run      Validate release preconditions without triggering workflow.
  -h, --help     Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-checks)
      SKIP_CHECKS=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1"
    exit 1
  fi
}

require_command git
require_command npm
require_command gh

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "Release must be triggered from main. Current branch: $CURRENT_BRANCH"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree must be clean before release."
  echo "Commit, stash, or discard local changes and try again."
  exit 1
fi

if ! gh auth status -h github.com >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated. Run: gh auth login"
  exit 1
fi

echo "Fetching latest main from origin..."
git fetch origin main

LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse origin/main)"
if [[ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]]; then
  echo "Local main is not in sync with origin/main."
  echo "Local:  $LOCAL_HEAD"
  echo "Remote: $REMOTE_HEAD"
  echo "Run: git pull --ff-only (or push your local main) and retry."
  exit 1
fi

if [[ "$SKIP_CHECKS" -eq 0 ]]; then
  echo "Running release checks..."
  npm run typecheck
  npm run lint
  npm run test
  npm run build
else
  echo "Skipping release checks (--skip-checks)."
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Dry run successful. Preconditions passed."
  exit 0
fi

echo "Triggering Release Please workflow..."
gh workflow run release-please.yml --ref main

echo "Release workflow triggered."
echo "Check status with:"
echo "  gh run list --workflow release-please.yml --limit 5"
