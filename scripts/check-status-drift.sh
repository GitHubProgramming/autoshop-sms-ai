#!/usr/bin/env bash
# check-status-drift.sh — CI guard against project status drift
#
# Ensures the canonical project_status_v2.json exists.
# v1 is no longer a separate file — it is derived from v2 at runtime.

set -euo pipefail

CANONICAL="project-brain/project_status_v2.json"

if [ ! -f "$CANONICAL" ]; then
  echo "ERROR: canonical file missing: $CANONICAL"
  exit 1
fi

echo "OK: canonical project status file exists: $CANONICAL"
exit 0
