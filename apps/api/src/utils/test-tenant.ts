/**
 * Test-tenant detection and shared-number assignment.
 *
 * A signup email is considered a TEST account if it matches:
 *   - pattern  mantas.gipiskis+<anything>@gmail.com   (plus-alias REQUIRED)
 *
 * The base email mantas.gipiskis@gmail.com is the PILOT tenant and must
 * NOT be classified as test.  Only plus-alias variants are test accounts.
 *
 * Test tenants skip Twilio number purchase and reuse a shared test number
 * configured via TEST_SHARED_PHONE_NUMBER env var.
 *
 * RULE: tenant-facing endpoints must never hide a tenant's own data using
 * is_test.  The is_test flag is for admin/global cross-tenant reporting only.
 */

const TEST_EMAIL_RE = /^mantas\.gipiskis\+.+@gmail\.com$/i;

export function isTestSignupEmail(email: string): boolean {
  return TEST_EMAIL_RE.test(email.toLowerCase().trim());
}

type AssignResult =
  | { ok: true; phoneNumber: string }
  | { ok: false; error: string };

/**
 * Returns the shared test phone number WITHOUT modifying tenant_phone_numbers.
 *
 * The pilot tenant (mantas.gipiskis@gmail.com) is NOT a test tenant — it owns
 * the real row in tenant_phone_numbers via migration 012 and has is_test=FALSE.
 *
 * Plus-alias test tenants (mantas.gipiskis+*@gmail.com) must NEVER
 * insert/update that table — doing so would corrupt ownership semantics.
 * They receive the shared number for display purposes only.
 */
export function getSharedTestNumber(): AssignResult {
  const phoneNumber = process.env.TEST_SHARED_PHONE_NUMBER;

  if (!phoneNumber) {
    return {
      ok: false,
      error: "TEST_SHARED_PHONE_NUMBER must be set in env",
    };
  }

  return { ok: true, phoneNumber };
}
