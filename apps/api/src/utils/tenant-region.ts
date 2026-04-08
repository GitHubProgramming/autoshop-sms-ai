import type { Tenant } from "../db/tenants";

/**
 * Returns true if the tenant is a free pilot (non-US) tenant, e.g. LT Proteros Servisas.
 * Use this to guard US-specific logic (Stripe area code extraction, Texas number provisioning, A2P checks).
 * TODO: when multi-region launch is planned, replace this with proper region logic (country_code column, etc).
 * See LT/US strategy docs.
 */
export function isPilotTenant(tenant: Pick<Tenant, "is_pilot_tenant">): boolean {
  return tenant.is_pilot_tenant === true;
}

/**
 * Returns true if the tenant is a standard US production tenant (not a pilot).
 * Inverse of isPilotTenant. Prefer using this in positive guards (e.g. "if (isUsTenant(t)) runStripe...")
 * for readability where the US path is the main branch.
 * TODO: when multi-region launch is planned, replace with proper region check.
 */
export function isUsTenant(tenant: Pick<Tenant, "is_pilot_tenant">): boolean {
  return tenant.is_pilot_tenant !== true;
}
