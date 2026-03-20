# Project Brain

> **Project Brain is NOT a source of truth for progress or system state.**
> Use GitHub Projects for task tracking and runtime verification for real system status.
> This directory is a **context system** — decision memory, architecture reference, and agent rules.

---

## 1. System Overview

**Product:** AutoShop AI — AI receptionist SaaS for auto repair shops.

**Core value:** Recover missed calls and convert them into booked appointments via SMS AI conversations.

**Target launch market:** Texas, USA.

### Core Revenue Flow (Protected)

```
Missed call / Inbound SMS
  -> Twilio webhook
  -> Fastify API (validate + enqueue)
  -> BullMQ queue (sms-inbound)
  -> n8n worker (tenant lookup, message save)
  -> n8n worker (OpenAI gpt-4o-mini -> booking detection -> SMS reply)
  -> n8n worker (calendar sync -> confirmation SMS)
```

All work must protect or improve this flow. Do not optimize anything that does not improve it.

### Pricing Tiers

| Plan     | Price    | Conversations/mo |
|----------|----------|-------------------|
| Starter  | $199/mo  | 150               |
| Pro      | $299/mo  | 400               |
| Premium  | $499/mo  | 1,000             |

---

## 2. Locked Decisions

These decisions must NOT change without explicit human instruction.

### Source of Truth

- **GitHub repository** is the canonical source for all code and configuration
- **n8n** is a workflow runtime only — NOT the source of truth
- **GitHub Projects** is the source of truth for task tracking and progress

### Architecture Decisions (ADR)

| ID | Decision | Rationale |
|----|----------|-----------|
| ADR-001 | GitHub is source of truth for workflows | Prevents drift, enables version control and rollback |
| ADR-002 | n8n UI is NOT the development environment | Avoids untracked changes, ensures auditability |
| ADR-003 | Workflows deploy via GitHub Actions | Automated, repeatable deployments with duplicate detection |
| ADR-004 | Claude Code works via branches and PRs only | Maintains code review gate, prevents untested production changes |
| ADR-005 | TEST environment is a safe sandbox | Isolates experimental work from production |
| ADR-006 | API is ingress-only (Fastify) | Twilio requires fast responses; heavy processing runs async in n8n |
| ADR-007 | Billing state cached locally, not fetched live from Stripe | Reduces latency, avoids rate limits |
| ADR-008 | Multi-tenancy via Postgres RLS | Enforces data isolation at DB level |
| ADR-009 | Idempotent webhook handling (Redis, 24h TTL) | Prevents duplicate processing from provider retries |

### Frontend Lock

- Dashboard is `apps/web/app.html` — static single-page app (vanilla HTML/CSS/JS)
- Do NOT convert to React, Vite, Next.js, or any SPA framework
- Do NOT split `app.html` into multiple page files
- Served via `/app/:view` Vercel rewrites
- Auth pages: `/login`, `/signup`, `/onboarding/business`

### Backend Lock

- Fastify API framework — do not replace
- BullMQ queue architecture — do not replace
- PostgreSQL + Redis — do not replace
- Tenant isolation via RLS — must be preserved

### Infrastructure Lock

- Twilio = SMS/voice provider
- Google Calendar = calendar integration
- n8n Cloud = async workflow engine
- Deployment: GitHub -> Render -> Docker -> Fastify API
- n8n deploy: GitHub Actions -> `scripts/n8n-deploy.sh` -> n8n Cloud

### Environment Safety

| Environment | Purpose | Safety |
|-------------|---------|--------|
| `TEST` | Sandbox for experimentation | Safe — free to modify |
| `LT_Proteros` | Lithuania production flows | Protected — no automatic changes |
| `US_AutoShop` | US production flows | Protected — no automatic changes |

---

## 3. System Architecture

### API Layer

- **Location:** `apps/api/src/`
- **Framework:** Node.js + TypeScript (Fastify)
- **Role:** Ingress — receives webhooks, validates signatures, enqueues jobs to BullMQ
- **Entry point:** `apps/api/src/index.ts`

| Route Group | Files | Purpose |
|-------------|-------|---------|
| `/webhooks/` | `twilio-sms.ts`, `twilio-voice.ts`, `twilio-voice-status.ts`, `stripe.ts` | Inbound webhooks |
| `/auth/` | `login.ts`, `signup.ts`, `google.ts`, `admin-bootstrap.ts` | Authentication & OAuth |
| `/billing/` | `checkout.ts`, `portal.ts` | Stripe billing |
| `/tenant/` | `dashboard.ts` | Tenant dashboard data |
| `/internal/` | `process-sms.ts`, `booking-intent.ts`, `calendar-event.ts`, `missed-call-sms.ts`, etc. | n8n-facing endpoints |
| `/` | `health.ts` | Health check |

### SMS Pipeline

```
Inbound SMS -> Twilio webhook -> /webhooks/twilio-sms
  -> Signature validation -> Idempotency check (Redis)
  -> Enqueue to BullMQ (sms-inbound)
  -> n8n worker: tenant lookup + message save
  -> n8n worker: OpenAI gpt-4o-mini -> booking detection -> SMS reply
  -> n8n worker: calendar sync -> confirmation SMS
```

### Voice Pipeline

```
Inbound Call -> Twilio webhook -> /webhooks/twilio-voice
  -> Forward to shop phone (20s timeout)
  -> If missed -> /webhooks/twilio-voice-status
  -> Enqueue missed-call SMS trigger
```

### BullMQ Queues

| Queue | Purpose |
|-------|---------|
| `sms-inbound` | Inbound SMS and missed-call triggers |
| `provision-number` | Async Twilio number provisioning |
| `billing-events` | Grace period checks |
| `calendar-sync` | Google Calendar sync jobs |

### Database

- **PostgreSQL** with Row-Level Security (RLS) for tenant isolation
- All tenant queries go through `withTenant(tenantId, fn)`
- Migrations: `apps/api/scripts/migrate.js`

### n8n Integration

- **Runtime:** n8n Cloud (async worker)
- **Deploy:** GitHub Actions -> `scripts/n8n-deploy.sh` -> n8n Cloud
- **Role:** Consumes BullMQ queues, runs AI processing, sends SMS, syncs calendar
- **Workflows:** organized by environment (US_AutoShop, LT_Proteros, TEST)

### Twilio

- Each tenant has a dedicated Twilio phone number
- Webhook signature validation enforced in staging/production
- `SKIP_TWILIO_VALIDATION=true` only in dev

### Google Calendar

- OAuth2 integration per tenant
- Tokens stored encrypted in DB
- Calendar sync via `calendar-sync` BullMQ queue
- OAuth flow: `/auth/google/url` -> consent -> `/auth/google/callback`

### Stripe Billing

- Subscription management via Stripe
- Checkout: `/billing/checkout` -> Stripe Checkout Session
- Portal: `/billing/portal` -> Stripe Customer Portal
- Webhooks: `/webhooks/stripe` -> billing state updates

### Dashboard

- **Location:** `apps/web/app.html`
- **Type:** Static single-page app (vanilla HTML/CSS/JS)
- **Served at:** `/app/:view` via Vercel rewrites
- **Auth:** JWT token-based, stored in localStorage
- **Data:** Single API call to `/tenant/dashboard`

### Deployment

```
Developer -> GitHub (main branch)
  -> Render: Docker build -> API container
  -> GitHub Actions: n8n workflow deploy
  -> Vercel: Static frontend serving
```

---

## 4. Operating Rules for Agents

### Hard Rules

1. Always work on branch `ai/<task-name>`
2. Smallest safe patch only
3. Do not refactor unrelated systems
4. Do not invent progress or verification
5. Never claim "live-tested" without real service verification
6. Never modify production workflows (US_AutoShop, LT_Proteros)
7. Never invent credentials or secrets
8. Prefer repository evidence over assumptions
9. BUILD work > test-only work
10. One task at a time

### Forbidden Operations

- Do NOT modify production workflows in `n8n/workflows/US_AutoShop/` or `n8n/workflows/LT_Proteros/`
- Do NOT edit, create, or delete credentials or secrets (`.env`, API keys, tokens)
- Do NOT modify deploy scripts or CI pipelines without explicit approval
- Do NOT run destructive database operations without human approval
- Do NOT push directly to `main`
- Do NOT force-push to any branch
- Do NOT bypass pre-commit hooks or verification scripts
- Do NOT introduce mock data as real data
- Do NOT break API contracts

### Allowed Operations

- Create new workflows in `n8n/workflows/TEST/`
- Modify `apps/api/` code on feature branches with verification
- Add or update tests
- Safe UI edits in `apps/web/app.html`

### Verification Rules

- Accuracy > optimism
- Verification > speed
- Facts > assumptions
- Never claim success without machine-verifiable proof
- If output is truncated or timed out, re-run before reporting
- Always verify with real runtime when possible

### Branch & Commit Rules

- All changes via feature branches (`ai/<task-name>`)
- Run `bash scripts/ai-verify.sh` before every commit
- Never commit claiming success unless verification is confirmed

### Escalation

Ask for human clarification when:
1. Secrets or credentials are required
2. A destructive database operation is needed
3. Multiple architecture paths exist with significant business impact
4. Any change would affect production environments

---

## Reference Files

| File | Purpose |
|------|---------|
| `CLAUDE_RULES.md` | Dashboard UI execution rules |
| `PAGE_MAP.md` | Dashboard view component map |
| `FILE_INDEX.md` | Repository navigation index |
