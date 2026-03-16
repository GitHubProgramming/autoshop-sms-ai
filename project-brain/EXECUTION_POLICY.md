# Execution Policy

How the AI agent must operate inside this repository.

---

## Before Any Task

1. Read all files in `/project-brain/` — these are higher priority than repo exploration
2. Read `AI_WORK.md` and `AI_STATUS.md`
3. Treat lock files as constraints — only search the repo if information is missing
4. Never redesign architecture unless explicitly instructed
5. Prefer minimal modifications over large changes
6. If repo content conflicts with lock files, report the conflict — do not resolve silently

## Execution Rules

- **Avoid full repository scans** — use targeted file reads
- **Modify the smallest possible code surface** — smallest safe patch only
- **Do not create new systems** if an existing one can be extended
- **Do not refactor unrelated systems** while fixing a bug or adding a feature
- **Do not invent progress** — only report verified facts
- **Do not claim live-tested** without real service verification

## File Read Priority

When starting a task, read in this order:

1. `project-brain/PROJECT_TRUTH.md` — immutable facts
2. `project-brain/ARCHITECTURE_LOCK.md` — what must not change
3. `project-brain/EXECUTION_POLICY.md` — how to operate
4. `project-brain/SYSTEM_MAP.md` — system architecture
5. `project-brain/PAGE_MAP.md` — dashboard UI map
6. `project-brain/FILE_INDEX.md` — repository navigation index
7. `project-brain/project_status_v2.json` — current project state
8. `AI_WORK.md` / `AI_STATUS.md` — current tasks

## Branch & Commit Rules

- Always work on branch `ai/<task-name>`
- Smallest safe patch only
- Never modify production workflows
- Never invent credentials or secrets
- Clean repo required before starting work and before creating PRs

## Verification Rules

- Accuracy > optimism
- Verification > speed
- Facts > assumptions
- Never claim success without machine-verifiable proof
- If output is truncated or timed out, re-run before reporting
