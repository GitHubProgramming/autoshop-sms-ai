# AI Contributor Rules

Hard guardrails for all AI agents (Claude Code or other automated contributors).

## Forbidden Operations

- **DO NOT** modify production workflows in `n8n/workflows/US_AutoShop/` or `n8n/workflows/LT_Proteros/`
- **DO NOT** edit, create, or delete credentials or secrets (`.env`, API keys, tokens)
- **DO NOT** modify deploy scripts (`scripts/n8n-deploy.sh`) or CI pipelines (`.github/workflows/`)
- **DO NOT** run destructive database operations without explicit human approval
- **DO NOT** push directly to `main`
- **DO NOT** force-push to any branch
- **DO NOT** bypass pre-commit hooks or verification scripts
- **DO NOT** invent or fabricate API keys, tokens, or secrets

## Allowed Operations

- Create new workflows in `n8n/workflows/TEST/`
- Add or update documentation files
- Create new files in safe areas (`project-brain/`, `docs/`)
- Modify `apps/api/` code on feature branches with verification
- Add or update tests
- Update `AI_STATUS.md`, `AI_TASKS.md`, `AI_WORK.md`

## Branch Policy

- **No direct commits to `main`** — all changes via feature branches
- Branch naming: `ai/<task-name>` for AI-initiated work
- All changes must go through pull requests
- Run `bash scripts/ai-verify.sh` before every commit

## Verification Requirements

Before committing any code change:

1. Run `bash scripts/ai-verify.sh`
2. Fix any failures before proceeding
3. Include verification results in commit context

## Scope Control

- Work only on the task at hand — do not refactor unrelated code
- Prefer minimal patches over broad changes
- Do not expand scope unless required by the core flow
- Preserve existing working systems

## Mandatory Status Updates

`project-brain/project_status.md` is the single source of truth for project progress.

**After every meaningful task completion, AI contributors MUST:**

1. Update `project_status.md` before opening or updating a PR
2. If a task is completed — move it from Active Tasks to done and update Stage Progress
3. If a task is blocked — add the blocker to Blocked Items with required action and owner
4. If focus changes — update Current Focus to reflect the new priority
5. If any code or workflow was changed — add an entry to Recent Changes with date and short summary
6. Every PR description must note what status changes were made

**Failure to update `project_status.md` means the task is not considered done.**

**Progress tracking must be conservative:**
- Stage percentages only advance when completion criteria objectively move
- Blocked stages stay frozen at last verified progress
- Code-complete but unverified stages are capped at 40–50%
- When uncertain, round down

## Escalation

AI agents must ask for human clarification when:

1. Secrets or credentials are required
2. A destructive database operation is needed
3. Multiple architecture paths exist with significant business impact
4. Any change would affect production environments
