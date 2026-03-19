# Project Truth

Immutable project facts. Do not re-evaluate unless explicitly instructed.

---

## Product Identity

- **Product:** AutoShop AI — AI receptionist SaaS for auto repair shops
- **Core value:** Recover missed calls and convert them into booked appointments via SMS AI
- **Target launch market:** Texas, USA

## Pricing Tiers

| Plan     | Price    | Conversations/mo |
|----------|----------|-------------------|
| Starter  | $199/mo  | 150               |
| Pro      | $299/mo  | 400               |
| Premium  | $499/mo  | 1,000             |

## Frontend Architecture

- The AutoShop admin UI is a **static single-page application**
- **Canonical dashboard file:** `apps/web/app.html` (served via `/app/:view` Vercel rewrites)
- **Dashboard routes:** `/app/dashboard`, `/app/conversations`, `/app/appointments`, `/app/customers`, `/app/analytics`, `/app/billing`, `/app/settings`
- **Auth routes:** `/login`, `/signup`, `/onboarding/business`
- The dashboard must **NOT** be rewritten into React, Vite, or any SPA framework
- All UI improvements happen inside `apps/web/app.html`

## Source of Truth

- **GitHub repository** is the canonical source of truth for all code and configuration
- **n8n** is a workflow runtime only — it is NOT the source of truth
- **`project-brain/project_status_v2.json`** is the single source of truth for project status
- **`project-brain/project_status.md`** is a human-readable mirror only

## Deployment Architecture

```
GitHub main
  → Render build
    → Docker container
      → Fastify API (runtime)
        → Runtime JSON config
          → Admin dashboard (apps/web/app.html → served at /app/:view)
```

- n8n workflows deploy via GitHub Actions (`n8n-deploy.yml`) on push to `main`
- Infrastructure: Docker Compose for local dev (`infra/docker-compose.yml`)

## Core Flow (Protected)

```
Missed call / Inbound SMS
  → Twilio webhook
  → Fastify API (validate + enqueue)
  → BullMQ queue (sms-inbound)
  → n8n worker (tenant lookup, message save)
  → n8n worker (OpenAI gpt-4o-mini → booking detection → SMS reply)
  → n8n worker (calendar sync → confirmation SMS)
```

This is the revenue-generating pipeline. All work must protect or improve it.
