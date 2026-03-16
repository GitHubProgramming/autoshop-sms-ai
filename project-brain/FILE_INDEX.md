# AutoShop AI — File Index

---

## 1 — Purpose

This file is the repository navigation layer for AI agents.

**Function:**

- Reduce unnecessary repo search — go directly to the right file
- Identify canonical files quickly — no guessing
- Map core system areas — know what lives where
- Support minimal-scope edits — touch only what the task requires

For architecture rules and constraints, see `PROJECT_TRUTH.md` and `ARCHITECTURE_LOCK.md`.

---

## 2 — Canonical Entry Points

| Item | Path |
|------|------|
| Canonical dashboard | `apps/web/app.html` |
| API entry point | `apps/api/src/index.ts` |
| Static frontend dir | `apps/web/` |
| API source dir | `apps/api/src/` |
| Project brain | `project-brain/` |
| Deployment config (Render) | `render.yaml` |
| Deployment config (Vercel) | `vercel.json`, `apps/web/vercel.json` |
| Docker | `apps/api/Dockerfile`, `infra/docker-compose.yml` |
| CI/CD workflows | `.github/workflows/` |
| Environment config | `.env`, `.env.example`, `.env.local` |
| n8n workflow deploy | `scripts/n8n-deploy.sh`, `.github/workflows/n8n-deploy.yml` |
| Migration runner | `apps/api/scripts/migrate.js` |
| DB schema/config | `apps/api/src/db/app-config.ts` |

---

## 3 — Repository Areas

### 3.1 Dashboard / Static Frontend

- **Path:** `apps/web/`
- **Responsibility:** Shop owner dashboard UI, login, signup, onboarding, marketing pages
- **Key files:**
  - `app.html` — canonical dashboard (all 7 views)
  - `login.html` — tenant login page
  - `signup.html` — tenant signup page
  - `onboarding.html` — onboarding flow
  - `admin.html` — internal admin dashboard
  - `index.html` — marketing/landing page
  - `demo.html` — demo funnel page
  - `privacy.html`, `terms.html` — legal pages
- **Edit safety:** Safe for UI-only edits. All dashboard work stays in `app.html`.

### 3.2 API / Backend

- **Path:** `apps/api/src/`
- **Responsibility:** Fastify API — webhooks, auth, billing, tenant data, internal endpoints
- **Key subdirectories:**
  - `routes/webhooks/` — Twilio SMS, voice, voice-status, Stripe webhooks
  - `routes/auth/` — login, signup, Google OAuth, admin bootstrap
  - `routes/billing/` — Stripe checkout, portal
  - `routes/tenant/` — dashboard data API
  - `routes/internal/` — n8n-facing endpoints (process-sms, booking-intent, calendar, config, etc.)
  - `routes/health.ts` — health check
  - `services/` — business logic (see 3.4, 3.5)
  - `middleware/` — auth guard, admin guard, Twilio validation
  - `workers/` — BullMQ workers
  - `queues/` — BullMQ queue definitions
- **Edit safety:** Backend edits require caution. Test after changes.

### 3.3 Database / Migrations / Schema

- **Path:** `apps/api/src/db/`
- **Responsibility:** PostgreSQL client, tenant isolation (RLS), app config
- **Key files:**
  - `client.ts` — database client / connection
  - `tenants.ts` — tenant isolation (`withTenant`)
  - `app-config.ts` — app configuration, schema definitions
  - `audit.ts` — audit logging
- **Migrations:** `apps/api/scripts/migrate.js` (runner), `apps/api/db/migrations/` (dir)
- **Edit safety:** High caution. Schema changes affect all tenants.

### 3.4 SMS / Messaging Pipeline

- **Path:** `apps/api/src/routes/webhooks/twilio-sms.ts`, `twilio-voice.ts`, `twilio-voice-status.ts`
- **Services:** `apps/api/src/services/process-sms.ts`, `missed-call-sms.ts`, `booking-intent.ts`
- **Workers:** `apps/api/src/workers/sms-inbound.worker.ts`
- **Middleware:** `apps/api/src/middleware/twilio-validate.ts`
- **Responsibility:** Inbound SMS/voice webhooks, message processing, booking detection, missed-call triggers
- **Edit safety:** High caution — this is the core revenue pipeline.

### 3.5 Google Calendar Integration

- **Path:** `apps/api/src/services/google-calendar.ts`, `google-token-refresh.ts`
- **Routes:** `apps/api/src/routes/auth/google.ts`, `apps/api/src/routes/internal/calendar-event.ts`, `calendar-tokens.ts`
- **Responsibility:** OAuth2 flow, token storage/refresh, calendar event creation/sync
- **Edit safety:** Caution — affects booking confirmation flow.

### 3.6 Admin Auth / Login

- **Path:** `apps/api/src/routes/auth/login.ts`, `signup.ts`, `admin-bootstrap.ts`, `google.ts`
- **Middleware:** `apps/api/src/middleware/require-auth.ts`, `admin-guard.ts`
- **Frontend:** `apps/web/login.html`, `apps/web/signup.html`, `apps/web/admin.html`
- **Responsibility:** Tenant and admin authentication, JWT tokens, Google OAuth
- **Edit safety:** Caution — affects access control.

### 3.7 Deployment / Docker / Build

- **Render:** `render.yaml`
- **Docker:** `apps/api/Dockerfile`, `infra/docker-compose.yml`, `infra/nginx.conf`
- **Vercel:** `vercel.json` (root), `apps/web/vercel.json`
- **CI/CD:** `.github/workflows/ci.yml`, `docker-check.yml`, `n8n-deploy.yml`
- **Responsibility:** Build, deploy, and infrastructure configuration
- **Edit safety:** High caution — affects production deployment.

### 3.8 n8n / Workflow Integration

- **Deploy script:** `scripts/n8n-deploy.sh`
- **CI workflow:** `.github/workflows/n8n-deploy.yml`
- **Internal routes:** `apps/api/src/routes/internal/` (n8n calls these endpoints)
- **Responsibility:** n8n workflow deployment, API endpoints consumed by n8n workers
- **Edit safety:** Caution — internal routes are called by production n8n workflows.

### 3.9 Project Brain / Truth Layer

- **Path:** `project-brain/`
- **Key files:** `AI_BOOT_SEQUENCE.md`, `PROJECT_TRUTH.md`, `ARCHITECTURE_LOCK.md`, `EXECUTION_POLICY.md`, `SYSTEM_MAP.md`, `PAGE_MAP.md`, `FILE_INDEX.md`, `project_status_v2.json`, `project_status.md`
- **Responsibility:** AI agent knowledge base, project status tracking
- **Edit safety:** Safe to read. Updates to status files must follow JSON-first rule.

### 3.10 Scripts / Utilities

- **Path:** `scripts/`
- **Key files:**
  - `ai-verify.sh` — AI verification runner
  - `n8n-deploy.sh` — n8n workflow deployment
  - `dev.sh` — local dev startup
  - `send-telegram.ps1`, `notify-*.ps1` — Telegram notifications
  - `run-ca-with-notify.ps1` — canonical Claude launch script
  - `ask-openai.ps1` — OpenAI bridge second opinion
  - `migrate.js` — at `apps/api/scripts/migrate.js`
- **Edit safety:** Generally safe. Notification scripts affect alerting only.

---

## 4 — UI Page Ownership

All 7 dashboard pages live in `apps/web/app.html`. Views are switched client-side via `switchView()`. Single data source: `GET /tenant/dashboard`.

| Page | Section in app.html | Backend Endpoint(s) |
|------|--------------------|--------------------|
| Dashboard | `#view-dashboard` | `GET /tenant/dashboard` |
| Conversations | `#view-conversations` | `GET /tenant/dashboard` → `recent_conversations` |
| Appointments | `#view-appointments` | `GET /tenant/dashboard` → `recent_bookings` |
| Customers | `#view-customers` | Derived client-side from conversations + bookings |
| Analytics | `#view-analytics` | `GET /tenant/dashboard` → `stats` |
| Billing | `#view-billing` | `POST /billing/checkout`, `POST /billing/portal` |
| Settings | `#view-settings` | `POST /auth/google/url`, `POST /auth/google/disconnect` |

**Agent note:** For any dashboard UI edit, open `apps/web/app.html`, search for the relevant `#view-*` section. See `PAGE_MAP.md` for detailed component breakdowns.

---

## 5 — High-Risk Files — Edit with Caution

| File / Area | Risk |
|-------------|------|
| `apps/api/src/routes/webhooks/twilio-sms.ts` | Core revenue pipeline — SMS ingestion |
| `apps/api/src/routes/webhooks/twilio-voice.ts` | Core pipeline — missed call detection |
| `apps/api/src/middleware/twilio-validate.ts` | Security — webhook signature validation |
| `apps/api/src/middleware/require-auth.ts` | Security — JWT authentication |
| `apps/api/src/middleware/admin-guard.ts` | Security — admin access control |
| `apps/api/src/db/tenants.ts` | Data isolation — RLS tenant boundary |
| `apps/api/src/db/client.ts` | Database connection — affects all queries |
| `apps/api/Dockerfile` | Deployment — production container build |
| `render.yaml` | Deployment — Render service configuration |
| `.github/workflows/n8n-deploy.yml` | Deployment — production n8n workflow push |
| `apps/api/src/workers/sms-inbound.worker.ts` | Core pipeline — message queue processing |
| `apps/api/src/services/google-calendar.ts` | Integration — calendar booking creation |
| `.env`, `.env.local` | Secrets — never commit, never expose |

---

## 6 — Safe Edit Patterns for Agents

- **UI copy/layout/styling** → edit `apps/web/app.html` only, do not change architecture
- **Dashboard data display** → modify render functions in `app.html`, not the API response shape
- **New API data field** → add to `routes/tenant/dashboard.ts`, consume in `app.html`
- **Backend bug fix** → targeted edit in the specific route/service file, run tests
- **New internal endpoint** → add file in `routes/internal/`, register in `index.ts`
- **Migration** → create SQL via `apps/api/scripts/migrate.js`, update `app-config.ts` if needed
- **Deployment config** → only touch if task explicitly requires it
- **Prefer extension over replacement** — add to existing systems, do not rebuild

---

## 7 — Fast Task Routing Guide

| Task Type | Inspect First |
|-----------|--------------|
| Dashboard visual bug | `apps/web/app.html` → relevant `#view-*` section |
| Dashboard data issue | `apps/api/src/routes/tenant/dashboard.ts` |
| Login / auth issue | `apps/api/src/routes/auth/login.ts`, `apps/web/login.html` |
| Admin auth issue | `apps/api/src/middleware/admin-guard.ts`, `apps/web/admin.html` |
| Google Calendar issue | `apps/api/src/services/google-calendar.ts`, `routes/auth/google.ts` |
| SMS not working | `apps/api/src/routes/webhooks/twilio-sms.ts`, `services/process-sms.ts` |
| Missed call not triggering | `apps/api/src/routes/webhooks/twilio-voice.ts`, `twilio-voice-status.ts` |
| Booking not created | `apps/api/src/services/booking-intent.ts`, `routes/internal/calendar-event.ts` |
| Billing/Stripe issue | `apps/api/src/routes/billing/checkout.ts`, `routes/webhooks/stripe.ts` |
| Deployment mismatch | `render.yaml`, `apps/api/Dockerfile`, `.github/workflows/ci.yml` |
| n8n workflow deploy | `scripts/n8n-deploy.sh`, `.github/workflows/n8n-deploy.yml` |
| Project status update | `project-brain/project_status_v2.json` (JSON first, then MD mirror) |
| Settings page issue | `apps/web/app.html` → `#view-settings`, settings tab sections |

---

## 8 — Agent Rule

Before performing a broad repository search, the AI agent must inspect this file first and use it to choose the minimal file set needed for the task.

If the task can be resolved using only the files listed in this index, no further repo scanning is needed.
