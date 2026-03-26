#!/usr/bin/env node
/**
 * LT Pilot: First Safe Dashboard Logging Test (Node.js version)
 *
 * Usage:
 *   INTERNAL_API_KEY=<key-from-render> node scripts/lt-safe-test.js
 *
 * Or on Windows PowerShell:
 *   $env:INTERNAL_API_KEY="<key-from-render>"; node scripts/lt-safe-test.js
 */

const https = require("https");

const API_HOST = "autoshop-api-7ek9.onrender.com";
const LT_TENANT_ID =
  process.env.LT_TENANT_ID || "7d82ab25-e991-4d13-b4ac-846865f8b85a";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;
const TEST_PHONE = "+37060000001";

if (!INTERNAL_API_KEY) {
  console.error("ERROR: INTERNAL_API_KEY not set.\n");
  console.error(
    "Get it from: Render Dashboard → autoshop-api → Environment → INTERNAL_API_KEY\n"
  );
  console.error(
    "IMPORTANT: Render-generated keys are base64 — include the trailing '=' if present.\n"
  );
  console.error("Then run:");
  console.error(
    '  PowerShell: $env:INTERNAL_API_KEY="<paste>"; node scripts/lt-safe-test.js'
  );
  console.error(
    "  Bash:       INTERNAL_API_KEY=<paste> node scripts/lt-safe-test.js"
  );
  process.exit(1);
}

console.log("── LT Pilot: Safe Dashboard Logging Test ──");
console.log(`API:       https://${API_HOST}`);
console.log(`Tenant:    ${LT_TENANT_ID}`);
console.log(`Phone:     ${TEST_PHONE}`);
console.log(`Booking:   DISABLED (false)\n`);

const payload = JSON.stringify({
  tenantId: LT_TENANT_ID,
  customerPhone: TEST_PHONE,
  inboundBody:
    "Sveiki, noriu uzsiregistruoti automobilio remontui",
  outboundBody:
    "Sveiki! Kokia paslauga jus domina? Mes atliekame variklio, pakabos ir stabdziu remonta.",
  bookingDetected: false,
  source: "sms",
});

const req = https.request(
  {
    hostname: API_HOST,
    path: "/internal/lt-log-conversation",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
      "x-internal-key": INTERNAL_API_KEY,
    },
  },
  (res) => {
    let body = "";
    res.on("data", (c) => (body += c));
    res.on("end", () => {
      console.log(`HTTP Status: ${res.statusCode}`);
      console.log(`Response: ${body}\n`);

      if (res.statusCode === 200) {
        console.log("══════════════════════════════════════════════");
        console.log("  SUCCESS: LT dashboard logging test PASSED");
        console.log("══════════════════════════════════════════════\n");
        console.log(`  Tenant:          ${LT_TENANT_ID}`);
        console.log("  Booking path:    DISABLED");
        console.log("  USA affected:    NO\n");
        console.log("  Conversation is now visible in the LT tenant dashboard.");
        console.log("  Login as mantas.gipiskis+lt@gmail.com to verify.");
      } else if (res.statusCode === 403) {
        console.error("FAIL: 403 Forbidden — INTERNAL_API_KEY is wrong.");
        console.error(
          "  Copy the correct value from Render Dashboard → autoshop-api → Environment"
        );
        process.exit(1);
      } else if (res.statusCode === 404) {
        console.error("FAIL: 404 — Tenant not found.");
        console.error(
          `  Tenant ID ${LT_TENANT_ID} does not exist in production.`
        );
        console.error("  Check if migration 040 ran. Look in Render logs for:");
        console.error("  'LT pilot tenant created: Proteros Servisas'");
        process.exit(1);
      } else {
        console.error(`FAIL: Unexpected status ${res.statusCode}`);
        process.exit(1);
      }
    });
  }
);

req.on("error", (e) => {
  console.error(`Connection error: ${e.message}`);
  process.exit(1);
});

req.write(payload);
req.end();
