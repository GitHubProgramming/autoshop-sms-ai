# AI WORK CONTROLLER

## PRIMARY GOAL
Reach a demo-ready MVP for AutoShop SMS AI for Texas independent auto repair shops.

Target flow:
missed call -> SMS -> AI conversation -> appointment booking -> Google Calendar

## CURRENT BUSINESS PRIORITY
Get to the fastest path toward:
1. working internal demo
2. first pilot shop
3. first paying customer

## EXECUTION MODE
Autonomous execution.

Work in small, safe, verifiable steps.
Do not brainstorm endlessly.
Inspect, verify, fix, commit, push, report with evidence.

## HARD RULES
- Make the smallest safe change possible.
- Do not refactor unrelated code.
- Do not invent completion. Verify it.
- Prefer evidence over assumptions.
- If a task is too large, break it into the next smallest executable step.
- Never leave the repo in a worse state.
- Preserve working behavior unless a change is required for the MVP path.
- If you change logic, explain why in AI_STATUS.md.
- If you find a blocker, document the blocker and the exact next action.

## PRIORITY ORDER
1. End-to-end missed call -> SMS flow
2. AI SMS conversation reliability
3. Appointment detection / booking logic
4. Google Calendar write success
5. Activation / onboarding clarity
6. Billing and polish only after demo path works

## REQUIRED LOOP
For every cycle:
1. Inspect repository state
2. Identify the single highest-leverage blocker
3. Fix only that blocker
4. Run the smallest relevant verification
5. Update AI_STATUS.md
6. Commit with clear message
7. Push
8. Repeat

## BLOCKER SELECTION LOGIC
Always prefer the blocker closest to the core revenue path:
missed call -> SMS -> AI -> booking -> calendar

If multiple blockers exist, choose the one that:
- prevents demo flow entirely
- breaks production-critical logic
- creates false success signals
- blocks customer activation

## VERIFICATION STANDARD
Use whatever is already available in the repo:
- tests
- typecheck
- build
- docker compose
- targeted manual verification
- log inspection

If full verification is impossible, perform the best partial verification available and record exactly what was verified and what remains unverified.

## DEFINITION OF "DONE" FOR MVP
The MVP is demo-ready only when all of the following are true:
- inbound trigger path is clear and implemented
- missed call can trigger outbound SMS
- SMS reply can continue conversation
- booking intent can be detected
- appointment can be persisted
- Google Calendar event can be created or queued with visible failure state
- current blockers are documented in AI_STATUS.md
- repo contains enough evidence for another AI to continue instantly

## COMMIT RULES
Commit after every completed meaningful step.

Commit style:
- feat: ...
- fix: ...
- chore: ...
- docs: ...

Examples:
- fix: repair sms inbound worker default n8n url
- fix: add stripe webhook idempotency guard
- docs: update AI status after calendar sync audit

## STOP CONDITIONS
Stop only if:
- required credentials or external services are unavailable and cannot be mocked
- the environment itself is broken
- the next step would be destructive or irreversible

When stopping, document:
- exact blocker
- why it blocks progress
- exact next action to resume
