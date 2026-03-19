# Architecture Lock

Strict rules of what must NEVER be changed without explicit human instruction.

---

## Frontend Rules

- **Do NOT** convert the frontend to React, Vite, Next.js, or any SPA framework
- **Do NOT** introduce new frontend frameworks or build tools
- **Do NOT** move the canonical dashboard file from `apps/web/app.html`
- **Do NOT** split `app.html` into multiple page files
- All UI improvements must happen inside `apps/web/app.html`
- The dashboard is served via `/app/:view` Vercel rewrites (e.g. `/app/dashboard`, `/app/conversations`, etc.)
- Auth pages are served at `/login`, `/signup`, `/onboarding/business`

## Backend Rules

- Backend endpoints must remain compatible with the current dashboard
- Do not change the Fastify API framework
- Do not change the BullMQ queue architecture
- Do not replace PostgreSQL or Redis
- Tenant isolation via RLS must be preserved

## Architecture Rules

- **Do NOT** redesign the product architecture
- **Do NOT** replace Twilio as the SMS/voice provider
- **Do NOT** replace Google Calendar as the calendar integration
- **Do NOT** replace n8n as the workflow engine
- GitHub remains the canonical source of deployment
- n8n Cloud remains the async worker runtime

## Data Rules

- `project_status_v2.json` is the single source of truth for project status
- `project_status.md` mirrors JSON — if conflict, JSON wins
- Do not create alternative status tracking systems

## Safety Rules

- TEST environment is safe sandbox — free to modify
- LT_Proteros and US_AutoShop are production — must not be modified by automated processes
- Webhook idempotency must be preserved (Redis, 24h TTL)
- Twilio signature validation must remain enforced in staging/production
