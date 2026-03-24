/**
 * Trial Expiry Service
 *
 * Proactively transitions expired trial tenants to 'trial_expired' status.
 * This runs periodically so the database reflects reality — admin dashboards,
 * metrics, and billing queries see accurate state without relying solely on
 * the runtime getBlockReason() check in the SMS webhook.
 *
 * Rules:
 *   - Only transitions billing_status = 'trial'
 *   - Only when trial_ends_at < NOW()
 *   - Skips demo, active, canceled, etc. (they have their own lifecycle)
 *   - Idempotent: already-expired tenants are not re-updated
 */

import { query } from "../db/client";

export async function expireTrials(): Promise<number> {
  const result = await query<{ count: number }>(
    `WITH expired AS (
       UPDATE tenants
       SET billing_status = 'trial_expired',
           updated_at     = NOW()
       WHERE billing_status = 'trial'
         AND trial_ends_at IS NOT NULL
         AND trial_ends_at < NOW()
       RETURNING id
     )
     SELECT COUNT(*)::int AS count FROM expired`
  );

  return result[0]?.count ?? 0;
}
