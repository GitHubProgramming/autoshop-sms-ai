# AI_STATUS — AutoShop SMS AI
## Technical State Log (ops-internal)

Last Updated: 2026-03-08
Branch: frontend-safe-polish

---

## ARCHITECTURE SUMMARY

**Flow:**
```
Twilio missed call / SMS
  → Fastify API (apps/api/, port 3000)
    → BullMQ queue (Redis) [sms-inbound]
      → n8n WF-001 (twilio-sms-ingest) consumer
        → n8n WF-002 (ai-worker) via HTTP
          → OpenAI gpt-4o-mini
          → Appointment saved to Postgres
          → n8n WF-004 (calendar-sync) via HTTP
            → Google Calendar API
          → n8n WF-003 (close-conversation) via HTTP
```

**Billing flow:**
```
Stripe Checkout → Stripe webhook → /webhooks/stripe → tenant billing state update
```

**Provisioning flow:**
```
Stripe subscription.created → /internal/enqueue-provision-number → BullMQ [provision-number] → n8n WF-007
```

---

## DETECTED APPS / SERVICES / ROUTES

### apps/api/ (Fastify, TypeScript)
- `POST /webhooks/twilio/sms` — inbound SMS (BullMQ enqueue)
- `POST /webhooks/twilio/voice-status` — missed call trigger (BullMQ enqueue)
- `POST /webhooks/stripe` — billing events
- `GET /auth/google/start` — Google OAuth initiation (tenantId param, NO ownership check)
- `GET /auth/google/callback` — Google OAuth callback
- `POST /billing/checkout` — Stripe checkout session (NO auth guard)
- `POST /internal/enqueue-provision-number` — provision phone (INTERNAL_API_KEY protected)
- `GET /health` — health check

### apps/web/ (Static HTML)
- `index.html` — public landing page
- `autoshop-landing.html` — alternate landing page
- `login.html` — demo login (localStorage auth, NO real backend session)
- `app.html` — operator dashboard (localStorage auth check only, no backend verification)
- `demo.html` — demo dashboard (clearly labeled simulated data)

### infra/
- `docker-compose.yml` — Postgres, Redis, n8n, n8n_worker, API containers
- n8n at port 5678, API at port 3000

---

## DEPLOYMENT SETUP SUMMARY

- **API:** Dockerized (Fastify, port 3000), no Vercel integration
- **Frontend:** Static HTML files in `apps/web/` — NOT in Next.js, NOT Vercel
- **n8n:** Self-hosted in Docker at port 5678
- **Postgres:** Docker container (port 5432), RLS enforced
- **Redis:** Docker container (port 6379), BullMQ
- **No vercel.json** — no cloud deploy configured
- **`.env` is gitignored** — real secrets not committed

---

## AUTH SUMMARY

- **API:** No JWT/session auth. Only webhook signature validation (Twilio + Stripe) and INTERNAL_API_KEY.
- **Frontend:** localStorage-based demo auth. No real backend session. Forgeable by any user.
- **n8n:** Basic auth (admin:admin default in docker compose)
- **Google OAuth:** Implemented at API level (`/auth/google/start`). State token encrypted AES-256-GCM. No UI entry point.

---

## SECURITY OBSERVATIONS

### HIGH RISK
1. **localStorage demo auth** — `apps/web/login.html` + `app.html` — any user can forge auth by modifying localStorage. No backend validation.
2. **No auth on `/billing/checkout`** — any user can create Stripe checkout session for any tenantId.
3. **No tenantId ownership check on `/auth/google/start`** — any user can trigger Google OAuth for any tenant.
4. **SQL string interpolation** — `apps/api/src/db/client.ts:29` — SET LOCAL uses string concat, not parameterized.
5. **n8n SQL uses template syntax** — `{{ $json.field }}` in SQL queries with only quote-escaping, not true parameterization.

### MEDIUM RISK
6. **N8N_ENCRYPTION_KEY fallback** — `infra/docker-compose.yml` uses hardcoded fallback value `change_me_32_chars_minimum_here!` if env not set.
7. **API runs as root** — `apps/api/Dockerfile` has no USER directive.
8. **No CORS headers** — API has no CORS config; browser will block cross-origin requests in production.
9. **SKIP_TWILIO_VALIDATION=true** — intentional for dev but must be false in production; not enforced.

### LOW RISK (informational)
10. **console.log in SMS worker** — inconsistent with Fastify logger standard.
11. **TypeScript `any` casts** — in Stripe billing code.

---

## LAUNCH READINESS OBSERVATIONS

### What IS working (verified 2026-03-08)
- Full SMS → AI → appointment → calendar E2E flow (smoke test exec IDs 243-246)
- BullMQ queue reliably enqueues inbound SMS
- n8n WF-001 → WF-002 → WF-004 → WF-003 all returning SUCCESS
- Postgres RLS enforcing tenant isolation
- Twilio signature validation middleware (dev bypass in place)
- Stripe checkout endpoint creates sessions correctly

### What is NOT working / NOT configured
- Billing: Stripe keys are all REPLACE_ME placeholders — no real billing
- Google Calendar: OAuth flow exists but no UI entry point
- Twilio SMS delivery: hitting 50/day test limit in test mode
- Admin notifications: chargeback disputes are silent
- Blocked tenant UX: no reply SMS sent to customer

### Verdict
**DEMO-READY** for internal use + pilot demos.
**NOT PRODUCTION-READY** until P0 security items fixed and P1 blockers resolved.

---

## CURRENT HIGHEST-RISK ITEMS

1. `S1` — localStorage auth → anyone can forge operator dashboard access
2. `S4` — Unguarded `/billing/checkout` → tenant impersonation possible
3. `S5` — Unguarded `/auth/google/start` → OAuth CSRF / tenant hijack risk
4. `L1` — Stripe credentials not set → billing completely non-functional
5. `L2` — Blocked tenants get no SMS reply → silent failure for customer

---

## LATEST COMPLETED WORK

**Session: 2026-03-08 (commit 6ec623d)**
- Added INTERNAL_API_KEY auth guard to `/internal/enqueue-provision-number`
- Replaced "Screenshot Placeholder" text on landing pages
- Fixed dead footer links (Privacy/Terms/Support → mailto Contact)
- Full pre-launch security + credibility audit documented in AI_STATUS.md

**Session: n8n local verification (commit db0f45e)**
- All 4 n8n workflows verified SUCCESS in smoke test
- Pilot runbook created
- Google Calendar sync confirmed working (calendar_synced=true)

---

## OPS DASHBOARD FILES

- `/ops/PROJECT_BOARD.md` — canonical task board
- `/ops/board-data.json` — machine-readable board state
- `/ops/board-view.html` — visual local browser dashboard

**Note:** These files are internal only. NOT deployed. NOT in public/. NOT referenced by any app route.
