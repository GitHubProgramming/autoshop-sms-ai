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

## Mandatory Status Update Protocol

`project-brain/project_status.md` is the single source of truth for project progress.

**This is a non-negotiable execution requirement.** Every task — code, documentation, or workflow — must include a `project_status.md` update as a required deliverable. A task without a status update is incomplete.

### Required steps before finishing any task

1. Update `project-brain/project_status.md`
2. Reflect changes in all applicable sections:
   - **Project Completion Estimate** — if weighted progress changed
   - **Current Focus** — if the active priority shifted
   - **Stage Progress / Progress Model** — if any stage advanced or regressed
   - **Active Tasks** — move items between todo / in progress / done
   - **Blocked Items** — add new blockers with required action, owner, and affected stages
   - **Recent Changes** — add a dated entry for every meaningful change
   - **Next Owner Decision** — if owner input is now needed
3. In your final response, state exactly which sections of `project_status.md` were updated
4. Include `project-brain/project_status.md` in the recommended `git add` command
5. If no status update is needed, explicitly justify why — but the default assumption is that every meaningful task requires one

### Strict completion rule

A task is NOT done unless both are true:
- The implementation / documentation work is completed
- `project-brain/project_status.md` reflects reality

### Progress tracking must be conservative

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
