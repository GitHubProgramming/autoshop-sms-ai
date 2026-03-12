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
conflicts=0
transferred=0
transfer_failed=0
folder_placed=0
folder_place_failed=0

# ─── Live Workflow Index ─────────────────────────────────────────────────
# Fetched once at startup. Used for ID and name-based matching.
# Format: JSON array cached in LIVE_WORKFLOWS_JSON
LIVE_WORKFLOWS_JSON=""

fetch_live_workflows() {
  echo -e "${BLUE}Fetching all live workflows from n8n...${NC}"

  local cursor="" all_workflows="[]"
  while true; do
    local url="$N8N_URL/api/v1/workflows?limit=250"
    if [ -n "$cursor" ]; then
      url="$url&cursor=$cursor"
    fi

    local response http_code body
    response="$(curl -s -w "\n%{http_code}" \
      -H "X-N8N-API-KEY: $N8N_API_KEY" \
      -H "accept: application/json" \
      "$url")"

    http_code="$(echo "$response" | tail -1)"
    body="$(echo "$response" | sed '$d')"

    if [ "$http_code" != "200" ]; then
      echo -e "  ${RED}ERROR${NC}: Could not fetch workflows (HTTP $http_code)"
      echo "  Response: $body"
      exit 1
    fi

    # Merge this page into all_workflows and extract nextCursor
    # NOTE: JSON is piped via stdin (not argv) to avoid OS argument-size limits in CI
    local result
    result="$(printf '{"a":%s,"b":%s}' "$all_workflows" "$body" | node -e "
      const input = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      const all = input.a;
      const resp = input.b;
      const page = resp.data || resp;
      if (Array.isArray(page)) {
        page.forEach(w => all.push({
          id: w.id,
          name: w.name,
          active: w.active || false,
          projectId: (w.projectId) || (w.parentProject && w.parentProject.id) || '',
          folderId: (w.parentFolder && w.parentFolder.id) || w.parentFolderId || ''
        }));
      }
      const nc = resp.nextCursor || '';
      console.log(JSON.stringify({ workflows: all, nextCursor: nc }));
    " 2>/dev/null)"

    all_workflows="$(printf '%s' "$result" | node -e "
      const r = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      process.stdout.write(JSON.stringify(r.workflows));
    ")"
    cursor="$(printf '%s' "$result" | node -e "
      const r = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      process.stdout.write(r.nextCursor || '');
    ")"

    if [ -z "$cursor" ]; then
      break
    fi
  done

  LIVE_WORKFLOWS_JSON="$all_workflows"
  local count
  count="$(printf '%s' "$LIVE_WORKFLOWS_JSON" | node -e "
    process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).length));
  ")"
  echo -e "  Found ${GREEN}$count${NC} live workflows"
  echo ""
}

# Resolve a repo workflow to a live n8n workflow ID.
# Priority: (a) exact ID match, (b) exact name match in target project, (c) create.
# Sets RESOLVED_ID (live n8n ID or empty for create) and RESOLVED_ACTION (update/create/conflict).
RESOLVED_ID=""
RESOLVED_ACTION=""

resolve_workflow() {
  local repo_id="$1"
  local repo_name="$2"
  local target_project_id="${PROJECT_IDS[$N8N_TARGET_PROJECT]:-}"

  # (a) Check if the exact repo ID exists live
  local id_match
  id_match="$(printf '%s' "$LIVE_WORKFLOWS_JSON" | node -e "
    const wfs = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const match = wfs.find(w => w.id === process.argv[1]);
    process.stdout.write(match ? match.id : '');
  " "$repo_id" 2>/dev/null || echo "")"

  if [ -n "$id_match" ]; then
    RESOLVED_ID="$id_match"
    RESOLVED_ACTION="update"
    return
  fi

  # (b) Search by exact name within the target project
  local name_result
  name_result="$(printf '%s' "$LIVE_WORKFLOWS_JSON" | node -e "
    const wfs = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const name = process.argv[1];
    const projId = process.argv[2];
    // Match by name; if we have a project ID, filter to that project
    let matches = wfs.filter(w => w.name === name);
    if (projId) {
      const projMatches = matches.filter(w => w.projectId === projId);
      if (projMatches.length > 0) matches = projMatches;
    }
    console.log(JSON.stringify({ count: matches.length, id: matches.length === 1 ? matches[0].id : '', ids: matches.map(m => m.id) }));
  " "$repo_name" "$target_project_id" 2>/dev/null)"

  local match_count match_id
  match_count="$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).count))" "$name_result")"
  match_id="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).id)" "$name_result")"

  if [ "$match_count" = "1" ]; then
    RESOLVED_ID="$match_id"
    RESOLVED_ACTION="update"
    return
  fi

  if [ "$match_count" -gt 1 ] 2>/dev/null; then
    local dup_ids
    dup_ids="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).ids.join(', '))" "$name_result")"
    RESOLVED_ID=""
    RESOLVED_ACTION="conflict:$dup_ids"
    return
  fi

  # (c) No match — create
  RESOLVED_ID=""
  RESOLVED_ACTION="create"
}

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
  mapping="$(printf '%s' "$body" | node -e "
    const resp = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const projects = resp.data || resp;
    if (Array.isArray(projects)) {
      projects.forEach(p => {
        if (p.name && p.id) {
          console.log(p.name + '=' + p.id);
        }
      });
    }
  " 2>/dev/null || echo "")"

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

  # n8n Cloud uses 'emailOrLdapLoginId' instead of 'email' for the login field.
  # We send both for compatibility with self-hosted (email) and cloud (emailOrLdapLoginId).
  local login_body
  login_body="{\"email\":\"${N8N_EMAIL}\",\"emailOrLdapLoginId\":\"${N8N_EMAIL}\",\"password\":\"${N8N_PASSWORD}\"}"

  echo -e "  Attempting login to $N8N_URL/rest/login ..."

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
  fi

  echo -e "  ${YELLOW}Login attempt 1 (/rest/login) failed (HTTP $http_code)${NC}"
  echo "  Response: $body"

  # Fallback: try /api/v1/login (some n8n versions use this)
  response="$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -c "$COOKIE_FILE" \
    -d "$login_body" \
    "$N8N_URL/api/v1/login")"

  http_code="$(echo "$response" | tail -1)"
  body="$(echo "$response" | sed '$d')"

  if [ "$http_code" = "200" ]; then
    echo -e "  ${GREEN}Internal API login OK (via /api/v1/login)${NC}"
    INTERNAL_AUTH_HEADER="cookie"
    return 0
  fi

  echo -e "  ${YELLOW}Login attempt 2 (/api/v1/login) failed (HTTP $http_code)${NC}"
  echo "  Response: $body"
  rm -f "$COOKIE_FILE"
  COOKIE_FILE=""
  return 1
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
  mapping="$(printf '%s' "$body" | node -e "
    const resp = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const folders = resp.data || resp;
    if (Array.isArray(folders)) {
      folders.forEach(f => {
        if (f.name && f.id) {
          console.log(f.name + '=' + f.id);
        }
      });
    }
  " 2>/dev/null || echo "")"

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
  current_project_id="$(printf '%s' "$get_resp" | node -e "
    const wf = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const pid = (wf.projectId) || (wf.parentProject && wf.parentProject.id) || '';
    process.stdout.write(pid);
  " 2>/dev/null || echo "")"

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
    result_folder="$(printf '%s' "$body" | node -e "
      const wf = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      const fid = (wf.parentFolder && wf.parentFolder.id) || wf.parentFolderId || '';
      process.stdout.write(fid);
    " 2>/dev/null || echo "")"

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

  # Extract workflow ID and name from repo JSON
  local repo_id repo_name
  repo_id="$(node -e "const d=require('$file'); process.stdout.write(d.id || '')" 2>/dev/null || echo "")"
  repo_name="$(node -e "const d=require('$file'); process.stdout.write(d.name || '')" 2>/dev/null || echo "$filename")"

  if [ -z "$repo_name" ]; then
    echo -e "  ${YELLOW}SKIP${NC} $filename — no 'name' field in JSON"
    skipped=$((skipped + 1))
    return
  fi

  # Resolve: find the correct live workflow to update, or decide to create
  resolve_workflow "${repo_id:-}" "$repo_name"
  local live_id="$RESOLVED_ID"
  local action="$RESOLVED_ACTION"

  # ── Handle duplicate conflict ──────────────────────────────────────────
  if [[ "$action" == conflict:* ]]; then
    local dup_ids="${action#conflict:}"
    echo -e "  [$project] $repo_name — ${RED}DUPLICATE CONFLICT${NC}"
    echo -e "    Multiple live workflows with this name: $dup_ids"
    echo -e "    ${RED}STOPPING${NC} — resolve duplicates manually before deploying."
    conflicts=$((conflicts + 1))
    failed=$((failed + 1))
    return
  fi

  # ── Dry-run reporting ──────────────────────────────────────────────────
  if [ "$DRY_RUN" = "true" ]; then
    local target_proj="${PROJECT_IDS[$N8N_TARGET_PROJECT]:-none}"
    local target_fold="${FOLDER_IDS[$project]:-none}"
    if [ "$action" = "update" ]; then
      local match_method="repo ID"
      if [ "$live_id" != "${repo_id:-}" ]; then
        match_method="name match"
      fi
      echo -e "  [$project] $repo_name — ${GREEN}WOULD UPDATE${NC} (live id: $live_id, matched by: $match_method)"
    else
      echo -e "  [$project] $repo_name — ${YELLOW}WOULD CREATE${NC} (no live match found)"
    fi
    echo -e "    target project: $target_proj, target folder: $target_fold"
    skipped=$((skipped + 1))
    return
  fi

  # ── Execute deploy ─────────────────────────────────────────────────────
  local wf_id="" action_result="" http_code response_body

  if [ "$action" = "update" ]; then
    wf_id="$live_id"
    echo -n "  [$project] $repo_name -> UPDATE $wf_id ... "

    local payload
    payload="$(strip_payload "$file")"

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
    # Create new workflow
    echo -n "  [$project] $repo_name -> CREATE ... "

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
      local created_id
      created_id="$(printf '%s' "$response_body" | node -e "
        const r = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
        process.stdout.write(r.id || '');
      " 2>/dev/null || echo "")"

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
    transfer_to_project "$wf_id" "$project" "$repo_name"
    move_to_folder "$wf_id" "$project" "$repo_name"
  fi

  # Export the final live ID so activate_workflow can use it
  RESOLVED_ID="$wf_id"
}

# Activate a workflow after deploy.
# Accepts the resolved live n8n ID (not the repo ID).
activate_workflow() {
  local live_id="$1"

  if [ -z "$live_id" ] || [ "$DRY_RUN" = "true" ]; then
    return
  fi

  curl -s -o /dev/null \
    -X POST \
    -H "X-N8N-API-KEY: $N8N_API_KEY" \
    "$N8N_URL/api/v1/workflows/$live_id/activate" 2>/dev/null || true
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

# Step 3: Fetch all live workflows for matching
fetch_live_workflows

# Step 4: Deploy each project folder (skip _archive)
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
      # activate_workflow uses the resolved live ID, which is stored in RESOLVED_ID
      # after deploy_workflow runs. Only activate if we had a successful resolution.
      activate_workflow "$RESOLVED_ID"
    fi
  done
  echo ""
done

echo "========================================="
echo -e " Deploy:    ${GREEN}$deployed deployed${NC}, ${RED}$failed failed${NC}, ${YELLOW}$skipped skipped${NC}"
if [ "$conflicts" -gt 0 ]; then
  echo -e " Conflicts: ${RED}$conflicts DUPLICATE CONFLICTS${NC} — must resolve before deploy"
fi
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
