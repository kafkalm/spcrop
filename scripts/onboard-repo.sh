#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "" ]]; then
  echo "Usage: $0 <owner/repo> [task_db_id] [portfolio_db_id]"
  exit 1
fi

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_cmd gh
require_cmd node
require_cmd security

REPO="$1"
DEFAULT_TASK_DB_ID="31424215b1ed8133928ee6e272c4f8e6"
TASK_DB_ID="${2:-$DEFAULT_TASK_DB_ID}"
DEFAULT_PORTFOLIO_DB_ID="31424215b1ed81d08d66df4193c5838e"
PORTFOLIO_DB_ID="${3:-$DEFAULT_PORTFOLIO_DB_ID}"
TOKEN_KEYCHAIN_SERVICE="${TOKEN_KEYCHAIN_SERVICE:-codex/notion_token}"

NOTION_TOKEN="$(security find-generic-password -a "$USER" -s "$TOKEN_KEYCHAIN_SERVICE" -w 2>/dev/null || true)"
if [[ -z "$NOTION_TOKEN" ]]; then
  echo "Notion token not found in Keychain service: $TOKEN_KEYCHAIN_SERVICE" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_OUT="$(NOTION_TOKEN="$NOTION_TOKEN" NOTION_PORTFOLIO_DB_ID="$PORTFOLIO_DB_ID" TARGET_REPO="$REPO" node "$SCRIPT_DIR/ensure_portfolio_project.mjs")"
PORTFOLIO_PROJECT_MODE="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(j.portfolio_project_mode || "unknown");' "$PROJECT_OUT")"
PORTFOLIO_PROJECT_URL="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(j.portfolio_project_url || "");' "$PROJECT_OUT")"
PORTFOLIO_PROJECT_DEDUPED="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(String(j.portfolio_project_deduped || 0));' "$PROJECT_OUT")"

# Configure secrets for this repository.
gh secret set NOTION_TOKEN --repo "$REPO" --body "$NOTION_TOKEN"
gh secret set NOTION_PORTFOLIO_DB_ID --repo "$REPO" --body "$PORTFOLIO_DB_ID"
gh secret set NOTION_TASK_DB_ID --repo "$REPO" --body "$TASK_DB_ID"

# Initialize labels (ignore failure so onboarding can continue even if labels already exist).
if [[ -x "$SCRIPT_DIR/../.github/scripts/bootstrap_labels.sh" ]]; then
  "$SCRIPT_DIR/../.github/scripts/bootstrap_labels.sh" "$REPO" || true
fi

# Trigger first reconcile run if workflow exists.
if gh workflow view notion-reconcile.yml --repo "$REPO" >/dev/null 2>&1; then
  gh workflow run notion-reconcile.yml --repo "$REPO"
fi

echo "Onboarding completed for $REPO"
echo "NOTION_TASK_DB_ID=$TASK_DB_ID"
echo "Task DB (shared) ID: $TASK_DB_ID"
echo "Portfolio row: $PORTFOLIO_PROJECT_MODE"
if [[ -n "$PORTFOLIO_PROJECT_URL" ]]; then
  echo "Portfolio row URL: $PORTFOLIO_PROJECT_URL"
fi
if [[ "$PORTFOLIO_PROJECT_DEDUPED" != "0" ]]; then
  echo "Portfolio deduped: archived $PORTFOLIO_PROJECT_DEDUPED duplicate rows"
fi
