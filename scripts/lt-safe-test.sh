#!/usr/bin/env bash
# ── LT Pilot: First Safe Dashboard Logging Test ─────────────────────────────
#
# Usage:
#   INTERNAL_API_KEY=<key-from-render> bash scripts/lt-safe-test.sh
#
# Prerequisites:
#   - Copy INTERNAL_API_KEY from Render Dashboard → autoshop-api → Environment
#   - LT tenant must exist (created by migration 040)
#
# What this does:
#   - Sends a test conversation to POST /internal/lt-log-conversation
#   - Uses LT tenant: Proteros Servisas (7d82ab25-e991-4d13-b4ac-846865f8b85a)
#   - Booking path is NOT triggered (bookingDetected: false)
#   - No SMS is sent, no calendar write, no Zadarma dependency
#   - Only logs to Postgres for dashboard visibility
#
# Safe: USA/Texas tenant is untouched. Only LT tenant data is written.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

API_URL="${AUTOSHOP_API_URL:-https://autoshop-api-7ek9.onrender.com}"
LT_TENANT_ID="${LT_TENANT_ID:-7d82ab25-e991-4d13-b4ac-846865f8b85a}"
TEST_PHONE="+37060000001"

if [ -z "${INTERNAL_API_KEY:-}" ]; then
  echo "ERROR: INTERNAL_API_KEY not set."
  echo ""
  echo "Get it from: Render Dashboard → autoshop-api → Environment → INTERNAL_API_KEY"
  echo ""
  echo "Then run:"
  echo "  INTERNAL_API_KEY=<paste-key> bash scripts/lt-safe-test.sh"
  exit 1
fi

echo "── LT Pilot: Safe Dashboard Logging Test ──"
echo "API:       $API_URL"
echo "Tenant:    $LT_TENANT_ID"
echo "Phone:     $TEST_PHONE"
echo "Booking:   DISABLED (false)"
echo ""

# Step 1: Health check
echo "Step 1: Health check..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/health")
if [ "$HTTP_CODE" != "200" ]; then
  echo "FAIL: API health check returned $HTTP_CODE (expected 200)"
  exit 1
fi
echo "  OK: API is up ($HTTP_CODE)"

# Step 2: Send test conversation
echo ""
echo "Step 2: Sending LT test conversation..."

PAYLOAD=$(cat <<'ENDJSON'
{
  "tenantId": "LT_TENANT_ID_PLACEHOLDER",
  "customerPhone": "PHONE_PLACEHOLDER",
  "inboundBody": "Sveiki, noriu uzsiregistruoti automobilio remontui",
  "outboundBody": "Sveiki! Kokia paslauga jus domina? Mes atliekame variklio, pakabos ir stabdziu remonta.",
  "bookingDetected": false,
  "source": "sms"
}
ENDJSON
)

# Replace placeholders
PAYLOAD="${PAYLOAD//LT_TENANT_ID_PLACEHOLDER/$LT_TENANT_ID}"
PAYLOAD="${PAYLOAD//PHONE_PLACEHOLDER/$TEST_PHONE}"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/internal/lt-log-conversation" \
  -H "x-internal-key: $INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "  HTTP Status: $HTTP_CODE"
echo "  Response: $BODY"
echo ""

if [ "$HTTP_CODE" = "200" ]; then
  echo "══════════════════════════════════════════════"
  echo "  SUCCESS: LT dashboard logging test PASSED"
  echo "══════════════════════════════════════════════"
  echo ""
  echo "  Tenant:          $LT_TENANT_ID"
  echo "  Booking path:    DISABLED"
  echo "  USA affected:    NO"
  echo ""
  echo "  Conversation is now visible in the LT tenant dashboard."
  echo "  Login as mantas.gipiskis+lt@gmail.com to verify."
elif [ "$HTTP_CODE" = "403" ]; then
  echo "FAIL: 403 Forbidden — INTERNAL_API_KEY is wrong."
  echo "  Copy the correct value from Render Dashboard → autoshop-api → Environment"
  exit 1
elif [ "$HTTP_CODE" = "404" ]; then
  echo "FAIL: 404 — Tenant not found."
  echo "  The LT tenant_id $LT_TENANT_ID does not exist in production."
  echo "  Check if migration 040 ran successfully."
  echo "  To verify, check Render logs for: 'LT pilot tenant created: Proteros Servisas'"
  exit 1
else
  echo "FAIL: Unexpected status $HTTP_CODE"
  exit 1
fi
