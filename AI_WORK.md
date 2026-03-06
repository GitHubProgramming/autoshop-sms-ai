## Completed Tasks

### Fix Docker build: BullMQ + ioredis type conflict (branch: ai/fix-mvp-blockers)

**What was implemented:**
- `queues/redis.ts`: BullMQ queues use plain `connection` object (`host`/`port`/`password`) instead of a `Redis` instance. `redis` instance kept separately for idempotency helpers.
- `workers/sms-inbound.worker.ts`: Worker uses same plain `connection` object pattern.
- `routes/webhooks/stripe.ts`: Stripe event object cast to `any` to resolve `tenant_id` typing issue.

**Files changed:**
- `apps/api/src/queues/redis.ts`
- `apps/api/src/workers/sms-inbound.worker.ts`
- `apps/api/src/routes/webhooks/stripe.ts`

**Commands executed:**
```
docker compose -f infra/docker-compose.yml build api  → SUCCESS
docker compose -f infra/docker-compose.yml up -d      → All containers started (api, postgres, redis, n8n, n8n_worker)
```

**Result:** TypeScript compiles cleanly, API container starts.

---

### SMS inbound webhook smoke test (branch: ai/fix-mvp-blockers)

**What was implemented:**
End-to-end smoke test for `POST /webhooks/twilio/sms` covering the full ingress path (Twilio → Fastify → BullMQ).

Mocking strategy:
- `db/client` and `queues/redis` mocked to prevent module-level env-var guards from throwing
- `db/tenants.getTenantByPhoneNumber` mocked to return a seeded tenant
- Twilio signature validation bypassed via `NODE_ENV=development` + `SKIP_TWILIO_VALIDATION=true`
- Uses `app.inject()` — no live network or Docker required

**4 test cases:**
1. Returns HTTP 200 with `Content-Type: text/xml` and `<Response/>` body
2. Enqueues a `process-sms` job on BullMQ with correct payload and `jobId`
3. Writes idempotency key `twilio:<MessageSid>` to Redis
4. Returns 200 without enqueueing on duplicate `MessageSid` (idempotency guard)

**Files changed:**
- `apps/api/src/tests/sms-inbound.test.ts` (new)

**Commands executed:**
```
npm install                                                         → 394 packages installed
./node_modules/.bin/vitest run src/tests/sms-inbound.test.ts       → 4/4 passed (213ms)
```

**Result:** All 4 tests pass. ✓

---

## Next highest-value task

**Add smoke test for the missed-call-trigger path (voice-status webhook).**

- `POST /webhooks/twilio/voice-status` with `CallStatus=no-answer` and a tenant `To` number
- Assert: 200 response, `missed-call-trigger` job enqueued on `sms-inbound` queue
- Covers the second main ingress path (missed call → outbound SMS flow via WF-002)
- File: `apps/api/src/tests/voice-status.test.ts`
