# Architectural Decisions

> Part of the shared-memory system. These are stable decisions that should not be re-debated each session. See README.md for the full protocol.

## ADR-001: GitHub as Source of Truth

All n8n workflows are stored in the GitHub repository under `n8n/workflows/`. The n8n UI is not the development environment. Changes are made in code, committed to branches, reviewed via pull requests, and deployed automatically on merge to `main`.

**Rationale:** Prevents drift between environments, enables version control, code review, and rollback.

## ADR-002: n8n UI Is Not the Development Environment

Developers and AI agents must not use the n8n UI to create or edit workflows intended for production. All workflow changes flow through Git.

**Rationale:** Avoids untracked changes, ensures all modifications are auditable and reversible.

## ADR-003: Workflows Deploy via GitHub Actions

The `n8n-deploy.yml` GitHub Actions workflow runs `scripts/n8n-deploy.sh` on push to `main`. The script uses three-tier matching (live ID → name match → create new) with duplicate detection.

**Rationale:** Automated, repeatable deployments with safety checks against duplicate workflow creation.

## ADR-004: Claude Code Works via Branches and Pull Requests

AI agents (Claude Code) must work on feature branches (`ai/<task-name>`), never commit directly to `main`. All changes go through pull requests.

**Rationale:** Maintains code review gate, prevents untested changes from reaching production.

## ADR-005: TEST Environment for Experimentation

The `n8n/workflows/TEST/` folder is a safe sandbox. New workflows, experiments, and prototypes are created here first. Production folders (`US_AutoShop`, `LT_Proteros`) are protected.

**Rationale:** Isolates experimental work from production systems.

## ADR-006: API Is Ingress-Only

The Fastify API (`apps/api/`) handles webhook validation and job enqueueing only. All heavy processing (AI, SMS sending, calendar sync) runs asynchronously in n8n workers via BullMQ.

**Rationale:** Twilio requires fast webhook responses (~15s). Async processing ensures reliability and prevents timeout failures.

## ADR-007: Billing State Is Not Checked Live

Billing/subscription state is cached in the database, not fetched from Stripe on every inbound message. Stripe webhooks update the local state.

**Rationale:** Reduces latency, avoids Stripe rate limits, and prevents billing service outages from blocking SMS processing.

## ADR-008: Multi-Tenancy via Postgres RLS

Each tenant's data is isolated using Postgres Row-Level Security. All tenant-scoped queries must use `withTenant(tenantId, fn)` which sets `app.current_tenant_id` as a session variable.

**Rationale:** Enforces data isolation at the database level, preventing accidental cross-tenant data access.

## ADR-009: Idempotent Webhook Handling

All webhook endpoints use Redis-based idempotency checks (24h TTL) keyed on provider-specific IDs (MessageSid, CallSid, Stripe event.id).

**Rationale:** Twilio and Stripe retry failed webhook deliveries. Idempotency prevents duplicate processing.

## ADR-010: Demo-First Onboarding

New signups enter **demo mode** immediately and land inside the app/dashboard — not the onboarding wizard. The full setup flow (phone number provisioning, call forwarding, calendar connection) is deferred until the user activates a trial with a card on file.

**Demo mode rules:**
- `billing_status = 'demo'`, `workspace_mode = 'demo'`
- Dashboard shows sample/demo data only — clearly labeled "DEMO MODE" / "SAMPLE DATA"
- All real side effects are blocked: no Twilio provisioning, no outbound SMS, no AI execution, no booking creation, no calendar sync, no usage counting
- Demo data is served in-memory by the frontend; no fake records are inserted into production tables
- A clear CTA ("Start 14-Day Free Trial") is always visible to prompt activation

**Activation flow:**
- User clicks "Start Free Trial" → Stripe Checkout (card required, no charge today)
- On `customer.subscription.created` webhook: `billing_status` flips to `trial`, `workspace_mode` to `live_empty`, `provisioning_state` to `pending_setup`
- User is redirected to the onboarding wizard to complete real setup (phone, forwarding, calendar, test)
- Demo data is no longer served once tenant is activated

**Rationale:** Eliminates the dead-end where new signups hit "Provisioning requires an active trial" before seeing the product. Lets users experience the value proposition (demo data) before committing a credit card, improving conversion.
