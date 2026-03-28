# Dev-Loop Operator Guide

## Quick Start

```bash
# Submit a task
bash scripts/dev-loop-submit.sh scripts/tasks/example-task.json

# Or on PowerShell
.\scripts\dev-loop-submit.ps1 -TaskFile scripts\tasks\example-task.json
```

## Prerequisites

- n8n running locally (`docker compose up -d` from `infra/`)
- `ANTHROPIC_API_KEY` in root `.env` with funded credits
- Dev-loop orchestrator workflow active in n8n

## Creating a Task

Create a JSON file in `scripts/tasks/` following this format:

```json
{
  "task_id": "unique-id",
  "title": "Short task title",
  "goal": "What should be achieved — be specific",
  "scope_boundaries": ["What is in/out of scope"],
  "files_allowed": ["glob patterns of files that may be changed"],
  "files_forbidden": ["glob patterns that must NOT be touched"],
  "critical_systems_risk": false,
  "expected_output": ["What deliverables are expected"],
  "checks_required": ["typecheck", "test"]
}
```

### Required Fields

| Field | Type | Notes |
|-------|------|-------|
| `task_id` | string | Unique identifier, used in branch name (`ai/task-{id}`) |
| `title` | string | Short description |
| `goal` | string | Detailed goal — Claude executes based on this |

### Critical Systems Guard

Tasks touching these systems are auto-escalated (blocked before execution):

- Billing / Stripe
- Auth / login / sessions
- Twilio webhooks
- Google OAuth / token refresh
- Multi-tenant RLS
- Provisioning / signup
- Deploy config
- DB migrations

Set `"critical_systems_risk": true` if the task intentionally touches these. It will be escalated for manual review.

## What Happens

1. Task enters n8n webhook
2. Validated and risk-classified
3. High-risk tasks → blocked + ESCALATE
4. Low/medium risk → Claude API executes the task
5. Response parsed into ExecutionResultContract
6. Review packet assembled with decision recommendation
7. Result returned and saved to `scripts/tasks/results/`

## Decision Outcomes

| Decision | Meaning |
|----------|---------|
| `SAFE_AUTOMERGE` | All good — but merge gate is OFF by default |
| `FIX_AND_RETRY` | Small issue, can retry (max 2) |
| `ESCALATE` | Needs human decision |

**Merge gate is OFF by default.** Even `SAFE_AUTOMERGE` results require manual merge unless `AUTOMERGE_ENABLED=true` is set in n8n env.

## Reviewing Results

Results are saved to `scripts/tasks/results/{task_id}_{timestamp}.json`.

Key fields in the review packet:

```
goal_match:              full / partial / failed
risk_level:              low / medium / high
critical_systems_touched: true / false
checks_passed:           true / false
recommended_decision:    SAFE_AUTOMERGE / FIX_AND_RETRY / ESCALATE
operator_notes:          Human-readable summary
```

## Environment Variables

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `ANTHROPIC_API_KEY` | Yes | — | In root `.env`, read by n8n via `env_file` |
| `N8N_BASE_URL` | No | `http://localhost:5678` | Override for remote n8n |
| `CLAUDE_DEV_LOOP_MODEL` | No | `claude-sonnet-4-20250514` | Model for task execution |
| `AUTOMERGE_ENABLED` | No | `false` | Must be explicitly `true` to allow auto-merge |
