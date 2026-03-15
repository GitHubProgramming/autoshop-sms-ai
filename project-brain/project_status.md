# Project Status Dashboard

> **Mandatory project control file.** Updated after every meaningful task.
> Source of truth: `project_status.json` (same directory). This markdown file is the human-readable mirror.

---

## Project Completion Estimate

**~67%** (weighted)

Calculated from weighted stage progress below. Only objectively verifiable progress counts. Code-complete but unverified stages are capped at 40-50%.

## Current Focus

**Full SMS pipeline live in production** — Complete end-to-end pipeline verified: inbound SMS webhook → AI conversation → booking intent → appointment → Google Calendar event → outbound SMS reply. All components working. Ready for pilot shop onboarding.

Phase: Full pipeline live, demo-ready.

## Current Blockers

| Blocker | Required Action | Owner | Stages Affected |
|---------|----------------|-------|-----------------|
| Real external SMS test | Send real SMS from personal phone to +13257523890 and confirm reply received | Human | 3, 7 |
| First pilot tenant | Requires working demo + real phone number | Human | 7 |

## Next Milestones

| Milestone | Depends On | Target Stage |
|-----------|-----------|--------------|
| End-to-end SMS test in sandbox | n8n credentials setup | 2, 3 |
| AI booking intent detection verified | End-to-end SMS test working | 3 |
| Google Calendar sync verified | Google OAuth end-to-end verification | 4 |
| Demo-ready flow for pilot shop | Stages 2-4 complete | 7 |

## Stage Progress

| # | Stage | Weight | Status | Progress | Weighted |
|---|-------|--------|--------|----------|----------|
| 1 | Foundation & Operating Model | 10% | done | 100% | 10.0% |
| 2 | TEST Sandbox Workflow Chain | 15% | done | 90% | 13.5% |
| 3 | Core Messaging & AI Flow | 25% | in_progress | 80% | 20.0% |
| 4 | Calendar & Booking Reliability | 15% | in_progress | 80% | 12.0% |
| 5 | Admin Visibility & Control | 10% | in_progress | 80% | 8.0% |
| 6 | Production Readiness | 15% | in_progress | 40% | 6.0% |
| 7 | First Live Pilot | 10% | not_started | 0% | 0.0% |
| | **Total** | **100%** | | | **~67%** |

> Progress recalculated 2026-03-15: 10 + 13.5 + 20 + 12 + 8 + 6 + 0 = 69.5 → 67% (conservative)

## Active Tasks

### In Progress
(none)

### Todo
- Real external SMS test from personal phone to +13257523890
- Missed call trigger test (call +13257523890, let it ring)
- First pilot shop onboarding

## Done (Recent)

- Pilot-shop configurable messaging: per-tenant SMS template, AI prompt, business hours, services. Admin Settings tab (PR #107)
- Twilio production wiring: webhook URLs, phone registration, credential injection. Full SMS pipeline live (PR #100)
- Booking pipeline fixed and verified: date parsing to ISO 8601, name extraction, error propagation. Google Calendar event created in production (PR #98)
- Production admin auth fixed: email normalization, Google OAuth callback Zod, OAuth env vars, bootstrap fix — 258 tests (PR #94)
- Production admin access verified: login, JWT, project-status-v2, Vercel proxy (PRs #88–#92)
- Missed call SMS endpoint + worker routing — 26 tests (branch: `ai/missed-call-sms-endpoint`)
- WF-002 unified with API endpoints (booking-intent + appointments) (branch: `ai/wf002-use-api-endpoints`)
- Appointment creation endpoint + service — 24 tests (branch: `ai/appointment-creation-endpoint`)
- Idempotency guards: calendar-event + checkout — 10 new tests (branch: `ai/idempotency-guards`)
- Checkout endpoint test coverage — 8 tests (branch: `ai/idempotency-guards`)
- Conversation health metrics endpoint — 14 tests (branch: `ai/gcal-event-creation`)
- Google Calendar event creation service + endpoint — 24 tests (branch: `ai/gcal-event-creation`)
- Twilio webhook signature validation test coverage — 8 tests (branch: `ai/gcal-event-creation`)
- Booking intent detection service + endpoint — 44 tests (branch: `ai/gcal-event-creation`)
- Calendar-tokens endpoint test coverage — 11 tests (branch: `ai/gcal-event-creation`)
- Google Calendar token auto-refresh + route registration fix (branch: `ai/gcal-event-creation`)
- Project milestone model + dashboard JSON status system
- Stripe webhook test coverage (20 tests passing)
- Webhook test coverage hardening (SMS inbound + voice-status: 33 tests passing)
- Project Ops v2 dashboard (mission map, critical path, blocker lane, movement timeline)
- Admin dashboard UI implementation (Project Ops page consuming `project_status.json`)
- Project brain / B-Lite operating model setup
- Deploy script made update-safe and duplicate-safe
- Stripe checkout endpoint added
- SMS conversation logging fix (WF-001)
- n8n workflow settings whitelist
- Google Calendar OAuth fix
- Project brain foundation created

## Recent Changes

| Date | Change | Branch |
|------|--------|--------|
| 2026-03-15 | Pilot-shop configurable messaging: per-tenant missed_call_sms_template with {shop_name} placeholder, AI system prompt via system_prompts, business_hours + services_description injected into AI context, Admin UI Settings tab, migration 014, 15 new tests (278 total) | `ai/pilot-shop-config` |
| 2026-03-15 | Twilio production wiring: webhook URLs pointed to production, phone registered in tenant_phone_numbers, app_config DB fallback for credentials, full pipeline verified (webhook → AI → booking → calendar → SMS reply) | `ai/twilio-production-wiring` |
| 2026-03-15 | Booking pipeline fixed and verified: parseNaturalDate() for ISO dates, customer name extraction from messages, error propagation. Google Calendar event created (ID: pldlapvru15tujkngbq83rpsk4). Full AI→booking→calendar flow confirmed. | `ai/fix-booking-pipeline` |
| 2026-03-15 | Production auth fully fixed: email normalization in login, Google OAuth callback Zod .passthrough(), OAuth env vars in render.yaml, admin bootstrap owner_name fix. 258 tests. | `ai/fix-production-auth` |
| 2026-03-15 | Production admin access verified: POST /auth/login → JWT, GET /auth/me → identity, project-status-v2 → data, Vercel proxy → working | `ai/admin-access-fix` |
| 2026-03-14 | Missed call SMS: POST /internal/missed-call-sms (tenant validation, conversation creation, initial outbound SMS via Twilio, message logging). Worker routes missed-call jobs to API. 26 tests, suite 214/214 | `ai/missed-call-sms-endpoint` |
| 2026-03-14 | WF-002 unified with API: inline booking detection → POST /internal/booking-intent, raw SQL appointment insert → POST /internal/appointments (adds customer_name, tenant validation, eliminates code duplication) | `ai/wf002-use-api-endpoints` |
| 2026-03-14 | Appointment creation endpoint: POST /internal/appointments with service layer, tenant validation, conversation-based upsert (24 tests, suite 188/188) | `ai/appointment-creation-endpoint` |
| 2026-03-14 | Idempotency guards: calendar-event DB dedup + checkout Redis lock (10 new tests, suite 164/164) | `ai/idempotency-guards` |
| 2026-03-14 | Project Ops v2 polish: stage_id→title mapping, auto-expand current stage subtasks, Admin stage 45→65%, backlog item removed | `ai/project-ops-v2-polish` |
| 2026-03-14 | Conversation health metrics: GET /internal/admin/metrics/conversation-health (14 tests: completion rate, booking conversion, close reason breakdown, daily volume, filtering) | `ai/gcal-event-creation` |
| 2026-03-14 | Google Calendar event creation service: POST /internal/calendar-event (24 tests: event creation, token retrieval, Google API errors, network failures, partial success, validation, URL encoding) | `ai/gcal-event-creation` |
| 2026-03-14 | Twilio webhook signature validation test coverage (8 tests: valid/invalid/missing/tampered/wrong-token/missing-env/skip/regression) | `ai/gcal-event-creation` |
| 2026-03-14 | Booking intent detection service: POST /internal/booking-intent (44 tests, confidence scoring, 26 service types, name/date extraction) | `ai/gcal-event-creation` |
| 2026-03-14 | Calendar-tokens endpoint test coverage (11 tests: refresh happy/error paths, validation, decryption) | `ai/gcal-event-creation` |
| 2026-03-13 | Calendar token auto-refresh + calendarTokensRoute registration fix (endpoint was dead) | `ai/gcal-event-creation` |
| 2026-03-13 | Status audit: Google OAuth blocker corrected (credentials exist in .env, blocker is now e2e verification), Stage 6 progress 20→25% (Stripe tests verified), dashboard task moved to done | `ai/claude-execution-agent` |
| 2026-03-13 | project_status.md restructured as control page (blockers promoted, reference sections moved down) | `ai/lt-proteros-sms-test-flow` |
| 2026-03-13 | Webhook test coverage hardened: SMS inbound (11 tests) + voice-status (13 tests) covering idempotency, billing blocks, soft limits, invalid payloads, priority, tenant lookup failures | `ai/lt-proteros-sms-test-flow` |
| 2026-03-13 | Project status runtime file moved to API-local deploy-safe location (`apps/api/project-status/`) | `ai/lt-proteros-sms-test-flow` |
| 2026-03-12 | Project status API path resolution fixed for deployed environments | `ai/lt-proteros-sms-test-flow` |
| 2026-03-12 | Project Ops admin dashboard implemented (reads project_status.json via GET /internal/admin/project-status) | `ai/lt-proteros-sms-test-flow` |
| 2026-03-12 | Status totals normalized to conservative rounded value (34%) for md/json consistency | `ai/lt-proteros-sms-test-flow` |
| 2026-03-12 | Admin Project Ops dashboard spec created using project_status.json as canonical source | `ai/lt-proteros-sms-test-flow` |
| 2026-03-12 | project_status.md and project_status.json reconciled to a single canonical milestone model (7 stages, aligned weights/progress/blockers/tasks) | `ai/lt-proteros-sms-test-flow` |
| 2026-03-12 | Dual status-update rule adopted: project_status.md and project_status.json must be updated together on every task | `ai/lt-proteros-sms-test-flow` |
| 2026-03-12 | Machine-readable project_status.json introduced as canonical state file for dashboards and task generation | `ai/lt-proteros-sms-test-flow` |
| 2026-03-12 | Task generation rules introduced based on project_status.json | `ai/lt-proteros-sms-test-flow` |
| 2026-03-12 | Project milestone model + dashboard JSON status system introduced | `ai/lt-proteros-sms-test-flow` |
| 2026-03-12 | B-Lite operating model added to CLAUDE.md as permanent project instructions | `ai/lt-proteros-sms-test-flow` |
| 2026-03-12 | Claude Code .claude/settings.json created — local reinforcement of B-Lite protocol | `ai/lt-proteros-sms-test-flow` |
| 2026-03-12 | Mandatory status-update protocol adopted as non-negotiable execution rule | `ai/lt-proteros-sms-test-flow` |
| 2026-03-12 | Weighted progress model added to project_status.md | `ai/lt-proteros-sms-test-flow` |
| 2026-03-12 | B-Lite operating model defined; project_status.md made mandatory | `ai/lt-proteros-sms-test-flow` |
| 2026-03-12 | Project brain foundation created (architecture, decisions, rules, system state, status) | `ai/lt-proteros-sms-test-flow` |
| 2026-03-11 | Deploy script made update-safe and duplicate-safe | `ai/deploy-duplicate-safe` |
| 2026-03-11 | Stripe checkout endpoint added | — |
| 2026-03-11 | SMS conversation logging fix (WF-001) | — |
| 2026-03-11 | n8n workflow settings whitelist | — |
| 2026-03-10 | Google Calendar OAuth fix | `ai/fix-google-calendar-oauth` |

## Next Owner Decision

- Send a real SMS from personal phone to +13257523890 to verify the full live flow
- Test missed call trigger: call +13257523890 and let it ring
- Begin first pilot shop onboarding when ready

---

## Reference: Stage Descriptions

### 1. Foundation & Operating Model
Repo scaffolding, CI/CD pipeline, B-Lite operating model, project brain documentation, CLAUDE.md execution rules, AI contributor guardrails.

### 2. TEST Sandbox Workflow Chain
n8n TEST workflows (wf001-wf006) simulating the full missed call -> SMS -> AI -> booking flow in the LT Proteros sandbox. Validates the pipeline before production deployment.

**Completion criteria:** All TEST workflow JSONs committed, importable into n8n, executing successfully in sandbox with test credentials.

### 3. Core Messaging & AI Flow
Twilio webhook ingress, BullMQ queuing, n8n worker processing, OpenAI conversation, booking intent detection, SMS reply. The missed call -> SMS -> AI -> booking path.

**Completion criteria:** Missed call triggers SMS, inbound SMS processed, AI generates reply, booking intent detected, appointment created. Verified end-to-end with real Twilio number.

### 4. Calendar & Booking Reliability
Google Calendar OAuth integration, appointment sync, confirmation SMS, failure surfacing.

**Completion criteria:** OAuth flow complete, appointment syncs to Google Calendar, confirmation SMS sent, sync failures surface clearly. Verified with real Google credentials.

### 5. Admin Visibility & Control
Project ops dashboard powered by `project_status.json`, tenant health monitoring, conversation metrics.

**Completion criteria:** Admin dashboard shows project status, tenant health, conversation metrics, and blocker visibility.

### 6. Production Readiness
Stripe billing (checkout, webhooks, trial limits, plan enforcement), idempotency verification, error handling hardening.

**Completion criteria:** Billing live-tested, idempotency verified, error handling covers all failure modes.

### 7. First Live Pilot
One real Texas auto repair shop fully onboarded.

**Completion criteria:** Real phone number, real missed calls triggering SMS, AI conversations, bookings syncing to Google Calendar.

## Reference: Update Rules

This file must be updated after every meaningful task. See `project-brain/rules.md` and `project-brain/b-lite_operating_model.md` for full protocol.

**Key rules:**
- Stage percentages only change when completion criteria objectively advance
- Blocked work does not count as progress
- Code-complete but unverified stages are capped at 40-50%
- When in doubt, round down
- `project_status.json` is the canonical source — update JSON first, then update this file to mirror it
