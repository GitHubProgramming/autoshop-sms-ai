/**
 * Usage Warning Service
 *
 * After a conversation is counted, checks if the tenant has crossed
 * the 80% or 100% usage threshold and sends an SMS to the shop owner.
 *
 * Uses the DB function check_usage_warnings() which atomically reads
 * the counters and sets the warned_80pct / warned_100pct flags.
 *
 * Non-fatal: warnings must never break the SMS processing pipeline.
 */

import { query } from "../db/client";
import { sendTwilioSms } from "./missed-call-sms";

/**
 * Check and send usage warnings for a tenant after conversation close.
 * Returns the warning level fired ('warn_80' | 'warn_100' | 'none').
 */
export async function checkAndNotifyUsage(
  tenantId: string,
  fetchFn: typeof fetch = fetch
): Promise<string> {
  try {
    // Call the DB function — it atomically checks thresholds and sets flags
    const rows = await query<{ check_usage_warnings: string }>(
      `SELECT check_usage_warnings($1)`,
      [tenantId]
    );

    const warning = rows[0]?.check_usage_warnings ?? "none";
    if (warning === "none") return "none";

    // Look up owner phone and shop name for notification
    const tenantRows = await query<{
      owner_phone: string | null;
      shop_name: string | null;
      conv_used_this_cycle: number;
      conv_limit_this_cycle: number;
    }>(
      `SELECT owner_phone, shop_name, conv_used_this_cycle, conv_limit_this_cycle
       FROM tenants WHERE id = $1`,
      [tenantId]
    );

    const tenant = tenantRows[0];
    if (!tenant?.owner_phone) return warning;

    const shopLabel = tenant.shop_name ?? "Your shop";
    const used = tenant.conv_used_this_cycle;
    const limit = tenant.conv_limit_this_cycle;

    let smsBody: string;
    if (warning === "warn_100") {
      smsBody =
        `AutoShop AI (${shopLabel}): You've reached your conversation limit ` +
        `(${used}/${limit}). Upgrade your plan to keep receiving customer messages.`;
    } else {
      smsBody =
        `AutoShop AI (${shopLabel}): You've used 80% of your conversations ` +
        `(${used}/${limit}). Consider upgrading to avoid interruption.`;
    }

    await sendTwilioSms(tenant.owner_phone, smsBody, fetchFn);

    return warning;
  } catch {
    // Non-fatal: usage warnings must never break the pipeline
    return "none";
  }
}
