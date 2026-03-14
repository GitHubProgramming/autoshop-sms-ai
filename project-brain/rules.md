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

## Mandatory Dual Status Update Protocol

`project-brain/project_status.json` is the **single source of truth** for project state. `project-brain/project_status.md` is a **human-readable mirror** derived from the JSON.

- `project_status.json` — canonical source (used for dashboards, task generation, and automation)
- `project_status.md` — human-readable mirror (for Owner review and PR descriptions)

**This is a non-negotiable execution requirement.** Every task — code, documentation, or workflow — must include updates to **both** status files as a required deliverable. A task without synchronized status updates is incomplete.

### Required steps before finishing any task

1. Update **both** `project-brain/project_status.md` **and** `project-brain/project_status.json`
2. Reflect changes in all applicable sections:
   - **Project Completion Estimate** — if weighted progress changed
   - **Current Focus** — if the active priority shifted
   - **Stage Progress / Progress Model** — if any stage advanced or regressed
   - **Active Tasks** — move items between todo / in progress / done
   - **Blocked Items** — add new blockers with required action, owner, and affected stages
   - **Recent Changes** — add a dated entry for every meaningful change
   - **Next Owner Decision** — if owner input is now needed
3. Ensure both files reflect the same state — neither may drift from the other
4. In your final response, state exactly which sections of both status files were updated
5. Include both `project-brain/project_status.md` and `project-brain/project_status.json` in the recommended `git add` command
6. If no status update is needed, explicitly justify why — but the default assumption is that every meaningful task requires one

### Strict completion rule

A task is NOT done unless all three are true:
- The implementation / documentation work is completed
- `project-brain/project_status.json` reflects reality (canonical source)
- `project-brain/project_status.md` mirrors the JSON accurately

### Progress tracking must be conservative

- Stage percentages only advance when completion criteria objectively move
- Blocked stages stay frozen at last verified progress
- Code-complete but unverified stages are capped at 40–50%
- When uncertain, round down

### Milestone calculation rule

`overall_progress` in `project_status.json` is a **stored value** that must be recalculated on every stage progress change using this exact formula:

```
overall_progress = floor( sum( stage.weight × stage.progress / 100 ) )
```

- Weights are integers that sum to 100
- Progress is an integer 0–100
- The result is floored (rounded down), never rounded up
- The `~XX%` in `project_status.md` must match the stored JSON value
- If any stage progress changes, `overall_progress` **must** be recalculated before commit

## Escalation

AI agents must ask for human clarification when:

1. Secrets or credentials are required
2. A destructive database operation is needed
3. Multiple architecture paths exist with significant business impact
4. Any change would affect production environments
