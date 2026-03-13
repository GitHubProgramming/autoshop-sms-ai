#!/usr/bin/env bash
# check-status-drift.sh — CI guard against project status drift
#
# Ensures apps/api/project-status/project_status.json (if it exists in the
# working tree) is identical to the canonical project-brain/project_status.json.
# Exits non-zero on drift so CI catches it before deploy.

set -euo pipefail

CANONICAL="project-brain/project_status.json"
DEPLOY_COPY="apps/api/project-status/project_status.json"

if [ ! -f "$CANONICAL" ]; then
  echo "ERROR: canonical file missing: $CANONICAL"
  exit 1
fi

if [ ! -f "$DEPLOY_COPY" ]; then
  # No deploy copy in tree — fine, Docker build will create it
  echo "OK: no deploy-safe copy in tree (will be generated at build time)"
  exit 0
fi

if diff -q "$CANONICAL" "$DEPLOY_COPY" > /dev/null 2>&1; then
  echo "OK: deploy-safe copy matches canonical source"
  exit 0
else
  echo "DRIFT DETECTED: $DEPLOY_COPY differs from $CANONICAL"
  echo ""
  diff "$CANONICAL" "$DEPLOY_COPY" || true
  echo ""
  echo "Fix: remove $DEPLOY_COPY (it is build-generated, not manually maintained)"
  exit 1
fi
