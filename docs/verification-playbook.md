# Production Duplicate-Protection Verification Playbook

Strict operator playbook for proving each duplicate-protection path works in production.

---

## Prerequisites

### Required Credentials

| Credential | How to Obtain | Where Used |
|------------|--------------|------------|
| Admin JWT | `POST /auth/login` with admin email/password (email must be in `ADMIN_EMAILS` env) | All verification endpoints |
| Render Dashboard | https://dashboard.render.com — service owner access | Log inspection, log drain setup |
| Production API URL | `https://autoshopsmsai.com` | API calls |

### Log Drain Setup (One-Time)

1. Open Render Dashboard → `autoshop-api` service → **Logs** tab
2. Click **Add Log Drain**
3. Choose provider (Papertrail recommended for simplicity, Datadog for dashboards)
4. Once active, all structured JSON logs are forwarded and searchable

**Structured log events to search for:**
- `webhook_duplicate_detected` — webhook replay blocked
- `booking_duplicate_blocked` — duplicate appointment creation blocked
- `sms_duplicate_blocked` — duplicate SMS send blocked

### Obtaining Admin JWT

```bash
# 1. If no admin account exists, bootstrap one (requires ADMIN_BOOTSTRAP_KEY):
curl -X POST https://autoshopsmsai.com/auth/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"email":"<admin-email>","password":"<password>","bootstrapKey":"<ADMIN_BOOTSTRAP_KEY>"}'

# 2. Login to get JWT:
TOKEN=$(curl -s -X POST https://autoshopsmsai.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<admin-email>","password":"<password>"}' | jq -r '.token')
```

---

## Proof 1: SMS Webhook Replay Blocked

**What it proves:** Sending the same `MessageSid` twice does not trigger duplicate processing.

### Evidence Source
Admin API: `GET /internal/admin/verification/webhook-events?source=twilio_sms`

### Procedure

```bash
# 1. Check current webhook events for twilio_sms
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://autoshopsmsai.com/internal/admin/verification/webhook-events?source=twilio_sms&limit=10" | jq .

# 2. Send a test replay (same MessageSid twice):
DEDUP_SID="SM_VERIFY_$(date +%s)"

curl -X POST https://autoshopsmsai.com/webhooks/twilio/sms \
  -d "MessageSid=$DEDUP_SID&From=%2B15551234567&To=%2B13257523890&Body=test"

curl -X POST https://autoshopsmsai.com/webhooks/twilio/sms \
  -d "MessageSid=$DEDUP_SID&From=%2B15551234567&To=%2B13257523890&Body=test"

# 3. Check that only ONE row exists for this event_sid:
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://autoshopsmsai.com/internal/admin/verification/webhook-events?event_sid=$DEDUP_SID" | jq .

# 4. Check logs (Render Dashboard or log drain) for:
#    event: "webhook_duplicate_detected", source: "twilio_sms", MessageSid: $DEDUP_SID
```

### Pass Condition
- `webhook_events` table contains exactly **1 row** for the test `event_sid`
- Second request returns HTTP 200 with `<Response/>` (same as first — by design)
- Log drain shows `webhook_duplicate_detected` for the second request
- **OR** Render Dashboard logs show the structured log entry

### Fail Condition
- Two rows appear for the same `event_sid` (UNIQUE constraint violation would prevent this, but check)
- No `webhook_duplicate_detected` log for the replay

---

## Proof 2: Stripe Webhook Replay Blocked

**What it proves:** Sending the same Stripe `event.id` twice does not trigger duplicate billing processing.

### Evidence Source
Admin API: `GET /internal/admin/verification/webhook-events?source=stripe`

### Procedure

```bash
# Note: Stripe webhooks require valid signature (STRIPE_WEBHOOK_SECRET).
# Use Stripe CLI for replay testing:

# 1. Install Stripe CLI and login
stripe login

# 2. Trigger a test event (creates unique event.id):
stripe trigger checkout.session.completed

# 3. Re-send the same event via Stripe Dashboard > Webhooks > Resend
# Or use stripe events resend <event_id>

# 4. Check webhook_events for stripe source:
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://autoshopsmsai.com/internal/admin/verification/webhook-events?source=stripe&limit=10" | jq .

# 5. Check logs for webhook_duplicate_detected with source: "stripe"
```

### Pass Condition
- Only **1 row** per Stripe `event.id` in `webhook_events`
- Replay log shows `webhook_duplicate_detected` for stripe source

### Fail Condition
- Multiple rows for same event ID
- No duplicate detection log on replay

---

## Proof 3: Booking Duplicate Blocked

**What it proves:** Creating two appointments for the same `conversation_id` does not create duplicate records (uses `ON CONFLICT` upsert).

### Evidence Source
Admin API: `GET /internal/admin/verification/booking-dedup`

### Procedure

```bash
# 1. List recent appointments to find a conversation_id:
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://autoshopsmsai.com/internal/admin/verification/booking-dedup?limit=10" | jq .

# 2. Check for any appointment where was_updated=true
#    (indicates ON CONFLICT triggered — the row was updated, not duplicated)

# 3. Check log drain for "booking_duplicate_blocked" events:
#    Search: event:"booking_duplicate_blocked"

# 4. Verify UNIQUE constraint exists on appointments table:
#    (already proven by migration 024 and unit tests — 548 passing)
```

### Pass Condition
- No two appointments share the same `conversation_id`
- Any `was_updated=true` appointment confirms the upsert path worked
- Log drain shows `booking_duplicate_blocked` if a real duplicate was attempted
- **OR** unit test suite confirms dedup logic (548 tests passing)

### Fail Condition
- Two appointments with identical `conversation_id`
- Upsert silently drops data without logging

---

## Proof 4: SMS Duplicate-Send Blocked

**What it proves:** The same outbound SMS is not sent twice within a 30-second window for the same conversation.

### Evidence Source
Admin API: `GET /internal/admin/verification/sms-dedup`

### Procedure

```bash
# 1. List recent messages for a known conversation:
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://autoshopsmsai.com/internal/admin/verification/sms-dedup?limit=30" | jq .

# 2. For a specific conversation, check outbound messages:
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://autoshopsmsai.com/internal/admin/verification/sms-dedup?conversation_id=<uuid>&limit=30" | jq .

# 3. Check that no two outbound messages with identical body
#    have sent_at timestamps within 30 seconds of each other

# 4. Check log drain for "sms_duplicate_blocked" events:
#    Search: event:"sms_duplicate_blocked"
```

### Pass Condition
- No identical outbound messages within 30s in the same conversation
- Log drain shows `sms_duplicate_blocked` if a real duplicate send was attempted
- **OR** timing analysis of messages table shows no sub-30s identical sends

### Fail Condition
- Two identical outbound messages within 30s for the same conversation
- `sms_duplicate_blocked` never fires despite queue retries

---

## Quick Verification Summary

Run after obtaining `$TOKEN`:

```bash
# Full duplicate evidence summary (last 24 hours):
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://autoshopsmsai.com/internal/admin/verification/duplicate-evidence?hours=24" | jq .

# Webhook events by source:
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://autoshopsmsai.com/internal/admin/verification/webhook-events?source=twilio_sms&limit=5" | jq .
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://autoshopsmsai.com/internal/admin/verification/webhook-events?source=twilio_voice&limit=5" | jq .
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://autoshopsmsai.com/internal/admin/verification/webhook-events?source=stripe&limit=5" | jq .

# Booking dedup:
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://autoshopsmsai.com/internal/admin/verification/booking-dedup?limit=10" | jq .

# SMS dedup:
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://autoshopsmsai.com/internal/admin/verification/sms-dedup?limit=10" | jq .
```

---

## Access Methods (Priority Order)

| Method | Setup Effort | Evidence Quality | Status |
|--------|-------------|-----------------|--------|
| Admin verification endpoints | Zero (deployed with API) | Direct DB evidence | **Available after deploy** |
| Render Dashboard logs | Zero | Structured log text search | **Available now** |
| Log drain (Papertrail/Datadog) | 5 min Render config | Searchable, alertable, persistent | **Requires one-time setup** |
| Production DB readonly | Render Dashboard > Database > External Access | Full SQL access | **Available via Render** |

## Render Log Drain Setup (Recommended)

1. Go to https://dashboard.render.com
2. Select `autoshop-api` service
3. Click **Logs** in sidebar
4. Click **Add Log Drain** (top right)
5. For Papertrail: enter syslog endpoint from Papertrail account
6. For Datadog: enter Datadog log intake URL with API key
7. Once active, search for structured events by `event` field

This makes all `webhook_duplicate_detected`, `booking_duplicate_blocked`, and `sms_duplicate_blocked` events permanently searchable and alertable.
