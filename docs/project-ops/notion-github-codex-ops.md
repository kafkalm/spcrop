# Notion + GitHub + Codex Ops Setup

## 1. Required GitHub Secrets

Set these repository secrets:

- `NOTION_TOKEN`
- `NOTION_TASK_DB_ID` (shared single Task Mirror DB across repositories)
- `NOTION_PORTFOLIO_DB_ID` (reserved for dashboard expansion)

### Fast Path (macOS)

Use the onboarding script to configure all three secrets automatically and upsert Portfolio row:

```bash
./scripts/onboard-repo.sh <owner/repo>
```

The script reads:

- `NOTION_TOKEN` from Keychain service `codex/notion_token`
- `NOTION_TASK_DB_ID` from built-in shared default value
  - default: `31424215b1ed8133928ee6e272c4f8e6`
  - optional override: script argument #2
- `NOTION_PORTFOLIO_DB_ID` from the built-in default value
  - default: `31424215b1ed81d08d66df4193c5838e`
  - optional override: script argument #3

During onboarding, the script also upserts one Portfolio row by `Project Key`:

- if row exists: update `Last Synced At`, `Repository URL`, keep project active
- if row missing: create a new row for the repo

## 2. Required Notion Database Properties

Task mirror database should contain:

- `Title` (title)
- `GitHub Item Key` (rich text, unique)
- `GitHub Issue ID` (number)
- `GitHub PR ID` (number)
- `Repo` (select)
- `Status` (select: Planned, Doing, Reviewing, Blocked, Done)
- `Priority` (select: P0, P1, P2, P3)
- `Estimate` (select: XS, S, M, L, XL)
- `Blocked` (checkbox)
- `GitHub URL` (url)
- `PR URL` (url)
- `Work Type` (select: feature, bug, chore, research)
- `Last Synced At` (date)
- `Project` (relation -> Portfolio DB)

## 3. Bootstrap Labels

Run in repo root:

```bash
.github/scripts/bootstrap_labels.sh
```

This initializes `type:*`, `prio:*`, and `status:*` labels.

## 4. Issue Claim Protocol (Multi-Thread Safe)

Use Draft-PR lock workflow to prevent two Codex threads from fixing the same issue.

- Create issue with `status:backlog`.
- Before coding, claim issue:

```bash
.github/scripts/claim_issue.sh <issue_number>
```

- Claim action:
- creates or reuses open PR on current branch
- ensures PR body references issue (`Refs #<issue>`)
- prefers Draft PR for in-progress work
- `status:in-progress`
- assignee to current `gh` user
- If another branch already has an open PR linked to same issue, claim fails and thread must skip.

## 5. Workflow Behavior

- `.github/workflows/notion-sync.yml`
  - Event-driven sync on issue/pr/review updates.
- `.github/workflows/notion-reconcile.yml`
  - Daily reconciliation (01:17 UTC) for last 30 days.

## 6. Codex Execution Contract

- Start work from a GitHub issue.
- Claim issue before implementation.
- Use branch naming: `<type>/<issue-number>-<slug>`.
- PR must link issue and include validation evidence.
