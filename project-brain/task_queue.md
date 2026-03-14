# Task Queue

Prioritized execution queue. Work top-down. Update after every session.

## Priority Order

Tasks are ordered by proximity to the core revenue flow:
missed call → SMS → AI → booking → calendar

## Queue

### Ready (can be done now)

1. **Continue TEST workflow refinement** — Improve workflow JSONs for sandbox testing while waiting for credentials
2. **API error handling audit** — Verify all /internal/ endpoints surface clear errors for n8n consumption
3. **Process-sms endpoint hardening** — POST /internal/process-sms is the newest endpoint; verify edge cases

### Blocked (waiting on Human)

4. **End-to-end demo with real Twilio** — Requires n8n credentials (postgres, openai, twilio)
5. **Google Calendar OAuth e2e verification** — Requires Human to complete OAuth flow
6. **First pilot tenant onboarding** — Requires working demo + real phone number

### Backlog (lower priority)

7. **Production readiness hardening** — Stage 6 at 32%, but blocked by upstream stages
8. **Admin dashboard enhancements** — Stage 5 at 65%, functional but not urgent

## Completed Recently

- Missed call SMS endpoint (26 tests)
- WF-002 API unification
- Appointment creation endpoint (24 tests)
- Idempotency guards (10 tests)
- OpenAI agent-bridge infrastructure
