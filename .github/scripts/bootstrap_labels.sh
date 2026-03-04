#!/usr/bin/env bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required" >&2
  exit 1
fi

REPO="${1:-}"
if [[ -z "$REPO" ]]; then
  REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
fi

create_or_update() {
  local name="$1" color="$2" desc="$3"
  gh label create "$name" --repo "$REPO" --color "$color" --description "$desc" --force >/dev/null
  echo "label ensured: $name"
}

create_or_update "type:feature" "1f6feb" "New functionality"
create_or_update "type:bug" "d73a4a" "Bug fix"
create_or_update "type:chore" "6e7781" "Maintenance"
create_or_update "type:research" "8b5cf6" "Research or spike"

create_or_update "prio:p0" "b60205" "Critical"
create_or_update "prio:p1" "d93f0b" "High"
create_or_update "prio:p2" "fbca04" "Normal"
create_or_update "prio:p3" "0e8a16" "Low"

create_or_update "blocked" "b60205" "Blocked by dependency"
