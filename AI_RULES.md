# AI Development Rules

Claude must follow these rules:

1. Always create and work from branch ai/<task-name>
2. Never commit directly to main
3. Always run verification before commit:

bash scripts/ai-verify.sh

4. If verification fails:
- fix the problem
- rerun verification
- only then commit

5. Always produce the smallest safe patch
6. Do not refactor unrelated areas
7. Do not rewrite architecture unless explicitly required
