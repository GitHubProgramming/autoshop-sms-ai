/**
 * LT pilot tenant identifier resolution.
 *
 * The tenants table has no `slug` column (see db/migrations/001_init.sql),
 * so internal routes called from n8n/Zadarma workflows receive either the raw
 * tenant UUID or a well-known slug like `lt-proteros-servisas`. This helper
 * normalizes both to the canonical UUID, and rejects anything unknown.
 *
 * When a `slug` column eventually gets added to `tenants`, replace the map
 * with a DB lookup — the call sites will not need to change.
 */

export const LT_PROTEROS_TENANT_UUID = "7d82ab25-e991-4d13-b4ac-846865f8b85a";

const SLUG_TO_UUID: Record<string, string> = {
  "lt-proteros-servisas": LT_PROTEROS_TENANT_UUID,
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns the canonical tenant UUID for an incoming identifier, or null if the
 * identifier is neither a UUID nor a known LT slug.
 */
export function resolveLtTenantId(input: string): string | null {
  if (UUID_RE.test(input)) return input;
  return SLUG_TO_UUID[input] ?? null;
}
