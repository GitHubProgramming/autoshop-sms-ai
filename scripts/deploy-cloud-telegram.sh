#!/bin/bash
# Deploy dev-loop + Telegram workflows to n8n Cloud
#
# Prerequisites:
#   1. Generate a fresh API key in n8n Cloud: Settings > API > Create API Key
#   2. Get the production INTERNAL_API_KEY from Render Dashboard:
#      Dashboard > autoshop-api > Environment > INTERNAL_API_KEY
#   3. Set in .env.local:
#      N8N_URL=https://bandomasis.app.n8n.cloud
#      N8N_API_KEY=<fresh key from step 1>
#
# Usage:
#   bash scripts/deploy-cloud-telegram.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# Load cloud config
ENV_LOCAL="${REPO_ROOT}/.env.local"
if [ ! -f "$ENV_LOCAL" ]; then
  echo "ERROR: .env.local not found. Create it with N8N_URL and N8N_API_KEY."
  exit 1
fi

N8N_URL=$(grep "^N8N_URL=" "$ENV_LOCAL" | cut -d= -f2- | tr -d '\r\n ')
N8N_API_KEY=$(grep "^N8N_API_KEY=" "$ENV_LOCAL" | cut -d= -f2- | tr -d '\r\n ')

if [ -z "$N8N_URL" ] || [ -z "$N8N_API_KEY" ]; then
  echo "ERROR: N8N_URL and N8N_API_KEY must be set in .env.local"
  exit 1
fi

echo "Target: $N8N_URL"

# Verify API access
echo "Verifying API access..."
VERIFY=$(curl -s -w "\n%{http_code}" -H "X-N8N-API-KEY: $N8N_API_KEY" "$N8N_URL/api/v1/workflows?limit=1" 2>/dev/null)
HTTP_CODE=$(echo "$VERIFY" | tail -1)
if [ "$HTTP_CODE" != "200" ]; then
  echo "ERROR: Cannot access n8n Cloud API (HTTP $HTTP_CODE)."
  echo "Generate a fresh API key in n8n Cloud: Settings > API > Create API Key"
  echo "Then update N8N_API_KEY in .env.local"
  exit 1
fi
echo "API access: OK"

# ── Step 1: Create Telegram credential if it doesn't exist ────────────
echo ""
echo "=== Step 1: Telegram Credential ==="
CRED_EXISTS=$(curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" "$N8N_URL/api/v1/credentials" 2>/dev/null | node -e "
  process.stdin.resume();let d='';
  process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    const creds=(JSON.parse(d).data||[]);
    const tg=creds.find(c=>c.type==='telegramApi');
    console.log(tg?tg.id:'');
  });
" 2>/dev/null)

if [ -n "$CRED_EXISTS" ]; then
  echo "Telegram credential already exists (ID: $CRED_EXISTS)"
  TG_CRED_ID="$CRED_EXISTS"
else
  echo "Creating Telegram credential..."
  TOKEN=$(grep "^TELEGRAM_BOT_TOKEN=" "${REPO_ROOT}/.env" | cut -d= -f2- | tr -d '\r\n "'"'"'')
  if [ -z "$TOKEN" ]; then
    echo "ERROR: TELEGRAM_BOT_TOKEN not found in .env"
    exit 1
  fi

  CREATE_RESULT=$(curl -s -X POST \
    -H "X-N8N-API-KEY: $N8N_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"AutoShop Telegram\",\"type\":\"telegramApi\",\"data\":{\"accessToken\":\"${TOKEN}\"}}" \
    "$N8N_URL/api/v1/credentials" 2>/dev/null)

  TG_CRED_ID=$(echo "$CREATE_RESULT" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id||''))" 2>/dev/null)
  if [ -z "$TG_CRED_ID" ]; then
    echo "ERROR: Failed to create credential: $CREATE_RESULT"
    exit 1
  fi
  echo "Telegram credential created (ID: $TG_CRED_ID)"
fi

# ── Step 2: Deploy orchestrator workflow ──────────────────────────────
echo ""
echo "=== Step 2: Dev-Loop Orchestrator ==="
ORCH_FILE="${REPO_ROOT}/n8n/workflows/US_AutoShop/dev-loop-orchestrator.json"

# Check if it exists already
ORCH_EXISTS=$(curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" "$N8N_URL/api/v1/workflows" 2>/dev/null | node -e "
  process.stdin.resume();let d='';
  process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    const wfs=(JSON.parse(d).data||[]);
    const o=wfs.find(w=>w.name.includes('Dev-Loop Orchestrator'));
    console.log(o?o.id:'');
  });
" 2>/dev/null)

ORCH_JSON=$(cat "$ORCH_FILE")
if [ -n "$ORCH_EXISTS" ]; then
  echo "Updating existing orchestrator (ID: $ORCH_EXISTS)..."
  # Extract nodes and connections from the file for the update payload
  UPDATE_PAYLOAD=$(node -e "
    const wf=JSON.parse(require('fs').readFileSync('${ORCH_FILE}','utf8'));
    console.log(JSON.stringify({
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      settings: wf.settings,
      staticData: wf.staticData
    }));
  " 2>/dev/null)
  curl -s -X PATCH \
    -H "X-N8N-API-KEY: $N8N_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$UPDATE_PAYLOAD" \
    "$N8N_URL/api/v1/workflows/$ORCH_EXISTS" > /dev/null 2>&1
  ORCH_ID="$ORCH_EXISTS"
  echo "Orchestrator updated"
else
  echo "Creating orchestrator workflow..."
  CREATE_RESULT=$(curl -s -X POST \
    -H "X-N8N-API-KEY: $N8N_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$ORCH_JSON" \
    "$N8N_URL/api/v1/workflows" 2>/dev/null)
  ORCH_ID=$(echo "$CREATE_RESULT" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id||''))" 2>/dev/null)
  if [ -z "$ORCH_ID" ]; then
    echo "ERROR: Failed to create orchestrator: $CREATE_RESULT"
    exit 1
  fi
  echo "Orchestrator created (ID: $ORCH_ID)"
fi

# Activate orchestrator
echo "Activating orchestrator..."
curl -s -X PATCH \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"active":true}' \
  "$N8N_URL/api/v1/workflows/$ORCH_ID" > /dev/null 2>&1
echo "Orchestrator activated"

# ── Step 3: Deploy Telegram intake workflow ───────────────────────────
echo ""
echo "=== Step 3: Telegram Task Intake ==="
TG_FILE="${REPO_ROOT}/n8n/workflows/US_AutoShop/telegram-task-intake.json"

# Patch the workflow JSON to use the actual credential ID
TG_JSON=$(node -e "
  const wf=JSON.parse(require('fs').readFileSync('${TG_FILE}','utf8'));
  wf.nodes.forEach(n=>{
    if(n.credentials?.telegramApi){
      n.credentials.telegramApi.id='${TG_CRED_ID}';
    }
  });
  console.log(JSON.stringify(wf));
" 2>/dev/null)

TG_EXISTS=$(curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" "$N8N_URL/api/v1/workflows" 2>/dev/null | node -e "
  process.stdin.resume();let d='';
  process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    const wfs=(JSON.parse(d).data||[]);
    const t=wfs.find(w=>w.name.includes('Telegram Task Intake'));
    console.log(t?t.id:'');
  });
" 2>/dev/null)

if [ -n "$TG_EXISTS" ]; then
  echo "Updating existing Telegram intake (ID: $TG_EXISTS)..."
  UPDATE_PAYLOAD=$(echo "$TG_JSON" | node -e "
    process.stdin.resume();let d='';
    process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{
      const wf=JSON.parse(d);
      console.log(JSON.stringify({
        name: wf.name,
        nodes: wf.nodes,
        connections: wf.connections,
        settings: wf.settings,
        staticData: wf.staticData
      }));
    });
  " 2>/dev/null)
  curl -s -X PATCH \
    -H "X-N8N-API-KEY: $N8N_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$UPDATE_PAYLOAD" \
    "$N8N_URL/api/v1/workflows/$TG_EXISTS" > /dev/null 2>&1
  TG_ID="$TG_EXISTS"
  echo "Telegram intake updated"
else
  echo "Creating Telegram intake workflow..."
  CREATE_RESULT=$(curl -s -X POST \
    -H "X-N8N-API-KEY: $N8N_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$TG_JSON" \
    "$N8N_URL/api/v1/workflows" 2>/dev/null)
  TG_ID=$(echo "$CREATE_RESULT" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id||''))" 2>/dev/null)
  if [ -z "$TG_ID" ]; then
    echo "ERROR: Failed to create Telegram intake: $CREATE_RESULT"
    exit 1
  fi
  echo "Telegram intake created (ID: $TG_ID)"
fi

# Activate Telegram intake
echo "Activating Telegram intake..."
ACTIVATE_RESULT=$(curl -s -X PATCH \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"active":true}' \
  "$N8N_URL/api/v1/workflows/$TG_ID" 2>/dev/null)
echo "Telegram intake activated"

# ── Step 4: Verify ────────────────────────────────────────────────────
echo ""
echo "=== Verification ==="
WORKFLOWS=$(curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" "$N8N_URL/api/v1/workflows" 2>/dev/null)
echo "$WORKFLOWS" | node -e "
  process.stdin.resume();let d='';
  process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    const wfs=JSON.parse(d).data||[];
    console.log('Workflows:');
    wfs.forEach(w=>console.log('  '+w.id+' | active='+w.active+' | '+w.name));
  });
" 2>/dev/null

echo ""
echo "=== Required n8n Cloud Environment Variables ==="
echo "Set these in n8n Cloud: Settings > Variables"
echo "  API_BASE_URL = https://autoshop-api-7ek9.onrender.com"
echo "  INTERNAL_API_KEY = <from Render Dashboard > autoshop-api > Environment>"
echo "  ANTHROPIC_API_KEY = <your funded Anthropic key>"
echo "  TELEGRAM_CHAT_ID = $(grep '^TELEGRAM_CHAT_ID=' "${REPO_ROOT}/.env" | cut -d= -f2- | tr -d '\r\n ')"
echo "  N8N_BASE_URL = $N8N_URL"
echo ""
echo "Deploy complete. Send a Telegram message to test."
