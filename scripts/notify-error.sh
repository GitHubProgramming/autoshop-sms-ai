#!/bin/bash
# Call when an error occurs. Pass error description as argument.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)"
[ -z "$SCRIPT_DIR" ] && SCRIPT_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
[ -z "$SCRIPT_DIR" ] && SCRIPT_DIR="$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
BRANCH=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
ERROR="${1:-unknown error}"
bash "$SCRIPT_DIR/notify-telegram.sh" "❌ Error: $ERROR — branch: $BRANCH"
