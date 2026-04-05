# Blockers

Only real blockers that currently prevent progress. Remove entries when resolved.

## Active Blockers

### 1. n8n credentials not configured
- **What:** postgres-creds, openai-creds, twilio-creds missing in n8n UI
- **Owner:** Human
- **Affects:** Stage 2 (TEST Sandbox Workflow Chain), Stage 3 (Core Messaging & AI Flow)
- **Required action:** Manual setup in n8n UI with real API keys
- **Impact:** Cannot run end-to-end SMS test flows. All workflow JSONs are committed but cannot execute.

### 2. AI conversation reply blocked by carrier
- **What:** Missed-call trigger verified (call → SMS sent). AI conversation reply blocked by Telia LT carrier — not a code issue.
- **Owner:** Human (Twilio A2P 10DLC campaign approval)
- **Affects:** Stage 3 (Core Messaging & AI Flow), Stage 6 (End-to-end demo)
- **Required action:** Wait for Twilio A2P 10DLC campaign approval, then re-test AI conversation reply
- **Impact:** Cannot verify full conversation flow (SMS reply → AI response → booking) until carrier allows delivery

### 3. First pilot tenant
- **What:** No real auto repair shop onboarded yet
- **Owner:** Human
- **Affects:** Stage 7 (First Live Pilot)
- **Required action:** Working demo + real phone number + willing shop
- **Impact:** Cannot start Stage 7 until demo is proven.

## Resolved Blockers

- **2026-04-05 — Missed-call SMS trigger:** Call from Lithuania to +13257523890 triggered automatic SMS within seconds. Pipeline verified.
- **2026-04-05 — Google Calendar OAuth verification:** Owner completed OAuth consent flow. access_token + refresh_token saved to tenant_calendar_tokens. Token decryption verified via /internal/calendar-tokens endpoint. Stage 4 complete.
