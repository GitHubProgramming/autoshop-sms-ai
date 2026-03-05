# n8n Workflow Notes

## Queue Mode — Why It's Required

Without Queue Mode, n8n runs all executions in the main process. If an OpenAI
call takes 8 seconds and 50 shops have concurrent missed calls, n8n queues them
serially = up to 400 second delay. Unacceptable.

Queue Mode routes execution to separate worker processes via Redis/BullMQ.
Each worker picks up jobs independently. Scale workers horizontally.

## Environment Variables (n8n specific)

```
EXECUTIONS_MODE=queue
QUEUE_BULL_REDIS_HOST=redis
QUEUE_BULL_REDIS_PORT=6379
QUEUE_HEALTH_CHECK_ACTIVE=true
N8N_CONCURRENCY_PRODUCTION_LIMIT=20    # max concurrent executions per worker
N8N_ENCRYPTION_KEY=<32-char string>   # for credential encryption
```

## Credential Setup in n8n UI

After starting n8n, add these credentials (Settings → Credentials):

1. **Postgres** — same DATABASE_URL
2. **OpenAI** — API key
3. **Twilio** — Account SID + Auth Token
4. **Google Calendar OAuth2** — Client ID + Secret (separate from API OAuth)
5. **HTTP Basic Auth** — for internal API calls back to Fastify

## Workflow: Usage Warning Email (Example n8n Use Case)

Trigger: Webhook from BullMQ (warning_email job type)
Nodes:
1. Receive webhook payload: { tenant_id, level, usage_count, usage_limit }
2. Postgres: SELECT shop_name, phone FROM tenants WHERE id = $tenant_id
3. Condition: level == '80' or '100'
4. Send email via SMTP/SendGrid:
   Subject: "You've used {X}% of your AutoShop SMS AI conversations"
   Body: templated

## Tenant Isolation in n8n

Every n8n workflow MUST:
- Receive tenant_id in the trigger payload
- Pass tenant_id to every Postgres query as a WHERE clause condition
- NEVER query across tenants

n8n has no built-in RLS enforcement — this is application-layer responsibility.

## Monitoring

- n8n executions UI at http://localhost:5678/executions
- Failed executions appear in red — check for OpenAI rate limits, Twilio errors
- Redis queue depth: `redis-cli LLEN bull:ai_process:wait`
- Worker health: `QUEUE_HEALTH_CHECK_ACTIVE=true` exposes /healthz on each worker
