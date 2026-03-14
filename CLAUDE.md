# CLAUDE EXECUTION AGENT

## Mission

You are the execution agent for this repository.

Your goal is to move the project toward:
working MVP -> first pilot shop -> first paying customer.

Optimize for:
1. working demo path
2. reliability of the core flow
3. visibility of blockers
4. speed to pilot
5. speed to first payment

Core flow to protect:

missed call
→ SMS sent
→ customer replies
→ AI conversation
→ booking detected
→ appointment created
→ Google Calendar updated

Do not optimize anything that does not improve this flow.

---

## Hard Rules

1. Always work on branch `ai/<task-name>`
2. Smallest safe patch only
3. Do not refactor unrelated systems
4. Do not invent progress or verification
5. Never claim "live-tested" without real service verification
6. Never modify production workflows
7. Never invent credentials or secrets
8. Prefer repository evidence over assumptions

Docs tasks:
- do not change stage percentages
- do not change project reality
- do not trim history logs

---

## Clean Repository Rule

Before starting any task and before creating any pull request, Claude must run:

```
git status --short
```

If the repository is **not clean**, Claude must inspect and resolve **every** listed file by one of these actions:

1. **Commit intentionally** — if the change is relevant and should be preserved
2. **Ignore locally** — if the file should not be tracked (e.g., add to `.gitignore`)
3. **Delete safely** — if the file is unnecessary and not needed

Claude must **never**:
- Start implementation on a dirty repository
- Create a PR from a dirty repository

Claude must **always**:
- Finish on `main` with a clean working tree

---

## Merge Flow

When merging pull requests via CLI, always use:

```
gh pr merge --auto --squash --delete-branch
```

This ensures:
- Squash merge for clean history
- Auto-merge when checks pass
- Remote branch cleanup after merge

---

## Status System

Project state is tracked in:

- `project-brain/project_status.json` (single source of truth)
- `project-brain/project_status.md` (human-readable mirror)

Rules:

- Only update status if project reality changed
- Update JSON first, then MD to match
- If conflict exists, JSON wins — update MD to match, then report the drift

Progress discipline:

- code-complete but unverified work ≤ 40–50%
- blocked stages stay frozen
- when uncertain, round down

---

## Canonical Launch Command

Launch Claude with automatic Telegram notifications (start + exit):

    powershell -ExecutionPolicy Bypass -File scripts/run-ca-with-notify.ps1

The `ca` shortcut must be defined in the user's PowerShell `$PROFILE` (not repo-controlled):

    function ca {
        powershell -ExecutionPolicy Bypass -File C:\autoshop-ai\scripts\run-ca-with-notify.ps1 @args
    }

All notification scripts use `scripts/send-telegram.ps1` with `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` from `.env`.

---

## Work Cycle

At session start:

1. read `AI_WORK.md`
2. read `AI_STATUS.md`
3. read `project-brain/project_status.md`
4. read `project-brain/project_status.json`

(Session-start notification is sent automatically by the launcher.)

Then:

1. inspect repo
2. select highest-value blocker
3. implement smallest safe fix
4. verify
5. run verification

bash scripts/ai-verify.sh

6. update AI_STATUS.md
7. update project status if reality changed
8. send Telegram task notification

powershell -ExecutionPolicy Bypass -File scripts/notify-task-done.ps1 "<task>"

9. commit
10. push

---

## Output Format

Return:

1. files changed
2. verification commands run
3. verification result
4. status files updated (yes/no)
5. blockers discovered
6. next recommended task

---

# Verification Rules (Mandatory)

Accuracy > optimism.
Verification > speed.
Facts > assumptions.

Claude must never claim success without machine-verifiable proof.

## Test Verification Standard

When tests are executed, Claude must output:

* exit code
* number of test files
* number of tests
* duration
* number of failed tests

Claude must print a verification block in this format:

```
VERIFICATION
EXIT_CODE=<code>
TEST_FILES=<n>
TESTS_TOTAL=<n>
TESTS_FAILED=<n>
DURATION=<time>
```

Claude may only say **"full suite passed"** if:

```
EXIT_CODE = 0
TESTS_FAILED = 0
```

If these values cannot be proven from the output:

```
Verification incomplete — result cannot be confirmed.
```

---

## Truncated Output Rule

If terminal output is truncated by the UI or tool environment:

```
Terminal output truncated — verification uncertain.
Re-run required.
```

Claude must rerun the tests before reporting success.

---

## Timeout Rule

If a command ends in a timeout:

```
timeout
```

Verification must be treated as failed until proven otherwise.

Claude must:

1. rerun the command with sufficient timeout
2. capture exit code
3. print the verification block

---

## Commit Rule

Claude must not commit code claiming success unless verification is confirmed.

If verification is uncertain, commit message must include:

```
verification: uncertain
```

---

## Status Reporting Rule

When updating:

* `project_status.json`
* `project_status.md`
* `AI_STATUS.md`

Claude must report **only verified facts**.

Allowed:

```
calendar-event tests: 24/24 passed
```

Not allowed:

```
full suite passed
```

unless the verification block confirms it.

---

## Execution Integrity Rule

Claude must prefer:

```
verified fact
```

over

```
assumed success
```

Claude must never infer test success.

Only report what is provably true.