# System State

High-level snapshot of the project as of 2026-03-12.

## Current Structure

### TEST Workflows (`n8n/workflows/TEST/`)
| File | Purpose |
|------|---------|
| `autoshop-ai-mvp.json` | MVP demo workflow |
| `demo-sms.json` | SMS demo flow |
| `test-github-deploy.json` | Deploy pipeline test |
| `wf001-lt-sandbox-missed-call.json` | LT sandbox missed call trigger |
| `wf002-lt-sandbox-send-sms.json` | LT sandbox SMS sending |
| `wf003-lt-sandbox-sms-ai-agent.json` | LT sandbox AI agent |
| `wf004-lt-sandbox-booking.json` | LT sandbox booking flow |
| `wf005-lt-sandbox-log-sheets.json` | LT sandbox Google Sheets logging |
| `wf006-test-telia-missed-call-sms.json` | Telia missed call SMS test |

### LT_Proteros Workflows (`n8n/workflows/LT_Proteros/`)
| File | Purpose |
|------|---------|
| `lt-missed-call-to-sms.json` | Missed call to SMS trigger |
| `lt-sms-booking-agent.json` | SMS booking AI agent |
| `voice-booking-agent.json` | Voice booking agent |

### US_AutoShop Workflows (`n8n/workflows/US_AutoShop/`)
| File | Purpose |
|------|---------|
| `sms-inbound.json` | WF-001: SMS ingest → tenant lookup |
| `ai-booking-worker.json` | WF-002: AI processing → booking detection |
| `close-conversation.json` | WF-003: Conversation closing |
| `calendar-sync.json` | WF-004: Google Calendar sync |
| `provision-number.json` | WF-007: Twilio number provisioning |

## Known Issues

- **Credentials not configured in n8n:** postgres-creds, openai-creds, twilio-creds require manual setup in n8n UI with real API keys
- **Google Calendar OAuth:** requires `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env` and tenant completing OAuth flow
- **No open automatable tasks:** remaining blockers require manual credential provisioning

## Current Development Focus

- TEST environment stabilization and SMS flow automation
- LT Proteros sandbox SMS test flows (branch: `ai/lt-proteros-sms-test-flow`)
- Verifying end-to-end: missed call → SMS → AI → booking → calendar

## Next Milestones

1. Complete n8n credential configuration (manual)
2. End-to-end demo with real Twilio numbers
3. Google Calendar OAuth flow for first pilot tenant
4. First pilot customer onboarding
5. Stripe billing integration live with real payments
