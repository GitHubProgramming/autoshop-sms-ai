# AI STATUS

## PROJECT
AutoShop SMS AI

## PRIMARY GOAL
Demo-ready MVP for:
missed call -> SMS -> AI conversation -> appointment booking -> Google Calendar

## CURRENT STATUS
State: LOCAL STACK VERIFIED RUNNING — all containers healthy, DB schema applied, API+n8n reachable. Only live credentials block end-to-end demo.

## LAST COMPLETED STEPS (this session, latest first)
1. [2026-03-06] DEMO_SETUP.md created — branch ai/local-demo-verification
   - DEMO_SETUP.md: exact copy-paste steps, verified against repo (SQL, credential names, URLs)
   - Fixed .env.example: GOOGLE_REDIRECT_URI was /oauth/google/callback → corrected to /auth/google/callback (actual route)
   - Fixed seed SQL: tenants table requires shop_name/owner_name/owner_email NOT NULL; tenant_phone_numbers requires twilio_sid NOT NULL
   - Confirmed n8n credential names from workflow JSON: AutoShop Postgres, AutoShop OpenAI, AutoShop Twilio
   - Confirmed voice-status webhook requires From field (documented in DEMO_SETUP.md)
   - Documented Twilio validation bypass: only works with NODE_ENV=development (docker runs production — real Twilio required for demo)
2. [2026-03-06] LOCAL DEMO VERIFICATION — branch ai/local-demo-verification
   - npm ci → clean
   - npm run build (tsc) → clean, 0 errors
   - npm test → 19/19 passed (3 files: tenants, sms-inbound, voice-status)
   - docker compose build api → SUCCESS (node:20-alpine, prod image built)
   - docker compose up -d → ALL 5 containers healthy
     - autoshop_postgres: healthy (port 5432)
     - autoshop_redis: healthy (port 6379)
     - autoshop_n8n: healthy (port 5678, /healthz → {"status":"ok"})
     - autoshop_n8n_worker: up
     - autoshop_api: healthy (port 3000, /health → {"status":"ok","checks":{"postgres":"ok","redis":"ok"}})
   - DB migrations confirmed: all 9 tables present (tenants, conversations, messages, appointments, tenant_calendar_tokens, billing_events, system_prompts, tenant_phone_numbers, conversation_cooldowns)
   - Workflow JSON files confirmed in repo: WF-001 through WF-004 + WF-007
2. Fix SMS conversation logging: added "DB: Save Inbound Message" node to WF-001 (twilio-sms-ingest.json)
3. Add POST /billing/checkout (Stripe Checkout Session creation)
4. Added GET /auth/google/start + GET /auth/google/callback routes
5. Added voice-status.test.ts — 6 tests covering missed-call-trigger path
6. Fixed tenants.test.ts — vi.mock("../db/client") for pure-function tests

## WHAT HAS BEEN VERIFIED (2026-03-06)
- npm run build → CLEAN (0 TypeScript errors)
- npm test → 19/19 passed (tenants, sms-inbound, voice-status)
- docker compose build api → SUCCESS (exit 0)
- docker compose up -d → ALL HEALTHY
- GET http://localhost:3000/health → {"status":"ok","checks":{"postgres":"ok","redis":"ok"},"version":"0.1.0","env":"production"}
- GET http://localhost:5678/healthz → {"status":"ok"}
- DB: 9 tables confirmed via psql \dt
- n8n worker: running, connected to Redis queue

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
1. [BLOCKED — manual] n8n workflow import: must import WF-001 through WF-004 via n8n UI (http://localhost:5678) — exact steps in DEMO_SETUP.md Step 4
2. [BLOCKED — manual] n8n credential config: must create "AutoShop Postgres", "AutoShop OpenAI", "AutoShop Twilio" in n8n UI — exact steps in DEMO_SETUP.md Step 5
3. [BLOCKED — credentials] Google OAuth: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + redirect URI must be in .env; complete flow at http://localhost:3000/auth/google/start?tenantId=<uuid> — exact steps in DEMO_SETUP.md Step 6
4. [BLOCKED — infrastructure] Twilio webhook bypass only works with NODE_ENV=development; docker runs NODE_ENV=production; real Twilio + ngrok required for demo — see DEMO_SETUP.md Step 7
5. [NOT BLOCKING DEMO] Stripe checkout: only needed for paid plan activation, not demo flow

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

## NEXT REQUIRED ACTION (manual — credentials required)

Stack is running locally. Only credentials and n8n workflow import remain.

### Step 1 — Create .env file (copy from .env.example, fill real values)
```
cp .env.example .env
```
Required credentials to fill:
- TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID
- OPENAI_API_KEY
- GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
- GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
- STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO, STRIPE_PRICE_PREMIUM
- N8N_ENCRYPTION_KEY (any 32-char random string)
- JWT_SECRET (any 64-char random string)

### Step 2 — Restart stack with credentials
```
docker compose -f infra/docker-compose.yml up -d
```

### Step 3 — Import n8n workflows
1. Open http://localhost:5678 (login: admin / admin_secret)
2. Import each file from n8n/workflows/:
   - twilio-sms-ingest.json (WF-001)
   - ai-worker.json (WF-002)
   - close-conversation.json (WF-003)
   - calendar-sync.json (WF-004)
   - provision-number.json (WF-007)

### Step 4 — Configure n8n credentials (in n8n UI)
- postgres-creds: host=postgres, port=5432, db=autoshop, user=autoshop, password=autoshop_secret
- openai-creds: OPENAI_API_KEY value
- twilio-creds: TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN

### Step 5 — Seed a test tenant
```sql
INSERT INTO tenants (id, name, phone, plan, trial_ends_at)
VALUES (gen_random_uuid(), 'Test Shop', '+15551234567', 'trial', NOW() + INTERVAL '14 days');
INSERT INTO tenant_phone_numbers (tenant_id, phone_number)
SELECT id, '+15551234567' FROM tenants WHERE name='Test Shop';
```

### Step 6 — Connect Google Calendar (per tenant)
```
GET http://localhost:3000/auth/google/start?tenantId=<uuid>
```
Complete the OAuth flow in browser.

### Step 7 — Configure Twilio webhook
Set Twilio number voice status callback to your ngrok/public URL:
- Voice status: POST https://<your-tunnel>/webhooks/twilio/voice-status
- SMS: POST https://<your-tunnel>/webhooks/twilio/sms

### Step 8 — Test the flow
Simulate a missed call by posting to the voice-status webhook:
```bash
curl -X POST http://localhost:3000/webhooks/twilio/voice-status \
  -d "CallSid=CA_test_001&To=+15551234567&CallStatus=no-answer" \
  -H "Content-Type: application/x-www-form-urlencoded"
```
Expected: SMS sent to customer, AI conversation starts.

## INSTRUCTIONS FOR NEXT AI
1. Read AI_WORK.md, CLAUDE.md, this file
2. Run: cd apps/api && npm test → must show 19/19 pass
3. Run: cd apps/api && npm run build → must be clean
4. All code tasks are DONE. Stack runs locally without credentials (health checks pass).
5. Only remaining work: credential configuration (manual) per steps above, then live e2e test
