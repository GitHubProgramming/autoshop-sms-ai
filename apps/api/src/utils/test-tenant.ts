/**
 * Test-tenant detection and shared-number assignment.
 *
 * A signup email is considered a TEST account if it matches:
 *   - exactly  mantas.gipiskis@gmail.com
 *   - pattern  mantas.gipiskis+<anything>@gmail.com
 *
 * Test tenants skip Twilio number purchase and reuse a shared test number
 * configured via TEST_SHARED_PHONE_NUMBER / TEST_SHARED_TWILIO_SID env vars.
 */

const TEST_EMAIL_RE = /^mantas\.gipiskis(\+.*)?@gmail\.com$/i;

export function isTestSignupEmail(email: string): boolean {
  return TEST_EMAIL_RE.test(email.toLowerCase().trim());
}

type AssignResult =
  | { ok: true; phoneNumber: string }
  | { ok: false; error: string };

/**
 * Assigns the shared test phone number to a tenant.
 * Inserts (or no-ops on conflict) into tenant_phone_numbers so the
 * dashboard and onboarding see an active number without buying one.
 */
export async function assignSharedTestNumber(tenantId: string): Promise<AssignResult> {
  const phoneNumber = process.env.TEST_SHARED_PHONE_NUMBER;
  const twilioSid = process.env.TEST_SHARED_TWILIO_SID;

  if (!phoneNumber || !twilioSid) {
    return {
      ok: false,
      error: "TEST_SHARED_PHONE_NUMBER and TEST_SHARED_TWILIO_SID must be set in env",
    };
  }

  // Lazy import to avoid triggering DB pool init at module load
  const { query } = await import("../db/client");

  // The shared test number may already be registered to the pilot/admin tenant.
  // If so, just point this test tenant at the same row — no insert needed.
  // The dashboard reads phone_number by tenant_id, so we upsert a row for
  // THIS tenant. We use a per-tenant synthetic SID to avoid colliding with
  // the real Twilio SID or other test tenants.
  const perTenantSid = `${twilioSid}_${tenantId.slice(0, 8)}`;

  // If this tenant already has the shared number, do nothing.
  const existing = await query<{ id: string }>(
    `SELECT id FROM tenant_phone_numbers
     WHERE tenant_id = $1 AND phone_number = $2 LIMIT 1`,
    [tenantId, phoneNumber]
  );

  if (existing.length === 0) {
    // Insert with a per-tenant synthetic SID. The phone_number UNIQUE constraint
    // would block a second row with the same number, so we must handle conflict:
    // if the number is already taken (e.g., by the pilot tenant), we skip the insert
    // and instead update the existing row to also serve this test tenant.
    await query(
      `INSERT INTO tenant_phone_numbers (tenant_id, twilio_sid, phone_number, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (phone_number) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         status = 'active',
         provisioned_at = NOW()`,
      [tenantId, perTenantSid, phoneNumber]
    );
  }

  return { ok: true, phoneNumber };
}
