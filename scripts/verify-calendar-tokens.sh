#!/usr/bin/env bash
# verify-calendar-tokens.sh — Check if Google Calendar tokens exist for a tenant
#
# Usage:
#   bash scripts/verify-calendar-tokens.sh <tenant-id>
#   TENANT_ID=<uuid> bash scripts/verify-calendar-tokens.sh
#
# The API must be running. Uses internal endpoint (dev mode allows without key).

set -euo pipefail

# Load .env if present
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

TENANT_ID="${1:-${TENANT_ID:-}}"
API_BASE="${API_BASE:-http://localhost:3000}"
INTERNAL_KEY="${INTERNAL_API_KEY:-}"

if [ -z "$TENANT_ID" ]; then
  echo "Usage: bash scripts/verify-calendar-tokens.sh <tenant-id>"
  echo ""
  echo "You can also set TENANT_ID in .env or environment."
  exit 1
fi

echo "=== Checking calendar tokens for tenant: $TENANT_ID ==="
echo ""

# Build headers — include x-internal-key if available
HEADERS=(-H "Content-Type: application/json")
if [ -n "$INTERNAL_KEY" ]; then
  HEADERS+=(-H "x-internal-key: $INTERNAL_KEY")
fi

RESPONSE=$(curl -s -w "\n%{http_code}" \
  "${HEADERS[@]}" \
  "$API_BASE/internal/calendar-tokens/$TENANT_ID")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "404" ]; then
  echo "STATUS: NOT CONNECTED"
  echo ""
  echo "No calendar tokens found for this tenant."
  echo "Run the OAuth flow first: bash scripts/test-google-oauth.sh"
  exit 0
fi

if [ "$HTTP_CODE" != "200" ]; then
  echo "ERROR: Internal endpoint returned HTTP $HTTP_CODE"
  echo "$BODY"
  echo ""
  echo "Make sure the API is running and INTERNAL_API_KEY is set (or NODE_ENV=development)."
  exit 1
fi

echo "STATUS: CONNECTED"
echo ""

# Extract fields safely (without exposing actual tokens)
# The internal endpoint returns access_token, refresh_token, token_expiry, calendar_id
# We only show non-sensitive fields
TOKEN_EXPIRY=$(echo "$BODY" | grep -o '"token_expiry":"[^"]*"' | cut -d'"' -f4)
CALENDAR_ID=$(echo "$BODY" | grep -o '"calendar_id":"[^"]*"' | cut -d'"' -f4)

# Check if access_token is present (non-empty) without printing it
HAS_ACCESS=$(echo "$BODY" | grep -o '"access_token":"[^"]*"' | wc -l)
HAS_REFRESH=$(echo "$BODY" | grep -o '"refresh_token":"[^"]*"' | wc -l)

echo "  Calendar ID:    ${CALENDAR_ID:-primary}"
echo "  Token Expiry:   ${TOKEN_EXPIRY:-unknown}"
echo "  Access Token:   $([ "$HAS_ACCESS" -gt 0 ] && echo 'present' || echo 'MISSING')"
echo "  Refresh Token:  $([ "$HAS_REFRESH" -gt 0 ] && echo 'present' || echo 'MISSING')"
echo ""

# Also query DB directly for google_account_email (the internal endpoint doesn't return it)
# Try psql if DATABASE_URL is available
if [ -n "${DATABASE_URL:-}" ]; then
  echo "=== DB verification ==="
  RESULT=$(psql "$DATABASE_URL" -t -A -c \
    "SELECT google_account_email, integration_status, connected_at, token_expiry
     FROM tenant_calendar_tokens
     WHERE tenant_id = '$TENANT_ID'" 2>/dev/null || echo "")

  if [ -n "$RESULT" ]; then
    IFS='|' read -r DB_EMAIL DB_STATUS DB_CONNECTED DB_EXPIRY <<< "$RESULT"
    echo "  Google Email:       ${DB_EMAIL:-not set}"
    echo "  Integration Status: ${DB_STATUS:-unknown}"
    echo "  Connected At:       ${DB_CONNECTED:-unknown}"
    echo "  Token Expiry (DB):  ${DB_EXPIRY:-unknown}"
  else
    echo "  (Could not query DB directly — using API response only)"
  fi
  echo ""
fi

echo "VERIFICATION COMPLETE"
