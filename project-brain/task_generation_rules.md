# Task Generation Rules

Strict rules for generating next-step tasks from `project_status.json`.

## Pre-condition

Before proposing any new task, Claude **must** read `project-brain/project_status.json` and base all recommendations on its current contents. Ad-hoc reasoning without consulting the JSON is not allowed.

**Stale JSON means invalid task generation.** If `project_status.json` has not been kept in sync with `project_status.md`, task generation output is unreliable. Before generating tasks, verify that the JSON reflects the latest known state. If drift is detected, the first task must be to synchronize both files.

## Task Derivation Sources

New tasks must be derived exclusively from these fields in `project_status.json`:

| Field | What it tells you |
|-------|-------------------|
| `current_phase` | The macro goal right now |
| `current_focus` | The specific active priority |
| `stages[].status == "blocked"` | Work that cannot proceed without action |
| `stages[].status == "in_progress"` | Work that should be finished before starting anything new |
| `active_tasks.todo` | Already-identified next steps |
| `blockers[]` | Specific impediments with owners and affected stages |
| `next_owner_decision` | Decisions only the human can make |

Tasks that cannot be traced to one of these sources must not be proposed.

## Prioritization Rules

When generating tasks, apply these rules in strict order:

1. **Unblock critical blockers** — If a blocker is actionable within the allowed scope (i.e., does not require credentials, human decisions, or forbidden-scope changes), generate an unblock task first.
2. **Finish the current in-progress milestone** — Do not start new stages while `in_progress` stages have incomplete work.
3. **Complete high-weight stages before low-weight stages** — When choosing between two stages at the same status, prefer the one with higher `weight` in the progress model.
4. **Do not start new stages when the current one is unfinished** — A stage at `in_progress` must reach its completion criteria (or be explicitly blocked) before moving to a `not_started` stage.
5. **Respect the MVP flow priority** — When in doubt, choose the task closer to: missed call -> SMS -> AI -> booking -> calendar.

## Scope Constraints

- Claude must **not** generate tasks for forbidden areas (production workflows, credentials, deploy scripts, CI pipelines).
- If a blocker's `owner` is `"Human"`, Claude must not invent a workaround. Instead, surface the decision needed under "Owner input required".
- If `next_owner_decision` contains unresolved items, Claude must list them explicitly and not proceed as if they are resolved.

## Owner Input Rule

When owner input is required:
- Do **not** invent a solution or assume a decision.
- Surface the exact decision needed, who must make it, and what is blocked by it.
- Propose tasks that can proceed independently of the pending decision, if any exist.

## Task Validation Checklist

Before finalizing a proposed task, verify:

- [ ] It traces to a specific field in `project_status.json`
- [ ] It falls within allowed scope
- [ ] It does not duplicate an `active_tasks.in_progress` item
- [ ] It does not skip ahead of higher-priority work
- [ ] It does not require credentials or secrets Claude cannot provide
- [ ] It has clear acceptance criteria
- [ ] It respects progress discipline (no fake "done")

## When No Tasks Are Available

If all remaining work is blocked on human action or forbidden scope, Claude must:
1. State clearly that no actionable tasks exist within the allowed scope
2. List the specific blockers preventing progress
3. Recommend the owner actions that would unblock the most work
