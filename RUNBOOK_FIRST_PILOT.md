# AutoShop AI — First Pilot Runbook

## What This System Does

Missed call → instant SMS → AI conversation → appointment booked → Google Calendar updated

## Prerequisites

- Docker Desktop running
- `.env` populated (see `.env.example`)
- Google OAuth tokens in `tenant_calendar_tokens` for the pilot tenant
- Real Twilio account (not test credentials) for live SMS delivery

## Start the Full Stack

```bash
cd C:/autoshop-ai/infra
docker compose up -d
```

Wait ~20 seconds for all containers to be healthy.

Verify:
```bash
curl http://localhost:3000/health      # API
curl http://localhost:5678/healthz     # n8n
```

## Active Workflows (do not touch)

| ID | Name | Purpose |
|----|------|---------|
| `dhRnL4XBERa1Fmnm` | WF-001: Twilio SMS Ingest | BullMQ → tenant lookup → call WF-002 |
| `OfR92OEfwYdxxOb3` | WF-002: AI Worker | OpenAI → detect booking → appointment → call WF-004 |
| `wf003CloseConversation` | WF-003: Close Conversation | Mark conversation closed in DB |
| `wf004CalendarSync` | WF-004: Calendar Sync | Google token refresh → create event → update DB |

All others are inactive. Do not activate them.

## Configure Twilio Webhook

In Twilio Console → Phone Numbers → the shop's number:
- **A MESSAGE COMES IN** → Webhook → `https://YOUR_DOMAIN/webhooks/twilio/sms` → HTTP POST
- **A CALL COMES IN** → Webhook → `https://YOUR_DOMAIN/webhooks/twilio/voice` → HTTP POST

For local testing with real SMS, use ngrok:
```bash
ngrok http 3000
# Then set Twilio webhook to: https://NGROK_URL/webhooks/twilio/sms
```

## Run a Smoke Test

```bash
curl -s -X POST http://localhost:3000/webhooks/twilio/sms \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "MessageSid=SM_TEST_$(date +%s)" \
  --data-urlencode "AccountSid=YOUR_TWILIO_ACCOUNT_SID" \
  --data-urlencode "From=+15128881234" \
  --data-urlencode "To=+15125559999" \
  --data-urlencode "Body=Book oil change 2026-04-15T10:00:00-05:00"
```

Expected: `<Response/>` immediately.

## Verify Pipeline (30 seconds later)

```bash
# All 4 executions should be "success"
docker exec autoshop_postgres psql -U autoshop -d autoshop -c \
  "SELECT id, status, \"workflowId\" FROM n8n.execution_entity ORDER BY \"startedAt\" DESC LIMIT 5;"

# Appointment should exist with calendar_synced = true
docker exec autoshop_postgres psql -U autoshop -d autoshop -c \
  "SELECT customer_phone, service_type, scheduled_at, google_event_id, calendar_synced FROM public.appointments ORDER BY created_at DESC LIMIT 3;"
```

## Set Up a Pilot Tenant

```sql
-- Connect to DB
docker exec -it autoshop_postgres psql -U autoshop -d autoshop

-- Create tenant
INSERT INTO tenants (id, shop_name, owner_name, owner_email, owner_phone, billing_status, plan_id)
VALUES (
  gen_random_uuid(),
  'Pilot Shop Name',
  'Owner Name',
  'owner@email.com',
  '+1XXXXXXXXXX',
  'trial',
  'starter'
) RETURNING id;

-- Assign Twilio number to tenant
INSERT INTO tenant_phone_numbers (tenant_id, phone_number, twilio_sid)
VALUES ('<TENANT_ID>', '+1SHOPNUMBER', 'PN_PLACEHOLDER');

-- Add system prompt
INSERT INTO system_prompts (tenant_id, prompt_text, is_active)
VALUES ('<TENANT_ID>', 'You are a helpful auto shop scheduling assistant for [Shop Name]. Help customers book appointments. When they confirm a booking, say "Your appointment is confirmed" and include the date/time.', true);
```

## Google Calendar OAuth (per tenant)

```bash
# Start OAuth flow
curl http://localhost:3000/auth/google/start?tenantId=TENANT_ID

# Complete in browser, tokens auto-saved to tenant_calendar_tokens
```

## Monitor Live

```bash
# Watch n8n execution log
docker exec autoshop_postgres psql -U autoshop -d autoshop -c \
  "SELECT id, status, \"workflowId\", \"startedAt\" FROM n8n.execution_entity ORDER BY \"startedAt\" DESC LIMIT 10;"

# Watch appointments
docker exec autoshop_postgres psql -U autoshop -d autoshop -c \
  "SELECT * FROM public.appointments ORDER BY created_at DESC LIMIT 5;"

# Watch API logs
docker logs autoshop_api -f
```

## Known Limitations for Pilot

1. **Twilio test account**: 50 SMS/day limit. Use production Twilio account.
2. **Billing (Stripe)**: Not active. Demo runs on trial plan (50 conv / 14 days).
3. **SKIP_TWILIO_VALIDATION=true** must be set in `.env` for local dev. Set to `false` in production.
4. **Google Calendar tokens expire**: Refresh token is stored in DB. WF-004 auto-refreshes access tokens on each sync.

## Restart After Reboot

```bash
cd C:/autoshop-ai/infra
docker compose up -d
# Wait 20s, verify health endpoints
```

## Emergency: Reset a Stuck Conversation

```sql
UPDATE conversations SET status = 'closed', close_reason = 'manual_reset', closed_at = NOW()
WHERE customer_phone = '+1CUSTOMERNUMBER' AND status = 'open';
```
