# n8n Integration Contracts

## Architecture Note
AI processing (OpenAI calls) happens in **BullMQ workers** (`services/worker`), NOT in n8n.
n8n is used for external workflow orchestration, integrations, and fallback automation only.

The BullMQ worker (`aiWorker.ts`) handles the full hot path:
- SMS inbound processing
- Missed call response
- OpenAI function calling
- Google Calendar sync

## When to Use n8n

Use n8n for:
1. **External webhook triggers** (Zapier-style integrations shops may request)
2. **Email/Slack notifications** for shop owners (usage warnings, new bookings)
3. **Fallback workflows** when primary worker is degraded
4. **Reporting automations** (weekly summary emails)

## If Using n8n for AI Processing (Alternative Approach)

If you choose to run AI in n8n instead of the BullMQ worker:

### Backend → n8n Payload (webhook trigger)

```json
{
  "event": "missed_call" | "sms_inbound",
  "tenant_id": "uuid",
  "customer_phone": "+12145551234",
  "twilio_number": "+19725559876",
  "message_body": "Hi, I need an oil change",
  "conversation_id": "uuid",
  "message_sid": "SMxxxx",
  "shop_context": {
    "shop_name": "Mike's Auto",
    "timezone": "America/Chicago",
    "services": ["Oil Change", "Brakes"],
    "business_hours": { "mon": "08:00-17:00" }
  },
  "conversation_history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "turn_count": 3,
  "max_turns": 12
}
```

### n8n → Backend Response (POST /internal/conversation/message)

```json
{
  "conversation_id": "uuid",
  "tenant_id": "uuid",
  "ai_reply": "Thanks for reaching out! What service do you need?",
  "booking_confirmed": false,
  "booking_data": null
}
```

If booking confirmed:
```json
{
  "conversation_id": "uuid",
  "tenant_id": "uuid",
  "ai_reply": "Great! Booked for Thursday at 2pm, John. See you then!",
  "booking_confirmed": true,
  "booking_data": {
    "customer_name": "John Smith",
    "service_type": "Oil Change",
    "scheduled_date": "2025-03-15",
    "scheduled_time": "14:00",
    "notes": ""
  }
}
```

## CRITICAL: Conversation Counter in n8n

**NEVER increment conversation count inside n8n.**
Always call the backend `/internal/conversation/open` endpoint which runs the
`open_conversation()` Postgres stored procedure atomically.

n8n MUST call the backend first and check:
```json
{ "result": "opened" | "blocked_trial" | "blocked_plan" | "duplicate_open" }
```

Only proceed if `result === "opened"`. Stop immediately on any blocked result.

## Queue Mode Configuration

- n8n version: `n8nio/n8n:1.40.0` (pinned)
- Mode: `EXECUTIONS_MODE=queue`
- Backend: Redis (same Redis instance as BullMQ)
- Workers: 3 replicas minimum

## Import Steps

1. Start n8n via docker-compose
2. Login at http://localhost:5678 with BASIC_AUTH credentials
3. Go to Settings → Community nodes (if needed)
4. Import workflow JSONs from `/n8n/workflows/` (when created)
5. Set credentials for: OpenAI, Twilio, Google Calendar, Postgres
6. Activate workflows

## Pinned Version Policy

n8n has breaking changes between minor versions. Version is pinned to `1.40.0`.
To upgrade:
1. Test in staging environment first
2. Export all workflow JSONs as backup
3. Update docker-compose.yml version
4. Restart and verify workflow execution
