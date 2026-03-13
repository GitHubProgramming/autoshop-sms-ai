This file defines how Claude Code must operate inside this repository.
Claude must read this file before performing any work.

# CLAUDE EXECUTION AGENT

## Mission

Move the project toward:

working MVP → first pilot shop → first paying customer.

Always optimize for:

1. working demo path
2. reliability of the core flow
3. visibility of blockers
4. speed to pilot
5. speed to first payment

Protect the core flow:

missed call
→ SMS sent
→ customer replies
→ AI conversation
→ booking detected
→ appointment created
→ Google Calendar updated

Do not optimize work that does not improve this flow.

---

## Hard Rules

1. Always work on branch `ai/<task-name>`
2. Smallest safe patch only
3. Do not refactor unrelated systems
4. Never invent progress or verification
5. Never claim "live-tested" without real verification
6. Never modify production workflows
7. Never invent credentials or secrets
8. Prefer repository evidence over assumptions

---

## Autonomous Delivery Rule

When a task requires making the change live:

Continue the delivery path yourself if repository permissions allow it:

1. commit required changes
2. push the branch
3. open a pull request if main is protected
4. merge the pull request
5. verify CI
6. verify deployment
7. verify the live behavior when possible

If direct push to main is blocked:
recover automatically via pull request flow.

Do not stop at "code fixed" if deployment is required.

---

## Secret Handling Rule

Never print, echo, expose, or quote:

* tokens
* passwords
* cookies
* auth headers
* API keys
* git credential output
* environment secrets

Never display credential values from:

* git credential helpers
* environment variables
* CLI authentication output
* configuration files

If authentication is missing:
report only that authentication is missing.

Never reveal secret values.

---

## Status System

Project state lives in:

project-brain/project_status.md
project-brain/project_status.json

Rules:

* update status only if project reality changed
* keep md/json aligned
* do not change stage percentages unless justified
* when uncertain, round progress down

---

## Work Cycle

At session start:

1. read `AI_WORK.md`
2. read `AI_STATUS.md`
3. read `project-brain/project_status.md`
4. read `project-brain/project_status.json`

Then:

1. inspect repository
2. select the highest-value blocker
3. implement the smallest safe fix
4. verify
5. run verification

bash scripts/ai-verify.sh

6. update AI_STATUS.md
7. update project status if reality changed
8. send completion notification
9. commit
10. push

---

## Live Verification Rule

If a task affects production behavior:

Verify the live endpoint, service, or UI behavior when possible.

If authentication blocks full verification:

state exactly what was verified publicly and what requires authenticated confirmation.

---

## Output Format

Return:

1. files changed
2. verification commands run
3. verification result
4. status files updated (yes/no)
5. blockers discovered
6. next recommended task
