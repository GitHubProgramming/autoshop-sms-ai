# Security Policy

## Reporting a Vulnerability

Do NOT open a public GitHub issue for security vulnerabilities.

Email: security@autoshopsmsai.com

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (optional)

We will respond within 48 hours.

## Known Security Architecture Decisions

### Tenant Isolation
- PostgreSQL Row-Level Security (RLS) enforces tenant isolation at DB layer
- Every tenant-scoped query MUST call `SET LOCAL app.current_tenant_id = '<uuid>'`
- The `autoshop_app` DB role cannot bypass RLS
- Admin operations use `autoshop_admin` role (logged and audited)

### Webhook Security
- All Twilio webhooks validated with `x-twilio-signature` HMAC-SHA1
- All Stripe webhooks validated with `stripe-signature` HMAC-SHA256
- Both use idempotency keys (Redis) to prevent replay attacks

### Secret Management
- Secrets loaded via environment variables only
- Google OAuth tokens encrypted at rest (AES-256) before DB storage
- JWT tokens: 24h access TTL, 30-day refresh TTL

### Never commit
- `.env` files
- `n8n/credentials.json`
- Any file containing API keys, secrets, or tokens
