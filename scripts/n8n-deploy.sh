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
NC='\033[0m'

deployed=0
failed=0
skipped=0

deploy_workflow() {
  local file="$1"
  local project="$2"
  local filename
  filename="$(basename "$file")"

  # Extract workflow ID and name from JSON
  local wf_id wf_name
  wf_id="$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('id',''))" "$file" 2>/dev/null || echo "")"
  wf_name="$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('name',''))" "$file" 2>/dev/null || echo "$filename")"

  if [ -z "$wf_id" ]; then
    echo -e "  ${YELLOW}SKIP${NC} $filename — no 'id' field in JSON"
    skipped=$((skipped + 1))
    return
  fi

  echo -n "  [$project] $wf_name ($wf_id) ... "

  if [ "$DRY_RUN" = "true" ]; then
    echo -e "${YELLOW}DRY RUN${NC}"
    skipped=$((skipped + 1))
    return
  fi

  # Check if workflow already exists in n8n
  local http_code
  http_code="$(curl -s -o /dev/null -w "%{http_code}" \
    -H "X-N8N-API-KEY: $N8N_API_KEY" \
    "$N8N_URL/api/v1/workflows/$wf_id")"

  if [ "$http_code" = "200" ]; then
    # Update existing workflow
    http_code="$(curl -s -o /dev/null -w "%{http_code}" \
      -X PUT \
      -H "X-N8N-API-KEY: $N8N_API_KEY" \
      -H "Content-Type: application/json" \
      -d @"$file" \
      "$N8N_URL/api/v1/workflows/$wf_id")"

    if [ "$http_code" = "200" ]; then
      echo -e "${GREEN}UPDATED${NC}"
      deployed=$((deployed + 1))
    else
      echo -e "${RED}FAILED (HTTP $http_code)${NC}"
      failed=$((failed + 1))
    fi
  else
    # Create new workflow
    http_code="$(curl -s -o /dev/null -w "%{http_code}" \
      -X POST \
      -H "X-N8N-API-KEY: $N8N_API_KEY" \
      -H "Content-Type: application/json" \
      -d @"$file" \
      "$N8N_URL/api/v1/workflows")"

    if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
      echo -e "${GREEN}CREATED${NC}"
      deployed=$((deployed + 1))
    else
      echo -e "${RED}FAILED (HTTP $http_code)${NC}"
      failed=$((failed + 1))
    fi
  fi
}

# Activate a workflow after deploy
activate_workflow() {
  local file="$1"
  local wf_id
  wf_id="$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('id',''))" "$file" 2>/dev/null || echo "")"

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

# Deploy each project folder (skip _archive)
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

  echo "[$project]"
  for f in "${json_files[@]}"; do
    if [ -f "$f" ]; then
      deploy_workflow "$f" "$project"
      activate_workflow "$f"
    fi
  done
  echo ""
done

echo "========================================="
echo " Results: ${GREEN}$deployed deployed${NC}, ${RED}$failed failed${NC}, ${YELLOW}$skipped skipped${NC}"
echo "========================================="

if [ "$failed" -gt 0 ]; then
  exit 1
fi
