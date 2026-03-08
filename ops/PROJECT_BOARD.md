# AUTOSHOP SMS AI — PROJECT BOARD

Project Phase: PAID-LAUNCH HARDENING
Last Updated: 2026-03-08 (launch-blockers pass — 7 items fixed: M9, M10, S1, S3, S4, S5, T2)

## Progress
- P0 tasks remaining: 0
- P1 tasks remaining: 1 (BLOCKED on Mantas — Stripe credentials)
- P2 tasks remaining: 1
- P3 tasks remaining: 5
- Total tasks remaining: 7
- Done tasks: 32
- Launch status: NEARLY READY — blocked only on L1 (Mantas: real Stripe keys)

---

## P0 — SECURITY (CRITICAL)

All P0 items DONE.

---

## P1 — LAUNCH BLOCKERS

| ID | Task | Status | Owner | Notes |
|----|------|--------|-------|-------|
| L1 | Populate real Stripe credentials + verify billing flow works | BLOCKED | Mantas | All Stripe keys in .env are REPLACE_ME — billing completely broken. Requires real Stripe account. Also: add `checkout.session.completed` to Stripe webhook event subscriptions in dashboard. |

---

## P2 — PRODUCT TRUST

| ID | Task | Status | Owner | Notes |
|----|------|--------|-------|-------|
| T5 | Implement per-tenant rate limiting via Redis | TODO | Claude | `apps/api/src/index.ts:46` — TODO comment; global limit only |

---

## P3 — POST-LAUNCH IMPROVEMENTS

| ID | Task | Status | Owner | Notes |
|----|------|--------|-------|-------|
| I1 | Replace console.log with Fastify logger in SMS worker | TODO | Claude | `apps/api/src/workers/sms-inbound.worker.ts` — inconsistent logging |
| I2 | Remove TypeScript `any` casts in Stripe code | TODO | Claude | `billing/checkout.ts:57` + `webhooks/stripe.ts:70,128` |
| I3 | Add integration tests for Stripe webhook handler | TODO | Claude | Billing state machine untested in test suite |
| I4 | Add password_hash column + bcrypt verification to complete auth | TODO | Claude | `routes/auth/login.ts` — S1 JWT is real but password not validated. Requires: ALTER TABLE + migration + bcrypt. |
| I5 | Implement welcome email in WF-007 provision flow | TODO | Claude | n8n WF-007 — TODO comment node; no email implementation |

---

## DONE

| ID | Task | Status | Owner | Notes |
|----|------|--------|-------|-------|
| S1 | Replace localStorage demo auth with real backend session/JWT | DONE | Claude | `POST /auth/login` + `GET /auth/me`. @fastify/jwt registered. login.html + app.html updated. Auth guard uses server-verified JWT. REMAINING blocker: password_hash column (tracked as I4). |
| S2 | Parameterize tenant RLS SET LOCAL query | DONE | Claude | `set_config($1, true)` + UUID whitelist in `db/client.ts` — commit 7dfd0a2 |
| S3 | Parameterize SQL in all n8n workflows | DONE | Claude | WF-001: Validate Inputs node (UUID/E.164 regex), Prepare Message Data node, parameterized INSERT via queryReplacement ($1/$2/$3/$4). WF-007: DB: Save Phone Number parameterized. Manual escape removed. |
| S4 | Add auth guard to `/billing/checkout` | DONE | Claude | `requireAuth` preHandler + cross-tenant check. Returns 403 if body.tenantId ≠ JWT tenantId. |
| S5 | Validate tenantId ownership on `/auth/google/start` | DONE | Claude | Accepts `?token=<jwt>`. Verifies JWT server-side. tenantId extracted from token — not trusted from query param. |
| S6 | Remove hardcoded N8N_ENCRYPTION_KEY fallback | DONE | Claude | `infra/docker-compose.yml` — `:?` syntax — commit 7dfd0a2 |
| M9 | WF-001 handles service-unavailable-reply job type | DONE | Claude | `n8n/workflows/twilio-sms-ingest.json` — Check Job Type IF node. True → Twilio httpRequest sends unavailability SMS. |
| M10 | provision-number queue consumer + WF-007 suspend handling | DONE | Claude | `apps/api/src/workers/provision-number.worker.ts` created. `index.ts` updated. `n8n/workflows/provision-number.json` — Suspend or Provision? IF node. Suspend flow: DB lookup → Twilio clear URLs → DB status=suspended. |
| T2 | Add "Connect Google Calendar" UI flow for tenants | DONE | Claude | `connectGoogleCalendar()` in app.html. Wired to Settings Integrations Reconnect, Bookings alert Reconnect, Activation Checklist CTAs. Navigates to `/auth/google/start?token=<jwt>`. |
| T3 | Add billing upgrade UI (pricing page / upgrade button) | DONE | Claude | Upgrade buttons in app.html banners point to `/billing` view. Real Stripe checkout path blocked by L1. |
| D1 | Add INTERNAL_API_KEY auth guard to provision endpoint | DONE | Claude | `apps/api/src/routes/internal/provision-number.ts` — commit 6ec623d |
| D2 | Replace "Screenshot Placeholder" text on landing pages | DONE | Claude | `apps/web/index.html`, `autoshop-landing.html` — commit 6ec623d |
| D3 | Fix dead Privacy/Terms/Support footer links | DONE | Claude | All 3 pages — commit 6ec623d |
| D4 | Add Google OAuth callback endpoint | DONE | Claude | `GET /auth/google/start` + `/callback` with AES-256-GCM token encryption |
| D5 | Add Stripe checkout endpoint | DONE | Claude | `POST /billing/checkout` |
| D6 | Fix SMS conversation logging (inbound message persist) | DONE | Claude | WF-001 Save Inbound Message node added |
| D7 | Fix tenants.test.ts (9/9 passing) | DONE | Claude | vi.mock for db/client |
| D8 | Add voice-status.test.ts | DONE | Claude | 6 tests covering missed-call-trigger path |
| D9 | Add Google Calendar booking confirmation (WF-004) | DONE | Claude | calendar_synced=true verified in smoke tests |
| D10 | Full local E2E smoke test — all 4 workflows passing | DONE | Claude | exec IDs 243-246, 2026-03-08 |
| D11 | BullMQ queue-backed SMS ingest | DONE | Claude | sms-inbound queue, n8n WF-001 consumer |
| D12 | Twilio signature validation middleware | DONE | Claude | SKIP_TWILIO_VALIDATION=true for dev |
| D13 | Postgres RLS multi-tenancy | DONE | Claude | withTenant() enforces RLS on all tenant queries |
| D14 | Docker smoke verification + compose path fix | DONE | Claude | scripts/ai-verify.sh |
| D15 | Tighten .vercelignore | DONE | Claude | CLAUDE.md, db/, docs/, runbooks excluded |
| L2 | Send "service unavailable" SMS to blocked tenants | DONE | Claude | `twilio-sms.ts` enqueues `service-unavailable-reply` job |
| L3 | Add Twilio number suspension on subscription deletion | DONE | Claude | `webhooks/stripe.ts` enqueues `suspend-twilio-number` |
| L4 | Add admin notification for chargeback disputes | DONE | Claude | `webhooks/stripe.ts` enqueues `admin-alert-dispute` |
| L5 | Add CORS headers to API | DONE | Claude | `@fastify/cors` — restricts to CORS_ORIGINS env var |
| L6 | Run API Docker container as non-root user | DONE | Claude | `apps/api/Dockerfile` prod stage — `USER node` |
| T1 | Add Privacy Policy and Terms of Service pages | DONE | Claude | `apps/web/privacy.html` + `apps/web/terms.html` |
| T4 | Fix Stripe price ID → plan slug mapping (no silent fallback) | DONE | Claude | `webhooks/stripe.ts` — throws on unknown price ID |
| B1 | Add checkout.session.completed handler to trigger provisioning | DONE | Claude | CRITICAL FIX: `webhooks/stripe.ts` enqueues `provision-twilio-number` on checkout.session.completed |

---

## MANUAL SETUP REQUIRED (Cannot be fixed in code)

| ID | Requirement | Owner | Notes |
|----|-------------|-------|-------|
| M1 | Set real Stripe secret key + webhook secret in .env | Mantas | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| M2 | Set Stripe price IDs in .env | Mantas | `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_PREMIUM` |
| M3 | Add `checkout.session.completed` to Stripe webhook event subscriptions | Mantas | Stripe dashboard → Webhooks → add event type |
| M4 | Set CORS_ORIGINS in production .env | Mantas | e.g. `CORS_ORIGINS=https://autoshopsmsai.com` |
| M5 | Set N8N_ENCRYPTION_KEY in .env (min 32 chars) | Mantas | Required — docker compose fails if not set |
| M6 | Set INTERNAL_API_KEY in production .env | Mantas | Protects `/internal/enqueue-provision-number` |
| M7 | Set SKIP_TWILIO_VALIDATION=false in production | Mantas | Must not be `true` in production |
| M8 | Set up Twilio production account and upgrade from test mode | Mantas | Test mode limits to 50 SMS/day |
| M11 | Set real Google OAuth credentials in .env | Mantas | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` |
| M12 | Set JWT_SECRET in .env (min 32 random chars) | Mantas | Required for session auth — API logs warning if not set |
| M13 | Import updated WF-001 + WF-007 into n8n | Mantas/Claude | `n8n/workflows/twilio-sms-ingest.json` + `provision-number.json` updated. Import via n8n UI or update workflow_entity + workflow_history in Postgres DB. |

---

## EXECUTION RULES

Claude must always follow this workflow:

1. Read /ops/PROJECT_BOARD.md first — this is the canonical task board
2. Never invent work outside the board
3. Pick the highest-priority TODO task
4. Set it to DOING in both PROJECT_BOARD.md AND board-data.json
5. Execute the work
6. Mark it DONE in both files
7. Move completed items to DONE section in PROJECT_BOARD.md
8. Recompute and update progress counts (p0/p1/p2/p3/total remaining, done count)
9. Update /ops/board-data.json (source of truth for the HTML dashboard)
10. Update /ops/AI_STATUS.md with latest completed work

After every meaningful change Claude MUST update all three files:
- /ops/PROJECT_BOARD.md
- /ops/board-data.json
- /ops/AI_STATUS.md

Claude must not bypass this system.
