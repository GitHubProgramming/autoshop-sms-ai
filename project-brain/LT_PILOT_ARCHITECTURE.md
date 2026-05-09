# LT Pilot — Proteros Servisas Architecture

## Status

- **Current state:** WORKING (synthetic E2E)
  - Inbound SMS → AI conversation → booking: **WORKING** (verified Apr 14 2026 production run).
  - Missed call → SMS trigger: **WORKING via direct backend processing** (PR #516, deployed 2026-05-09 12:50 UTC). n8n decommissioned — free plan expired, workflow webhook returned 404 on every forward; backend now parses Zadarma payloads and calls `handleMissedCallSms()` inline. Synthetic NOTIFY_END POST → Twilio SID `SMd32c12aa26048ddf85b8af71915e1ab4` returned. Real-call verification still pending on user side.
- **Last verified:** 2026-05-09
- **Commit on main at audit time:** `9fd71e5`
- **Render deploy commit:** `9fd71e5a237043ccd2f6e87e0227b8b19ee71d0a` (from `/health`)

## Quick Reference

| Item | Value |
|---|---|
| LT Twilio number | `+37066806130` (see `.secrets/twilio-lt-from-number.txt`) |
| LT Twilio SID | `PN4424f5163dd2e6ab0e17b5cc1f056863` (see `.secrets/twilio-lt-phone-sid.txt`) |
| LT Twilio capabilities | `SMS=true, Voice=false, MMS=false, Fax=false` |
| LT Twilio type | `mobile` |
| LT Twilio regulatory bundle | `BU806efab58c3088139b80125918d248b5` — status `twilio-approved`, friendly name "AutoShop SMS AI" |
| LT Twilio messaging service | **None** — standalone DID (not in any MG service) |
| LT Twilio sms_url | `https://autoshop-api-7ek9.onrender.com/webhooks/twilio/sms` |
| LT Twilio voice_url | `null` (voice capability disabled) |
| Zadarma number | `+37045512300` |
| Zadarma purpose | Voice-only (missed-call detection — Twilio LT has no voice DIDs) |
| Zadarma webhook handler | `https://autoshop-api-7ek9.onrender.com/internal/zadarma-webhook` (direct — no n8n) |
| Tenant UUID | `7d82ab25-e991-4d13-b4ac-846865f8b85a` |
| Tenant slug | `lt-proteros-servisas` |
| Tenant email | `mantas.gipiskis+lt@gmail.com` |
| Tenant owner phone (Telia) | `+37067577829` |
| Tenant locale | `lt-LT` |
| Tenant currency | `EUR` |
| Tenant timezone | `Europe/Vilnius` |
| Tenant billing_status | `trial` (90-day, 500 conversation limit) |
| n8n | **DECOMMISSIONED** — free plan expired 2026-05-09; missed-call SMS is now handled inline by the backend. Workflow JSON kept in `n8n-workflows/` for reference only. |
| Backend origin | `https://autoshop-api-7ek9.onrender.com` |
| Render service ID | `srv-d6n7qavgi27c73c9ap10` |
| Render owner ID | `tea-d6n7ehvtskes73e90otg` |
| Secrets location | `.secrets/` (not committed) |

## Architecture Diagram (text)

### Missed Call → SMS Flow (direct backend, post PR #516)

```
Customer calls +37067577829 (Mantas Telia)
  → Telia GSM conditional forward (**61*+37045512300*10# — 10s no-answer)
  → +37045512300 (Zadarma LT DID)
  → Zadarma PBX Scenario #11 (5s timeout, Extension 101)
  → Voicemail or no answer → NOTIFY_END event
     (disposition observed in production: "answered" when voicemail picks up,
      "cancel" when caller hangs up first; status_code=16 for normal clearing)
  → Zadarma Notifications POST → /internal/zadarma-webhook
  → Backend persists audit row in zadarma_events
  → Backend filters: event_type === "NOTIFY_END" AND caller is external
     (NOTIFY_START / NOTIFY_INTERNAL skipped to avoid triple-fire)
  → Backend calls handleMissedCallSms() directly (same service used by US flow)
     - opens or reuses conversation (Redis SETNX + FOR UPDATE dedupe)
     - records missed_calls audit row
     - sends Twilio SMS from +37066806130 (LT mobile, isPilot=true path)
     - logs synthetic inbound + outbound messages
  → SMS lands on caller's phone
  → Customer can reply → existing inbound-SMS → AI flow takes over
```

The proxy never touches n8n. `ZADARMA_WEBHOOK_SECRET` and
`N8N_LT_ZADARMA_WEBHOOK_URL` are still in Render env config but are no
longer read by code (cleanup deferred to a follow-up env-var PR).

### Inbound SMS → AI Conversation Flow (WORKING)

```
Customer sends SMS to +37066806130 (Twilio LT)
  → Twilio POST /webhooks/twilio/sms (HMAC signature validated)
  → getTenantByPhoneNumber(+37066806130) resolves LT tenant 7d82ab25
  → BullMQ queue (sms-inbound) → sms-inbound.worker.ts
  → POST /internal/process-sms (isPilot=true, pilotFrom=+37066806130)
  → Fetch conversation history (last 8 messages)
  → Load system_prompts v2 (LT, ~1700 chars, migration 044)
  → OpenAI gpt-4o-mini (300 tokens, temp 0.3)
  → detectBookingIntent() with LT patterns (PR #507; "numeris" handling in PR #510)
  → If booking detected:
       createAppointment() → DB row
       createCalendarEvent() → fails (no Google tokens for LT tenant)
       PR #508 LT fallback: "Ačiū! Gavome jūsų vizito užklausą…"
  → sendTwilioSms(customerPhone, response, fetch, pilotFrom)
  → Log outbound message to DB
  → Dashboard surfaces conversation in real time
```

## Components Status Table

| Component | Status | Evidence |
|---|---|---|
| Twilio LT number active & regulator-approved | WORKING | `IncomingPhoneNumbers/PN44…` → `status: in-use`, bundle `twilio-approved` |
| Twilio inbound SMS webhook configured | WORKING | `sms_url` set to `/webhooks/twilio/sms` |
| Twilio outbound SMS send | WORKING | Live probe of `/internal/missed-call-sms` returned `twilioSid` `SMe50555…` |
| Twilio historical SMS traffic (Apr 13–14) | WORKING | 10+ delivered outbound, 10+ received inbound in 7-day window |
| Zadarma webhook echo (`zd_echo`) | WORKING | GET `/internal/zadarma-webhook?zd_echo=ping` → `200 ping` |
| Zadarma → backend delivery | WORKING | Render logs show NOTIFY_START / NOTIFY_INTERNAL / NOTIFY_END persisted |
| Direct backend missed-call processing (no n8n) | WORKING | Synthetic NOTIFY_END POST 2026-05-09 12:51 UTC → Twilio SID `SMd32c12aa26048ddf85b8af71915e1ab4`; deduped second POST returned `sms_sent: false` as expected |
| n8n forwarding | DECOMMISSIONED | Free plan expired; route no longer touches n8n (PR #516) |
| `/internal/missed-call-sms` endpoint (backend logic) | WORKING | Direct call with valid body → 200 + Twilio SID |
| `/internal/process-sms` endpoint | WORKING | Route registered; validation works (400 on empty body with correct error details) |
| `/internal/lt-recent-conversations` | WORKING | Returns messages for tenant slug |
| `/internal/dlq` | WORKING | Returns `[]` (no failed jobs) |
| `/health` | WORKING | `postgres: ok, redis: ok, pipeline_env: ok` |
| LT system prompt v2 loaded | WORKING (assumed — migration 044 applied, conversations used v2 on Apr 14) | Migration file upserts `is_active=true` for v2 |
| Frontend i18n (`_t()`) | WORKING | `_t()` at `apps/web/app.html:2411`; 81 keys; reads `tenantState.locale` from JWT/session |
| Frontend `lt-LT` coverage | PARTIAL | 81 string keys with `lt-LT` entries; some dashboard strings still English (trial banner, analytics) |
| Google Calendar integration for LT tenant | NOT CONFIGURED | No tokens; requires manual OAuth click in dashboard |
| Telia → Zadarma GSM forward | USER-CONFIRMED (Apr 19) | NOTIFY_START arrived at Zadarma for real call from `+37062344272` |

## Key Files

- Backend SMS sender: `apps/api/src/services/missed-call-sms.ts`
- Missed-call HTTP route (zod schema): `apps/api/src/routes/internal/missed-call-sms.ts`
- AI conversation service: `apps/api/src/services/process-sms.ts`
- Booking detection: `apps/api/src/services/booking-intent.ts`
- Twilio inbound webhook: `apps/api/src/routes/webhooks/twilio-sms.ts`
- Zadarma webhook handler (direct missed-call processing): `apps/api/src/routes/internal/zadarma-webhook.ts`
- LT tenant utils (slug → UUID): `apps/api/src/utils/lt-tenant.ts`
- Backend i18n helpers: `apps/api/src/utils/i18n.ts`
- Frontend i18n: `apps/web/app.html` (`_I18N_STRINGS` + `_t()`)
- n8n workflow (reference only — decommissioned): `n8n-workflows/WF-LT-ZADARMA-MISSED-CALL.json`
- n8n workflow notes (reference only — decommissioned): `n8n-workflows/WF-LT-ZADARMA-MISSED-CALL.md`
- System prompt v2: `db/migrations/044_lt_system_prompt_v2.sql`
- Tenant creation: `db/migrations/040_create_lt_pilot_tenant.sql`
- Twilio number wiring: `db/migrations/041_lt_twilio_number.sql`
- Locale/currency columns: `db/migrations/053_tenant_locale.sql`

## Database Tables Used

- `tenants` — `locale`, `currency`, `timezone`, `billing_status`, pilot tenant row
- `tenant_phone_numbers` — `+37066806130` active (Twilio), `+37045512300` suspended (Zadarma)
- `conversations` — LT tenant conversations (1 confirmed from Apr 14)
- `messages` — inbound + outbound SMS rows
- `appointments` — LT booking rows (booking_state enum: `PENDING_MANUAL_CONFIRMATION`, `CONFIRMED_MANUAL`, etc.)
- `system_prompts` — v1 inactive, v2 active for LT tenant
- `zadarma_events` — audit log of every Zadarma webhook hit (append-only)
- `customer_cooldowns` — per-(tenant, customer) cooldown flag for repeat-call suppression

> Direct production DB queries could not be executed from this audit (no CLI access to Render Postgres). DB-layer facts above are inferred from migration files and from responses of read-side internal endpoints (`lt-recent-conversations`, `missed-call-sms` dry-run, `dlq`).

## Merged PRs (chronological, LT-pilot scope)

| PR | Title |
|---|---|
| #496 | docs(twilio-provisioning): document LT/US isolation invariant for future callers |
| #497 | fix(lt): correct Panevėžys address, add services list and Saturday hours to LT SMS prompt |
| #498 | feat(lt-pilot): add Zadarma missed-call webhook workflow (placeholder SMS) |
| #500 | fix(lt-pilot): Parse node accepts call_status and direct $json fields |
| #501 | feat(lt-pilot): add /internal/lt-send-sms and /internal/lt-recent-conversations |
| #502 | fix(lt-pilot): n8n SMS sender posts to backend lt-send-sms instead of httpbin |
| #503 | fix(lt-pilot): base64-encode Zadarma HMAC hex string, not raw bytes |
| #504 | feat(lt-pilot): add /internal/zadarma-webhook proxy for Zadarma → n8n bridge |
| #505 | feat(lt-pilot): enable USA pipeline for LT tenant — Twilio direct From + Lithuanian prompt |
| #506 | feat(lt-pilot): wire LT tenant to Twilio mobile number +37066806130 |
| #507 | fix(lt-pilot): add Lithuanian booking confirmation patterns to detectBookingIntent |
| #508 | fix(lt-pilot): localize hardcoded English fallback strings to Lithuanian for pilot tenants |
| #509 | feat(lt-pilot): system prompt v2 — strict no-repeat, multi-field extraction, mandatory confirmation phrase |
| #510 | fix(lt-pilot): add 'numeris' to LT plate context with telefono-numeris guard |
| #511 | feat(lt-pilot): tenant locale + currency infrastructure (backend) |
| #512 | fix(dashboard): P0 blockers — overflow scroll, appointment confirm, frontend i18n |
| #513 | feat(dashboard): Lithuanian localization for LT tenants (US unchanged) |
| #514 | fix(build): add locale/currency/timezone to Google OAuth + signup JWT signs |
| #515 | docs(lt-pilot): add LT pilot architecture knowledge base |
| #516 | feat(lt-pilot): process missed calls directly in zadarma webhook — remove n8n dependency |

## Known Limitations

1. **Twilio LT = SMS only.** Twilio has **zero voice-enabled LT numbers** in inventory (confirmed via `AvailablePhoneNumbers/LT/Mobile.json?VoiceEnabled=true&SmsEnabled=true` → empty list). Voice cannot be toggled on an existing number.
2. **Zadarma is required** for any inbound voice / missed-call detection path.
3. **Google Calendar is not connected** for the LT tenant — needs a manual OAuth click in the dashboard.
4. **AI sometimes invents unavailable time slots** — v2 prompt improved this but is not airtight; v3 prompt may be needed.
5. **Some dashboard strings still render in English** (trial banner, analytics) even on `lt-LT` session — coverage is ~81 keys, not 100%.
6. **n8n payload mapping to `/internal/missed-call-sms`** is the current blocker for the missed-call path (see "Components Status Table").

## Env Vars (Render production, 26 keys)

```
DATABASE_URL
GITHUB_REPO
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
INTERNAL_API_KEY
JWT_SECRET
LOG_LEVEL
N8N_LT_ZADARMA_WEBHOOK_URL
NODE_ENV
OPENAI_API_KEY
PORT
PUBLIC_ORIGIN
REDIS_URL
STRIPE_PRICE_PREMIUM
STRIPE_PRICE_PRO
STRIPE_PRICE_STARTER
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_LT_FROM_NUMBER
TWILIO_MESSAGING_SERVICE_SID
ZADARMA_API_KEY
ZADARMA_API_SECRET
ZADARMA_WEBHOOK_SECRET
```

All required keys for the LT pilot are present (`TWILIO_LT_FROM_NUMBER`, `ZADARMA_*`, `INTERNAL_API_KEY`). `N8N_LT_ZADARMA_WEBHOOK_URL` and `ZADARMA_WEBHOOK_SECRET` are no longer read by code (n8n decommissioned PR #516) — safe to remove in a cleanup PR. Values are [REDACTED] — fetch with Render API if needed (do not paste into docs).

## Troubleshooting

- **Deploy fails:** confirm `PORT=3000` and `NODE_ENV=production` still present after any `PUT /env-vars` — Render's endpoint replaces the full set (see `feedback_render_env_vars.md`).
- **Outbound SMS not sending:** confirm `TWILIO_LT_FROM_NUMBER` env var is `+37066806130` and `tenant_phone_numbers` row for the LT tenant is `status='active'`.
- **Inbound SMS not routing:** confirm `tenant_phone_numbers` has exactly one active row for `+37066806130` pointing at the LT tenant UUID.
- **Missed-call SMS not firing:** check Render logs for `"Missed-call SMS processed"` entries. Filter checks `event === "NOTIFY_END"` and `caller_id !== called_did` and non-empty caller. If `processed: false` in logs, payload didn't match (e.g., NOTIFY_START / NOTIFY_INTERNAL events fire too — only NOTIFY_END triggers SMS). If `service_error` is set in the log, see `handleMissedCallSms` return values (tenant blocked, conversation race, Twilio creds missing, etc.).
- **Cooldown blocking conversations during debugging:** `DELETE FROM customer_cooldowns WHERE customer_phone='<E.164>' AND tenant_id='<uuid>';`
- **Zadarma Notifications URL drift:** after any Render env-var rewrite, verify the Zadarma dashboard still points at `/internal/zadarma-webhook` (NEEDS CHROME VERIFICATION — not callable from CLI).

## What's NOT Done Yet

1. **Real-call end-to-end verification** — synthetic NOTIFY_END POST is proven (Twilio SID returned); a live call from `+37067577829` to `+37045512300` that goes to voicemail should fire SMS via the same code path. Pending user-side test.
2. **Cleanup PR for unused n8n env vars** — `ZADARMA_WEBHOOK_SECRET` and `N8N_LT_ZADARMA_WEBHOOK_URL` are still in Render config; safe to remove in a follow-up.
3. **Google Calendar OAuth** for LT tenant (user action: click "Connect Calendar" in dashboard).
4. **System prompt v3** — tighten slot-invention behavior.
5. **Dashboard i18n gap closure** — remaining English strings (trial banner, analytics).
6. **BullMQ retry backoff tuning** — 3 retries are currently too fast for Zadarma transient hiccups.

## Verification Commands Used For This Audit

```bash
# Backend
curl -sS "https://autoshop-api-7ek9.onrender.com/health"
curl -sS "https://autoshop-api-7ek9.onrender.com/internal/zadarma-webhook?zd_echo=auditcheck"
curl -sS -H "x-internal-key: $INTERNAL_API_KEY" \
  "https://autoshop-api-7ek9.onrender.com/internal/lt-recent-conversations?tenant=lt-proteros-servisas&limit=5"
curl -sS -H "x-internal-key: $INTERNAL_API_KEY" \
  "https://autoshop-api-7ek9.onrender.com/internal/dlq?limit=5"

# Twilio
curl -sS -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/IncomingPhoneNumbers/PN4424f5163dd2e6ab0e17b5cc1f056863.json"
curl -sS -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/AvailablePhoneNumbers/LT/Mobile.json?VoiceEnabled=true&SmsEnabled=true"

# Missed-call SMS (direct backend, no n8n)
curl -sS -X POST "https://autoshop-api-7ek9.onrender.com/internal/zadarma-webhook" \
  -H "Content-Type: application/json" \
  -d '{"event":"NOTIFY_END","caller_id":"+37060000000","called_did":"37045512300","pbx_call_id":"synthetic_test","disposition":"answered","status_code":"16","duration":"10"}'
# expected: {"ok":true,"processed":true} — and "Missed-call SMS processed" log entry

# Render
curl -sS -H "Authorization: Bearer $RENDER_TOKEN" \
  "https://api.render.com/v1/services/srv-d6n7qavgi27c73c9ap10/env-vars?limit=50"
curl -sS -H "Authorization: Bearer $RENDER_TOKEN" \
  "https://api.render.com/v1/logs?ownerId=tea-d6n7ehvtskes73e90otg&resource=srv-d6n7qavgi27c73c9ap10&startTime=<ISO>&endTime=<ISO>&text=zadarma&limit=200"
```
