#!/usr/bin/env bash
# n8n-deploy.sh — Deploy workflow JSON files from repo into n8n via REST API
#
# Usage:
#   N8N_URL=http://localhost:5678 N8N_API_KEY=your-key bash scripts/n8n-deploy.sh [project]
#
# Arguments:
#   project  — Deploy only a specific project folder (US_AutoShop, TEST, LT_Proteros).
#              If omitted, deploys all projects.
#
# Environment:
#   N8N_URL      — n8n instance URL (default: http://localhost:5678)
#   N8N_API_KEY  — n8n API key (required, generate in n8n Settings > API)
#   DRY_RUN      — Set to "true" to only show what would be deployed

set -euo pipefail

N8N_URL="${N8N_URL:-http://localhost:5678}"
DRY_RUN="${DRY_RUN:-false}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKFLOWS_DIR="$SCRIPT_DIR/../n8n/workflows"
PROJECT_FILTER="${1:-}"

if [ -z "${N8N_API_KEY:-}" ]; then
  echo "ERROR: N8N_API_KEY is required. Generate one in n8n Settings > API."
  exit 1
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

deployed=0
failed=0
skipped=0
transferred=0
transfer_failed=0

# Strip fields that n8n API does not accept in request body.
# The API only accepts: name, nodes, connections, settings, staticData.
# Fields like id, active, pinData, versionId, tags cause HTTP 400.
strip_payload() {
  local file="$1"
  node -e "
    const fs = require('fs');
    const wf = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    delete wf.id;
    delete wf.active;
    delete wf.pinData;
    delete wf.versionId;
    delete wf.meta;
    delete wf.createdAt;
    delete wf.updatedAt;
    delete wf.tags;
    process.stdout.write(JSON.stringify(wf));
  " "$file"
}

# ─── Project ID Resolution ───────────────────────────────────────────────
# Fetches all n8n projects and builds an associative map: project_name -> project_id
# The n8n API returns projects at GET /api/v1/projects
declare -A PROJECT_IDS

resolve_project_ids() {
  echo -e "${BLUE}Resolving n8n project IDs...${NC}"

  local response http_code body
  response="$(curl -s -w "\n%{http_code}" \
    -H "X-N8N-API-KEY: $N8N_API_KEY" \
    -H "accept: application/json" \
    "$N8N_URL/api/v1/projects")"

  http_code="$(echo "$response" | tail -1)"
  body="$(echo "$response" | sed '$d')"

  if [ "$http_code" != "200" ]; then
    echo -e "  ${YELLOW}WARNING${NC}: Could not list projects (HTTP $http_code). Workflows will deploy without project placement."
    echo "  Response: $body"
    return
  fi

  # Parse project names and IDs from the API response
  # Response format: { "data": [ { "id": "...", "name": "...", "type": "..." }, ... ] }
  local mapping
  mapping="$(node -e "
    const resp = JSON.parse(process.argv[1]);
    const projects = resp.data || resp;
    if (Array.isArray(projects)) {
      projects.forEach(p => {
        if (p.name && p.id) {
          console.log(p.name + '=' + p.id);
        }
      });
    }
  " "$body" 2>/dev/null || echo "")"

  if [ -z "$mapping" ]; then
    echo -e "  ${YELLOW}WARNING${NC}: No projects found or unexpected response format."
    echo "  Response: $body"
    return
  fi

  while IFS='=' read -r name id; do
    if [ -n "$name" ] && [ -n "$id" ]; then
      PROJECT_IDS["$name"]="$id"
      echo -e "  Found project: ${GREEN}$name${NC} -> $id"
    fi
  done <<< "$mapping"

  echo ""
}

# Transfer a workflow to the correct n8n project after create/update
transfer_to_project() {
  local wf_id="$1"
  local project="$2"
  local wf_name="$3"

  local project_id="${PROJECT_IDS[$project]:-}"

  if [ -z "$project_id" ]; then
    echo -e "    ${YELLOW}SKIP TRANSFER${NC} — no n8n project found matching '$project'"
    return
  fi

  # Check current project assignment by fetching the workflow
  # The GET response may include a parentProject or project field
  local get_resp
  get_resp="$(curl -s \
    -H "X-N8N-API-KEY: $N8N_API_KEY" \
    "$N8N_URL/api/v1/workflows/$wf_id")"

  local current_project_id
  current_project_id="$(node -e "
    const wf = JSON.parse(process.argv[1]);
    const pid = (wf.projectId) || (wf.parentProject && wf.parentProject.id) || '';
    process.stdout.write(pid);
  " "$get_resp" 2>/dev/null || echo "")"

  if [ "$current_project_id" = "$project_id" ]; then
    echo -e "    ${GREEN}ALREADY IN PROJECT${NC} '$project'"
    return
  fi

  echo -n "    Transferring to project '$project' ($project_id) ... "

  local transfer_body
  transfer_body="{\"destinationProjectId\":\"$project_id\"}"

  local response http_code body
  response="$(curl -s -w "\n%{http_code}" \
    -X PUT \
    -H "X-N8N-API-KEY: $N8N_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$transfer_body" \
    "$N8N_URL/api/v1/workflows/$wf_id/transfer")"

  http_code="$(echo "$response" | tail -1)"
  body="$(echo "$response" | sed '$d')"

  if [ "$http_code" = "200" ] || [ "$http_code" = "204" ]; then
    echo -e "${GREEN}TRANSFERRED${NC}"
    transferred=$((transferred + 1))
  else
    echo -e "${RED}TRANSFER FAILED (HTTP $http_code)${NC}"
    echo "    Response: $body"
    transfer_failed=$((transfer_failed + 1))
  fi
}

deploy_workflow() {
  local file="$1"
  local project="$2"
  local filename
  filename="$(basename "$file")"

  # Extract workflow ID and name from JSON
  local wf_id wf_name
  wf_id="$(node -e "const d=require('$file'); process.stdout.write(d.id || '')" 2>/dev/null || echo "")"
  wf_name="$(node -e "const d=require('$file'); process.stdout.write(d.name || '')" 2>/dev/null || echo "$filename")"

  if [ -z "$wf_id" ]; then
    echo -e "  ${YELLOW}SKIP${NC} $filename — no 'id' field in JSON"
    skipped=$((skipped + 1))
    return
  fi

  echo -n "  [$project] $wf_name ($wf_id) ... "

  if [ "$DRY_RUN" = "true" ]; then
    local project_id="${PROJECT_IDS[$project]:-none}"
    echo -e "${YELLOW}DRY RUN${NC} (target project: $project_id)"
    skipped=$((skipped + 1))
    return
  fi

  # Build the cleaned payload (without id, active, pinData, versionId)
  local payload
  payload="$(strip_payload "$file")"

  # Check if workflow already exists in n8n
  local http_code response_body
  http_code="$(curl -s -o /dev/null -w "%{http_code}" \
    -H "X-N8N-API-KEY: $N8N_API_KEY" \
    "$N8N_URL/api/v1/workflows/$wf_id")"

  local action_result=""

  if [ "$http_code" = "200" ]; then
    # Update existing workflow
    response_body="$(curl -s -w "\n%{http_code}" \
      -X PUT \
      -H "X-N8N-API-KEY: $N8N_API_KEY" \
      -H "Content-Type: application/json" \
      -d "$payload" \
      "$N8N_URL/api/v1/workflows/$wf_id")"

    http_code="$(echo "$response_body" | tail -1)"
    response_body="$(echo "$response_body" | sed '$d')"

    if [ "$http_code" = "200" ]; then
      echo -e "${GREEN}UPDATED${NC}"
      deployed=$((deployed + 1))
      action_result="ok"
    else
      echo -e "${RED}FAILED (HTTP $http_code)${NC}"
      echo "    Response: $response_body"
      failed=$((failed + 1))
    fi
  else
    # Create new workflow — include the id in payload so n8n uses our ID
    local create_payload
    create_payload="$(node -e "
      const fs = require('fs');
      const wf = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
      const clean = {
        id: wf.id,
        name: wf.name,
        nodes: wf.nodes || [],
        connections: wf.connections || {},
        settings: wf.settings || {}
      };
      if (wf.staticData) clean.staticData = wf.staticData;
      process.stdout.write(JSON.stringify(clean));
    " "$file")"

    response_body="$(curl -s -w "\n%{http_code}" \
      -X POST \
      -H "X-N8N-API-KEY: $N8N_API_KEY" \
      -H "Content-Type: application/json" \
      -d "$create_payload" \
      "$N8N_URL/api/v1/workflows")"

    http_code="$(echo "$response_body" | tail -1)"
    response_body="$(echo "$response_body" | sed '$d')"

    if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
      # Extract the actual ID assigned by n8n (may differ from our requested ID)
      local created_id
      created_id="$(node -e "
        const r = JSON.parse(process.argv[1]);
        process.stdout.write(r.id || '');
      " "$response_body" 2>/dev/null || echo "$wf_id")"

      if [ -n "$created_id" ] && [ "$created_id" != "$wf_id" ]; then
        echo -e "${GREEN}CREATED${NC} (assigned id: $created_id)"
        wf_id="$created_id"
      else
        echo -e "${GREEN}CREATED${NC}"
      fi
      deployed=$((deployed + 1))
      action_result="ok"
    else
      echo -e "${RED}FAILED (HTTP $http_code)${NC}"
      echo "    Response: $response_body"
      failed=$((failed + 1))
    fi
  fi

  # After successful create/update, transfer to correct project
  if [ "$action_result" = "ok" ]; then
    transfer_to_project "$wf_id" "$project" "$wf_name"
  fi
}

# Activate a workflow after deploy
activate_workflow() {
  local file="$1"
  local wf_id
  wf_id="$(node -e "const d=require('$file'); process.stdout.write(d.id || '')" 2>/dev/null || echo "")"

  if [ -z "$wf_id" ] || [ "$DRY_RUN" = "true" ]; then
    return
  fi

  curl -s -o /dev/null \
    -X POST \
    -H "X-N8N-API-KEY: $N8N_API_KEY" \
    "$N8N_URL/api/v1/workflows/$wf_id/activate" 2>/dev/null || true
}

echo "========================================="
echo " n8n Workflow Deploy"
echo " Target: $N8N_URL"
echo " Dry run: $DRY_RUN"
echo "========================================="
echo ""

# Step 1: Resolve project IDs from n8n
resolve_project_ids

# Step 2: Deploy each project folder (skip _archive)
for project_dir in "$WORKFLOWS_DIR"/*/; do
  project="$(basename "$project_dir")"

  # Skip archive
  if [ "$project" = "_archive" ]; then
    continue
  fi

  # Filter by project if specified
  if [ -n "$PROJECT_FILTER" ] && [ "$project" != "$PROJECT_FILTER" ]; then
    continue
  fi

  # Find workflow JSON files
  json_files=("$project_dir"/*.json)
  if [ ! -e "${json_files[0]:-}" ]; then
    echo "[$project] No workflow files found"
    continue
  fi

  echo "[$project] (target n8n project: ${PROJECT_IDS[$project]:-NOT FOUND})"
  for f in "${json_files[@]}"; do
    if [ -f "$f" ]; then
      deploy_workflow "$f" "$project"
      activate_workflow "$f"
    fi
  done
  echo ""
done

echo "========================================="
echo -e " Deploy:    ${GREEN}$deployed deployed${NC}, ${RED}$failed failed${NC}, ${YELLOW}$skipped skipped${NC}"
echo -e " Placement: ${GREEN}$transferred transferred${NC}, ${RED}$transfer_failed transfer failed${NC}"
echo "========================================="

if [ "$failed" -gt 0 ] || [ "$transfer_failed" -gt 0 ]; then
  exit 1
fi
