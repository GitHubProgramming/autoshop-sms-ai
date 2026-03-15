#!/usr/bin/env bash
# setup-prod-admin.sh — Bootstrap admin tenant + verify login in production
#
# Usage:
#   INTERNAL_API_KEY=<key-from-render> bash scripts/setup-prod-admin.sh [password]
#
# Requires:
#   - INTERNAL_API_KEY (from Render Dashboard → Environment)
#   - ADMIN_EMAILS must already include mantas.gipiskis@gmail.com in production
#
set -euo pipefail

BASE="https://autoshopsmsai.com"
EMAIL="mantas.gipiskis@gmail.com"
PASSWORD="${1:-}"

if [ -z "${INTERNAL_API_KEY:-}" ]; then
  echo "ERROR: INTERNAL_API_KEY not set. Copy it from Render Dashboard → autoshop-api → Environment."
  exit 1
fi

if [ -z "$PASSWORD" ]; then
  echo -n "Enter admin password (min 8 chars): "
  read -rs PASSWORD
  echo
fi

if [ ${#PASSWORD} -lt 8 ]; then
  echo "ERROR: Password must be at least 8 characters."
  exit 1
fi

echo "=== Step 1: Bootstrap admin tenant ==="
BOOTSTRAP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/auth/admin-bootstrap" \
  -H "Content-Type: application/json" \
  -H "x-internal-key: $INTERNAL_API_KEY" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")

BOOTSTRAP_BODY=$(echo "$BOOTSTRAP" | head -n -1)
BOOTSTRAP_CODE=$(echo "$BOOTSTRAP" | tail -n 1)

echo "Response ($BOOTSTRAP_CODE): $BOOTSTRAP_BODY"

if [ "$BOOTSTRAP_CODE" != "200" ] && [ "$BOOTSTRAP_CODE" != "201" ] && [ "$BOOTSTRAP_CODE" != "409" ]; then
  echo "ERROR: Bootstrap failed. Check ADMIN_EMAILS and INTERNAL_API_KEY in Render."
  exit 1
fi

if [ "$BOOTSTRAP_CODE" = "409" ]; then
  echo "Tenant already has password — proceeding to login."
fi

echo ""
echo "=== Step 2: Login ==="
LOGIN=$(curl -s -w "\n%{http_code}" -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")

LOGIN_BODY=$(echo "$LOGIN" | head -n -1)
LOGIN_CODE=$(echo "$LOGIN" | tail -n 1)

echo "Response ($LOGIN_CODE): $LOGIN_BODY"

if [ "$LOGIN_CODE" != "200" ]; then
  echo "ERROR: Login failed."
  exit 1
fi

TOKEN=$(echo "$LOGIN_BODY" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "ERROR: Could not extract JWT token from login response."
  exit 1
fi

echo "JWT obtained successfully."

echo ""
echo "=== Step 3: Verify admin access — project-status-v2 ==="
STATUS=$(curl -s -w "\n%{http_code}" "$BASE/internal/admin/project-status-v2" \
  -H "Authorization: Bearer $TOKEN")

STATUS_BODY=$(echo "$STATUS" | head -n -1)
STATUS_CODE=$(echo "$STATUS" | tail -n 1)

echo "Response ($STATUS_CODE)"

if [ "$STATUS_CODE" = "200" ]; then
  echo "SUCCESS: project-status-v2 returns 200"
elif [ "$STATUS_CODE" = "403" ]; then
  echo "FAILED: 403 — email not in ADMIN_EMAILS. Update ADMIN_EMAILS in Render to include $EMAIL"
  exit 1
elif [ "$STATUS_CODE" = "503" ]; then
  echo "FAILED: 503 — ADMIN_EMAILS env var not configured in production"
  exit 1
else
  echo "UNEXPECTED: HTTP $STATUS_CODE — $STATUS_BODY"
  exit 1
fi

echo ""
echo "=== Step 4: Verify admin overview ==="
OVERVIEW=$(curl -s -w "\n%{http_code}" "$BASE/internal/admin/overview" \
  -H "Authorization: Bearer $TOKEN")

OVERVIEW_CODE=$(echo "$OVERVIEW" | tail -n 1)
echo "admin/overview: HTTP $OVERVIEW_CODE"

echo ""
echo "=== VERIFICATION SUMMARY ==="
echo "Email:              $EMAIL"
echo "Login:              OK (HTTP 200)"
echo "JWT:                obtained"
echo "project-status-v2:  HTTP $STATUS_CODE"
echo "admin/overview:     HTTP $OVERVIEW_CODE"
echo ""
echo "Admin panel URL: $BASE/admin.html"
