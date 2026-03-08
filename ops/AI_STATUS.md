# AI_STATUS — AutoShop SMS AI
## Technical State Log (ops-internal)

Last Updated: 2026-03-08 (paid-launch pass — 9 code fixes + 1 critical new finding)
Branch: ai/paid-launch-pass

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
Stripe Checkout (POST /billing/checkout)
  → Stripe Checkout Session (with area_code in metadata)
  → Customer pays
  → checkout.session.completed webhook → provision-number queue → n8n WF-007
  → customer.subscription.created webhook → tenant billing_status = active
```

**Provisioning flow:**
```
checkout.session.completed → /webhooks/stripe → provisionNumberQueue [provision-twilio-number]
  → n8n WF-007 → buy Twilio number → save to tenant_phone_numbers
```

---

## DETECTED APPS / SERVICES / ROUTES

### apps/api/ (Fastify, TypeScript)
- `POST /webhooks/twilio/sms` — inbound SMS (BullMQ enqueue)
- `POST /webhooks/twilio/voice-status` — missed call trigger (BullMQ enqueue)
- `POST /webhooks/stripe` — billing events (signature-verified, idempotent)
- `GET /auth/google/start` — Google OAuth initiation (tenantId param, NO ownership check — S4 BLOCKED)
- `GET /auth/google/callback` — Google OAuth callback
- `POST /billing/checkout` — Stripe checkout session (NO auth guard — S4 BLOCKED)
- `POST /internal/enqueue-provision-number` — provision phone (INTERNAL_API_KEY protected ✓)
- `GET /health` — health check

### apps/web/ (Static HTML)
- `index.html` — public landing page (Privacy/Terms footer links wired ✓)
- `autoshop-landing.html` — alternate landing page
- `login.html` — demo login (localStorage auth, NO real backend session — S1 BLOCKED)
- `app.html` — operator dashboard (localStorage auth check only, no backend verification — S1 BLOCKED)
- `demo.html` — demo dashboard (clearly labeled simulated data)
- `privacy.html` — Privacy Policy page ✓ NEW
- `terms.html` — Terms of Service page ✓ NEW

### infra/
- `docker-compose.yml` — Postgres, Redis, n8n, n8n_worker, API containers
- n8n at port 5678, API at port 3000
- N8N_ENCRYPTION_KEY now required (`:?` syntax — fails loudly if not set) ✓

---

## DEPLOYMENT SETUP SUMMARY

- **API:** Dockerized (Fastify, port 3000), non-root user in prod (`USER node`) ✓
- **Frontend:** Static HTML files in `apps/web/` — NOT in Next.js
- **n8n:** Self-hosted in Docker at port 5678
- **Postgres:** Docker container (port 5432), RLS enforced
- **Redis:** Docker container (port 6379), BullMQ
- **CORS:** @fastify/cors registered; restricts to CORS_ORIGINS env var (no wildcard) ✓
- **`.env` is gitignored** — real secrets not committed

---

## AUTH SUMMARY

- **API:** No JWT/session auth. Only webhook signature validation (Twilio + Stripe) and INTERNAL_API_KEY.
- **Frontend:** localStorage-based demo auth. No real backend session. Forgeable by any user. ← S1 BLOCKER
- **n8n:** Basic auth (admin:admin default in docker compose)
- **Google OAuth:** Implemented at API level. State token encrypted AES-256-GCM. No tenantId ownership check. ← S5 BLOCKED on S1.

---

## SECURITY STATUS (post paid-launch pass)

### FIXED ✓
- S2: Tenant RLS SET LOCAL parameterized (`set_config($1, true)`)
- S6: N8N_ENCRYPTION_KEY hardcoded fallback removed (`:?` syntax — fails loudly)
- L5: CORS added via @fastify/cors — CORS_ORIGINS env var allowlist
- L6: Dockerfile prod stage runs as non-root (`USER node`)
- D1: INTERNAL_API_KEY auth guard on provision endpoint
- T4: Stripe price ID silent fallback fixed — throws on unknown price

### REMAINING HIGH RISK
1. **S1 — localStorage demo auth** — `apps/web/login.html` + `app.html` — any user can forge operator dashboard access. No backend session. BLOCKED: requires full auth system implementation.
2. **S3 — n8n SQL template injection** — `{{ }}` template syntax in n8n workflow SQL nodes. SMS body content can contain SQL payloads if not properly parameterized. Requires n8n workflow database updates.
3. **S4 — Unguarded `/billing/checkout`** — BLOCKED on S1 (no session to validate tenantId ownership)
4. **S5 — Unguarded `/auth/google/start`** — BLOCKED on S1 (no session to validate tenantId ownership)

### MEDIUM RISK (documented, not exploitable without access)
5. n8n basic auth is `admin:admin_secret` default — must be overridden in production .env
6. SKIP_TWILIO_VALIDATION must be false in production — not enforced by code

---

## BILLING STATUS (post paid-launch pass)

### Fixed
- `checkout.session.completed` handler added — now triggers Twilio provisioning on payment ✓
- Silent plan fallback removed — unknown Stripe price ID throws instead of defaulting ✓
- `areaCode` added to checkout session metadata — flows through to provisioning ✓
- Subscription deletion now enqueues `suspend-twilio-number` job ✓
- Chargeback disputes now enqueue `admin-alert-dispute` job (visible in queue) ✓

### Still broken (requires real credentials)
- All Stripe env vars are REPLACE_ME placeholders — billing completely non-functional
- Must register `checkout.session.completed` in Stripe dashboard webhook event subscriptions

---

## TWILIO STATUS

### Code-level
- Signature validation middleware: DONE ✓ (SKIP_TWILIO_VALIDATION=true for dev only)
- Blocked tenant SMS reply: DONE ✓ (enqueues `service-unavailable-reply` job)
- Number suspension on cancel: DONE ✓ (enqueues `suspend-twilio-number` job)

### n8n workflow gaps (M9, M10)
- WF-001 does not yet handle `service-unavailable-reply` job type — SMS won't be sent until WF-001 is updated
- WF-007 does not yet handle `suspend-twilio-number` job type — suspension won't execute until WF-007 is updated

### Manual setup required
- Upgrade to Twilio production account (test mode: 50 SMS/day limit)
- Set SKIP_TWILIO_VALIDATION=false in production

---

## LEGAL / TRUST STATUS

- Privacy Policy page: `apps/web/privacy.html` — DONE ✓
- Terms of Service page: `apps/web/terms.html` — DONE ✓
- Footer links in index.html: Privacy Policy + Terms of Service + Contact ✓
- Footer links in login.html: Privacy Policy + Terms of Service + Contact ✓

---

## LAUNCH READINESS OBSERVATIONS

### What IS working (verified 2026-03-08)
- Full SMS → AI → appointment → calendar E2E flow (smoke test exec IDs 243-246)
- BullMQ queue-backed SMS ingest
- n8n WF-001 → WF-002 → WF-004 → WF-003 all SUCCESS
- Postgres RLS enforcing tenant isolation
- Twilio signature validation (dev bypass in place)
- Stripe checkout session creation (code ready, real keys needed)
- Privacy + Terms pages created
- CORS configured
- Dockerfile runs as non-root

### What is NOT working / NOT configured
- Billing: all Stripe env vars are REPLACE_ME — no real billing
- Auth: localStorage-only — dashboard is not real-auth-protected
- Twilio: test mode (50/day limit) — needs production account
- n8n WF-001: does not handle `service-unavailable-reply` job type
- n8n WF-007: does not handle `suspend-twilio-number` job type
- Google Calendar UI: no frontend entry point for tenants to connect

### Verdict
**DEMO-READY** for pilot demos.
**NOT PRODUCTION-READY** for paid customers:
- S1 (auth), S3 (n8n SQL), L1 (Stripe keys) are the last major blockers.

---

## CURRENT HIGHEST-PRIORITY ITEMS

1. `S1` — Real auth system (P0 — dashboard is demo-grade, not paid-launch-grade)
2. `S3` — n8n SQL parameterization (P0 — SQL injection risk from SMS content)
3. `L1` — Real Stripe credentials (P1 — BLOCKED: Mantas)
4. `M3` — Add `checkout.session.completed` to Stripe webhook subscriptions (P1 — manual, Mantas)
5. `M9` — Update n8n WF-001 to handle `service-unavailable-reply` job type (P1 — Claude/Mantas)

---

## LATEST COMPLETED WORK

**Session: 2026-03-08 — Paid-launch pass (branch: ai/paid-launch-pass)**

Files changed:
- `infra/docker-compose.yml` — S6: removed hardcoded N8N_ENCRYPTION_KEY fallback (both n8n and n8n_worker)
- `apps/api/Dockerfile` — L6: added `USER node` to prod stage
- `apps/api/package.json` — L5: added @fastify/cors dependency
- `apps/api/src/index.ts` — L5: registered @fastify/cors with CORS_ORIGINS allowlist
- `apps/api/src/routes/webhooks/stripe.ts` — T4: fixed silent plan fallback; B1: added checkout.session.completed handler; L3: added suspension job; L4: added dispute alert job
- `apps/api/src/routes/webhooks/twilio-sms.ts` — L2: enqueues service-unavailable-reply job for blocked tenants
- `apps/api/src/routes/billing/checkout.ts` — added areaCode to checkout body + session metadata
- `apps/web/privacy.html` — T1: Privacy Policy page (new file)
- `apps/web/terms.html` — T1: Terms of Service page (new file)
- `apps/web/index.html` — T1: Privacy + Terms footer links added
- `apps/web/login.html` — T1: Privacy + Terms footer links added

Critical new finding:
- B1: `checkout.session.completed` was NOT handled in stripe.ts — Twilio provisioning was never triggered on payment. This meant new paying customers would NEVER get a phone number. FIXED.

Items completed this session: S6, L2, L3, L4, L5, L6, T1, T4, B1 (9 items)

---

## OPS DASHBOARD FILES

- `/ops/PROJECT_BOARD.md` — canonical task board
- `/ops/board-data.json` — machine-readable board state
- `/ops/board-view.html` — visual local browser dashboard

**Note:** These files are internal only. NOT deployed. NOT in public/. NOT referenced by any app route.
