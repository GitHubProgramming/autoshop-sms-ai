# System Map

High-level architecture overview of AutoShop AI.

---

## API Layer

- **Location:** `apps/api/`
- **Framework:** Node.js + TypeScript (Fastify)
- **Role:** Ingress layer — receives webhooks, validates, enqueues to BullMQ
- **Entry point:** `apps/api/src/index.ts`

### Route Groups

| Path | Files | Purpose |
|------|-------|---------|
| `/webhooks/` | `twilio-sms.ts`, `twilio-voice.ts`, `twilio-voice-status.ts`, `stripe.ts` | Inbound webhooks from Twilio & Stripe |
| `/auth/` | `login.ts`, `signup.ts`, `google.ts`, `admin-bootstrap.ts` | Authentication & OAuth |
| `/billing/` | `checkout.ts`, `portal.ts` | Stripe billing checkout & portal |
| `/tenant/` | `dashboard.ts` | Tenant dashboard data API |
| `/internal/` | `admin.ts`, `appointments.ts`, `booking-intent.ts`, `calendar-event.ts`, `calendar-tokens.ts`, `config.ts`, `missed-call-sms.ts`, `process-sms.ts`, `project-status.ts`, `provision-number.ts`, `appointment-sync-proof.ts` | Internal/n8n-facing endpoints |
| `/` | `health.ts` | Health check |

## SMS Pipeline

```
Inbound SMS → Twilio webhook → /webhooks/twilio-sms
  → Signature validation → Idempotency check (Redis)
  → Enqueue to BullMQ (sms-inbound)
  → n8n worker: tenant lookup + message save
  → n8n worker: OpenAI gpt-4o-mini → booking detection → SMS reply
  → n8n worker: calendar sync → confirmation SMS
```

## Voice Pipeline

```
Inbound Call → Twilio webhook → /webhooks/twilio-voice
  → Forward to shop phone (20s timeout)
  → If missed → /webhooks/twilio-voice-status
  → Enqueue missed-call SMS trigger
```

## BullMQ Queues

| Queue | Purpose |
|-------|---------|
| `sms-inbound` | Inbound SMS and missed-call triggers |
| `provision-number` | Async Twilio number provisioning |
| `billing-events` | Grace period checks |
| `calendar-sync` | Google Calendar sync jobs |

## Database

- **PostgreSQL** with Row-Level Security (RLS) for tenant isolation
- All tenant queries go through `withTenant(tenantId, fn)`
- Migrations in `apps/api/src/db/`

## n8n Integration

- **Runtime:** n8n Cloud (async worker)
- **Environments:** TEST (sandbox), LT_Proteros (production), US_AutoShop (production)
- **Deploy:** GitHub Actions → `scripts/n8n-deploy.sh` → n8n Cloud
- **Role:** Consumes BullMQ queues, runs AI processing, sends SMS, syncs calendar

## Twilio Messaging

- Each tenant has a dedicated Twilio phone number
- Inbound SMS/voice → Twilio webhooks → Fastify API
- Outbound SMS sent by n8n workers via Twilio API
- Webhook signature validation enforced in staging/production

## Google Calendar

- OAuth2 integration per tenant
- Tenant-scoped tokens stored encrypted in DB
- Calendar sync runs via `calendar-sync` BullMQ queue
- OAuth flow: `/auth/google/url` → Google consent → `/auth/google/callback`

## Stripe Billing

- Subscription management via Stripe
- Checkout: `/billing/checkout` → Stripe Checkout Session
- Portal: `/billing/portal` → Stripe Customer Portal
- Webhooks: `/webhooks/stripe` → billing state updates

## Dashboard

- **Location:** `apps/web/app.html`
- **Type:** Static single-page application (vanilla HTML/CSS/JS)
- **Served by:** Render (Vercel headers for no-cache)
- **Auth:** JWT token-based, stored in localStorage
- **Data:** Single API call to `/tenant/dashboard`

## Deployment Pipeline

```
Developer → GitHub (main branch)
  → Render: Docker build → API container
  → GitHub Actions: n8n workflow deploy
  → Vercel/Render: Static frontend serving
```
