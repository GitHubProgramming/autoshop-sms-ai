AUTOLOAD: TRUE
PRIORITY: CRITICAL

PROJECT: AutoShop AI Dashboard

════════════════════════════════════════
CORE EXECUTION RULE
════════════════════════════════════════

This is a LIVE SaaS product.

Work is NOT evaluated by:
- code changes
- commits
- PR merges
- deploy success

Work is evaluated ONLY by:
VISIBLE RESULT in the LIVE UI.

If the UI looks the same → task is NOT complete.

════════════════════════════════════════
MANDATORY LOADING RULE
════════════════════════════════════════

This file MUST be treated as ALWAYS LOADED CONTEXT.

Before making ANY change, the agent MUST:
1. Read this file
2. Follow ALL rules strictly
3. Not override or ignore these rules

════════════════════════════════════════
UI COMPLETENESS RULE
════════════════════════════════════════

Dashboard must NEVER look:
- empty
- weak
- partial
- like a dev/skeleton UI

"Missing data" includes:
- null / undefined
- 0 values
- empty arrays
- empty strings
- partially usable backend data

In ALL such cases:
→ fallback/demo content MUST be rendered

════════════════════════════════════════
DASHBOARD CONTRACT (STRICT)
════════════════════════════════════════

Dashboard MUST ALWAYS show:

1. KPI ROW
- 4 KPI cards
- never empty

2. MAIN VALUE BLOCK (Revenue / Chart)
- must look primary
- never small or weak

3. LIVE ACTIVITY
- minimum 3 visible rows

4. APPOINTMENTS
- multiple rows
- never empty state

5. SYSTEM STATUS
- always filled
- always readable

════════════════════════════════════════
NO HALF-FIX RULE
════════════════════════════════════════

Forbidden:
- partial fixes
- cosmetic-only edits
- fallback applied only in some cases
- "improved but still weak UI"

Every fix MUST:
→ fully solve the visible problem

════════════════════════════════════════
SCOPE RULE
════════════════════════════════════════

- DO NOT change architecture
- DO NOT rewrite system
- DO NOT touch backend unless required

Modify ONLY what is needed to achieve visible UI result.

════════════════════════════════════════
VERIFICATION RULE
════════════════════════════════════════

Before finishing, validate:

"Would a user instantly see the improvement?"

If NO → continue working.

════════════════════════════════════════
FAIL CONDITION
════════════════════════════════════════

If after deploy UI still looks:
- similar
- empty
- incomplete

→ task is FAILED and must be redone.
