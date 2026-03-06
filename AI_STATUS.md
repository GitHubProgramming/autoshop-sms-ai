# AI STATUS

## PROJECT
AutoShop SMS AI

## PRIMARY GOAL
Demo-ready MVP for:
missed call -> SMS -> AI conversation -> appointment booking -> Google Calendar

## CURRENT STATUS
State: IN PROGRESS — core flow is structurally complete; credentials/n8n config blocks live execution

## LAST COMPLETED STEPS (this session, latest first)
1. Fix SMS conversation logging: added "DB: Save Inbound Message" node to WF-001 (twilio-sms-ingest.json) — inbound customer messages now persisted before AI call, fixing broken conversation history
2. Add POST /billing/checkout (Stripe Checkout Session creation — resolves or creates Stripe customer, returns redirect URL)
3. Added GET /auth/google/start + GET /auth/google/callback routes (AES-256-GCM token encryption, upsert to tenant_calendar_tokens)
4. Added voice-status.test.ts — 6 tests covering missed-call-trigger path (no-answer, busy, completed, idempotency, unknown tenant)
5. Fixed tenants.test.ts — added vi.mock("../db/client") so pure-function tests pass without DATABASE_URL
6. Wrote AI_WORK.md, CLAUDE.md (execution control files)

## WHAT HAS BEEN VERIFIED (this session)
- npm run typecheck → CLEAN (0 errors)
- npm test → 19/19 passed (3 test files: tenants, sms-inbound, voice-status)
- All tests pass without live DB or Redis (full mocking)

## MVP FLOW CHECKLIST
- [x] missed call trigger path confirmed (twilio-voice-status.ts + voice-status.test.ts)
- [x] outbound SMS trigger confirmed (smsInboundQueue.add "missed-call-trigger" job → n8n WF-001/WF-002)
- [x] inbound SMS conversation path confirmed (twilio-sms.ts + sms-inbound.test.ts)
- [x] booking intent detection confirmed (WF-002 ai-worker.json: booking_detected flag from GPT-4o-mini)
- [x] appointment persistence confirmed (WF-003 close-conversation.json: INSERT into appointments)
- [x] Google Calendar sync confirmed structurally (WF-004 calendar-sync.json: reads tenant_calendar_tokens, creates event)
- [x] Google OAuth token storage route added (GET /auth/google/start + /callback)
- [ ] LIVE end-to-end test not yet possible — requires real Twilio/OpenAI/Google credentials in n8n

## CURRENT TOP BLOCKER
n8n credentials not configured — workflows exist as JSON files but must be imported and configured manually in n8n UI.

Required credentials per workflow:
- postgres-creds (WF-001, WF-002, WF-003, WF-004): POSTGRES_USER / POSTGRES_PASSWORD
- openai-creds (WF-002): OPENAI_API_KEY
- twilio-creds (WF-002, WF-003): TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN
- google-calendar-creds (WF-004): per-tenant tokens via /auth/google/start flow

## BLOCKER LIST
1. [BLOCKED — manual] n8n workflow import: must import WF-001 through WF-004 via n8n UI (http://localhost:5678)
2. [BLOCKED — manual] n8n credential config: postgres-creds, openai-creds, twilio-creds must be set in n8n UI
3. [BLOCKED — credentials] Google OAuth: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET must be in .env; shop owner must complete OAuth flow at /auth/google/start?tenantId=<uuid>
4. [TODO] Stripe checkout endpoint not yet implemented (needed for paid plan activation)
5. [TODO] No rate limiting on /auth/google routes (low risk for MVP)

## REPO STATE AUDIT (2026-03-06)
### API (apps/api/src/)
- index.ts: Fastify server, registers all routes + starts BullMQ worker
- routes/webhooks/twilio-sms.ts: POST /webhooks/twilio/sms — idempotent, enqueues process-sms
- routes/webhooks/twilio-voice-status.ts: POST /webhooks/twilio/voice-status — enqueues missed-call-trigger for no-answer/busy/failed
- routes/webhooks/stripe.ts: POST /webhooks/stripe — handles billing events
- routes/internal/provision-number.ts: POST /internal/enqueue-provision-number — async Twilio number provisioning
- routes/auth/google.ts: GET /auth/google/start + /callback — Google Calendar OAuth (NEW)
- queues/redis.ts: BullMQ queues (sms-inbound, provision-number, billing-events, calendar-sync)
- workers/sms-inbound.worker.ts: forwards jobs to n8n webhook http://n8n:5678/webhook/sms-inbound
- db/client.ts: Postgres pool with RLS support
- db/tenants.ts: getTenantByPhoneNumber, getBlockReason, updateBillingStatus
- middleware/twilio-validate.ts: Twilio signature validation (bypassable in dev)

### n8n Workflows (n8n/workflows/)
- twilio-sms-ingest.json (WF-001): SMS webhook → tenant lookup → AI queue
- ai-worker.json (WF-002): OpenAI GPT-4o-mini → booking detection → Twilio SMS reply → close conversation
- close-conversation.json (WF-003): Creates appointment record → triggers WF-004
- calendar-sync.json (WF-004): Reads tenant_calendar_tokens → creates Google Calendar event → sends confirmation SMS
- provision-number.json (WF-007): Buys Twilio number → saves to DB → welcome email

### DB Migrations (db/migrations/)
- 001_init.sql: Full schema (tenants, conversations, messages, appointments, tenant_calendar_tokens, billing_events, system_prompts, conversation_cooldowns)
- 002_rls.sql: Row-level security policies
- 003_functions.sql: DB functions
- 004_indexes.sql: Performance indexes

### Tests
- tenants.test.ts: 9 tests — getBlockReason billing state machine
- sms-inbound.test.ts: 4 tests — POST /webhooks/twilio/sms (200, enqueue, idempotency)
- voice-status.test.ts: 6 tests — POST /webhooks/twilio/voice-status (missed-call trigger path)

## NEXT REQUIRED ACTION
All automatable code tasks are complete. Only manual/credential steps remain.

Manual steps required to go live:
1. Set .env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, OPENAI_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO, STRIPE_PRICE_PREMIUM
2. docker compose -f infra/docker-compose.yml up -d
3. Import all 5 n8n workflows from n8n/workflows/ via n8n UI (http://localhost:5678)
4. Configure n8n credentials: postgres-creds, openai-creds, twilio-creds
5. Run GET /auth/google/start?tenantId=<uuid> per tenant to connect Google Calendar

## INSTRUCTIONS FOR NEXT AI
1. Read AI_WORK.md, CLAUDE.md, this file
2. Run: cd apps/api && npm test → must show 19/19 pass
3. Run: cd apps/api && npm run typecheck → must be clean
4. All code tasks are DONE. The repo is structurally complete for demo.
5. Only remaining work: credential configuration (manual) + live e2e test once credentials are set
