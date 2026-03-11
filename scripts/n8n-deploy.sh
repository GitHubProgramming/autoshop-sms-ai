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
#   N8N_TARGET_PROJECT — Name of the single n8n project containing all folders
#                        (default: "AutoShop Production")
#   N8N_EMAIL    — n8n login email (optional, for internal API cookie auth fallback)
#   N8N_PASSWORD — n8n login password (optional, for internal API cookie auth fallback)

set -euo pipefail

N8N_URL="${N8N_URL:-http://localhost:5678}"
DRY_RUN="${DRY_RUN:-false}"
N8N_TARGET_PROJECT="${N8N_TARGET_PROJECT:-AutoShop Production}"
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
folder_placed=0
folder_place_failed=0

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

# ─── Folder ID Resolution ───────────────────────────────────────────────
# Fetches folders inside the target project using n8n internal API.
# The folder endpoint is: GET /rest/projects/:projectId/folders
# This is NOT part of the public API (/api/v1/) — it uses the internal /rest/ API.
# Auth: tries X-N8N-API-KEY header first, falls back to cookie-based login.
declare -A FOLDER_IDS
INTERNAL_AUTH_HEADER=""
COOKIE_FILE=""

# Authenticate to internal API via cookie login (fallback if API key doesn't work)
login_internal_api() {
  if [ -z "${N8N_EMAIL:-}" ] || [ -z "${N8N_PASSWORD:-}" ]; then
    echo -e "  ${YELLOW}WARNING${NC}: N8N_EMAIL/N8N_PASSWORD not set — cannot authenticate to internal API for folder placement."
    return 1
  fi

  COOKIE_FILE="$(mktemp)"
  local login_body
  login_body="{\"email\":\"${N8N_EMAIL}\",\"password\":\"${N8N_PASSWORD}\"}"

  local response http_code body
  response="$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -c "$COOKIE_FILE" \
    -d "$login_body" \
    "$N8N_URL/rest/login")"

  http_code="$(echo "$response" | tail -1)"
  body="$(echo "$response" | sed '$d')"

  if [ "$http_code" = "200" ]; then
    echo -e "  ${GREEN}Internal API login OK${NC}"
    INTERNAL_AUTH_HEADER="cookie"
    return 0
  else
    echo -e "  ${YELLOW}WARNING${NC}: Internal API login failed (HTTP $http_code)"
    echo "  Response: $body"
    rm -f "$COOKIE_FILE"
    COOKIE_FILE=""
    return 1
  fi
}

# Build curl auth args for internal API calls
internal_api_curl_auth() {
  if [ "$INTERNAL_AUTH_HEADER" = "cookie" ] && [ -n "$COOKIE_FILE" ]; then
    echo "-b $COOKIE_FILE"
  else
    echo "-H X-N8N-API-KEY:${N8N_API_KEY}"
  fi
}

resolve_folder_ids() {
  local target_project_id="${PROJECT_IDS[$N8N_TARGET_PROJECT]:-}"

  if [ -z "$target_project_id" ]; then
    echo -e "${YELLOW}SKIP FOLDER RESOLUTION${NC} — target project '$N8N_TARGET_PROJECT' not found in n8n."
    echo -e "  Available projects: ${!PROJECT_IDS[*]}"
    return
  fi

  echo -e "${BLUE}Resolving folder IDs inside project '$N8N_TARGET_PROJECT' ($target_project_id)...${NC}"

  # Try internal API with API key first
  local response http_code body
  response="$(curl -s -w "\n%{http_code}" \
    -H "X-N8N-API-KEY: $N8N_API_KEY" \
    -H "accept: application/json" \
    "$N8N_URL/rest/projects/$target_project_id/folders")"

  http_code="$(echo "$response" | tail -1)"
  body="$(echo "$response" | sed '$d')"

  # If API key doesn't work for internal endpoint, try cookie auth
  if [ "$http_code" = "401" ] || [ "$http_code" = "403" ]; then
    echo -e "  ${YELLOW}API key auth failed for internal API (HTTP $http_code), trying cookie login...${NC}"
    if login_internal_api; then
      response="$(curl -s -w "\n%{http_code}" \
        -b "$COOKIE_FILE" \
        -H "accept: application/json" \
        "$N8N_URL/rest/projects/$target_project_id/folders")"
      http_code="$(echo "$response" | tail -1)"
      body="$(echo "$response" | sed '$d')"
    fi
  elif [ "$http_code" = "200" ]; then
    INTERNAL_AUTH_HEADER="apikey"
  fi

  if [ "$http_code" != "200" ]; then
    echo -e "  ${YELLOW}WARNING${NC}: Could not list folders (HTTP $http_code). Workflows will deploy without folder placement."
    echo "  Response: $body"
    return
  fi

  # Parse folder names and IDs
  # Response format: { "data": [ { "id": "...", "name": "...", ... } ], "count": N }
  local mapping
  mapping="$(node -e "
    const resp = JSON.parse(process.argv[1]);
    const folders = resp.data || resp;
    if (Array.isArray(folders)) {
      folders.forEach(f => {
        if (f.name && f.id) {
          console.log(f.name + '=' + f.id);
        }
      });
    }
  " "$body" 2>/dev/null || echo "")"

  if [ -z "$mapping" ]; then
    echo -e "  ${YELLOW}WARNING${NC}: No folders found inside project '$N8N_TARGET_PROJECT'."
    echo "  Response: $body"
    return
  fi

  while IFS='=' read -r name id; do
    if [ -n "$name" ] && [ -n "$id" ]; then
      FOLDER_IDS["$name"]="$id"
      echo -e "  Found folder: ${GREEN}$name${NC} -> $id"
    fi
  done <<< "$mapping"

  echo ""
}

# ─── Transfer workflow to project ────────────────────────────────────────
# Uses public API: PUT /api/v1/workflows/:id/transfer
transfer_to_project() {
  local wf_id="$1"
  local project="$2"
  local wf_name="$3"

  # All repo folders map to a single n8n project (N8N_TARGET_PROJECT)
  local project_id="${PROJECT_IDS[$N8N_TARGET_PROJECT]:-}"

  if [ -z "$project_id" ]; then
    echo -e "    ${YELLOW}SKIP TRANSFER${NC} — target project '$N8N_TARGET_PROJECT' not found in n8n"
    return
  fi

  # Check current project assignment by fetching the workflow
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
    echo -e "    ${GREEN}ALREADY IN PROJECT${NC} '$N8N_TARGET_PROJECT'"
    return
  fi

  echo -n "    Transferring to project '$N8N_TARGET_PROJECT' ($project_id) ... "

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

# ─── Move workflow into folder ───────────────────────────────────────────
# Uses n8n internal API: PATCH /rest/workflows/:id with { parentFolderId }
# This is the only way to place a workflow into a folder — the public API
# does not support folder placement as of n8n 1.x/2.x.
move_to_folder() {
  local wf_id="$1"
  local folder_name="$2"
  local wf_name="$3"

  local folder_id="${FOLDER_IDS[$folder_name]:-}"

  if [ -z "$folder_id" ]; then
    echo -e "    ${YELLOW}SKIP FOLDER${NC} — no n8n folder found matching '$folder_name'"
    echo -e "    Available folders: ${!FOLDER_IDS[*]:-none}"
    return
  fi

  echo -n "    Moving to folder '$folder_name' ($folder_id) ... "

  # Build the PATCH body — only set parentFolderId to move the workflow
  local patch_body
  patch_body="{\"parentFolderId\":\"$folder_id\"}"

  local response http_code body

  if [ "$INTERNAL_AUTH_HEADER" = "cookie" ] && [ -n "$COOKIE_FILE" ]; then
    response="$(curl -s -w "\n%{http_code}" \
      -X PATCH \
      -b "$COOKIE_FILE" \
      -H "Content-Type: application/json" \
      -d "$patch_body" \
      "$N8N_URL/rest/workflows/$wf_id")"
  else
    response="$(curl -s -w "\n%{http_code}" \
      -X PATCH \
      -H "X-N8N-API-KEY: $N8N_API_KEY" \
      -H "Content-Type: application/json" \
      -d "$patch_body" \
      "$N8N_URL/rest/workflows/$wf_id")"
  fi

  http_code="$(echo "$response" | tail -1)"
  body="$(echo "$response" | sed '$d')"

  if [ "$http_code" = "200" ]; then
    # Verify the folder was actually set by checking the response
    local result_folder
    result_folder="$(node -e "
      const wf = JSON.parse(process.argv[1]);
      const fid = (wf.parentFolder && wf.parentFolder.id) || wf.parentFolderId || '';
      process.stdout.write(fid);
    " "$body" 2>/dev/null || echo "")"

    if [ "$result_folder" = "$folder_id" ]; then
      echo -e "${GREEN}PLACED IN FOLDER${NC} (verified)"
      folder_placed=$((folder_placed + 1))
    elif [ -n "$result_folder" ]; then
      echo -e "${GREEN}PLACED IN FOLDER${NC} (response folderId: $result_folder)"
      folder_placed=$((folder_placed + 1))
    else
      echo -e "${GREEN}PATCH OK${NC} (folder not confirmed in response — check n8n UI)"
      folder_placed=$((folder_placed + 1))
    fi
  else
    echo -e "${RED}FOLDER MOVE FAILED (HTTP $http_code)${NC}"
    echo "    Response: $(echo "$body" | head -c 300)"
    folder_place_failed=$((folder_place_failed + 1))
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
    local project_id="${PROJECT_IDS[$N8N_TARGET_PROJECT]:-none}"
    local folder_id="${FOLDER_IDS[$project]:-none}"
    echo -e "${YELLOW}DRY RUN${NC} (target project: $project_id, target folder: $folder_id)"
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
    # Create new workflow — n8n cloud treats 'id' as read-only, so omit it.
    # The n8n-assigned ID is captured from the response for subsequent operations.
    local create_payload
    create_payload="$(node -e "
      const fs = require('fs');
      const wf = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
      const clean = {
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
      # n8n assigns its own ID — capture it for transfer + folder placement
      local created_id
      created_id="$(node -e "
        const r = JSON.parse(process.argv[1]);
        process.stdout.write(r.id || '');
      " "$response_body" 2>/dev/null || echo "")"

      if [ -n "$created_id" ]; then
        echo -e "${GREEN}CREATED${NC} (n8n id: $created_id)"
        wf_id="$created_id"
      else
        echo -e "${RED}CREATED but no ID in response — cannot transfer/place${NC}"
        failed=$((failed + 1))
        return
      fi
      deployed=$((deployed + 1))
      action_result="ok"
    else
      echo -e "${RED}FAILED (HTTP $http_code)${NC}"
      echo "    Response: $response_body"
      failed=$((failed + 1))
    fi
  fi

  # After successful create/update:
  # 1. Transfer to the target project (public API)
  # 2. Move into the correct folder (internal API)
  if [ "$action_result" = "ok" ]; then
    transfer_to_project "$wf_id" "$project" "$wf_name"
    move_to_folder "$wf_id" "$project" "$wf_name"
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
echo " Project: $N8N_TARGET_PROJECT"
echo " Dry run: $DRY_RUN"
echo "========================================="
echo ""

# Step 1: Resolve project IDs from n8n
resolve_project_ids

# Step 2: Resolve folder IDs inside the target project
resolve_folder_ids

# Step 3: Deploy each project folder (skip _archive)
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

  local_project_id="${PROJECT_IDS[$N8N_TARGET_PROJECT]:-NOT FOUND}"
  local_folder_id="${FOLDER_IDS[$project]:-NOT FOUND}"
  echo "[$project] (project: $local_project_id, folder: $local_folder_id)"
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
echo -e " Project:   ${GREEN}$transferred transferred${NC}, ${RED}$transfer_failed transfer failed${NC}"
echo -e " Folders:   ${GREEN}$folder_placed placed${NC}, ${RED}$folder_place_failed failed${NC}"
echo "========================================="

# Clean up cookie file if created
if [ -n "${COOKIE_FILE:-}" ] && [ -f "$COOKIE_FILE" ]; then
  rm -f "$COOKIE_FILE"
fi

if [ "$failed" -gt 0 ] || [ "$transfer_failed" -gt 0 ] || [ "$folder_place_failed" -gt 0 ]; then
  exit 1
fi
