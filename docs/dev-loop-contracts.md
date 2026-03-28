# Autonomous Dev-Loop Contracts

Machine-readable contracts for the autonomous development loop orchestration.

## Overview

The dev-loop processes tasks through three stages, each with a defined contract:

1. **Task Contract** — input: what to do, scope boundaries, risk flags
2. **Execution Result Contract** — output from Claude: what happened, what changed, check results
3. **Review Packet Contract** — decision-ready summary for operator/ChatGPT review

## Decision Outcomes

| Decision | Meaning |
|----------|---------|
| `SAFE_AUTOMERGE` | Task fully matches goal, no gaps, no failed checks, no critical systems touched |
| `FIX_AND_RETRY` | Small clear issue, can be fixed safely, max 2 retry cycles |
| `ESCALATE` | Business decision needed, ambiguity, credentials required, or critical systems touched |

## Critical Systems (auto-escalate if touched)

- Billing / Stripe
- Authentication / login / sessions
- Twilio webhook core
- Google OAuth / token refresh
- Multi-tenant isolation / RLS
- Provisioning / signup flow
- Deployment pipeline
- Destructive DB migrations

## Contract Schemas

### A) Task Contract

```json
{
  "task_id": "string — unique identifier",
  "title": "string — short task title",
  "goal": "string — what should be achieved",
  "scope_boundaries": ["string — what is in/out of scope"],
  "files_allowed": ["string — glob patterns of files that may be changed"],
  "files_forbidden": ["string — glob patterns that must NOT be touched"],
  "critical_systems_risk": "boolean — true if task may touch critical systems",
  "expected_output": ["string — what deliverables are expected"],
  "checks_required": ["string — checks that must pass (typecheck, test, lint, etc.)"]
}
```

### B) Execution Result Contract

```json
{
  "task_id": "string — matches task contract",
  "status": "done | failed | blocked",
  "files_changed": ["string — list of changed file paths"],
  "checks_run": [
    {
      "name": "string — check name",
      "status": "pass | fail | not_run",
      "details": "string — output or error details"
    }
  ],
  "critical_files_touched": ["string — any critical-system files that were modified"],
  "summary": "string — what was done",
  "open_issues": ["string — unresolved issues"],
  "retry_recommended": "boolean — true if a retry could fix the issue"
}
```

### C) Review Packet Contract

```json
{
  "task_id": "string — matches task contract",
  "review_ready": "boolean — true when packet is complete",
  "goal_match": "full | partial | failed",
  "risk_level": "low | medium | high",
  "critical_systems_touched": "boolean",
  "checks_passed": "boolean — all required checks passed",
  "logical_gaps": ["string — any gaps in implementation"],
  "recommended_decision": "SAFE_AUTOMERGE | FIX_AND_RETRY | ESCALATE",
  "operator_notes": "string — human-readable summary for operator",
  "retry_count": "number — how many retries have been attempted (max 2)",
  "git_diff_summary": "string — summary of git changes",
  "branch": "string — git branch name"
}
```

## Flow Diagram

```
Task Contract (webhook)
    │
    ▼
Task Classification (risk check)
    │
    ▼
Claude Execution (branch, implement, test)
    │
    ▼
Result Collection (files, checks, diff)
    │
    ▼
Review Packet Assembly
    │
    ▼
Decision Gate
    ├─ SAFE_AUTOMERGE → merge (flag must be ON, default OFF)
    ├─ FIX_AND_RETRY → loop back (max 2)
    └─ ESCALATE → Telegram notification
```
