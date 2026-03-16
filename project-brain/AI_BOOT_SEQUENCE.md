# AutoShop AI — Agent Boot Sequence

---

## 1 — Boot Purpose

This file defines the mandatory initialization procedure for any AI agent working inside the AutoShop AI repository.

**Purpose:**

- Eliminate unnecessary repository scanning
- Enforce architecture rules from the first action
- Ensure consistent execution across all agent sessions
- Speed up AI development by front-loading project knowledge

Every agent session must complete this boot sequence before performing any repository work. No exceptions.

---

## 2 — Mandatory Startup Order

### Step 1 — Read Project Truth Layer

Read these files in this exact order:

1. `project-brain/PROJECT_TRUTH.md`
2. `project-brain/ARCHITECTURE_LOCK.md`
3. `project-brain/EXECUTION_POLICY.md`
4. `project-brain/SYSTEM_MAP.md`
5. `project-brain/PAGE_MAP.md`
6. `project-brain/FILE_INDEX.md`

### Step 2 — Confirm Core Facts

After reading, the agent must confirm these facts internally before proceeding:

- **Canonical dashboard file:** `apps/web/app.html`
- **Frontend architecture type:** Static single-page application (vanilla HTML/CSS/JS)
- **Deployment architecture:** GitHub main → Render build → Docker container → Fastify API → Admin dashboard
- **Target market:** Texas, USA
- **Pricing tiers:** Starter $199/mo, Pro $299/mo, Premium $499/mo

If any fact cannot be confirmed from the truth layer files, the agent must stop and report the discrepancy.

### Step 3 — Determine Minimal File Set

Identify only the files required for the current task. Do not read files unrelated to the task.

### Step 4 — Begin Work

Only after completing Steps 1–3 may the agent search the repository or modify code.

---

## 3 — Repository Discovery Rules

- **Avoid full repository scans** — never glob or grep the entire repo without a targeted pattern
- **Prefer targeted file reads** — use the System Map and Page Map to locate files directly
- **Never assume architecture changes** — the architecture is locked unless explicitly instructed otherwise
- **Never redesign system components** unless the human explicitly requests it
- **Modify the smallest possible code surface** — smallest safe patch only

---

## 4 — Architecture Protection

Hard constraints that must never be violated:

- The dashboard is a **static admin app** — not a framework-based SPA
- **Canonical file:** `apps/web/app.html` — all UI lives here
- **React/Vite conversion is forbidden** — no frontend framework introduction
- UI refinement must happen **inside the existing dashboard file**
- **GitHub is the canonical deployment source** — not n8n, not external systems
- Backend endpoints must remain **compatible with the current dashboard**
- **Tenant isolation via PostgreSQL RLS** must be preserved
- **BullMQ queue architecture** must not be replaced

---

## 5 — Failure Handling

If the repository state conflicts with boot rules (e.g., architecture has been changed, lock files are missing, dashboard has been moved):

The agent must:

1. **Report the conflict** — describe exactly what diverges from the truth layer
2. **Stop architecture modification** — do not attempt to fix or override the conflict
3. **Request human confirmation** — ask the human how to proceed before taking any action

The agent must never silently resolve conflicts with the project truth layer.

---

## 6 — Performance Goal

The purpose of this boot sequence is to make AI development:

- **Deterministic** — every session starts from the same knowledge base
- **Faster** — no time wasted rediscovering architecture, routes, or UI structure
- **Architecture-safe** — locked rules prevent accidental redesigns or framework changes

Boot time target: the agent should be ready to work within the first 2–3 tool calls of a session.
