# AutoShop SMS AI — Production SaaS

> Multi-tenant B2B SaaS for Texas auto repair shops.
> Missed call → instant SMS (5–20s) → AI conversation → appointment booked → Google Calendar updated.

---

## Assumptions

1. **Auth**: Clerk is used for multi-tenant auth. Each shop is a Clerk Organization.
2. **Timezone**: All DB timestamps are UTC. Display converts to `America/Chicago` (or `America/Denver` for El Paso shops, stored per-tenant).
3. **Conversation counting**: Incremented atomically in Postgres via stored procedure. Never in application code or n8n without a transaction.
4. **Billing state source of truth**: `tenants.billing_state` column. Never call Stripe API in the SMS hot path.
5. **AI hot path**: OpenAI calls happen in BullMQ workers (`services/worker`), not in n8n. n8n is for auxiliary workflows (emails, reports).
6. **Twilio number**: One dedicated number per tenant. Provisioned on Step 2 of onboarding.
7. **Token encryption**: Google OAuth tokens encrypted with AES-256-CBC using `ENCRYPTION_KEY`. Use a proper KMS (AWS KMS, GCP KMS) in production.
8. **Port assignments**: API=3001, Web=3000, n8n=5678, Postgres=5432, Redis=6379.
9. **Past-due grace**: 7 days from `invoice.payment_failed` before transitioning to `suspended`. This is a business decision — change in `cronWorker.ts`.
10. **Max AI turns**: 12 per conversation (default). Configurable per tenant in `tenants.max_ai_turns`.

---

## Local Development

### Prerequisites
- Node.js 20+
- Docker + Docker Compose
- npm 10+

### 1. Clone and install
```bash
git clone <repo>
cd autoshop-sms-ai
npm install
```

### 2. Environment
```bash
cp .env.example .env
# Fill in: Clerk keys, Twilio, Stripe, OpenAI, Google OAuth, ENCRYPTION_KEY
# ENCRYPTION_KEY must be a 64-char hex string (32 bytes):
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Start infrastructure
```bash
docker compose -f docker/docker-compose.yml up postgres redis -d
```

### 4. Run migrations
```bash
npm run db:migrate
```

### 5. Seed dev tenant
```bash
npm run db:seed
```

### 6. Start services
```bash
# Terminal 1: API
cd services/api && npm run dev

# Terminal 2: Worker
cd services/worker && npm run dev

# Terminal 3: Web
cd apps/web && npm run dev
```

Web: http://localhost:3000
API: http://localhost:3001
n8n: http://localhost:5678 (if running n8n via Docker)

---

## Production Deployment (Railway / Fly.io)

```bash
# API
cd services/api && railway up

# Worker
cd services/worker && railway up

# Web
cd apps/web && railway up
```

Set all env vars in Railway dashboard. Use Railway's managed Postgres and Redis.

---

## Twilio Webhook URLs

After deploying, configure these in Twilio or let onboarding auto-configure:

| Type | URL |
|------|-----|
| Inbound SMS | `https://api.yourdomain.com/webhooks/twilio/sms` |
| Missed Call | `https://api.yourdomain.com/webhooks/twilio/call` |

These are set automatically when provisioning a number via the onboarding API.
If you need to update them manually:
```bash
twilio phone-numbers:update <SID> \
  --sms-url https://api.yourdomain.com/webhooks/twilio/sms \
  --voice-url https://api.yourdomain.com/webhooks/twilio/call
```

---

## Stripe Webhook Setup

1. In Stripe Dashboard → Webhooks → Add endpoint
2. URL: `https://api.yourdomain.com/webhooks/stripe`
3. Events to listen for:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
4. Copy the webhook signing secret → `STRIPE_WEBHOOK_SECRET`

---

## Clerk Configuration

1. Create a Clerk application at https://clerk.com
2. Enable **Organizations** in Clerk dashboard
3. Copy Publishable Key → `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
4. Copy Secret Key → `CLERK_SECRET_KEY`
5. In Clerk → Webhooks, add endpoint: `https://api.yourdomain.com/webhooks/clerk`
   (optional — for user lifecycle events)
6. Configure OAuth redirect: `https://yourdomain.com/sign-in/sso-callback`

After sign-up, Clerk creates an Organization. The API extracts `org_id` from the JWT
and looks up `tenant_id` from `tenants.clerk_org_id`.

---

## Google OAuth Setup

1. Google Cloud Console → New Project
2. Enable Google Calendar API
3. OAuth 2.0 → Create credentials → Web application
4. Authorized redirect URI: `https://api.yourdomain.com/api/onboarding/google/callback`
5. Copy Client ID → `GOOGLE_CLIENT_ID`
6. Copy Client Secret → `GOOGLE_CLIENT_SECRET`

**Important**: For production, submit for Google OAuth verification if you'll have
>100 users. The verification process takes 1–2 weeks.

---

## n8n Queue Mode Setup

```bash
# Start n8n with Docker Compose
docker compose -f docker/docker-compose.yml up n8n-main n8n-worker -d

# Access n8n at http://localhost:5678
# Login with N8N_BASIC_AUTH_USER / N8N_BASIC_AUTH_PASSWORD from .env
```

See `/n8n/workflow-notes.md` for credential setup and workflow import steps.

---

## Architecture Quick Reference

```
Customer Phone
    │
    ▼ (missed call or SMS)
Twilio
    │ POST /webhooks/twilio/{sms|call}
    ▼
Fastify API
    │ 1. Validate X-Twilio-Signature
    │ 2. Idempotency check (Redis + webhook_events table)
    │ 3. Tenant lookup by Twilio number
    │ 4. Enqueue BullMQ job
    ▼
Redis/BullMQ Queue (ai_process)
    │
    ▼
BullMQ Worker
    │ 1. open_conversation() — atomic Postgres transaction
    │ 2. Check billing_state from DB (never Stripe API)
    │ 3. OpenAI GPT-4o-mini/GPT-4o conversation
    │ 4. Send SMS reply via Twilio
    │ 5. If booking: INSERT appointment → enqueue calendar_sync
    ▼
Google Calendar API (via calendar_sync queue)
```

---

## Definition of Done — First Paying Customer

- [ ] 1. Missed call → SMS sent within 20 seconds (end-to-end test with real phone)
- [ ] 2. AI books appointment via SMS conversation (5+ turns, full dialogue)
- [ ] 3. Appointment appears in Google Calendar within 30 seconds of booking
- [ ] 4. X-Twilio-Signature validation rejects invalid requests (HTTP 403)
- [ ] 5. Duplicate Twilio webhook (same MessageSid) → only 1 conversation opened
- [ ] 6. Trial expires at 50 conversations → 51st is hard blocked
- [ ] 7. Trial expires at 14 days → new conversations hard blocked
- [ ] 8. Stripe `invoice.payment_failed` → billing_state=past_due (NOT blocked)
- [ ] 9. Stripe `customer.subscription.deleted` → billing_state=canceled (hard blocked)
- [ ] 10. 80% usage warning email sent (or logged) at correct threshold
- [ ] 11. Dashboard KPI counts match database counts exactly
- [ ] 12. Tenant A cannot access Tenant B's conversations via any API endpoint
- [ ] 13. Google Calendar 401 → sync_status=failed → visible in dashboard Settings
- [ ] 14. Stripe payment collected. Subscription active in both Stripe and DB.
- [ ] 15. Onboarding wizard completes in under 10 minutes for non-technical user
- [ ] 16. Circuit breaker: phone sending >20 messages/10min is quarantined

---

## Key Files

| File | Purpose |
|------|---------|
| `db/migrations/001_init.sql` | All tables, indexes, constraints |
| `db/migrations/002_rls.sql` | Row-level security policies |
| `db/migrations/003_procedures.sql` | `open_conversation()` atomic stored procedure |
| `services/api/src/routes/webhooks/twilio-sms.ts` | SMS webhook + idempotency |
| `services/api/src/routes/webhooks/stripe.ts` | Stripe billing state machine |
| `services/worker/src/queues/aiWorker.ts` | AI conversation engine |
| `services/worker/src/queues/calendarWorker.ts` | Google Calendar sync |
| `services/worker/src/cron/cronWorker.ts` | Trial expiry + inactive conversation close |
| `apps/web/app/onboarding/page.tsx` | 4-step onboarding wizard |
| `apps/web/app/dashboard/DashboardClient.tsx` | Main dashboard with live data |

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Backend | Node.js + Fastify 4 + TypeScript |
| Database | PostgreSQL 15 with RLS |
| Cache/Queue | Redis 7 + BullMQ 5 |
| Auth | Clerk (Organizations = tenants) |
| Billing | Stripe Billing + Webhooks |
| SMS/Voice | Twilio Programmable Messaging + Voice |
| AI | OpenAI GPT-4o / GPT-4o-mini |
| Calendar | Google Calendar API v3 + OAuth 2.0 |
| Frontend | Next.js 14 App Router |
| Workflow | n8n 1.40.0 (Queue Mode, pinned) |
| Infra | Docker Compose → Railway/Fly.io → AWS ECS |
