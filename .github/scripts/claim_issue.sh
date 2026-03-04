#!/usr/bin/env bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required" >&2
  exit 1
fi

ISSUE_NUMBER="${1:-}"
REPO="${2:-}"
ASSIGNEE="${3:-}"

if [[ -z "$ISSUE_NUMBER" ]]; then
  echo "Usage: $0 <issue_number> [owner/repo] [assignee]" >&2
  exit 1
fi

if [[ -z "$REPO" ]]; then
  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
fi

if [[ -z "$ASSIGNEE" ]]; then
  ASSIGNEE="$(gh api user -q .login)"
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
DEFAULT_BRANCH="$(gh api "repos/$REPO" -q .default_branch)"

if [[ "$CURRENT_BRANCH" == "$DEFAULT_BRANCH" ]]; then
  echo "Current branch is default branch '$DEFAULT_BRANCH'. Create a feature branch first." >&2
  exit 1
fi

ISSUE_JSON="$(gh issue view "$ISSUE_NUMBER" --repo "$REPO" --json state,labels,url,title)"
OPEN_STATE="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(String(j.state || ""));' "$ISSUE_JSON")"
if [[ "$OPEN_STATE" != "OPEN" ]]; then
  echo "Issue #$ISSUE_NUMBER is not OPEN; cannot claim." >&2
  exit 1
fi

PRS_JSON="$(gh pr list --repo "$REPO" --state open --limit 200 --json number,title,url,headRefName,body,isDraft)"
CONFLICT_PR_JSON="$(node -e '
const prs = JSON.parse(process.argv[1]);
const issueNumber = process.argv[2];
const currentBranch = process.argv[3];
const ownerRepo = process.argv[4];
const escaped = issueNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const refs = new RegExp(`\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\\s+(?:[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+)?#${escaped}\\b`, "i");
const issueUrl = new RegExp(`https:\\/\\/github\\.com\\/${ownerRepo.replace("/", "\\/")}\\/issues\\/${escaped}\\b`, "i");
const linked = prs.filter((pr) => refs.test(String(pr.body || "")) || issueUrl.test(String(pr.body || "")));
const conflict = linked.find((pr) => pr.headRefName !== currentBranch);
process.stdout.write(conflict ? JSON.stringify(conflict) : "");
' "$PRS_JSON" "$ISSUE_NUMBER" "$CURRENT_BRANCH" "$REPO")"

if [[ -n "$CONFLICT_PR_JSON" ]]; then
  CONFLICT_URL="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(String(j.url || ""));' "$CONFLICT_PR_JSON")"
  CONFLICT_BRANCH="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(String(j.headRefName || ""));' "$CONFLICT_PR_JSON")"
  echo "Issue #$ISSUE_NUMBER is already locked by open PR on branch '$CONFLICT_BRANCH': $CONFLICT_URL" >&2
  exit 2
fi

# Ensure branch is pushed before creating/updating PR.
if ! git ls-remote --exit-code --heads origin "$CURRENT_BRANCH" >/dev/null 2>&1; then
  if [[ "$(git rev-list --count "origin/$DEFAULT_BRANCH..HEAD" 2>/dev/null || echo 0)" == "0" ]]; then
    if ! git diff --cached --quiet; then
      echo "Current branch has staged changes and no commits ahead; commit manually before claim." >&2
      exit 1
    fi
    git commit --allow-empty -m "chore: claim issue #$ISSUE_NUMBER" >/dev/null
  fi
  git push -u origin "$CURRENT_BRANCH" >/dev/null
fi

PR_BODY_FILE="$(mktemp -t claim-pr-body.XXXXXX.md)"
cat > "$PR_BODY_FILE" <<EOF
## Claim
- lock issue for this branch while implementation is in progress

Refs #$ISSUE_NUMBER
EOF

CURRENT_PR_JSON="$(gh pr view "$CURRENT_BRANCH" --repo "$REPO" --json number,url,isDraft,body 2>/dev/null || true)"

if [[ -n "$CURRENT_PR_JSON" ]]; then
  PR_NUMBER="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(String(j.number || ""));' "$CURRENT_PR_JSON")"
  UPDATED_BODY="$(node -e '
const pr = JSON.parse(process.argv[1]);
const issue = process.argv[2];
const body = String(pr.body || "");
const refs = new RegExp(`\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\\s+(?:[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+)?#${issue}\\b`, "i");
if (refs.test(body)) {
  process.stdout.write(body);
} else {
  process.stdout.write(`${body.replace(/\s*$/, "")}\n\nRefs #${issue}\n`);
}
' "$CURRENT_PR_JSON" "$ISSUE_NUMBER")"
  UPDATED_BODY_FILE="$(mktemp -t claim-pr-edit-body.XXXXXX.md)"
  printf "%s" "$UPDATED_BODY" > "$UPDATED_BODY_FILE"
  gh pr edit "$PR_NUMBER" --repo "$REPO" --add-assignee "$ASSIGNEE" --body-file "$UPDATED_BODY_FILE" >/dev/null
  rm -f "$UPDATED_BODY_FILE"
  PR_URL="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(String(j.url || ""));' "$CURRENT_PR_JSON")"
else
  ISSUE_TITLE="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(String(j.title || ""));' "$ISSUE_JSON")"
  PR_URL="$(gh pr create \
    --repo "$REPO" \
    --base "$DEFAULT_BRANCH" \
    --head "$CURRENT_BRANCH" \
    --draft \
    --title "wip: ${ISSUE_TITLE}" \
    --body-file "$PR_BODY_FILE" \
    --assignee "$ASSIGNEE")"
fi

rm -f "$PR_BODY_FILE"

# Normalize status before setting in-progress.
for status_label in status:backlog status:ready status:review status:blocked status:done; do
  gh issue edit "$ISSUE_NUMBER" --repo "$REPO" --remove-label "$status_label" >/dev/null 2>&1 || true
done
gh issue edit "$ISSUE_NUMBER" --repo "$REPO" --add-assignee "$ASSIGNEE" --add-label "status:in-progress" >/dev/null

ISSUE_URL="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(String(j.url || ""));' "$ISSUE_JSON")"
echo "Locked issue #$ISSUE_NUMBER with PR: $PR_URL"
echo "$ISSUE_URL"
