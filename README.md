# AutoShop SMS AI

> Multi-tenant SaaS — Missed call recovery via AI-powered SMS for Texas auto repair shops.

**Missed call → SMS in 5–20s → AI books appointment → Google Calendar updated.**

---

## Quick Start (Local)

### Prerequisites
- Docker + Docker Compose
- Node.js 20+ (for local API dev without Docker)

### 1. Clone and setup

```bash
git clone https://github.com/YOUR_ORG/autoshop-sms-ai.git
cd autoshop-sms-ai

# Copy env file and add your API keys
cp .env.example .env
# Edit .env — add TWILIO_*, STRIPE_*, OPENAI_API_KEY at minimum
```

### 2. Start everything

```bash
chmod +x scripts/dev.sh
./scripts/dev.sh
```

Or manually:

```bash
cd infra
docker compose up
```

### 3. Verify

```bash
curl http://localhost:3000/health
# → {"status":"ok","checks":{"postgres":"ok","redis":"ok"}}
```

| Service | URL |
|---------|-----|
| API | http://localhost:3000 |
| n8n UI | http://localhost:5678 |
| Postgres | localhost:5432 |
| Redis | localhost:6379 |

n8n login: `admin` / `admin_secret` (from `.env`)

---

## Repo Structure

```
autoshop-sms-ai/
├── apps/
│   └── api/                    # Node.js + TypeScript + Fastify API
│       ├── src/
│       │   ├── index.ts         # Entry point
│       │   ├── db/              # Postgres client + tenant queries
│       │   ├── queues/          # Redis + BullMQ queue definitions
│       │   ├── middleware/      # Twilio signature validation
│       │   ├── routes/
│       │   │   ├── health.ts
│       │   │   ├── webhooks/    # Twilio SMS, voice status, Stripe
│       │   │   └── internal/    # Provision number (async enqueue)
│       │   └── tests/
│       ├── Dockerfile
│       ├── package.json
│       └── tsconfig.json
├── n8n/
│   ├── workflows/               # Importable n8n workflow JSONs
│   │   ├── twilio-sms-ingest.json   # WF-001: SMS → tenant lookup → AI
│   │   ├── ai-worker.json           # WF-002: OpenAI → booking detection
│   │   └── provision-number.json    # WF-007: Async Twilio provisioning
│   └── credentials.example.json
├── db/
│   ├── migrations/
│   │   ├── 001_init.sql         # All tables
│   │   ├── 002_rls.sql          # Row-Level Security policies
│   │   ├── 003_functions.sql    # Atomic conversation counter + helpers
│   │   └── 004_indexes.sql      # Performance indexes
│   └── seed/
│       └── 001_dev_seed.sql     # 1 dev tenant for local testing
├── infra/
│   └── docker-compose.yml       # Postgres, Redis, n8n, n8n_worker, API
├── scripts/
│   └── dev.sh                   # One-command local setup
├── .env.example
├── .gitignore
├── ARCHITECTURE.md              # Risk audit + full architecture
├── DATABASE_SCHEMA.md
├── BILLING_STATE_MACHINE.md
├── CONVERSATION_LIFECYCLE.md
├── TWILIO_PROVISIONING.md
├── N8N_ARCHITECTURE.md
├── ONBOARDING_FLOW.md
├── ROADMAP.md
├── SECURITY.md
└── LICENSE
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (Postgres + Redis) |
| POST | `/webhooks/twilio/sms` | Inbound SMS (Twilio → queue) |
| POST | `/webhooks/twilio/voice-status` | Missed call trigger |
| POST | `/webhooks/stripe` | Stripe billing events |
| POST | `/internal/enqueue-provision-number` | Async Twilio number provisioning |

---

## n8n Workflows

Import from `n8n/workflows/` via n8n UI (Settings → Import Workflow):

| File | Workflow | Description |
|------|----------|-------------|
| `twilio-sms-ingest.json` | WF-001 | Receive SMS → tenant lookup → set RLS context → AI |
| `ai-worker.json` | WF-002 | OpenAI → booking detection → send reply → close conversation |
| `provision-number.json` | WF-007 | Buy Twilio number → save to DB → welcome email |

---

## Plans

| Plan | Conversations/Month | Hard Block? |
|------|-------------------|-------------|
| Trial | 50 (or 14 days) | YES — on expiry |
| Starter | 150 | NO — soft limit only |
| Pro | 400 | NO — soft limit only |
| Premium | 1,000 | NO — soft limit only |
| Enterprise | Custom | NO |

**Conversation** = one complete SMS thread (closes on booking, user close signal, or 24h inactivity).

Paid plans at 100% usage: AI sends upgrade message — never drops silently.

---

## Tech Stack

- **API**: Node.js 20 + TypeScript + Fastify
- **Database**: PostgreSQL 16 + Row-Level Security
- **Queue**: Redis 7 + BullMQ
- **Automation**: n8n (queue mode, 1 main + 1 worker)
- **SMS**: Twilio (dedicated number per tenant)
- **AI**: OpenAI gpt-4o-mini
- **Billing**: Stripe Subscriptions + Webhooks

---

## Development

```bash
# Run API locally (without Docker)
cd apps/api
npm install
npm run dev

# Typecheck
npm run typecheck

# Tests
npm run test

# Lint
npm run lint
```

---

## ⚠️ Before First Launch

1. **A2P 10DLC registration** in Twilio — takes 3–7 days, nothing works without it
2. Fill all `.env` values — especially `STRIPE_WEBHOOK_SECRET` and `TWILIO_AUTH_TOKEN`
3. Run migrations against production DB
4. Set `SKIP_TWILIO_VALIDATION=false` in staging/production

See `ROADMAP.md` for Phase 1 checklist.
