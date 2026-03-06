# CLAUDE.md

## Operating rules (must follow)

1) Work ONLY on a new branch: ai/<task-name>
2) Do NOT refactor unrelated code
3) Minimal patch only
4) Always run:

docker compose -f infra/docker-compose.yml build api
docker compose -f infra/docker-compose.yml up -d

5) Output must include:
- files changed
- git diff
- commands executed
- docker build result

6) Never invent secrets or API keys

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from `apps/api/`:

```bash
npm run dev          # Start API with hot reload (tsx watch)
npm run build        # Compile TypeScript → dist/
npm run typecheck    # Type-check without emitting
npm run lint         # ESLint on src/
npm run test         # Run all tests (vitest)
npm run db:migrate   # Run DB migrations
```

Run a single test file:
```bash
npx vitest run src/tests/tenants.test.ts
```

Start the full local stack (Postgres, Redis, n8n, n8n_worker, API):
```bash
cd infra && docker compose up
```

## Architecture

**Flow:** Twilio (missed call / SMS) → Fastify API → BullMQ queue → n8n worker → OpenAI → Twilio SMS reply → Google Calendar

The API (`apps/api/`) is purely an ingress and enqueue layer — it does no AI processing itself. All heavy work (AI, SMS sending, calendar sync, Twilio provisioning) runs asynchronously in n8n workflows that consume BullMQ queues.

**Key architectural rules:**
- Every Twilio webhook must respond with `<Response/>` TwiML within ~15s or Twilio retries. The API always returns 200 immediately and enqueues a job.
- All tenant-scoped DB queries must use `withTenant(tenantId, fn)` from `db/client.ts`, which sets `app.current_tenant_id` for Postgres RLS enforcement. Never bypass this for tenant data.
- All webhook endpoints (Twilio SMS, voice-status) go through the `validateTwilioSignature` preHandler. This can be bypassed in dev via `SKIP_TWILIO_VALIDATION=true` but must be `false` in staging/production.
- Idempotency is enforced at every entry point using `checkIdempotency` / `markIdempotency` (Redis, 24h TTL) keyed on `MessageSid` / `CallSid` / Stripe `event.id`.

**Multi-tenancy:** Each tenant has a dedicated Twilio phone number. Inbound webhooks arrive at `To` (the shop's number), which is used to look up the tenant via `tenant_phone_numbers`. Tenant data isolation is enforced via Postgres RLS (migrations `002_rls.sql`, `003_functions.sql`).

**Billing state machine** (`db/tenants.ts` + `routes/webhooks/stripe.ts`):
- Trial: hard block at 50 conversations or 14 days
- Paid (starter/pro/premium): soft limit only — AI sends upgrade nudge, never drops silently
- `past_due` → 3-day grace period → `past_due_blocked` if unpaid
- Stripe price IDs map to plan slugs via env vars `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_PREMIUM`

**BullMQ queues** (defined in `queues/redis.ts`):
- `sms-inbound` — inbound SMS and missed-call triggers (consumed by n8n WF-001/WF-002)
- `provision-number` — async Twilio number provisioning (n8n WF-007)
- `billing-events` — grace period checks
- `calendar-sync` — Google Calendar sync jobs

**n8n workflows** (import via n8n UI from `n8n/workflows/`):
- `twilio-sms-ingest.json` (WF-001): SMS → tenant lookup → set RLS context → AI
- `ai-worker.json` (WF-002): OpenAI `gpt-4o-mini` → booking detection → send reply → close conversation
- `provision-number.json` (WF-007): Buy Twilio number → save to DB → welcome email

**DB schema** key tables: `tenants`, `tenant_phone_numbers`, `conversations`, `messages`, `appointments`, `tenant_calendar_tokens`, `billing_events`, `system_prompts`, `conversation_cooldowns`. Migrations auto-apply on Postgres container start (mounted to `/docker-entrypoint-initdb.d`).

## Environment Variables

Required at minimum: `DATABASE_URL`, `REDIS_URL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `OPENAI_API_KEY`. See `.env.example` for the full list.

## Autonomous execution rules

Claude should operate in execution-first mode.

Do NOT ask routine confirmation questions if the repository context is sufficient.

Claude must only ask for clarification when:
1. Secrets or credentials are required
2. A destructive database operation is required
3. Multiple architecture paths exist with major business impact

After every completed task Claude MUST:

1. Update AI_WORK.md with:
   - What was implemented
   - What files changed
   - What passed/failed
2. Suggest the next highest-value task for the repository.

Claude should always prefer:
- small patches
- minimal changes
- preserving working systems

## Mandatory verification before committing

Before committing any code Claude MUST run:

```bash
bash scripts/ai-verify.sh
```

If verification fails Claude must fix the problem before pushing.

## Autonomous AI Workflow

Claude must follow this workflow:

1. Read AI_TASKS.md
2. Select the first OPEN task
3. Create branch ai/<task-name>
4. Implement the smallest safe patch
5. Run verification:

```bash
bash scripts/ai-verify.sh
```

6. Commit changes
7. Push branch
8. Open PR
9. Mark the task DONE in AI_TASKS.md