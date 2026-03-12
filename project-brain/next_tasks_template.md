# Next Tasks Template

Standard output format for proposed tasks. Every task recommendation must use this structure.

---

## [Task Title]

**Why now:** [1-2 sentences explaining why this is the highest-priority actionable task right now, based on project_status.json]

**Source:** [Stage name + ID, blocker description, or active_tasks.todo item — must cite the exact origin in project_status.json]

**Allowed scope:**
- [list of directories / files that may be modified]

**Forbidden scope:**
- [list of directories / files that must not be touched]

**Acceptance criteria:**
- [ ] [Specific, verifiable condition 1]
- [ ] [Specific, verifiable condition 2]
- [ ] [project_status.md updated to reflect change]

**Risks / blockers:**
- [Known risks or dependencies that could prevent completion]

**Owner input required:** Yes / No
- [If yes: exact decision needed and what it unblocks]

---

## Usage Notes

- Propose 1-3 tasks per session, ordered by priority.
- Each task must pass the validation checklist in `task_generation_rules.md`.
- If fewer than 3 actionable tasks exist, state why and list what would unblock more work.
- Tasks that require owner input should be listed separately at the end under "Pending Owner Decisions".
