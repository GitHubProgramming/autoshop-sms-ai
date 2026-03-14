#!/bin/bash
# Wrapper to send Telegram notifications via send-telegram.ps1
# Usage: bash scripts/notify-telegram.sh "Your message here"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)"
[ -z "$SCRIPT_DIR" ] && SCRIPT_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
[ -z "$SCRIPT_DIR" ] && SCRIPT_DIR="$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
PS_SCRIPT="$REPO_ROOT/scripts/send-telegram.ps1"

MESSAGE="${1:-No message provided}"

if [ ! -f "$PS_SCRIPT" ]; then
  echo "[notify] send-telegram.ps1 not found at $PS_SCRIPT — skipping"
  exit 0
fi

powershell.exe -ExecutionPolicy Bypass -File "$PS_SCRIPT" -Message "$MESSAGE" 2>/dev/null
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "[notify] Telegram notification failed (exit $EXIT_CODE) — continuing"
fi

exit 0
