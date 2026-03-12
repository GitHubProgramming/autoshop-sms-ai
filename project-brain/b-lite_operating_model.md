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
6. Builder updates project-brain/project_status.md
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
| **Status update** | `project_status.md` reflects the change | Builder + PR review |
| **Code review** | PR approved by Owner before merge | GitHub branch protection |
| **CI green** | GitHub Actions checks pass | GitHub Actions |

## Status Update Policy

`project-brain/project_status.md` is the mandatory project control file.

**Builder must update it:**
- After every task completion (before opening PR)
- When a task becomes blocked
- When focus or phase changes
- When code or workflows are modified

**PR descriptions must reference** which sections of `project_status.md` were updated.

**Owner should review** `project_status.md` at the start of each session to understand current state.

## Definition of Done

A task is complete when ALL of the following are true:

- [ ] Code change is implemented on a feature branch
- [ ] `bash scripts/ai-verify.sh` passes
- [ ] `project-brain/project_status.md` is updated (Active Tasks, Stage Progress, Recent Changes)
- [ ] PR is opened with clear description of changes
- [ ] No production workflows, deploy scripts, or credentials were modified
- [ ] PR is reviewed and merged by Owner

## Progress Update Discipline

Stage progress in `project_status.md` must follow conservative rules:

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
