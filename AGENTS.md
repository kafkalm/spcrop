# Codex Execution Rules

These rules are mandatory for Codex agents working in this repository.

## 1) Issue-First Execution

Before any code implementation, Codex must ensure there is a linked GitHub Issue.

- If user already provided an issue reference (`#123` or issue URL), use it.
- If no issue reference exists and the task requires code changes, Codex must create one automatically.
- No implementation work before issue exists.

## 2) Lock-First With Draft PR (Mandatory)

Before starting implementation, Codex must lock the issue using a PR, not owner labels.

- Lock means all are true:
- Current working branch is `<type>/<issue-number>-<slug>`.
- There is an open PR from current branch that references the issue (`Refs #...` or equivalent).
- Prefer Draft PR while implementation is ongoing.
- Issue has `status:in-progress`.

If another open PR already references the same issue from a different branch:

- Codex must not implement that issue in this thread.
- Stop and report lock conflict.

## 3) When to Auto-Create an Issue

Codex must auto-create an issue when all are true:
- The user asks for feature/bug/refactor/behavior change.
- The task is expected to modify repository-tracked files.
- There is no existing issue reference in the user request.

Codex should NOT auto-create issue for:

- Pure Q&A, planning-only discussion, or non-mutating exploration.
- Minor one-off local-only tasks explicitly requested without repo tracking.

## 4) Issue Selection Guard (Avoid Cross-Thread Collision)

Codex must never pick work from a generic open-issue list without lock filtering.

- If user explicitly specifies issue `#N`, use that issue and claim it.
- If Codex selects from backlog, only select issues that do not already have an open linked PR.
- Codex must skip issues already locked by another branch/PR.

## 5) Plan-to-Issue Mapping

When implementing from `plan.md` / implementation plans:

- Create 1 Epic issue for the whole plan.
- Create child execution issues for each independently mergeable task.
- Keep PR granularity as `1 PR -> 1 execution issue`.
- Link PR body with `Resolves #<issue_number>`.

## 6) Required Metadata for Auto-Created Issues

Codex should include:

- Title: concise action-oriented title.
- Body: context, acceptance criteria, and validation plan.
- Labels: one `type:*` and one `prio:*` at minimum.
- Status label: `status:backlog` by default on creation.

Default labels when uncertain:

- `type:chore`
- `prio:p2`

## 7) Branch + PR Contract

After issue creation (or discovery), Codex should:

- Before creating a worktree from `main`, ensure local `main` is up to date with remote (`git switch main && git fetch origin && git pull --ff-only`).
- Always implement new requirements in a dedicated git worktree (do not develop directly in the main workspace).
- Do not create nested worktrees from inside an existing worktree; create new worktrees from the primary repository root.
- Create/use branch: `<type>/<issue-number>-<slug>`.
- Run `.github/scripts/claim_issue.sh <issue_number>` to lock early.
- Ensure PR includes one of: `Resolves #...`, `Closes #...`, `Fixes #...`.
- Keep PR focused to a single issue.
- Keep `1 issue -> 1 open PR`.
- After PR is merged, archive and remove the related worktree immediately.

## 8) Auto-Create PR After Push

When code changes are complete and commits are pushed to a non-default branch, Codex must auto-create a PR.

- Do not wait for user to explicitly ask "create PR".
- If user asks to push, interpret this as `push + open PR`.
- Use repository default branch as base branch.
- Ensure PR body links issue (`Resolves #<issue_number>`).
- Keep idempotent behavior:
- If PR for current branch already exists (including Draft), update it instead of creating duplicate PR.
- If no PR exists, create one immediately after successful push.
- Draft policy:
- `claim_issue.sh` may create Draft PR for early lock.
- When implementation is complete and ready for review, Codex must convert Draft PR to Ready (`gh pr ready`).
- Codex must not leave PR in Draft when reporting task handoff complete.

## 9) Failure Handling

If Codex cannot create issue automatically (auth/permission/API/network):

- Stop before implementation.
- Report exact blocker.
- Ask user for minimal unblock action.

If Codex cannot lock issue via Draft PR (auth/permission/API/network/branch mismatch/conflict):

- Stop before implementation.
- Report exact blocker.
- Ask user for minimal unblock action.

If Codex cannot create or update PR automatically (auth/permission/API/network):

- Stop before claiming task handoff is complete.
- Report exact blocker.
- Ask user for minimal unblock action.

## 10) Commit Message Language

- All `git commit` messages must be written in English.
- This applies to both commit title and commit body.
- Do not use Chinese (or mixed-language) commit messages.

## 11) Commands (Reference)

Worktree lifecycle (required):

```bash
# ensure local main is latest before creating worktree
git switch main
git fetch origin
git pull --ff-only

# create isolated worktree for a new requirement
BRANCH="<type>/<issue-number>-<slug>"
WORKTREE_DIR="../wt-<issue-number>-<slug>"

# run from primary repo root; do not run from an existing worktree
git fetch origin
git worktree add -b "$BRANCH" "$WORKTREE_DIR" origin/main

# after PR merged, archive and remove worktree
git worktree remove "$WORKTREE_DIR"
git branch -d "$BRANCH" || true
```

Create issue:

```bash
ISSUE_BODY_FILE="$(mktemp -t codex-issue-body.XXXXXX.md)"

cat > "$ISSUE_BODY_FILE" <<'MD'
## Context
- <background>

## Acceptance Criteria
- <criterion 1>
- <criterion 2>

## Validation
- <validation command or check>
MD

gh issue create \
  --title "[TASK] <title>" \
  --body-file "$ISSUE_BODY_FILE" \
  --label "type:chore" \
  --label "prio:p2" \
  --label "status:backlog"

rm -f "$ISSUE_BODY_FILE"
```

Lock issue with Draft PR (recommended helper):

```bash
.github/scripts/claim_issue.sh <issue_number>
```

Create PR (idempotent pattern):

```bash
BASE_BRANCH="$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)"
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
PR_BODY_FILE="$(mktemp -t codex-pr-body.XXXXXX.md)"

cat > "$PR_BODY_FILE" <<'MD'
## Summary
- <change 1>
- <change 2>

## Validation
- <command and key output>

Resolves #<issue_number>
MD

if gh pr view "$CURRENT_BRANCH" --json number,isDraft >/dev/null 2>&1; then
  gh pr edit "$CURRENT_BRANCH" --title "<title>" --body-file "$PR_BODY_FILE"
else
  gh pr create \
    --base "$BASE_BRANCH" \
    --head "$CURRENT_BRANCH" \
    --title "<title>" \
    --body-file "$PR_BODY_FILE"
fi

# If the branch PR is still draft and work is complete, mark it ready.
if [[ "$(gh pr view "$CURRENT_BRANCH" --json isDraft -q .isDraft)" == "true" ]]; then
  gh pr ready "$CURRENT_BRANCH"
fi

rm -f "$PR_BODY_FILE"
```
