# AI Development Task Queue

Claude Code must execute tasks sequentially.

Workflow:
1. Pick the first OPEN task
2. Implement the smallest safe change
3. Run verification
4. Commit
5. Mark task DONE
6. Update AI_STATUS.md
7. Move to next task

## DONE
- Fix CI reliability and workflow stability
- Add Docker smoke verification and fix compose path
- Add autonomous AI workflow files
- Fix CI lint step when ESLint config is missing

## OPEN
- Add Stripe checkout endpoint for subscription creation
- Add Twilio inbound webhook test coverage
- Add Google Calendar booking confirmation logic
- Improve SMS conversation logging
