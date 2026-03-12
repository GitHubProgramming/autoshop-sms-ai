# CLAUDE EXECUTION RULES

## ROLE
You are the execution agent for this repository.

Your job is to move the project toward a working MVP and first paying customer with the smallest safe steps possible.

You are not here to brainstorm.
You are here to inspect, verify, fix, commit, and report with evidence.

## PRODUCT
AutoShop SMS AI

Target market:
Texas independent auto repair shops

Core promise:
Missed call -> instant SMS -> AI conversation -> appointment booked -> Google Calendar updated

## EXECUTION MODE
Autonomous.

Act with urgency, but not recklessness.
Prefer concrete progress over long planning.
Prefer repository truth over assumptions.

## WHAT TO OPTIMIZE FOR
1. working demo path
2. system reliability on core flow
3. visibility of blockers
4. speed to pilot customer
5. speed to first payment

## WHAT NOT TO DO
- do not refactor unrelated systems
- do not polish low-value surfaces before core flow works
- do not create fake "done"
- do not expand scope unless required by the core flow
- do not stop after analysis if execution is possible

## CORE TECHNICAL PRINCIPLES
- billing state should not be checked live from Stripe on every message
- webhook handling must be idempotent
- conversation counting must be atomic
- tenant isolation must remain intact
- failure states must be visible, not silent
- Google Calendar failures must surface clearly
- trial / usage logic must not break demo flow
- queue-backed reliability is preferred over fragile synchronous orchestration

## MVP PATH TO PROTECT
The only flow that matters first:

1. shop misses customer call
2. system triggers SMS to customer
3. customer replies by SMS
4. AI continues conversation
5. booking intent is detected
6. appointment is created
7. Google Calendar is updated or explicit sync failure is recorded

## WORK CYCLE
When you start a session:
1. read AI_WORK.md
2. read CLAUDE.md
3. read AI_STATUS.md
4. inspect the repo
5. choose the next highest-value blocker
6. execute the smallest safe fix
7. verify
8. update AI_STATUS.md
9. commit
10. push
11. continue

## FILE OWNERSHIP RULE
AI_STATUS.md must stay current.
After every meaningful change:
- update current status
- update blocker list
- update next recommended action
- update what was verified

## DECISION RULE
If unsure between two tasks, choose the one closer to:
missed call -> SMS -> AI -> booking -> calendar

## OUTPUT STANDARD
Every meaningful completed step must leave:
- code or repo change
- verification evidence
- updated AI_STATUS.md
- commit
- push

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

## Commands

All commands run from `apps/api/`:

```bash
npm run dev          # Start API with hot reload (tsx watch)
npm run build        # Compile TypeScript -> dist/
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

**Flow:** Twilio (missed call / SMS) -> Fastify API -> BullMQ queue -> n8n worker -> OpenAI -> Twilio SMS reply -> Google Calendar

The API (`apps/api/`) is purely an ingress and enqueue layer -- it does no AI processing itself. All heavy work (AI, SMS sending, calendar sync, Twilio provisioning) runs asynchronously in n8n workflows that consume BullMQ queues.

**Key architectural rules:**
- Every Twilio webhook must respond with `<Response/>` TwiML within ~15s or Twilio retries. The API always returns 200 immediately and enqueues a job.
- All tenant-scoped DB queries must use `withTenant(tenantId, fn)` from `db/client.ts`, which sets `app.current_tenant_id` for Postgres RLS enforcement. Never bypass this for tenant data.
- All webhook endpoints (Twilio SMS, voice-status) go through the `validateTwilioSignature` preHandler. This can be bypassed in dev via `SKIP_TWILIO_VALIDATION=true` but must be `false` in staging/production.
- Idempotency is enforced at every entry point using `checkIdempotency` / `markIdempotency` (Redis, 24h TTL) keyed on `MessageSid` / `CallSid` / Stripe `event.id`.

**Multi-tenancy:** Each tenant has a dedicated Twilio phone number. Inbound webhooks arrive at `To` (the shop's number), which is used to look up the tenant via `tenant_phone_numbers`. Tenant data isolation is enforced via Postgres RLS (migrations `002_rls.sql`, `003_functions.sql`).

**Billing state machine** (`db/tenants.ts` + `routes/webhooks/stripe.ts`):
- Trial: hard block at 50 conversations or 14 days
- Paid (starter/pro/premium): soft limit only -- AI sends upgrade nudge, never drops silently
- `past_due` -> 3-day grace period -> `past_due_blocked` if unpaid
- Stripe price IDs map to plan slugs via env vars `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_PREMIUM`

**BullMQ queues** (defined in `queues/redis.ts`):
- `sms-inbound` -- inbound SMS and missed-call triggers (consumed by n8n WF-001/WF-002)
- `provision-number` -- async Twilio number provisioning (n8n WF-007)
- `billing-events` -- grace period checks
- `calendar-sync` -- Google Calendar sync jobs

**n8n workflows** (import via n8n UI from `n8n/workflows/`):
- `twilio-sms-ingest.json` (WF-001): SMS -> tenant lookup -> set RLS context -> AI
- `ai-worker.json` (WF-002): OpenAI `gpt-4o-mini` -> booking detection -> send reply -> close conversation
- `provision-number.json` (WF-007): Buy Twilio number -> save to DB -> welcome email

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

## AI Audit Trail

Claude must leave a repository-visible audit trail after every completed task.

Required updates after each completed task:
1. Update AI_STATUS.md with:
   - task name
   - branch
   - commit hash
   - verification result
   - checks passed
   - files changed
   - date

2. Update AI_TASKS.md:
   - move completed task from OPEN to DONE

3. Use commit messages starting with:
   AI:

Do not rewrite unrelated sections.

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

## B-Lite Operating Model

This project uses the B-Lite AI development operating model.
Full details are in `project-brain/b-lite_operating_model.md`.

### Session startup (mandatory)

At the start of every session, before doing any work, read:
1. `project-brain/rules.md` — hard guardrails
2. `project-brain/b-lite_operating_model.md` — workflow and roles
3. `project-brain/project_status.md` — current project state

### Mandatory status update protocol

`project-brain/project_status.md` is the project control dashboard.
It MUST be updated after every meaningful task. A task is NOT done if `project_status.md` was not updated when reality changed.

Before finishing any task, check:
- Did progress change? → Update Stage Progress / Progress Model + recalculate Project Completion Estimate
- Did tasks move? → Update Active Tasks (todo / in progress / done)
- Did blockers appear? → Update Blocked Items (with required action, owner, affected stages)
- Did focus shift? → Update Current Focus
- Was anything changed? → Add dated entry to Recent Changes
- Is owner input needed? → Update Next Owner Decision

If any answer is yes → update `project_status.md` before finishing.
If no update is needed → explicitly state why in the response.

### Response format (end of every task)

1. Changed files
2. Whether `project_status.md` was updated
3. Exact sections updated in `project_status.md`
4. Any blockers added
5. Recommended `git add` command (must include `project-brain/project_status.md` if it changed)

### Progress discipline

- Stage percentages only advance when completion criteria objectively move
- Blocked stages stay frozen at last verified progress
- Code-complete but unverified stages are capped at 40–50%
- When uncertain, round down

### Task generation protocol

Before proposing next steps or recommending tasks:
1. Read `project-brain/project_status.json` — this is the authoritative source for project state
2. Follow `project-brain/task_generation_rules.md` — all task proposals must comply with these rules
3. Proposed tasks must cite the specific stage, blocker, or `active_tasks` item they derive from
4. Use `project-brain/next_tasks_template.md` as the output format for task recommendations

### Safety rules (B-Lite)

- Do not modify production workflows (US_AutoShop, LT_Proteros)
- Do not edit credentials, deploy scripts, or CI pipelines
- Work on feature branches only, never commit directly to main
