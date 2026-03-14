# Project Status Dashboard

> **Mandatory project control file.** Updated after every meaningful task.
> Source of truth: `project_status.json` (same directory). This markdown file is the human-readable mirror.

---

## Project Completion Estimate

**~41%** (weighted)

Calculated from weighted stage progress below. Only objectively verifiable progress counts. Code-complete but unverified stages are capped at 40-50%.

## Current Focus

**LT Proteros sandbox SMS test flows** — building and validating TEST workflows for the missed call -> SMS -> AI -> booking pipeline.

Phase: TEST environment stabilization and SMS flow validation.

## Current Blockers

| Blocker | Required Action | Owner | Stages Affected |
|---------|----------------|-------|-----------------|
| n8n credentials (postgres, openai, twilio) | Manual setup in n8n UI | Human | 2, 3 |
| Google Calendar OAuth verification | End-to-end OAuth flow test with existing credentials | Human | 4 |
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
| 2 | TEST Sandbox Workflow Chain | 15% | in_progress | 40% | 6.0% |
| 3 | Core Messaging & AI Flow | 25% | in_progress | 48% | 12.0% |
| 4 | Calendar & Booking Reliability | 15% | blocked | 38% | 5.7% |
| 5 | Admin Visibility & Control | 10% | in_progress | 40% | 4.0% |
| 6 | Production Readiness | 15% | in_progress | 28% | 4.2% |
| 7 | First Live Pilot | 10% | not_started | 0% | 0.0% |
| | **Total** | **100%** | | | **~41%** |

## Active Tasks

### In Progress
- LT sandbox SMS test flow development (branch: `ai/lt-proteros-sms-test-flow`)

### Todo
- End-to-end demo run with real Twilio numbers
- Google Calendar OAuth tenant onboarding

## Done (Recent)

- Twilio webhook signature validation test coverage — 8 tests (branch: `ai/gcal-event-creation`)
- Booking intent detection service + endpoint — 44 tests (branch: `ai/gcal-event-creation`)
- Calendar-tokens endpoint test coverage — 11 tests (branch: `ai/gcal-event-creation`)
- Google Calendar token auto-refresh + route registration fix (branch: `ai/gcal-event-creation`)
- Project milestone model + dashboard JSON status system
- Stripe webhook test coverage (20 tests passing)
- Webhook test coverage hardening (SMS inbound + voice-status: 33 tests passing)
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

- Provide n8n credentials (postgres, openai, twilio) to unblock end-to-end testing
- Verify Google Calendar OAuth flow end-to-end (credentials already in .env)
- Confirm priority: continue TEST sandbox work vs. unblock credential setup first

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
