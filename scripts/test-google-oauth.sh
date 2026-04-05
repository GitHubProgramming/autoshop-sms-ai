#!/usr/bin/env bash
# test-google-oauth.sh — Diagnostic: get Google OAuth URL for calendar connect
#
# Usage:
#   bash scripts/test-google-oauth.sh
#
# Requires .env with: TEST_EMAIL, TEST_PASSWORD (or pass as env vars)
# The API must be running on API_BASE (default: http://localhost:3000)

set -euo pipefail

# Load .env if present
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

API_BASE="${API_BASE:-http://localhost:3000}"
EMAIL="${TEST_EMAIL:-}"
PASSWORD="${TEST_PASSWORD:-}"

if [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
  echo "ERROR: TEST_EMAIL and TEST_PASSWORD must be set in .env or environment"
  echo ""
  echo "These should match an existing tenant's owner_email and password."
  echo "Example:"
  echo "  export TEST_EMAIL=mantas.gipiskis@gmail.com"
  echo "  export TEST_PASSWORD=yourpassword"
  echo "  bash scripts/test-google-oauth.sh"
  exit 1
fi

echo "=== Step 1: Login to get JWT ==="
LOGIN_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$API_BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")

HTTP_CODE=$(echo "$LOGIN_RESPONSE" | tail -1)
BODY=$(echo "$LOGIN_RESPONSE" | head -n -1)

if [ "$HTTP_CODE" != "200" ]; then
  echo "ERROR: Login failed (HTTP $HTTP_CODE)"
  echo "$BODY"
  echo ""
  echo "If this tenant uses Google login only (no password), you can skip login"
  echo "and pass a JWT directly:"
  echo "  export AUTOSHOP_JWT=<your-jwt-token>"
  echo "  bash scripts/test-google-oauth.sh"
  exit 1
fi

JWT=$(echo "$BODY" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
TENANT_ID=$(echo "$BODY" | grep -o '"tenantId":"[^"]*"' | cut -d'"' -f4)

if [ -z "$JWT" ]; then
  # Fallback: check if AUTOSHOP_JWT is set
  JWT="${AUTOSHOP_JWT:-}"
  if [ -z "$JWT" ]; then
    echo "ERROR: Could not extract JWT from login response"
    echo "$BODY"
    exit 1
  fi
fi

echo "Login OK — tenant: $TENANT_ID"
echo ""

echo "=== Step 2: Get Google OAuth URL ==="
URL_RESPONSE=$(curl -s -w "\n%{http_code}" \
  "$API_BASE/auth/google/url" \
  -H "Authorization: Bearer $JWT")

HTTP_CODE=$(echo "$URL_RESPONSE" | tail -1)
BODY=$(echo "$URL_RESPONSE" | head -n -1)

if [ "$HTTP_CODE" != "200" ]; then
  echo "ERROR: /auth/google/url failed (HTTP $HTTP_CODE)"
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
echo "============================================================"
echo "  GOOGLE CALENDAR OAUTH URL"
echo "============================================================"
echo ""
echo "$OAUTH_URL"
echo ""
echo "============================================================"
echo ""
echo "INSTRUCTIONS:"
echo "  1. Copy the URL above"
echo "  2. Open it in your browser"
echo "  3. Sign in with your Google account"
echo "  4. Grant calendar permissions"
echo "  5. You will be redirected to /app/dashboard?calendar=connected"
echo "  6. Then verify tokens were saved:"
echo "     bash scripts/verify-calendar-tokens.sh $TENANT_ID"
echo ""
