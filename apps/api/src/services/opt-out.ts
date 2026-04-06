/**
 * TCPA Opt-Out Service
 *
 * Tracks customer SMS opt-outs per tenant. Checked before any outbound SMS
 * to prevent sending messages to customers who replied STOP.
 *
 * TCPA compliance: $500-$1,500 statutory damages per unsolicited message.
 * This is defense-in-depth beyond Twilio's carrier-level STOP handling.
 */

import { query } from "../db/client";

// TCPA-standard opt-out keywords (Twilio also recognizes these at carrier level)
const OPT_OUT_KEYWORDS = new Set([
  "stop",
  "stopall",
  "unsubscribe",
  "cancel",
  "end",
  "quit",
]);

// TCPA-standard opt-in keywords
const OPT_IN_KEYWORDS = new Set(["start", "unstop", "yes"]);

/**
 * Check if a customer has opted out of SMS from this tenant.
 * Called before sending any outbound SMS.
 */
export async function isOptedOut(
  tenantId: string,
  customerPhone: string
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM opt_outs
     WHERE tenant_id = $1
       AND customer_phone = $2
       AND is_active = TRUE
     LIMIT 1`,
    [tenantId, customerPhone]
  );
  return rows.length > 0;
}

/**
 * Record a customer opt-out.
 * Uses UPSERT — safe to call multiple times.
 */
export async function recordOptOut(
  tenantId: string,
  customerPhone: string
): Promise<void> {
  await query(
    `INSERT INTO opt_outs (tenant_id, customer_phone, opted_out_at, is_active)
     VALUES ($1, $2, NOW(), TRUE)
     ON CONFLICT (tenant_id, customer_phone)
     DO UPDATE SET opted_out_at = NOW(), is_active = TRUE, opted_back_in_at = NULL`,
    [tenantId, customerPhone]
  );
}

/**
 * Record a customer opt-back-in (START/UNSTOP/YES).
 */
export async function recordOptIn(
  tenantId: string,
  customerPhone: string
): Promise<void> {
  await query(
    `UPDATE opt_outs
     SET is_active = FALSE, opted_back_in_at = NOW()
     WHERE tenant_id = $1 AND customer_phone = $2 AND is_active = TRUE`,
    [tenantId, customerPhone]
  );
}

/**
 * Check if an inbound SMS message is a TCPA opt-out keyword.
 * Only matches exact single-word messages (e.g. "STOP" not "please stop texting").
 */
export function isOptOutKeyword(message: string): boolean {
  return OPT_OUT_KEYWORDS.has(message.trim().toLowerCase());
}

/**
 * Check if an inbound SMS message is a TCPA opt-in keyword.
 */
export function isOptInKeyword(message: string): boolean {
  return OPT_IN_KEYWORDS.has(message.trim().toLowerCase());
}
