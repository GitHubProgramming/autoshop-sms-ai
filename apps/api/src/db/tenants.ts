import { query, withTenant } from "./client";

export type BillingStatus =
  | "demo"
  | "trial"
  | "trial_expired"
  | "active"
  | "scheduled_cancel"
  | "past_due"
  | "past_due_blocked"
  | "canceled"
  | "paused";

export type WorkspaceMode = "demo" | "live_empty" | "live_active";
export type ProvisioningState = "not_started" | "pending_setup" | "provisioning" | "ready" | "error";

export interface Tenant {
  id: string;
  shop_name: string;
  owner_email: string;
  billing_status: BillingStatus;
  plan_id: string | null;
  conv_used_this_cycle: number;
  conv_limit_this_cycle: number;
  trial_ends_at: Date | null;
  trial_started_at: Date | null;
  warned_80pct: boolean;
  warned_100pct: boolean;
  workspace_mode: WorkspaceMode;
  provisioning_state: ProvisioningState;
}

/**
 * Look up tenant by their Twilio inbound phone number.
 * Used in webhook handler — no tenant context needed (lookup only).
 *
 * Matches both 'active' and 'suspended' numbers so that:
 *   - Active tenants proceed to normal AI pipeline
 *   - Canceled/blocked tenants (with suspended numbers) still reach the
 *     billing enforcement check, which sends a polite auto-reply instead
 *     of silently dropping the customer's message
 */
export async function getTenantByPhoneNumber(
  phoneNumber: string
): Promise<Tenant | null> {
  const rows = await query<Tenant>(
    `SELECT t.*
     FROM tenants t
     JOIN tenant_phone_numbers tpn ON tpn.tenant_id = t.id
     WHERE tpn.phone_number = $1
       AND tpn.status IN ('active', 'suspended')
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

  // Demo accounts are always blocked from live processing
  if (billing_status === "demo") return "demo_mode";

  if (billing_status === "canceled") return "service_canceled";
  if (billing_status === "paused") return "service_paused";
  if (billing_status === "past_due_blocked") return "payment_failed";

  if (billing_status === "trial" || billing_status === "trial_expired") {
    if (trial_ends_at && new Date() > trial_ends_at) return "trial_expired";
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

/**
 * Transition a demo account to trial after billing activation.
 * Sets trial dates, usage counters, workspace mode, and provisioning state.
 */
export async function activateTrial(tenantId: string): Promise<void> {
  await query(
    `UPDATE tenants SET
       billing_status       = 'trial',
       trial_started_at     = NOW(),
       trial_ends_at        = NOW() + INTERVAL '14 days',
       trial_conv_limit     = 50,
       conv_limit_this_cycle = 50,
       conv_used_this_cycle = 0,
       warned_80pct         = FALSE,
       warned_100pct        = FALSE,
       workspace_mode       = 'live_empty',
       provisioning_state   = 'pending_setup',
       updated_at           = NOW()
     WHERE id = $1 AND billing_status = 'demo'`,
    [tenantId]
  );
}

/**
 * Check if a tenant is in demo mode (no live infrastructure allowed).
 */
export function isDemoMode(tenant: Tenant): boolean {
  return tenant.billing_status === "demo" || tenant.workspace_mode === "demo";
}
