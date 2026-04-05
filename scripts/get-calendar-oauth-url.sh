#!/usr/bin/env bash
# get-calendar-oauth-url.sh — Get Google Calendar OAuth URL from production API
#
# Usage:
#   AUTOSHOP_JWT=<token> bash scripts/get-calendar-oauth-url.sh
#
# The JWT is required. Get it from browser DevTools:
#   Application → Local Storage → autoshopsmsai.com → "autoshop_jwt"

set -euo pipefail

API_BASE="${API_BASE:-https://autoshop-api-7ek9.onrender.com}"
JWT="${AUTOSHOP_JWT:-}"

if [ -z "$JWT" ]; then
  echo "============================================================"
  echo "  AUTOSHOP_JWT is required"
  echo "============================================================"
  echo ""
  echo "How to get your JWT:"
  echo "  1. Go to https://autoshopsmsai.com/app/dashboard"
  echo "  2. Open browser DevTools (F12)"
  echo "  3. Go to Application → Local Storage → autoshopsmsai.com"
  echo "  4. Copy the value of 'autoshop_jwt'"
  echo ""
  echo "Then run:"
  echo "  AUTOSHOP_JWT=<paste_token> bash scripts/get-calendar-oauth-url.sh"
  exit 1
fi

echo "Calling GET /auth/google/url ..."
RESPONSE=$(curl -s -w "\n%{http_code}" \
  "$API_BASE/auth/google/url" \
  -H "Authorization: Bearer $JWT")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "401" ]; then
  echo "ERROR: JWT is expired or invalid (HTTP 401)"
  echo "Get a fresh token from browser DevTools and try again."
  exit 1
fi

if [ "$HTTP_CODE" != "200" ]; then
  echo "ERROR: /auth/google/url returned HTTP $HTTP_CODE"
  echo "$BODY"
  exit 1
fi

OAUTH_URL=$(echo "$BODY" | grep -o '"url":"[^"]*"' | cut -d'"' -f4)

if [ -z "$OAUTH_URL" ]; then
  echo "ERROR: No URL in response"
  echo "$BODY"
  exit 1
fi

echo ""
echo "--- OPEN THIS URL IN YOUR BROWSER ---"
echo ""
echo "$OAUTH_URL"
echo ""
echo "--- AFTER CONSENT YOU WILL BE REDIRECTED TO /app/dashboard?calendar=connected ---"
echo ""
