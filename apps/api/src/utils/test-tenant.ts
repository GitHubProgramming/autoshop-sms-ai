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

  // Upsert: if the shared number row already exists (from a previous test tenant),
  // reassign it to this tenant. Only one test tenant uses the shared number at a time.
  // Using ON CONFLICT on twilio_sid to handle re-assignment cleanly.
  await query(
    `INSERT INTO tenant_phone_numbers (tenant_id, twilio_sid, phone_number, status)
     VALUES ($1, $2, $3, 'active')
     ON CONFLICT (twilio_sid) DO UPDATE SET
       tenant_id = EXCLUDED.tenant_id,
       phone_number = EXCLUDED.phone_number,
       status = 'active',
       provisioned_at = NOW()`,
    [tenantId, twilioSid, phoneNumber]
  );

  return { ok: true, phoneNumber };
}
