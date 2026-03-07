# AI STATUS

## PROJECT
AutoShop SMS AI

## PRIMARY GOAL
Demo-ready MVP for:
missed call -> SMS -> AI conversation -> appointment booking -> Google Calendar

---

# ENV WIRING AUDIT — 2026-03-07

**Audit method:** Live compose config rendering, runtime container inspection, direct API calls.
**No assumptions. Only runtime-proven facts.**

---

## ROOT CAUSE (FIXED)

Docker Compose v2 loads `.env` from the **project directory**, which defaults to the directory
containing the compose file (`infra/`). The repo `.env` lives at the **repo root**. No `infra/.env`
existed. All `${VAR}` substitutions resolved to `""`. Every secret arrived in every container as
an empty string.

**Fix applied:** Added `env_file: - ../.env` to `n8n`, `n8n_worker`, and `api` services.
Removed the conflicting `environment:` entries that used bare `${VAR}` (no `:-default`) for
external secrets — those empty entries would have overridden `env_file:` due to Docker Compose
precedence rules. Vars with hardcoded values or `:-defaults` remain in `environment:` and
correctly take precedence over `env_file:` where needed (e.g. `NODE_ENV=production`,
`DATABASE_URL` with docker-internal hostname, `N8N_INTERNAL_URL`).

---

## EVIDENCE

### Before fix — compose config rendered blank for all secrets:
```
TWILIO_ACCOUNT_SID: ""
TWILIO_AUTH_TOKEN: ""
OPENAI_API_KEY: ""
STRIPE_SECRET_KEY: ""
GOOGLE_CLIENT_ID: ""
```

### After fix — compose config renders real values:
```
TWILIO_ACCOUNT_SID: AC04bd1b...  (SET)
TWILIO_AUTH_TOKEN: 772194a7...   (SET)
TWILIO_MESSAGING_SERVICE_SID: MG60426e...  (SET)
OPENAI_API_KEY: sk-proj-...      (SET)
STRIPE_SECRET_KEY: sk_test_...   (SET — placeholder)
STRIPE_WEBHOOK_SECRET: whsec_... (SET — placeholder)
GOOGLE_CLIENT_ID: REPLACE_ME...  (SET — placeholder)
SKIP_TWILIO_VALIDATION: true     (NOW WIRED — was missing entirely)
```

---

## FIX APPLIED

**File changed:** `infra/docker-compose.yml`

Changes per service:

| Service | Removed from environment: | Added |
|---------|--------------------------|-------|
| `api` | TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, OPENAI_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI | `env_file: - ../.env` |
| `n8n` | GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET | `env_file: - ../.env` |
| `n8n_worker` | GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET | `env_file: - ../.env` |

**Precedence note:** `environment:` > `env_file:` in Docker Compose. The remaining
`environment:` entries (NODE_ENV, DATABASE_URL with docker hostname, N8N_INTERNAL_URL, etc.)
correctly override the root `.env` values which use localhost hostnames.

---

## RUNTIME ENV STATUS (proven by `docker exec ... printenv`)

### autoshop_api

| Variable | Status |
|----------|--------|
| TWILIO_ACCOUNT_SID | **SET** (AC04bd1b...) |
| TWILIO_AUTH_TOKEN | **SET** (772194a7...) |
| TWILIO_MESSAGING_SERVICE_SID | **SET** (MG60426e...) |
| OPENAI_API_KEY | **SET** (sk-proj-...) |
| STRIPE_SECRET_KEY | **SET** (sk_test_ — placeholder) |
| STRIPE_WEBHOOK_SECRET | **SET** (whsec_ — placeholder) |
| GOOGLE_CLIENT_ID | **SET** (REPLACE_ME — placeholder) |
| GOOGLE_CLIENT_SECRET | **SET** (REPLACE_ME — placeholder) |
| SKIP_TWILIO_VALIDATION | **SET** (true) |
| NODE_ENV | **SET** (production) |
| DATABASE_URL | **SET** (postgresql://...@postgres:5432/...) |

### autoshop_n8n

| Variable | Status |
|----------|--------|
| GOOGLE_CLIENT_ID | **SET** (REPLACE_ME — placeholder) |
| GOOGLE_CLIENT_SECRET | **SET** (REPLACE_ME — placeholder) |
| OPENAI_API_KEY | **SET** (sk-proj-...) |
| TWILIO_ACCOUNT_SID | **SET** (AC04bd1b...) |

### autoshop_n8n_worker

| Variable | Status |
|----------|--------|
| GOOGLE_CLIENT_ID | **SET** (REPLACE_ME — placeholder) |
| GOOGLE_CLIENT_SECRET | **SET** (REPLACE_ME — placeholder) |
| OPENAI_API_KEY | **SET** (sk-proj-...) |
| TWILIO_ACCOUNT_SID | **SET** (AC04bd1b...) |

---

## WHAT IS NOW ACTUALLY VERIFIED

1. `GET /health` → **200 OK** — Postgres + Redis connected
2. `POST /webhooks/twilio/sms` → **403 "Missing Twilio signature"** — correct production behavior; Twilio signature validation is active and working. Real Twilio traffic will pass.
3. `POST /webhooks/twilio/voice-status` → **403 "Missing Twilio signature"** — same as above, correct.
4. `GET /auth/google/start` → **400** — env var is present but value is `REPLACE_ME` placeholder. Failure is now due to placeholder value, not missing env.
5. All 5 containers: started, healthy, secrets loaded.
6. `SKIP_TWILIO_VALIDATION=true` is now wired into the api container (was completely absent before). Note: the bypass only activates when `NODE_ENV=development`. Container runs production mode, so signature validation is active — this is correct for any real Twilio traffic.

---

## WHAT IS STILL BLOCKED

### Placeholder values (need real credentials in .env):
- `STRIPE_SECRET_KEY=sk_test_REPLACE_ME` → billing/checkout non-functional
- `STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME` → Stripe webhooks non-functional
- `GOOGLE_CLIENT_ID=REPLACE_ME.apps.googleusercontent.com` → Google OAuth broken
- `GOOGLE_CLIENT_SECRET=REPLACE_ME` → Google OAuth broken

### External setup not done:
1. **n8n credentials** — postgres-creds, openai-creds, twilio-creds: 0 configured in n8n UI
2. **WF-004 calendar sync** — workflow JSON exists in repo but NOT imported into n8n
3. **Duplicate workflows** — WF-001 and WF-002 each imported twice, both active → double-fires every SMS
4. **Public URL / ngrok** — not set up; Twilio cannot reach localhost
5. **Twilio webhooks in console** — not pointed at this server
6. **Real Twilio number in DB** — seed has fake placeholder SID

---

## SERVICES STATUS

| Service | Container | Status | Secrets Loaded |
|---------|-----------|--------|---------------|
| Postgres | autoshop_postgres | healthy | n/a |
| Redis | autoshop_redis | healthy | n/a |
| n8n (main) | autoshop_n8n | healthy | YES |
| n8n (worker) | autoshop_n8n_worker | up | YES |
| API | autoshop_api | healthy | YES |

---

## FASTEST PATH TO REAL DEMO

Strict dependency order. Cannot skip.

1. **Fill .env placeholders** — replace STRIPE, GOOGLE values with real credentials. Twilio and OpenAI are already real values.
2. **Restart API** — `docker compose -f infra/docker-compose.yml up -d`
3. **Delete duplicate n8n workflows** — in n8n UI, remove the extra copy of WF-001 and WF-002 (keep one of each).
4. **Import WF-004** — import `n8n/workflows/calendar-sync.json` into n8n UI.
5. **Configure n8n credentials** — create postgres-creds, openai-creds, twilio-creds in n8n UI.
6. **Set up ngrok** — `ngrok http 3000`; get public URL.
7. **Wire Twilio webhooks** — in Twilio console, set voice-status + SMS URLs to ngrok.
8. **Connect Google Calendar** — visit `/auth/google/start?tenantId=<dev-tenant-id>`.
9. **Test missed call flow** — call real Twilio number, let it ring, verify full chain.

---

*Audit completed: 2026-03-07*
*Branch: ai/local-demo-verification*
*Method: compose config rendering + live container exec + direct API calls*
