# AutoShop SMS AI — Local Demo Setup

Verified against repo state on 2026-03-06.
This is a copy-paste-ready guide for a full local demo run.

---

## Prerequisites

- Docker Desktop running
- ngrok (or any tunnel) if using a real Twilio number
- A Twilio account with at least one phone number
- An OpenAI API key
- A Google Cloud project with Calendar API enabled and OAuth 2.0 credentials

---

## Step 1 — Create `.env`

```bash
cp .env.example .env
```

Open `.env` and fill every `REPLACE_ME` value. Required values listed below.
Leave defaults for DATABASE_URL, REDIS_URL, REDIS_PASSWORD, POSTGRES_* — they match docker-compose.

### Required credentials (demo will not work without these)

```
# Twilio — get from console.twilio.com
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_MESSAGING_SERVICE_SID=MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# OpenAI — get from platform.openai.com/api-keys
OPENAI_API_KEY=sk-...

# Google OAuth — get from console.cloud.google.com
# Create OAuth 2.0 Client ID → Web application
# Add authorized redirect URI: https://autoshopsmsai.com/auth/google/callback
GOOGLE_CLIENT_ID=XXXXXXXXXX.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_REDIRECT_URI=https://autoshopsmsai.com/auth/google/callback

# Stripe — test keys from dashboard.stripe.com/test/apikeys
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_PREMIUM=price_...
```

### Generate local secrets (run these in terminal, paste output into .env)

```bash
# N8N_ENCRYPTION_KEY — must be exactly 32+ characters
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"

# JWT_SECRET — 64 characters
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### n8n credentials (used for n8n web UI login, set these too)

```
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=your_n8n_password_here
```

---

## Step 2 — Start the stack

```bash
docker compose -f infra/docker-compose.yml up -d
```

### Verify all containers are healthy

```bash
docker compose -f infra/docker-compose.yml ps
```

Expected output — all STATUS must show `(healthy)` or `Up`:
```
autoshop_api          Up (healthy)   0.0.0.0:3000->3000/tcp
autoshop_n8n          Up (healthy)   0.0.0.0:5678->5678/tcp
autoshop_n8n_worker   Up
autoshop_postgres     Up (healthy)   0.0.0.0:5432->5432/tcp
autoshop_redis        Up (healthy)   0.0.0.0:6379->6379/tcp
```

### Verify API health

```bash
curl http://localhost:3000/health
```

Expected:
```json
{"status":"ok","checks":{"postgres":"ok","redis":"ok"},"version":"0.1.0","env":"production"}
```

**Failure state:** if `postgres` or `redis` shows `error`, check container logs:
```bash
docker logs autoshop_api --tail=30
docker logs autoshop_postgres --tail=20
```

---

## Step 3 — Seed a demo tenant

Connect to Postgres and run:

```bash
docker exec -it autoshop_postgres psql -U autoshop -d autoshop
```

Then paste this SQL exactly (replace phone numbers with your actual Twilio number):

```sql
-- Replace +15551234567 with your Twilio phone number (E.164 format)
-- Replace ACXXXXXXXX with any placeholder (it's a local demo)

INSERT INTO tenants (
  shop_name,
  owner_name,
  owner_email,
  billing_status,
  trial_ends_at,
  conv_limit_this_cycle
) VALUES (
  'Demo Auto Shop',
  'Demo Owner',
  'demo@demoautoshop.test',
  'trial',
  NOW() + INTERVAL '14 days',
  50
) RETURNING id;
```

Copy the returned UUID. Then run:

```sql
-- Paste the UUID from above in place of <TENANT_UUID>
INSERT INTO tenant_phone_numbers (
  tenant_id,
  twilio_sid,
  phone_number,
  status
) VALUES (
  '<TENANT_UUID>',
  'PN_DEMO_LOCAL_001',
  '+15551234567',
  'active'
);
```

Verify:
```sql
SELECT t.id, t.shop_name, tpn.phone_number
FROM tenants t
JOIN tenant_phone_numbers tpn ON tpn.tenant_id = t.id;
```

Expected: 1 row with your shop name and phone number.

**Failure state:** `duplicate key value violates unique constraint "tenant_phone_numbers_phone_number_key"` — the number is already seeded. Run the SELECT to check.

---

## Step 4 — Import n8n workflows

1. Open http://localhost:5678 in browser
2. Log in with:
   - Username: `admin` (or your `N8N_BASIC_AUTH_USER`)
   - Password: value of `N8N_BASIC_AUTH_PASSWORD` from your `.env`
3. Go to **Workflows** → **Import from file**
4. Import each file in this order:
   - `n8n/workflows/twilio-sms-ingest.json` (WF-001)
   - `n8n/workflows/ai-worker.json` (WF-002)
   - `n8n/workflows/close-conversation.json` (WF-003)
   - `n8n/workflows/calendar-sync.json` (WF-004)

**Do NOT import** `provision-number.json` (WF-007) — not needed for demo flow.

5. After importing each workflow, click **Activate** (toggle top-right).

**Failure state:** If a workflow shows an error on activate, it likely means a credential is missing — continue to Step 5.

---

## Step 5 — Configure n8n credentials

In n8n UI: **Settings** → **Credentials** → **Add Credential**

### Credential 1: AutoShop Postgres

- Type: **Postgres**
- Name: `AutoShop Postgres` (must match exactly)
- Host: `postgres`
- Port: `5432`
- Database: `autoshop`
- User: `autoshop`
- Password: `autoshop_secret`
- SSL: disabled

### Credential 2: AutoShop OpenAI

- Type: **OpenAI**
- Name: `AutoShop OpenAI` (must match exactly)
- API Key: your `OPENAI_API_KEY` value

### Credential 3: AutoShop Twilio

- Type: **Twilio API**
- Name: `AutoShop Twilio` (must match exactly)
- Account SID: your `TWILIO_ACCOUNT_SID`
- Auth Token: your `TWILIO_AUTH_TOKEN`

After creating all three, go back to each workflow and confirm credentials are linked (no red warning icons).

**Failure state:** If credential names don't match exactly (`AutoShop Postgres`, `AutoShop OpenAI`, `AutoShop Twilio`), n8n will show a "credential not found" error on execution.

---

## Step 6 — Connect Google Calendar

This step requires your `.env` to have valid `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI=https://autoshopsmsai.com/auth/google/callback`.

You also need to configure your Google Cloud project:
- Authorized redirect URI: `https://autoshopsmsai.com/auth/google/callback`

Run the OAuth flow. Replace `<TENANT_UUID>` with the UUID from Step 3:

```
Open in browser: http://localhost:3000/auth/google/start?tenantId=<TENANT_UUID>
```

You will be redirected to Google's consent screen. After approving, you will see:
```json
{"status":"connected","message":"Google Calendar successfully connected"}
```

Verify the token was saved:
```bash
docker exec -it autoshop_postgres psql -U autoshop -d autoshop -c \
  "SELECT tenant_id, calendar_id, token_expiry FROM tenant_calendar_tokens;"
```

Expected: 1 row for your tenant with `calendar_id = primary`.

**Failure state:** `{"error":"Google OAuth not configured"}` → `GOOGLE_CLIENT_ID` or `GOOGLE_REDIRECT_URI` is missing from `.env`. Restart stack after fixing.

**Failure state:** `{"error":"Google token exchange failed"}` → Google rejected the code exchange. Usually means the redirect URI in `.env` doesn't exactly match what's configured in Google Cloud Console.

---

## Step 7 — Set up ngrok tunnel (required for Twilio webhooks)

Twilio needs a public HTTPS URL to call your local API.

```bash
ngrok http 3000
```

Copy the HTTPS URL (e.g. `https://abc123.ngrok.io`).

Configure your Twilio phone number at console.twilio.com → Phone Numbers → your number:

- **Voice & Fax** → "A call comes in" → **Webhook** (HTTP POST):
  ```
  https://abc123.ngrok.io/webhooks/twilio/voice-status
  ```
- **Messaging** → "A message comes in" → **Webhook** (HTTP POST):
  ```
  https://abc123.ngrok.io/webhooks/twilio/sms
  ```

**Important:** The voice-status URL must be set under **Call Status Changes**, not "A call comes in". In Twilio console, the exact setting is under the number → Voice → "Call Status Changes" → set to your webhook URL.

---

## Step 8 — Test the full flow

### Trigger a missed call (the real way)

Call the Twilio phone number from any phone and hang up / let it ring to voicemail.
Twilio will POST to your `/webhooks/twilio/voice-status` with `CallStatus=no-answer`.

Watch the API log:
```bash
docker logs autoshop_api -f
```

Expected log lines:
```
"Missed call job enqueued"
[sms-worker] job <id> (missed-call-trigger) delivered to n8n
```

Watch n8n execution at http://localhost:5678 → Executions — WF-001 should show a successful run.

### Verify outbound SMS sent

Within ~30 seconds, the customer number should receive an SMS from the shop's Twilio number.
This confirms the full missed call → SMS trigger → AI response chain worked.

### Reply to the SMS (continue conversation)

Reply to the SMS from the customer phone. This will:
1. Twilio POSTs to `/webhooks/twilio/sms`
2. API enqueues `process-sms` job
3. Worker forwards to n8n WF-001
4. WF-002 calls OpenAI → generates reply
5. Twilio sends reply SMS back

### Trigger appointment booking

Reply to the SMS with a booking request, e.g.:
```
I need an oil change. Can I come in tomorrow?
```

The AI will propose a time. Confirm it by replying with an agreement. When AI responds with booking confirmation language (e.g. "Your appointment is confirmed for..."), WF-002 triggers WF-003.

### Verify appointment was created

```bash
docker exec -it autoshop_postgres psql -U autoshop -d autoshop -c \
  "SELECT id, customer_phone, service_type, scheduled_at, calendar_synced FROM appointments ORDER BY created_at DESC LIMIT 3;"
```

Expected: 1 row with `calendar_synced = false` (before calendar sync) or `true` (after).

### Verify Google Calendar event

After WF-003 triggers WF-004 (calendar-sync), check:
1. n8n Executions → WF-004 run result
2. Google Calendar → look for new event at the scheduled time

**Success state:** WF-004 execution shows green, calendar event visible in Google Calendar.

**Failure state (expected without Google setup):** WF-004 execution shows error "No calendar tokens for tenant" — this is the explicit sync failure state. The appointment row exists in DB, `calendar_synced = false`. This is the defined failure path, not a silent failure.

---

## Step 9 — Verify explicit failure states

These are expected behaviors, not bugs:

| Scenario | What happens |
|---|---|
| Tenant not found for phone number | API returns `<Response/>`, logs `No tenant found for phone number`, nothing enqueued |
| Trial expired (14 days past) | `getBlockReason` returns `trial_expired`, job enqueued but blocked |
| Trial limit hit (50 conversations) | `getBlockReason` returns `trial_limit_reached` |
| Google Calendar tokens missing | WF-004 logs error, appointment stays with `calendar_synced = false` |
| n8n not running | Worker retries 3x with exponential backoff (2s, 4s, 8s), then marks job failed |
| Duplicate Twilio webhook | Idempotency key in Redis blocks re-processing (24h TTL) |

---

## What cannot be automated (requires your credentials)

1. Twilio account + phone number — must have a real number to receive calls/SMS
2. OpenAI API key — n8n makes direct API calls
3. Google Cloud OAuth credentials — per-tenant calendar tokens
4. Stripe — not required for demo flow (only needed for paid plan activation)
5. ngrok tunnel URL — changes each session unless using ngrok paid/static domain
6. n8n credential UI — credential secrets must be entered through n8n web UI, not config files
