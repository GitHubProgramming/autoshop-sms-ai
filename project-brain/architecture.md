# System Architecture

## System Components

### Backend (Fastify API)
- **Location:** `apps/api/`
- **Runtime:** Node.js + TypeScript (Fastify)
- **Role:** Ingress layer only — receives Twilio webhooks, validates signatures, enqueues jobs to BullMQ
- **Database:** PostgreSQL with Row-Level Security (RLS) for tenant isolation
- **Queue:** BullMQ backed by Redis
- **Key endpoints:** Twilio SMS inbound, voice-status (missed call), Stripe webhooks, Google OAuth, billing checkout

### Frontend (Web Dashboard)
- **Location:** `apps/web/`
- **Status:** Dashboard UI for shop owners (tenant management, calendar connect, billing)

### n8n (Workflow Engine)
- **Runtime:** n8n Cloud
- **Role:** Async worker — consumes BullMQ queues, runs AI processing, sends SMS replies, syncs calendar
- **Workflow structure:** organized by environment folders (US_AutoShop, LT_Proteros, TEST)

### SMS Provider
- **Twilio** — inbound/outbound SMS, phone number provisioning
- Each tenant has a dedicated Twilio phone number
- Webhook signature validation enforced on all inbound routes

### Calendar Integration
- **Google Calendar** via OAuth2
- Tenant-scoped calendar tokens stored encrypted in DB
- Calendar sync runs as a dedicated BullMQ queue (`calendar-sync`)

## Environments

| Environment | Purpose | Safety Level |
|-------------|---------|--------------|
| `TEST` | Sandbox for experimentation and development | Safe — free to modify |
| `LT_Proteros` | Lithuania Proteros production flows | Protected — no automatic changes |
| `US_AutoShop` | US AutoShop production flows | Protected — no automatic changes |

## Deployment Model

- **Source of truth:** GitHub repository
- **Runtime:** n8n Cloud executes workflows
- **Deploy pipeline:** GitHub Actions (`n8n-deploy.yml`) deploys workflows on push to `main`
- **Deploy script:** `scripts/n8n-deploy.sh` — three-tier matching (ID, name, create), duplicate detection, dry-run support
- **Branch policy:** feature branches → pull request → merge to `main` → auto-deploy
- **Infrastructure:** Docker Compose for local dev (`infra/docker-compose.yml` — Postgres, Redis, n8n, API)

## Data Flow

```
Missed Call / Inbound SMS
    → Twilio webhook
    → Fastify API (validate + enqueue)
    → BullMQ queue (sms-inbound)
    → n8n worker (WF-001: tenant lookup, message save)
    → n8n worker (WF-002: OpenAI gpt-4o-mini → booking detection → SMS reply)
    → n8n worker (WF-004: calendar sync → confirmation SMS)
```

### BullMQ Queues
| Queue | Purpose |
|-------|---------|
| `sms-inbound` | Inbound SMS and missed-call triggers |
| `provision-number` | Async Twilio number provisioning |
| `billing-events` | Grace period checks |
| `calendar-sync` | Google Calendar sync jobs |

## Safety Model

- **TEST environment** is a safe sandbox — AI agents and developers may freely create, modify, and delete TEST workflows
- **LT_Proteros and US_AutoShop** are production environments — must not be modified by automated processes
- **Webhook idempotency** enforced via Redis (24h TTL) on MessageSid/CallSid/Stripe event.id
- **Tenant isolation** enforced via Postgres RLS — all tenant queries go through `withTenant(tenantId, fn)`
- **Twilio signature validation** required in staging/production (`SKIP_TWILIO_VALIDATION=true` only in dev)
