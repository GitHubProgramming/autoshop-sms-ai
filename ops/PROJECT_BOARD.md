# AUTOSHOP SMS AI — PROJECT BOARD

Project Phase: PRE-LAUNCH HARDENING
Last Updated: 2026-03-08

## Progress
- P0 tasks remaining: 5
- P1 tasks remaining: 6
- P2 tasks remaining: 5
- P3 tasks remaining: 5
- Total tasks remaining: 20
- Done tasks: 15
- Launch status: NOT READY

---

## P0 — SECURITY (CRITICAL)

| ID | Task | Status | Owner | Notes |
|----|------|--------|-------|-------|
| S1 | Replace localStorage demo auth with real backend session/JWT | TODO | Claude | `apps/web/login.html` + `app.html` — client-side auth is forgeable |
| S2 | Parameterize tenant RLS SET LOCAL query | DONE | Claude | Fixed: `set_config($1, true)` + UUID whitelist validation |
| S3 | Parameterize SQL in all n8n workflows | TODO | Claude | `n8n/workflows/*.json` — `{{ }}` template syntax in SQL, escaping incomplete |
| S4 | Add auth guard to `/billing/checkout` | TODO | Claude | Any user can create checkout session for any tenantId |
| S5 | Validate tenantId ownership on `/auth/google/start` | TODO | Claude | Any user can trigger OAuth for any tenant |
| S6 | Remove hardcoded N8N_ENCRYPTION_KEY fallback from docker-compose | TODO | Claude | `infra/docker-compose.yml` lines 77, 131 — predictable fallback |

---

## P1 — LAUNCH BLOCKERS

| ID | Task | Status | Owner | Notes |
|----|------|--------|-------|-------|
| L1 | Populate real Stripe credentials + verify billing flow works | TODO | Mantas | All Stripe keys in .env are REPLACE_ME — billing completely broken |
| L2 | Send "service unavailable" SMS to blocked tenants | TODO | Claude | `apps/api/src/routes/webhooks/twilio-sms.ts:57` — TODO comment, customer gets no reply |
| L3 | Add Twilio number suspension on subscription deletion | TODO | Claude | `apps/api/src/routes/webhooks/stripe.ts:146` — orphaned numbers stay active |
| L4 | Add admin notification channel for chargeback disputes | TODO | Claude | `apps/api/src/routes/webhooks/stripe.ts:152` — disputes are silent |
| L5 | Add CORS headers to API | TODO | Claude | `apps/api/src/index.ts` — no CORS config, browser will block cross-origin requests |
| L6 | Run API Docker container as non-root user | TODO | Claude | `apps/api/Dockerfile` — no USER directive, container runs as root |

---

## P2 — PRODUCT TRUST

| ID | Task | Status | Owner | Notes |
|----|------|--------|-------|-------|
| T1 | Add Privacy Policy and Terms of Service pages | TODO | Mantas | Legal requirement for real customers; pages don't exist |
| T2 | Add "Connect Google Calendar" UI flow for tenants | TODO | Claude | `/auth/google/start` endpoint exists but no UI button or flow |
| T3 | Add billing upgrade UI (pricing page / upgrade button) | TODO | Claude | `/billing/checkout` endpoint exists but no UI entry point |
| T4 | Fix Stripe price ID → plan slug mapping (no silent fallback) | TODO | Claude | `apps/api/src/routes/webhooks/stripe.ts:18` — defaults silently to "starter" |
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
| S2 | Parameterize tenant RLS SET LOCAL query | DONE | Claude | `set_config($1, true)` + UUID whitelist in `db/client.ts` |

---

## EXECUTION RULES

Claude must always follow this workflow:

1. Read /ops/PROJECT_BOARD.md first
2. Never invent work outside the board
3. Pick the highest-priority TODO task
4. Set it to DOING
5. Execute the work
6. Mark it DONE
7. Move completed items to DONE
8. Update progress counts
9. Update /ops/board-data.json
10. Update /ops/AI_STATUS.md

Claude must not bypass this system.
