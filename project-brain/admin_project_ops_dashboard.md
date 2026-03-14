# Admin Project Ops Dashboard — Specification

> **Type:** UI + API spec (no application code)
> **Data source:** `project-brain/project_status.json` (canonical)
> **Navigation:** Admin → Project Ops
> **Status:** Draft spec — ready for implementation

---

## 1. Overview

The Project Ops dashboard gives the owner and operators a real-time view of MVP progress, active tasks, blockers, and recent changes — without reading code or status files manually.

All data is served from a single endpoint that reads `project_status.json`.

---

## 2. Backend Contract

### `GET /api/project-status`

**Source:** Reads and returns the contents of `project-brain/project_status.json` as-is.

**Response:** `200 OK` with `Content-Type: application/json`

```jsonc
{
  "overall_progress": 34,
  "current_phase": "...",
  "current_focus": "...",
  "stages": [ /* see Stage Progress schema */ ],
  "active_tasks": {
    "todo": [],
    "in_progress": [],
    "done": []
  },
  "blockers": [ /* see Blockers schema */ ],
  "recent_changes": [ /* see Recent Changes schema */ ],
  "next_owner_decision": []
}
```

**Auth:** Admin-only. Requires authenticated admin session.

**Error responses:**
- `401 Unauthorized` — not authenticated
- `403 Forbidden` — not admin role
- `500 Internal Server Error` — file read failure (include error message in response body)

**Implementation note:** This endpoint should read the file from disk on each request (no caching). The file changes infrequently and the read cost is negligible.

---

## 3. Dashboard Sections

### 3.1 Overall Progress

| Field | Source | UI Component | Priority |
|-------|--------|-------------|----------|
| `overall_progress` | **Derived from `stages[]`** (see formula below) | Circular progress gauge or horizontal progress bar | **P0** |

**Purpose:** Single-number summary of MVP completion.

**Derivation rule:** Do NOT trust `overall_progress` from the JSON directly. Compute it client-side:

```javascript
Math.floor(stages.reduce((sum, s) => sum + s.weight * s.progress / 100, 0))
```

This eliminates drift risk from stale or incorrectly-rounded stored values. The `overall_progress` field in the JSON is maintained for backward compatibility but is not authoritative — the `stages[]` array is.

---

### 3.2 Current Phase

| Field | Source | UI Component | Priority |
|-------|--------|-------------|----------|
| `current_phase` | Root field (string) | Text badge / banner | **P0** |

**Purpose:** One-line description of the current development phase. Displayed prominently at the top of the dashboard.

---

### 3.3 Current Focus

| Field | Source | UI Component | Priority |
|-------|--------|-------------|----------|
| `current_focus` | Root field (string) | Text card with subtle highlight | **P0** |

**Purpose:** What the team is actively working on right now. More specific than phase — describes the immediate task or initiative.

---

### 3.4 Stage Progress

| Field | Source | UI Component | Priority |
|-------|--------|-------------|----------|
| Stage table | `stages[]` array | Table or card grid | **P0** |

**Purpose:** Shows each MVP stage with its weight, status, and progress. This is the primary progress breakdown.

**Displayed fields per stage:**

| Column | JSON Field | Type | Notes |
|--------|-----------|------|-------|
| Stage Name | `stages[].name` | string | — |
| Weight | `stages[].weight` | integer (%) | Relative importance to MVP |
| Status | `stages[].status` | enum | One of: `done`, `in_progress`, `blocked`, `not_started` |
| Progress | `stages[].progress` | integer (0–100) | Percentage complete |
| Weighted Contribution | Calculated: `weight * progress / 100` | float | Shows actual contribution to overall % |

**Status badge colors:**
- `done` → green
- `in_progress` → blue
- `blocked` → red
- `not_started` → gray

**Completion meaning per stage** (display as tooltip or expandable row):

| Stage | 100% means |
|-------|-----------|
| Foundation & Operating Model | Repo structure, CI, B-Lite model, project brain, CLAUDE.md — all enforced |
| TEST Sandbox Workflow Chain | All TEST workflows (wf001–wf006) committed, importable, executing in sandbox |
| Core Messaging & AI Flow | Missed call → SMS → AI → booking detected → appointment created, verified E2E |
| Calendar & Booking Reliability | OAuth complete, calendar sync works, confirmation SMS sent, failures surface |
| Admin Visibility & Control | Dashboard shows project status, tenant health, conversation metrics |
| Production Readiness | Billing live-tested, idempotency verified, error handling complete |
| First Live Pilot | One real Texas shop: missed calls → SMS → AI → bookings → Google Calendar |

---

### 3.5 Active Tasks

| Field | Source | UI Component | Priority |
|-------|--------|-------------|----------|
| Todo list | `active_tasks.todo[]` | Task list with status indicators | **P1** |
| In Progress list | `active_tasks.in_progress[]` | Task list with status indicators | **P0** |
| Done list | `active_tasks.done[]` | Collapsible task list | **P2** |

**Purpose:** Shows what work is queued, active, and recently completed. In Progress items are most prominent.

**Layout:** Three-column kanban or stacked lists grouped by status. In Progress column is visually emphasized.

---

### 3.6 Blockers

| Field | Source | UI Component | Priority |
|-------|--------|-------------|----------|
| Blocker cards | `blockers[]` array | Alert cards or table with red accent | **P0** |

**Purpose:** Surfaces items that are preventing progress. These require human action and should be impossible to miss.

**Displayed fields per blocker:**

| Column | JSON Field | Type |
|--------|-----------|------|
| Blocker Name | `blockers[].name` | string |
| Required Action | `blockers[].required_action` | string |
| Owner | `blockers[].owner` | string |
| Affected Stages | `blockers[].affects_stages[]` | string array |

**UI behavior:**
- Blockers with `owner: "Human"` should be visually distinguished (e.g., red badge)
- Affected stages should link/scroll to the corresponding row in the Stage Progress table
- If `blockers[]` is empty, show a green "No blockers" state

---

### 3.7 Recent Changes

| Field | Source | UI Component | Priority |
|-------|--------|-------------|----------|
| Change log | `recent_changes[]` array | Timeline or reverse-chronological table | **P1** |

**Purpose:** Audit trail of what changed and when. Newest entries first.

**Displayed fields per entry:**

| Column | JSON Field | Type |
|--------|-----------|------|
| Date | `recent_changes[].date` | string (YYYY-MM-DD) |
| Change | `recent_changes[].change` | string |
| Branch | `recent_changes[].branch` | string (optional) |

**UI behavior:**
- Show the 10 most recent entries by default
- "Show all" expands the full list
- Branch names displayed as monospace code badges

---

### 3.8 Next Owner Decisions

| Field | Source | UI Component | Priority |
|-------|--------|-------------|----------|
| Decision list | `next_owner_decision[]` | Numbered action items with call-to-action styling | **P0** |

**Purpose:** Tells the owner exactly what decisions or actions are needed from them to unblock progress. This is the "what do I need to do" section.

**UI behavior:**
- Each item is a distinct action card
- Visually prominent — this section drives owner engagement
- Consider checkboxes or "Mark resolved" buttons for future interactivity

---

## 4. Page Layout

```
┌─────────────────────────────────────────────────────┐
│  Admin → Project Ops                                │
├─────────────────────────────────────────────────────┤
│                                                     │
│  [Overall Progress: 34%]   [Current Phase: ...]     │
│                                                     │
│  Current Focus: ...                                 │
│                                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ⚠ Blockers (3)                                     │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐         │
│  │ blocker 1 │ │ blocker 2 │ │ blocker 3 │         │
│  └───────────┘ └───────────┘ └───────────┘         │
│                                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Stage Progress                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │ Name │ Weight │ Status │ Progress │ Contrib │    │
│  │ ...  │ ...    │ ...    │ ...      │ ...     │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Active Tasks                                       │
│  [In Progress] [Todo] [Done]                        │
│                                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Next Owner Decisions                               │
│  1. ...                                             │
│  2. ...                                             │
│                                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Recent Changes                                     │
│  2026-03-12  ...                                    │
│  2026-03-12  ...                                    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Layout notes:**
- Blockers are placed above Stage Progress to ensure visibility
- Next Owner Decisions are placed near the bottom but with high visual weight
- The page is a single scrollable view — no tabs or sub-navigation

---

## 5. Admin Navigation

**Placement:** `Admin → Project Ops`

This page is added to the admin sidebar/navigation as a top-level item under the Admin section. It should be accessible to admin-role users only.

---

## 6. Implementation Notes

- **No application code is included in this spec.** This is a design and contract document only.
- The frontend should fetch `GET /api/project-status` on page load and render all sections from the response.
- No polling or WebSocket needed — the data changes only when a developer updates the JSON file and deploys.
- The endpoint reads a static JSON file; no database queries are involved.
- Future enhancement: add `PATCH /api/project-status` for owner to resolve blockers or mark decisions directly from the UI.
