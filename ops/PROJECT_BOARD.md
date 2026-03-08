# AUTOSHOP SMS AI — PROJECT BOARD

Project Phase: PAID-LAUNCH HARDENING
Last Updated: 2026-03-08 (paid-launch pass — 9 items fixed)

## Progress
- P0 tasks remaining: 4
- P1 tasks remaining: 1
- P2 tasks remaining: 3
- P3 tasks remaining: 5
- Total tasks remaining: 13
- Done tasks: 25
- Launch status: NOT READY

---

## P0 — SECURITY (CRITICAL)

| ID | Task | Status | Owner | Notes |
|----|------|--------|-------|-------|
| S1 | Replace localStorage demo auth with real backend session/JWT | DOING | Claude | `apps/web/login.html` + `app.html` — client-side auth is forgeable. Requires full auth system design. |
| S3 | Parameterize SQL in all n8n workflows | TODO | Claude | `n8n/workflows/*.json` — `{{ }}` template syntax in SQL, escaping incomplete. SQL injection risk from SMS body. |
| S4 | Add auth guard to `/billing/checkout` | BLOCKED | Claude | Depends on S1 — no auth system to validate tenantId ownership yet |
| S5 | Validate tenantId ownership on `/auth/google/start` | BLOCKED | Claude | Depends on S1 — no auth system to validate ownership yet |

---

## P1 — LAUNCH BLOCKERS

| ID | Task | Status | Owner | Notes |
|----|------|--------|-------|-------|
| L1 | Populate real Stripe credentials + verify billing flow works | BLOCKED | Mantas | All Stripe keys in .env are REPLACE_ME — billing completely broken. Requires real Stripe account. Also: add `checkout.session.completed` to Stripe webhook event subscriptions in dashboard. |

---

## P2 — PRODUCT TRUST

| ID | Task | Status | Owner | Notes |
|----|------|--------|-------|-------|
| T2 | Add "Connect Google Calendar" UI flow for tenants | TODO | Claude | `/auth/google/start` endpoint exists but no UI button or flow |
| T3 | Add billing upgrade UI (pricing page / upgrade button) | TODO | Claude | `/billing/checkout` endpoint exists but no UI entry point |
| T5 | Implement per-tenant rate limiting via Redis | TODO | Claude | `apps/api/src/index.ts:37` — TODO comment; global limit only |

---

## P3 — POST-LAUNCH IMPROVEMENTS

| ID | Task | Status | Owner | Notes |
|----|------|--------|-------|-------|
| I1 | Replace console.log with Fastify logger in SMS worker | TODO | Claude | `apps/api/src/workers/sms-inbound.worker.ts` — inconsistent logging |
| I2 | Remove TypeScript `any` casts in Stripe code | TODO | Claude | `billing/checkout.ts:57` + `webhooks/stripe.ts:70,128` |
| I3 | Add integration tests for Stripe webhook handler | TODO | Claude | Billing state machine untested in test suite |
| I4 | Add session expiration to localStorage auth token | TODO | Claude | `apps/web/login.html` — no expiry set, tokens never expire |
| I5 | Implement welcome email in WF-007 provision flow | TODO | Claude | n8n WF-007 referenced in docs but no email implementation |

---

## DONE

| ID | Task | Status | Owner | Notes |
|----|------|--------|-------|-------|
| D1 | Add INTERNAL_API_KEY auth guard to provision endpoint | DONE | Claude | `apps/api/src/routes/internal/provision-number.ts` — commit 6ec623d |
| D2 | Replace "Screenshot Placeholder" text on landing pages | DONE | Claude | `apps/web/index.html`, `autoshop-landing.html` — commit 6ec623d |
| D3 | Fix dead Privacy/Terms/Support footer links | DONE | Claude | All 3 pages — replaced with mailto Contact link — commit 6ec623d |
| D4 | Add Google OAuth callback endpoint | DONE | Claude | `GET /auth/google/start` + `/callback` with AES-256-GCM token encryption |
| D5 | Add Stripe checkout endpoint | DONE | Claude | `POST /billing/checkout` — creates customer + checkout session |
| D6 | Fix SMS conversation logging (inbound message persist) | DONE | Claude | WF-001 — "DB: Save Inbound Message" node added |
| D7 | Fix tenants.test.ts (vi.mock for db/client) | DONE | Claude | 9/9 tests passing |
| D8 | Add voice-status.test.ts | DONE | Claude | 6 tests covering missed-call-trigger path |
| D9 | Add Google Calendar booking confirmation (WF-004) | DONE | Claude | calendar_synced=true verified in smoke tests |
| D10 | Full local E2E smoke test — all 4 workflows passing | DONE | Claude | exec IDs 243-246, 2026-03-08 |
| D11 | BullMQ queue-backed SMS ingest | DONE | Claude | sms-inbound queue, n8n WF-001 consumer |
| D12 | Twilio signature validation middleware | DONE | Claude | SKIP_TWILIO_VALIDATION=true for dev |
| D13 | Postgres RLS multi-tenancy | DONE | Claude | withTenant() enforces RLS on all tenant queries |
| D14 | Docker smoke verification + compose path fix | DONE | Claude | scripts/ai-verify.sh |
| D15 | Tighten .vercelignore | DONE | Claude | CLAUDE.md, db/, docs/, runbooks excluded |
| S2 | Parameterize tenant RLS SET LOCAL query | DONE | Claude | `set_config($1, true)` + UUID whitelist in `db/client.ts` |
| S6 | Remove hardcoded N8N_ENCRYPTION_KEY fallback | DONE | Claude | `infra/docker-compose.yml` — both n8n and n8n_worker now require explicit env var (`:?` syntax) |
| L2 | Send "service unavailable" SMS to blocked tenants | DONE | Claude | `twilio-sms.ts` — enqueues `service-unavailable-reply` job to smsInboundQueue. n8n WF-001 must handle this job type. |
| L3 | Add Twilio number suspension on subscription deletion | DONE | Claude | `webhooks/stripe.ts` — enqueues `suspend-twilio-number` to provisionNumberQueue on subscription.deleted |
| L4 | Add admin notification for chargeback disputes | DONE | Claude | `webhooks/stripe.ts` — enqueues `admin-alert-dispute` to billingQueue on charge.dispute.created |
| L5 | Add CORS headers to API | DONE | Claude | `@fastify/cors` added — restricts to CORS_ORIGINS env var; no wildcard |
| L6 | Run API Docker container as non-root user | DONE | Claude | `apps/api/Dockerfile` prod stage — `USER node` added |
| T1 | Add Privacy Policy and Terms of Service pages | DONE | Claude | `apps/web/privacy.html` + `apps/web/terms.html` created. Footer links wired in index.html + login.html |
| T4 | Fix Stripe price ID → plan slug mapping (no silent fallback) | DONE | Claude | `webhooks/stripe.ts` — throws Error on unknown price ID instead of silently defaulting to "starter" |
| B1 | Add checkout.session.completed handler to trigger provisioning | DONE | Claude | CRITICAL NEW FINDING: provisioning was never triggered on payment. Fixed: `webhooks/stripe.ts` enqueues `provision-twilio-number` on checkout.session.completed |

---

## MANUAL SETUP REQUIRED (Cannot be fixed in code)

| ID | Requirement | Owner | Notes |
|----|-------------|-------|-------|
| M1 | Set real Stripe secret key + webhook secret in .env | Mantas | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| M2 | Set Stripe price IDs in .env | Mantas | `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_PREMIUM` |
| M3 | Add `checkout.session.completed` to Stripe webhook event subscriptions | Mantas | Stripe dashboard → Webhooks → add event type |
| M4 | Set CORS_ORIGINS in production .env | Mantas | e.g. `CORS_ORIGINS=https://autoshopsmsai.com` |
| M5 | Set N8N_ENCRYPTION_KEY in .env (min 32 chars) | Mantas | Required — docker compose now fails if not set |
| M6 | Set INTERNAL_API_KEY in production .env | Mantas | Protects `/internal/enqueue-provision-number` |
| M7 | Set SKIP_TWILIO_VALIDATION=false in production | Mantas | Must not be `true` in production |
| M8 | Set up Twilio production account and upgrade from test mode | Mantas | Test mode limits to 50 SMS/day |
| M9 | Update n8n WF-001 to handle `service-unavailable-reply` job type | Claude/Mantas | Requires n8n workflow database update |
| M10 | Update n8n WF-007 (or add new workflow) to handle `suspend-twilio-number` jobs | Claude/Mantas | Requires n8n workflow database update |
| M11 | Set real Google OAuth credentials in .env | Mantas | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` |

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
