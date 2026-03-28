#!/bin/bash
# Telegram Task Intake — Polling Mode
#
# Polls for new Telegram messages and submits them as dev-loop tasks.
# Works without a public URL (uses getUpdates polling instead of webhooks).
#
# Usage:
#   ./scripts/telegram-task-poll.sh              # poll once
#   ./scripts/telegram-task-poll.sh --loop       # poll every 10 seconds
#   ./scripts/telegram-task-poll.sh --loop 30    # poll every 30 seconds
#
# Requires: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID in .env
# Optional: INTERNAL_API_KEY (for API task registration)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${REPO_ROOT}/.env"

# Load specific env vars (safe parsing — no eval of arbitrary values)
if [ -f "$ENV_FILE" ]; then
  TELEGRAM_BOT_TOKEN=$(grep "^TELEGRAM_BOT_TOKEN=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d ' \r\n"'"'"'')
  TELEGRAM_CHAT_ID=$(grep "^TELEGRAM_CHAT_ID=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d ' \r\n"'"'"'')
  INTERNAL_API_KEY=$(grep "^INTERNAL_API_KEY=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d ' \r\n"'"'"'')
fi

TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
INTERNAL_API_KEY="${INTERNAL_API_KEY:-}"
API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"
N8N_BASE_URL="${N8N_BASE_URL:-http://localhost:5678}"
OFFSET_FILE="${REPO_ROOT}/scripts/tasks/.telegram_offset"

if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then
  echo "[telegram-poll] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set. Exiting."
  exit 1
fi

TG_API="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}"

# Get stored offset (skip already-processed messages)
OFFSET=0
if [ -f "$OFFSET_FILE" ]; then
  OFFSET=$(cat "$OFFSET_FILE")
fi

poll_once() {
  # Fetch updates from Telegram
  local updates
  updates=$(curl -s "${TG_API}/getUpdates?offset=${OFFSET}&timeout=5" 2>/dev/null)

  local ok
  ok=$(echo "$updates" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).ok)}catch(e){console.log('false')}})" 2>/dev/null)

  if [ "$ok" != "true" ]; then
    echo "[telegram-poll] Failed to fetch updates"
    return
  fi

  # Process each message
  echo "$updates" | node -e "
    process.stdin.resume();
    let d='';
    process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{
      const data=JSON.parse(d);
      const results=data.result||[];
      if(results.length===0){process.exit(0)}
      results.forEach(u=>{
        const msg=u.message||{};
        const text=(msg.text||'').trim();
        const chatId=msg.chat?.id;
        const updateId=u.update_id;
        if(text&&String(chatId)==='${TELEGRAM_CHAT_ID}'){
          console.log(JSON.stringify({updateId,chatId,text,messageId:msg.message_id}));
        }else{
          // Output offset update only
          console.error('skip:'+updateId);
        }
      });
    });
  " 2>/dev/null | while IFS= read -r line; do
    local text chatId updateId messageId
    updateId=$(echo "$line" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).updateId))" 2>/dev/null)
    text=$(echo "$line" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).text))" 2>/dev/null)
    chatId=$(echo "$line" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).chatId))" 2>/dev/null)

    # Skip /start and /help commands
    if [[ "$text" == /start* ]] || [[ "$text" == /help* ]]; then
      curl -s -X POST "${TG_API}/sendMessage" -d "chat_id=${chatId}" \
        -d "text=Send a plain text message describing a task. Example:

Add a formatPhoneNumber utility that normalizes US phone numbers to E.164" > /dev/null 2>&1
      echo "[telegram-poll] Sent help response"
      echo $((updateId + 1)) > "$OFFSET_FILE"
      continue
    fi

    # Strip /task prefix if present
    local taskText="$text"
    if [[ "$taskText" == /task\ * ]]; then
      taskText="${taskText:6}"
    fi

    # Generate task_id
    local ts shortHash taskId title
    ts=$(date +%s)
    shortHash=$(printf '%s' "$ts" | tail -c 6)
    taskId="tg-${shortHash}"
    title=$(echo "$taskText" | head -1 | cut -c1-60)

    echo "[telegram-poll] New task: ${taskId} — ${title}"

    # Build task contract JSON
    local taskJson
    taskJson=$(node -e "
      console.log(JSON.stringify({
        task_id: '${taskId}',
        title: $(echo "$title" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.stringify(d.trim())))" 2>/dev/null),
        goal: $(echo "$taskText" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.stringify(d.trim())))" 2>/dev/null),
        scope_boundaries: [],
        files_allowed: ['apps/api/**', 'packages/shared/**'],
        files_forbidden: ['**/auth/**','**/billing/**','**/stripe/**','**/twilio/**','**/oauth/**','**/provisioning/**','**/deploy/**','**/migration/**'],
        critical_systems_risk: false,
        expected_output: [],
        checks_required: ['typecheck']
      }));
    " 2>/dev/null)

    # Submit to orchestrator
    echo "[telegram-poll] Submitting to orchestrator..."
    local orchResult
    orchResult=$(curl -s --max-time 300 -X POST -H "Content-Type: application/json" \
      -d "$taskJson" \
      "${N8N_BASE_URL}/webhook/dev-loop-task" 2>/dev/null)

    # Extract status for reply
    local status decision branch
    status=$(echo "$orchResult" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);const rp=j.review_packet||{};console.log(rp.goal_match==='full'?'done':j.action==='ESCALATE'?'escalated':rp.goal_match||'submitted')}catch(e){console.log('submitted')}})" 2>/dev/null)
    decision=$(echo "$orchResult" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.review_packet?.recommended_decision||j.action||'')}catch(e){console.log('')}})" 2>/dev/null)
    branch=$(echo "$orchResult" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.review_packet?.branch||'')}catch(e){console.log('')}})" 2>/dev/null)

    # Build reply
    local reply="Task: ${taskId}
Title: ${title}
Status: ${status}"
    [ -n "$decision" ] && reply="${reply}
Decision: ${decision}"
    [ -n "$branch" ] && reply="${reply}
Branch: ${branch}"

    # Send Telegram reply
    curl -s -X POST "${TG_API}/sendMessage" \
      -d "chat_id=${chatId}" \
      --data-urlencode "text=${reply}" > /dev/null 2>&1

    echo "[telegram-poll] Reply sent. Status: ${status}, Decision: ${decision}"

    # Update offset
    echo $((updateId + 1)) > "$OFFSET_FILE"
  done

  # Update offset for skipped messages too
  local maxOffset
  maxOffset=$(echo "$updates" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const r=JSON.parse(d).result||[];if(r.length>0)console.log(r[r.length-1].update_id+1);else console.log('')}catch(e){console.log('')}})" 2>/dev/null)
  if [ -n "$maxOffset" ] && [ "$maxOffset" -gt "$OFFSET" ] 2>/dev/null; then
    echo "$maxOffset" > "$OFFSET_FILE"
  fi
}

# Main
mkdir -p "$(dirname "$OFFSET_FILE")"

if [ "${1:-}" = "--loop" ]; then
  INTERVAL="${2:-10}"
  echo "[telegram-poll] Polling every ${INTERVAL}s. Press Ctrl+C to stop."
  while true; do
    poll_once
    sleep "$INTERVAL"
  done
else
  poll_once
fi
