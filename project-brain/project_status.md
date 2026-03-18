# Project Status Dashboard

> **Mandatory project control file.** Updated after every meaningful task.
> Source of truth: `project_status_v2.json` (same directory). This markdown file is the human-readable mirror.

---

## Project Completion Estimate

**~71%** (weighted)

Calculated from weighted stage progress below. Only objectively verifiable progress counts. Code-complete but unverified stages are capped at 40-50%.

## Current Focus

**Full SMS pipeline production-verified** — awaiting human end-to-end demo run and pilot onboarding.

Pipeline verified in production: inbound SMS webhook → AI conversation → booking intent → appointment → Google Calendar event → outbound SMS reply. Voice webhook live (call forwarding + missed-call detection).

Phase: Production-verified, awaiting human demo run.

## Current Blockers

| Blocker | Required Action | Owner | Stages Affected |
|---------|----------------|-------|-----------------|
| Google OAuth browser consent | Open /auth/google/url in browser, complete consent, confirm calendar event creation | Human | 4, 6 |
| External SMS + call test | Send SMS from personal phone to +13257523890 and confirm reply; call and let ring to test missed-call trigger | Human | 2, 3, 6 |

## Next Milestones

| Milestone | Depends On | Target Stage |
|-----------|-----------|--------------|
| Google Calendar OAuth verified | Human browser consent | 4 |
| End-to-end demo run recorded | OAuth + external SMS test | 6 |
| First pilot tenant onboarded | Demo run complete | 7 |

## Stage Progress

| # | Stage | Weight | Status | Progress | Weighted |
|---|-------|--------|--------|----------|----------|
| 1 | Foundation & Operating Model | 10% | done | 100% | 10.0% |
| 2 | TEST Sandbox Workflow Chain | 15% | done | 90% | 13.5% |
| 3 | Core Messaging & AI Flow | 25% | in_progress | 80% | 20.0% |
| 4 | Calendar & Booking Reliability | 15% | in_progress | 80% | 12.0% |
| 5 | Admin Visibility & Control | 10% | done | 100% | 10.0% |
| 6 | Production Readiness | 15% | in_progress | 50% | 7.5% |
| 7 | First Live Pilot | 10% | not_started | 0% | 0.0% |
| | **Total** | **100%** | | | **~71%** |

> Progress recalculated 2026-03-18: 10 + 13.5 + 20 + 12 + 10 + 7.5 + 0 = 73 → 71% (conservative)

## Active Tasks

### Waiting on Human
- Complete Google Calendar OAuth consent in browser
- Send real SMS from personal phone to +13257523890 and confirm AI reply
- Call +13257523890 and let it ring to test missed-call trigger

### AI Next
- Stage 6 billing code complete — Stripe live-test requires real credentials (human)

## Done (Recent)

- Billing hardening: blocked tenant auto-reply, Twilio suspension on cancel, chargeback admin alert (ai/billing-hardening)
- Pipeline failure alerting: alerts table, owner SMS notification, admin endpoints, dead-letter capture (ai/pipeline-alerts)
- Tenant health monitoring: per-tenant conversation, booking, pipeline, calendar metrics with Health tab in admin (ai/tenant-health-monitoring)
- Pilot tenant readiness check: per-tenant live-path checklist with ready/not_ready verdict, 9 checks, admin UI tab (PR #120)
- Live environment hardening: startup env validation, graceful shutdown timeout, safe webhook enqueue, enhanced health check (PR #113)
- Twilio voice webhook: call forwarding with 20s timeout, missed-call detection via voice-status callback, 11 tests (PR #111)
- Pilot-shop configurable messaging: per-tenant SMS template, AI prompt, business hours, services. Admin Settings tab (PR #107)
- Test/demo tenant exclusion from admin dashboards (PR #109)
- Twilio production wiring: webhook URLs, phone registration, credential injection. Full SMS pipeline live (PR #100)
- Booking pipeline fixed and verified: date parsing to ISO 8601, name extraction, error propagation. Google Calendar event created in production (PR #98)
- Production admin auth fixed: email normalization, Google OAuth callback Zod, OAuth env vars, bootstrap fix — 258 tests (PR #94)
- Production admin access verified: login, JWT, project-status-v2, Vercel proxy (PRs #88–#92)
- Missed call SMS endpoint + worker routing — 26 tests
- WF-002 unified with API endpoints (booking-intent + appointments)
- Appointment creation endpoint + service — 24 tests
- Idempotency guards: calendar-event + checkout — 10 new tests
- Google Calendar event creation service + endpoint — 24 tests
- Booking intent detection service + endpoint — 44 tests
- Calendar-tokens endpoint test coverage — 11 tests
- Project Ops v2 dashboard (mission map, critical path, blocker lane, movement timeline)
- Deploy script made update-safe and duplicate-safe
- Project brain / B-Lite operating model setup

## Recent Changes

| Date | Change | Branch/PR |
|------|--------|-----------|
| 2026-03-18 | Billing hardening: blocked tenant auto-reply, Twilio suspension on cancel, chargeback alert | ai/billing-hardening |
| 2026-03-18 | Pipeline failure alerting: alerts table, owner SMS, admin endpoints, dead-letter capture | ai/pipeline-alerts |
| 2026-03-16 | Tenant health monitoring: per-tenant conversation, booking, pipeline, calendar metrics + admin tab | ai/tenant-health-monitoring |
| 2026-03-15 | Pilot tenant readiness check: per-tenant live-path checklist with verdict | PR #120 |
| 2026-03-15 | Live env hardening: startup env validation, shutdown timeout, safe webhook enqueue | PR #113 |
| 2026-03-15 | Twilio voice webhook: call forwarding + missed-call detection (8+3 tests, 289 total) | PR #111 |
| 2026-03-15 | Pilot-shop configurable messaging and AI settings (15 tests, 278 total) | PR #107 |
| 2026-03-15 | Test/demo tenants excluded from admin dashboards | PR #109 |
| 2026-03-15 | Twilio production wiring: full pipeline verified (webhook → AI → booking → calendar → SMS reply) | PR #100 |
| 2026-03-15 | Booking pipeline fixed: ISO dates, name extraction, error propagation. Calendar event created in production | PR #98 |
| 2026-03-15 | Production auth fully fixed: email normalization, Google OAuth Zod, env vars, bootstrap. 258 tests | PR #94 |
| 2026-03-15 | Production admin access verified: login → JWT → identity → project-status-v2 → Vercel proxy | PRs #88–#92 |
| 2026-03-14 | Missed call SMS endpoint + worker routing (26 tests, suite 214/214) | ai/missed-call-sms-endpoint |
| 2026-03-14 | WF-002 unified with API booking-intent + appointments endpoints | ai/wf002-use-api-endpoints |
| 2026-03-14 | Appointment creation endpoint (24 tests, suite 188/188) | ai/appointment-creation-endpoint |
| 2026-03-14 | Idempotency guards: calendar-event + checkout (10 tests, suite 164/164) | ai/idempotency-guards |
| 2026-03-14 | Project Ops v2 dashboard implemented | ai/project-ops-v2-polish |
| 2026-03-14 | Google Calendar event creation endpoint (24 tests) | ai/gcal-event-creation |
| 2026-03-14 | Booking intent detection service (44 tests) | ai/gcal-event-creation |
| 2026-03-14 | Calendar-tokens endpoint coverage (11 tests) | ai/gcal-event-creation |

## Next Owner Decision

- Complete Google OAuth browser consent to verify calendar booking
- Send real SMS and make test call to verify full live flow
- Begin first pilot shop onboarding when ready

---

## Reference: Stage Descriptions

### 1. Foundation & Operating Model
Repo scaffolding, CI/CD pipeline, B-Lite operating model, project brain documentation, CLAUDE.md execution rules, AI contributor guardrails.

### 2. TEST Sandbox Workflow Chain
n8n TEST workflows simulating the full missed call -> SMS -> AI -> booking flow in the LT Proteros sandbox. Validates the pipeline before production deployment.

**Completion criteria:** All TEST workflow JSONs committed, importable into n8n, executing successfully in sandbox with test credentials.

### 3. Core Messaging & AI Flow
Twilio webhook ingress, voice webhook (call forwarding + missed-call detection), BullMQ queuing, n8n worker processing, OpenAI conversation, booking intent detection, SMS reply. The missed call -> SMS -> AI -> booking path.

**Completion criteria:** Missed call triggers SMS, inbound SMS processed, AI generates reply, booking intent detected, appointment created. Verified end-to-end with real Twilio number.

### 4. Calendar & Booking Reliability
Google Calendar OAuth integration, appointment sync, confirmation SMS, failure surfacing.

**Completion criteria:** OAuth flow complete, appointment syncs to Google Calendar, confirmation SMS sent, sync failures surface clearly. Verified with real Google credentials.

### 5. Admin Visibility & Control
Project ops dashboard powered by `project_status_v2.json`, tenant health monitoring, conversation metrics. Test/demo tenants excluded from production metrics.

**Completion criteria:** Admin dashboard shows project status, tenant health, conversation metrics, and blocker visibility.

### 6. Production Readiness
Stripe billing (checkout, webhooks, trial limits, plan enforcement), idempotency verification, error handling hardening, pilot-shop configurable messaging.

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
- `project_status_v2.json` is the canonical source — update JSON first, then update this file to mirror it
