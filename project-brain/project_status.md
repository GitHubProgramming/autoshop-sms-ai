# Project Status Dashboard

> **This is the mandatory project control file.**
> Must be updated after every meaningful implementation cycle.
> See [Update Rules](#update-rules) below.

## Project Completion Estimate

**~38%** (weighted)

This percentage is calculated from weighted stage progress, not guesswork. Each stage has a defined weight reflecting its importance to the MVP. Only objectively verifiable progress counts. See [Progress Model](#progress-model) for the breakdown.

## Current Phase

TEST environment stabilization and SMS flow validation.

## Current Focus

LT Proteros sandbox SMS test flows — building and validating TEST workflows for the missed call → SMS → AI → booking pipeline.

## Progress Model

The project is divided into 7 weighted stages. Each stage has clear completion criteria. Overall progress = sum of (weight × stage progress).

| # | Stage | Weight | Status | Progress | Weighted | Completion Criteria |
|---|-------|--------|--------|----------|----------|-------------------|
| 1 | API + webhook ingress | 15% | Done | 100% | 15.0% | All Twilio/Stripe webhooks receive, validate, enqueue. Tests pass. |
| 2 | n8n workflows + deploy pipeline | 15% | Done | 100% | 15.0% | All workflow JSON committed, deploy script works, CI deploys on merge. |
| 3 | SMS send/receive (Twilio) | 20% | Partial | 40% | 8.0% | Inbound SMS processed, outbound reply sent, verified with real Twilio number. Code done, not verified with real credentials. |
| 4 | AI conversation + booking detection | 20% | Partial | 35% | 7.0% | OpenAI processes message, detects booking intent, creates appointment. Code done, not verified end-to-end. |
| 5 | Google Calendar sync | 10% | Partial | 30% | 3.0% | OAuth flow complete, appointment syncs to calendar, confirmation SMS sent. Code done, OAuth credentials not configured. |
| 6 | Billing (Stripe) | 10% | Partial | 35% | 3.5% | Checkout, webhooks, trial limits, plan enforcement all working with real Stripe. Code done, not live-tested. |
| 7 | Pilot customer live | 10% | Not Started | 0% | 0.0% | One real shop receiving missed-call SMS, AI replies, bookings appear in Google Calendar. |
| | **Total** | **100%** | | | **~38%** | |

**How to read this:** Code-complete stages are capped at 40–50% until verified with real services. "Blocked" stages remain at their last verified progress. A stage reaches 100% only when completion criteria are fully met in a real environment.

## Stage Progress

Summary view (derived from Progress Model above):

| Stage | Weight | Status | Progress |
|-------|--------|--------|----------|
| API + webhook ingress | 15% | Done | 100% |
| n8n workflows + deploy pipeline | 15% | Done | 100% |
| SMS send/receive (Twilio) | 20% | Partial | 40% |
| AI conversation + booking detection | 20% | Partial | 35% |
| Google Calendar sync | 10% | Partial | 30% |
| Billing (Stripe) | 10% | Partial | 35% |
| Pilot customer live | 10% | Not Started | 0% |

## Active Tasks

### In Progress
- LT sandbox SMS test flow development (branch: `ai/lt-proteros-sms-test-flow`)
- Project brain / B-Lite operating model setup

### Todo
- End-to-end demo run with real Twilio numbers
- Google Calendar OAuth tenant onboarding

### Done (recent)
- Deploy script made update-safe and duplicate-safe
- Stripe checkout endpoint added
- SMS conversation logging fix (WF-001)
- n8n workflow settings whitelist
- Google Calendar OAuth fix
- Project brain foundation created

## Blocked Items

| Blocker | Required Action | Owner | Stages Affected |
|---------|----------------|-------|-----------------|
| n8n credentials (postgres, openai, twilio) | Manual setup in n8n UI | Human | 3, 4 |
| Google OAuth credentials | Add `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` to `.env` | Human | 5 |
| First pilot tenant | Requires working demo + real phone number | Human | 7 |

## Recent Changes

| Date | Change | Branch |
|------|--------|--------|
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
5. **When a stage advances** — update both Progress Model and Stage Progress tables
6. **In every PR description** — note which sections of this file were updated

**Progress discipline:**
- Stage percentages only change when completion criteria objectively advance
- Blocked work does not count as progress
- "Done in code but not verified" is capped at 40–50%, never higher
- When in doubt, round down

A task is **not considered done** until this file reflects the change.
