#!/bin/bash
# Submit a task to the dev-loop orchestrator webhook
#
# Usage:
#   ./scripts/dev-loop-submit.sh <task.json>
#   ./scripts/dev-loop-submit.sh --example   # print example task contract
#
# The task JSON must conform to the TaskContract schema.
# See docs/dev-loop-contracts.md for the full spec.

set -euo pipefail

N8N_BASE_URL="${N8N_BASE_URL:-http://localhost:5678}"
WEBHOOK_PATH="webhook/dev-loop-task"

if [ "${1:-}" = "--example" ]; then
  cat <<'EXAMPLE'
{
  "task_id": "task-001",
  "title": "Add health check endpoint",
  "goal": "Create a /health endpoint that returns 200 OK with uptime",
  "scope_boundaries": ["Only touch the API server", "Do not modify auth"],
  "files_allowed": ["apps/api/src/routes/**", "apps/api/src/server.ts"],
  "files_forbidden": ["**/auth/**", "**/billing/**", "**/stripe/**"],
  "critical_systems_risk": false,
  "expected_output": ["New /health route file", "Route registered in server"],
  "checks_required": ["typecheck", "test"]
}
EXAMPLE
  exit 0
fi

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <task.json>"
  echo "       $0 --example"
  exit 1
fi

TASK_FILE="$1"

if [ ! -f "$TASK_FILE" ]; then
  echo "Error: File not found: $TASK_FILE"
  exit 1
fi

# Validate JSON
if ! python3 -c "import json; json.load(open('$TASK_FILE'))" 2>/dev/null && \
   ! node -e "JSON.parse(require('fs').readFileSync('$TASK_FILE','utf8'))" 2>/dev/null; then
  echo "Error: Invalid JSON in $TASK_FILE"
  exit 1
fi

echo "Submitting task to dev-loop orchestrator..."
echo "URL: ${N8N_BASE_URL}/${WEBHOOK_PATH}"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -d @"$TASK_FILE" \
  "${N8N_BASE_URL}/${WEBHOOK_PATH}")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP Status: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  echo "Task submitted successfully."
  echo ""
  echo "Response:"
  echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
else
  echo "Error submitting task."
  echo "$BODY"
  exit 1
fi
