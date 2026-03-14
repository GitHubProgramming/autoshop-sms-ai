# B-Lite Operating Model

Lightweight AI-assisted development workflow for the AutoShop SMS AI project.

## Roles

| Role | Actor | Responsibility |
|------|-------|---------------|
| **Owner** | Human (project lead) | Sets priorities, reviews PRs, provides credentials, makes architecture decisions |
| **Planner** | ChatGPT / planning agent | Creates execution briefs, breaks down tasks, evaluates trade-offs |
| **Builder** | Claude Code / execution agent | Implements on branches, runs verification, updates status, opens PRs |
| **CI** | GitHub Actions | Runs automated checks, deploys workflows to n8n on merge to `main` |

## Workflow

```
1. Owner sets priority
       ↓
2. Planner creates execution brief
       ↓
3. Builder creates branch (ai/<task-name>)
       ↓
4. Builder implements smallest safe patch
       ↓
5. Builder runs verification (scripts/ai-verify.sh)
       ↓
6. Builder updates project-brain/project_status.md AND project_status.json
       ↓
7. Builder opens PR
       ↓
8. CI runs checks
       ↓
9. Owner reviews and merges
       ↓
10. CI deploys to n8n (if workflows changed)
```

## Safety Gates

Each gate must pass before proceeding to the next step.

| Gate | Check | Enforced By |
|------|-------|-------------|
| **Branch isolation** | Work is on `ai/<task-name>`, never on `main` | Builder + Git policy |
| **Scope check** | Only files relevant to the task are modified | Builder self-check |
| **Production protection** | No changes to US_AutoShop, LT_Proteros, deploy scripts, CI | Builder + code review |
| **Verification** | `bash scripts/ai-verify.sh` passes | Builder |
| **Status update** | Both `project_status.md` and `project_status.json` reflect the change consistently | Builder + PR review |
| **Code review** | PR approved by Owner before merge | GitHub branch protection |
| **CI green** | GitHub Actions checks pass | GitHub Actions |

## Mandatory Dual Status Update Protocol

Both status files are **required deliverables** for every task. This is non-negotiable.

- `project-brain/project_status.json` — **single source of truth** (for dashboards, task generation, and automation)
- `project-brain/project_status.md` — **human-readable mirror** (for Owner review and PR descriptions)

Update order: **JSON first, then MD to match.** On conflict, JSON wins.

### What the Builder must do before finishing any task

1. Open **both** `project-brain/project_status.md` **and** `project-brain/project_status.json`
2. Update all applicable sections in both files:
   - **Project Completion Estimate** — recalculate if weighted progress changed
   - **Current Focus** — update if active priority shifted
   - **Stage Progress / Progress Model** — update if any stage advanced or regressed
   - **Active Tasks** — move items between todo / in progress / done as appropriate
   - **Blocked Items** — add new blockers with required action, owner, and affected stages
   - **Recent Changes** — add a dated entry for every meaningful change made
   - **Next Owner Decision** — add if owner input is now required
3. Verify consistency: the `.md` and `.json` must reflect the same state
4. Include both files in the `git add` command
5. In the final response, list exactly which sections of both files were updated
6. If genuinely no update is needed, state why explicitly

### Strict completion rule

A task is **NOT done** unless all three conditions are met:
- The implementation / documentation work is completed
- `project-brain/project_status.json` has been updated to reflect reality (canonical source)
- `project-brain/project_status.md` mirrors the JSON accurately

### PR requirements

- PR description must state which sections of both status files were updated
- Reviewer (Owner) should verify that both files accurately reflect the change and are consistent with each other

### Owner responsibilities

- Review `project_status.md` at the start of each session for human-readable context
- Use `project_status.json` as the machine-readable source for dashboards and task generation
- Flag any entries where the two files are inconsistent or stale

## Definition of Done

A task is complete when ALL of the following are true:

- [ ] Code change is implemented on a feature branch
- [ ] `bash scripts/ai-verify.sh` passes (for code changes)
- [ ] Both `project-brain/project_status.md` and `project-brain/project_status.json` are updated and consistent
- [ ] Final response lists exactly which sections of both status files were updated
- [ ] PR is opened with clear description of changes
- [ ] No production workflows, deploy scripts, or credentials were modified
- [ ] PR is reviewed and merged by Owner

## Progress Update Discipline

Stage progress in both `project_status.md` and `project_status.json` must follow conservative rules:

- **Percentages only change when completion criteria objectively move.** Writing code is not the same as delivering a working feature.
- **Blocked work does not count as progress.** If a stage is blocked on credentials or external action, its percentage stays frozen at the last verified state.
- **"Done in code but not verified" is not fully complete.** Code-only stages are capped at 40–50% until verified with real services in a real environment.
- **Progress must stay conservative.** When in doubt, round down. Overstating progress creates false confidence and hides risk.
- **Only the Progress Model table is authoritative.** The overall completion estimate is a weighted calculation from that table, not a subjective guess.

## Execution Priorities

When choosing between tasks, prefer the one closer to:

```
missed call → SMS → AI → booking → calendar
```

This is the core MVP flow. Everything else is secondary.
