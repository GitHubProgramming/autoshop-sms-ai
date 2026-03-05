import { query, withTenant } from "./client";

export type BillingStatus =
  | "trial"
  | "trial_expired"
  | "active"
  | "past_due"
  | "past_due_blocked"
  | "canceled"
  | "paused";

export interface Tenant {
  id: string;
  shop_name: string;
  owner_email: string;
  billing_status: BillingStatus;
  plan_id: string | null;
  conv_used_this_cycle: number;
  conv_limit_this_cycle: number;
  trial_ends_at: Date;
  warned_80pct: boolean;
  warned_100pct: boolean;
}

/**
 * Look up tenant by their Twilio inbound phone number.
 * Used in webhook handler — no tenant context needed (lookup only).
 */
export async function getTenantByPhoneNumber(
  phoneNumber: string
): Promise<Tenant | null> {
  const rows = await query<Tenant>(
    `SELECT t.*
     FROM tenants t
     JOIN tenant_phone_numbers tpn ON tpn.tenant_id = t.id
     WHERE tpn.phone_number = $1
       AND tpn.status = 'active'
     LIMIT 1`,
    [phoneNumber]
  );
  return rows[0] ?? null;
}

export async function getTenantById(id: string): Promise<Tenant | null> {
  const rows = await query<Tenant>(
    `SELECT * FROM tenants WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}

/**
 * Enforcement check — returns reason if blocked, null if allowed.
 */
export function getBlockReason(tenant: Tenant): string | null {
  const { billing_status, conv_used_this_cycle, conv_limit_this_cycle, trial_ends_at } = tenant;

  if (billing_status === "canceled") return "service_canceled";
  if (billing_status === "paused") return "service_paused";
  if (billing_status === "past_due_blocked") return "payment_failed";

  if (billing_status === "trial" || billing_status === "trial_expired") {
    if (new Date() > trial_ends_at) return "trial_expired";
    if (conv_used_this_cycle >= conv_limit_this_cycle) return "trial_limit_reached";
  }

  // Paid active — soft limit only (no hard block)
  return null;
}

export async function updateBillingStatus(
  tenantId: string,
  status: BillingStatus
): Promise<void> {
  await query(
    `UPDATE tenants SET billing_status = $1, updated_at = NOW() WHERE id = $2`,
    [status, tenantId]
  );
}
