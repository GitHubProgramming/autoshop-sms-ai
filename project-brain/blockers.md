# Blockers

Only real blockers that currently prevent progress. Remove entries when resolved.

## Active Blockers

### 1. n8n credentials not configured
- **What:** postgres-creds, openai-creds, twilio-creds missing in n8n UI
- **Owner:** Human
- **Affects:** Stage 2 (TEST Sandbox Workflow Chain), Stage 3 (Core Messaging & AI Flow)
- **Required action:** Manual setup in n8n UI with real API keys
- **Impact:** Cannot run end-to-end SMS test flows. All workflow JSONs are committed but cannot execute.

### 2. Google Calendar OAuth verification
- **What:** OAuth credentials exist in .env but the end-to-end flow has never been verified
- **Owner:** Human
- **Affects:** Stage 4 (Calendar & Booking Reliability)
- **Required action:** Complete OAuth flow test with existing credentials
- **Impact:** Calendar sync code is built and tested (24 tests) but unverified against real Google API.

### 3. First pilot tenant
- **What:** No real auto repair shop onboarded yet
- **Owner:** Human
- **Affects:** Stage 7 (First Live Pilot)
- **Required action:** Working demo + real phone number + willing shop
- **Impact:** Cannot start Stage 7 until demo is proven.

## Resolved Blockers

_Move resolved blockers here with date and resolution._
