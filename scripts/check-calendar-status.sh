#!/usr/bin/env bash
# check-calendar-status.sh — Check Google Calendar connection status via production API
#
# Usage:
#   bash scripts/check-calendar-status.sh <tenant-id>
#   AUTOSHOP_TENANT_ID=<uuid> bash scripts/check-calendar-status.sh

set -euo pipefail

TENANT_ID="${1:-${AUTOSHOP_TENANT_ID:-}}"
API_BASE="${API_BASE:-https://autoshop-api-7ek9.onrender.com}"
INTERNAL_KEY="${INTERNAL_API_KEY:-10aefb2a8e6e4046823ec8d83a4dfd2d36d83b79f2ff499d1d9faa4d77e8087c}"

if [ -z "$TENANT_ID" ]; then
  echo "Usage: bash scripts/check-calendar-status.sh <tenant-id>"
  echo ""
  echo "Get your tenant ID from browser DevTools:"
  echo "  Application → Local Storage → autoshopsmsai.com → 'autoshop_session'"
  echo "  (the tenantId field inside the JSON)"
  echo ""
  echo "Or set: AUTOSHOP_TENANT_ID=<uuid> bash scripts/check-calendar-status.sh"
  exit 1
fi

echo "Checking calendar tokens for tenant: $TENANT_ID ..."
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" \
  "$API_BASE/internal/calendar-tokens/$TENANT_ID" \
  -H "x-internal-key: $INTERNAL_KEY")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "404" ]; then
  echo "NOT CONNECTED"
  echo ""
  echo "No calendar tokens found for this tenant."
  echo "Run the OAuth flow first: AUTOSHOP_JWT=<token> bash scripts/get-calendar-oauth-url.sh"
  exit 0
fi

if [ "$HTTP_CODE" = "403" ]; then
  echo "ERROR: Forbidden (HTTP 403) — internal API key rejected"
  echo "Check INTERNAL_API_KEY value."
  exit 1
fi

if [ "$HTTP_CODE" != "200" ]; then
  echo "ERROR: HTTP $HTTP_CODE"
  echo "$BODY"
  exit 1
fi

# Extract safe fields only (never print actual tokens)
TOKEN_EXPIRY=$(echo "$BODY" | grep -o '"token_expiry":"[^"]*"' | cut -d'"' -f4)
CALENDAR_ID=$(echo "$BODY" | grep -o '"calendar_id":"[^"]*"' | cut -d'"' -f4)
HAS_ACCESS=$(echo "$BODY" | grep -c '"access_token":"[^"]*"' || true)
HAS_REFRESH=$(echo "$BODY" | grep -c '"refresh_token":"[^"]*"' || true)

echo "CONNECTED"
echo ""
echo "  Calendar ID:   ${CALENDAR_ID:-primary}"
echo "  Token Expiry:  ${TOKEN_EXPIRY:-unknown}"
echo "  Access Token:  $([ "$HAS_ACCESS" -gt 0 ] && echo 'present' || echo 'MISSING')"
echo "  Refresh Token: $([ "$HAS_REFRESH" -gt 0 ] && echo 'present' || echo 'MISSING')"
echo ""
