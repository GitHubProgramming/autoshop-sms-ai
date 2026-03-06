# AI Development Task Queue

Claude Code must execute tasks sequentially.

Workflow:
1. Pick the first OPEN task
2. Implement the smallest safe change
3. Run verification
4. Commit
5. Mark task DONE
6. Update AI_STATUS.md
7. Move to next task

## DONE
- Fix CI reliability and workflow stability
- Add Docker smoke verification and fix compose path
- Add autonomous AI workflow files
- Fix CI lint step when ESLint config is missing
- Extract service_type + scheduled_at from conversation messages in WF-003
- Add Google Calendar booking confirmation logic (WF-004 + confirmation SMS)
- Fix tenants.test.ts (add vi.mock for db/client; 9/9 tests now pass)
- Add voice-status.test.ts (6 tests covering missed-call-trigger path)
- Add Google OAuth callback endpoint (GET /auth/google/start + /callback with AES-256-GCM token encryption)

## BLOCKED
- Configure n8n credentials (postgres-creds, openai-creds, twilio-creds) — requires real API keys (manual n8n UI setup)
- Google Calendar OAuth flow for tenant — requires GOOGLE_CLIENT_ID/SECRET in .env + tenant completing OAuth flow at /auth/google/start

## OPEN
- Add Stripe checkout endpoint for subscription creation (POST /billing/checkout)
- Improve SMS conversation logging
