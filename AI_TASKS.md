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

## BLOCKED
- Configure n8n credentials (postgres-creds, openai-creds, twilio-creds) — requires real API keys (manual n8n UI setup)
- Google Calendar OAuth flow for tenant — requires real GOOGLE_CLIENT_ID/SECRET + tenant completing OAuth consent

## OPEN
- Add Google OAuth callback endpoint in API (POST /auth/google/callback) to store tokens in tenant_calendar_tokens
- Add Stripe checkout endpoint for subscription creation
- Add Twilio inbound webhook test coverage
- Improve SMS conversation logging
