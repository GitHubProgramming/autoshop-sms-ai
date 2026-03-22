/**
 * Test-tenant detection and shared-number assignment.
 *
 * A signup email is considered a TEST account if it matches:
 *   - exactly  mantas.gipiskis@gmail.com
 *   - pattern  mantas.gipiskis+<anything>@gmail.com
 *
 * Test tenants skip Twilio number purchase and reuse a shared test number
 * configured via TEST_SHARED_PHONE_NUMBER env var.
 */

const TEST_EMAIL_RE = /^mantas\.gipiskis(\+.*)?@gmail\.com$/i;

export function isTestSignupEmail(email: string): boolean {
  return TEST_EMAIL_RE.test(email.toLowerCase().trim());
}

type AssignResult =
  | { ok: true; phoneNumber: string }
  | { ok: false; error: string };

/**
 * Returns the shared test phone number WITHOUT modifying tenant_phone_numbers.
 *
 * The pilot/base tenant (mantas.gipiskis@gmail.com) owns the real row in
 * tenant_phone_numbers via migration 012. Plus-alias test tenants must NEVER
 * insert/update that table — doing so would corrupt ownership semantics.
 *
 * Instead, test-alias tenants receive the number for display purposes only.
 * The dashboard has a fallback for is_test tenants with no phone row.
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
