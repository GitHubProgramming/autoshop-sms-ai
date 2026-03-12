# Project Status Dashboard

> **This is the mandatory project control file.**
> Must be updated after every meaningful implementation cycle.
> See [Update Rules](#update-rules) below.
> Machine-readable mirror: `project_status.json` (same directory).

## Project Completion Estimate

**~34%** (weighted)

This percentage is calculated from weighted stage progress, not guesswork. Each stage has a defined weight reflecting its importance to the MVP. Only objectively verifiable progress counts. See [Progress Model](#progress-model) for the breakdown.

## Current Phase

TEST environment stabilization and SMS flow validation.

## Current Focus

LT Proteros sandbox SMS test flows — building and validating TEST workflows for the missed call -> SMS -> AI -> booking pipeline.

## Progress Model

The project is divided into 8 weighted stages aligned to the MVP milestone path. Each stage has clear completion criteria. Overall progress = sum of (weight x stage progress).

| # | Stage | Weight | Status | Progress | Weighted | Completion Criteria |
|---|-------|--------|--------|----------|----------|---------------------|
| 1 | Foundation & Operating Model | 10% | done | 100% | 10.0% | Repo structure, CI pipeline, B-Lite operating model, project brain, CLAUDE.md rules — all in place and enforced. |
| 2 | TEST Sandbox Workflow Chain | 15% | in_progress | 40% | 6.0% | All TEST workflow JSONs (wf001–wf006) committed, importable into n8n, and executing successfully in sandbox environment with test credentials. |
| 3 | Core Messaging & AI Flow | 25% | in_progress | 42% | 10.5% | Missed call triggers SMS, inbound SMS processed, AI generates reply, booking intent detected, appointment created. Verified end-to-end with real Twilio number. |
| 4 | Calendar & Booking Reliability | 15% | blocked | 30% | 4.5% | OAuth flow complete, appointment syncs to Google Calendar, confirmation SMS sent, sync failures surface clearly. Verified with real Google credentials. |
| 5 | Admin Visibility & Control | 10% | in_progress | 5% | 0.5% | Admin dashboard shows project status, tenant health, conversation metrics, and blocker visibility. Dashboard JSON data source created. |
| 6 | Production Readiness | 10% | in_progress | 20% | 2.0% | Billing (Stripe checkout, webhooks, trial limits, plan enforcement) live-tested. Idempotency verified. Error handling covers all failure modes. |
| 7 | First Live Pilot | 10% | not_started | 0% | 0.0% | One real Texas auto shop receiving missed-call SMS, AI replies working, bookings appearing in Google Calendar. |
| 8 | Scale & Handoff | 5% | not_started | 0% | 0.0% | Multi-tenant onboarding flow, monitoring, documentation for handoff to non-AI operator. |
| | **Total** | **100%** | | | **~34%** | |

**How to read this:** Code-complete stages are capped at 40-50% until verified with real services. "Blocked" stages remain at their last verified progress. A stage reaches 100% only when completion criteria are fully met in a real environment.

## Stage Descriptions

### 1. Foundation & Operating Model
Repo scaffolding, CI/CD pipeline, B-Lite operating model, project brain documentation, CLAUDE.md execution rules, AI contributor guardrails. This stage is the bedrock — everything else builds on it.

### 2. TEST Sandbox Workflow Chain
The chain of n8n TEST workflows (wf001 through wf006) that simulate the full missed call -> SMS -> AI -> booking flow in the LT Proteros sandbox environment. This validates the pipeline before production deployment.

### 3. Core Messaging & AI Flow
The heart of the product: Twilio webhook ingress, BullMQ queuing, n8n worker processing, OpenAI conversation, booking intent detection, and SMS reply. This is the missed call -> SMS -> AI -> booking path.

### 4. Calendar & Booking Reliability
Google Calendar OAuth integration, appointment sync, confirmation SMS, and failure surfacing. The final step in the core flow — without this, bookings are invisible to the shop.

### 5. Admin Visibility & Control
Project ops dashboard powered by `project_status.json`, tenant health monitoring, conversation metrics. Gives the owner and operators visibility into system state without reading code.

### 6. Production Readiness
Stripe billing (checkout, webhooks, trial limits, plan enforcement), idempotency verification, error handling hardening, and environment configuration for real deployment.

### 7. First Live Pilot
One real Texas auto repair shop fully onboarded: real phone number, real missed calls triggering SMS, AI conversations, bookings syncing to Google Calendar.

### 8. Scale & Handoff
Multi-tenant onboarding automation, monitoring dashboards, operational documentation, and handoff readiness so the system can run without the original builders.

## Active Tasks

### In Progress
- LT sandbox SMS test flow development (branch: `ai/lt-proteros-sms-test-flow`)
- Project milestone model + dashboard JSON status system (branch: `ai/lt-proteros-sms-test-flow`)

### Todo
- End-to-end demo run with real Twilio numbers
- Google Calendar OAuth tenant onboarding
- Admin dashboard UI (consuming `project_status.json`)

### Done (recent)
- Project brain / B-Lite operating model setup
- Deploy script made update-safe and duplicate-safe
- Stripe checkout endpoint added
- SMS conversation logging fix (WF-001)
- n8n workflow settings whitelist
- Google Calendar OAuth fix
- Project brain foundation created

## Blocked Items

| Blocker | Required Action | Owner | Stages Affected |
|---------|----------------|-------|-----------------|
| n8n credentials (postgres, openai, twilio) | Manual setup in n8n UI | Human | 2, 3 |
| Google OAuth credentials | Add `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` to `.env` | Human | 4 |
| First pilot tenant | Requires working demo + real phone number | Human | 7 |

## Recent Changes

| Date | Change | Branch |
|------|--------|--------|
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
- Provide Google OAuth client ID/secret for calendar integration
- Confirm priority: continue TEST sandbox work vs. unblock credential setup first

## Update Rules

This file must be updated by any AI contributor (Claude Code or other agent) under these conditions:

1. **After every meaningful task completion** — before the PR is opened or updated
2. **When a task becomes blocked** — add to Blocked Items immediately
3. **When focus shifts** — update Current Focus to reflect the new active priority
4. **When code or workflows change** — add a dated entry to Recent Changes
5. **When a stage advances** — update the Progress Model table
6. **In every PR description** — note which sections of this file were updated

**Progress discipline:**
- Stage percentages only change when completion criteria objectively advance
- Blocked work does not count as progress
- "Done in code but not verified" is capped at 40-50%, never higher
- When in doubt, round down

**JSON mirror:** After updating this file, ensure `project_status.json` reflects the same state. The JSON is the machine-readable source for the admin dashboard.

A task is **not considered done** until this file reflects the change.
