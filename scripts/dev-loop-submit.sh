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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
N8N_BASE_URL="${N8N_BASE_URL:-http://localhost:5678}"
WEBHOOK_PATH="webhook/dev-loop-task"
RESULTS_DIR="${REPO_ROOT}/scripts/tasks/results"

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

  # Extract task_id for filename
  TASK_ID=$(echo "$BODY" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.review_packet?.task_id||j.task_id||'unknown')}catch(e){console.log('unknown')}})" 2>/dev/null || echo "unknown")
  TIMESTAMP=$(date +%Y%m%d-%H%M%S)
  RESULT_FILE="${RESULTS_DIR}/${TASK_ID}_${TIMESTAMP}.json"

  mkdir -p "$RESULTS_DIR"
  echo "$BODY" > "$RESULT_FILE"

  echo "Result saved: $RESULT_FILE"
  echo ""
  echo "Review packet:"
  echo "$BODY" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.stringify(JSON.parse(d),null,2))}catch(e){console.log(d)}})" 2>/dev/null || echo "$BODY"
else
  echo "Error submitting task (HTTP $HTTP_CODE)."
  echo "$BODY"
  exit 1
fi
