# Project Brain — Shared Memory for Claude Execution

This directory is **working memory for Claude sessions**, not documentation for humans or customers.

`project-brain/` is the canonical shared-memory directory for this repository. All session-persistent context, status tracking, and architectural decisions live here.

## Purpose

Enable execution continuity across Claude sessions. Every session starts faster and makes better decisions because the previous session left structured context behind.

## Session Start Protocol

At the beginning of every session, read these files in order:

1. `current_focus.md` — What to work on right now
2. `blockers.md` — What is currently blocked and why
3. `session_handoff.md` — What the last session did and what it recommends next
4. `task_queue.md` — Prioritized execution queue
5. `decisions.md` — Stable decisions that should not be re-debated
6. `openai_advice.md` — Durable reasoning from bridge consultations

Then read the canonical status files:
- `project_status.json` (source of truth)
- `project_status.md` (human-readable mirror)

## Session End Protocol

Before ending a session, update:

1. `session_handoff.md` — Summarize what was done, what is next, what to avoid
2. `current_focus.md` — If the focus changed, update it
3. `blockers.md` — If blockers were resolved or discovered, update the list
4. `task_queue.md` — If tasks were completed or priorities shifted, update the queue
5. `openai_advice.md` — If the bridge was consulted, record durable insights

## Rules

- Only write verified facts. Never invent progress.
- Keep files concise. This is operational memory, not prose.
- `project_status.json` remains the canonical source of truth for stage progress and blockers.
- These files supplement, not replace, the status system.
- Delete stale content rather than letting it accumulate.
