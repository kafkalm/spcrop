# Repo Template: Codex + GitHub + Notion Ops

This template bootstraps a new repository with:

- Standard issue and PR templates
- GitHub Actions for Notion sync and daily reconcile
- Reusable Notion sync scripts and tests
- Setup guide under `docs/project-ops/`

## After Creating a Repo from This Template

1. Store Keychain entries once on macOS:
   - `security add-generic-password -a "$USER" -s "codex/notion_token" -w "<NOTION_TOKEN>" -U`
2. Run onboarding script (auto-creates Task Mirror DB, sets secrets, bootstraps labels, triggers reconcile):
   - `./scripts/onboard-repo.sh <owner/repo>`
   - optional override: `./scripts/onboard-repo.sh <owner/repo> <task_db_id> <portfolio_db_id>`
   - script uses shared Task DB by default and upserts one row in Portfolio DB (`Project Key = owner/repo`)

## Notes

- GitHub template repositories copy files only.
- Secrets, labels, environments, branch rules, and Actions history are not copied.
