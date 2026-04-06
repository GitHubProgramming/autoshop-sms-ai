import { query } from "../db/client";
import { getConfig } from "../db/app-config";

export interface ReleaseResult {
  released: number;
  errors: number;
  skipped: number;
}

const GRACE_DAYS = 30;

/**
 * Finds Twilio numbers suspended for 30+ days and releases them via the
 * Twilio REST API, then marks them as 'released' in the database.
 *
 * Called by the daily release-numbers cron worker.
 */
export async function releaseExpiredSuspendedNumbers(): Promise<ReleaseResult> {
  const rows = await query<{
    id: string;
    tenant_id: string;
    phone_number: string;
    twilio_sid: string;
    suspended_at: string;
  }>(
    `SELECT id, tenant_id, phone_number, twilio_sid, suspended_at
     FROM tenant_phone_numbers
     WHERE status = 'suspended'
       AND suspended_at IS NOT NULL
       AND suspended_at < NOW() - INTERVAL '30 days'
     ORDER BY suspended_at ASC`,
    []
  );

  if (rows.length === 0) {
    return { released: 0, errors: 0, skipped: 0 };
  }

  const accountSid = await getConfig("TWILIO_ACCOUNT_SID");
  const authToken = await getConfig("TWILIO_AUTH_TOKEN");

  if (!accountSid || !authToken) {
    console.error("[release-numbers] Twilio credentials not configured — skipping");
    return { released: 0, errors: rows.length, skipped: 0 };
  }

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  let released = 0;
  let errors = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      // Delete (release) the number from Twilio using the stored twilio_sid (PN...)
      const deleteUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers/${row.twilio_sid}.json`;
      const res = await fetch(deleteUrl, {
        method: "DELETE",
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(15_000),
      });

      if (res.status === 204 || res.ok) {
        // Success — mark as released in DB
        await query(
          `UPDATE tenant_phone_numbers
           SET status = 'released', released_at = NOW()
           WHERE id = $1`,
          [row.id]
        );
        released++;
        console.info(
          `[release-numbers] Released ${row.phone_number} (tenant ${row.tenant_id.slice(0, 8)}, suspended since ${row.suspended_at})`
        );
      } else if (res.status === 404) {
        // Number not found in Twilio — already released externally
        await query(
          `UPDATE tenant_phone_numbers
           SET status = 'released', released_at = NOW()
           WHERE id = $1`,
          [row.id]
        );
        skipped++;
        console.info(
          `[release-numbers] ${row.phone_number} not found in Twilio (already released) — marking as released`
        );
      } else {
        const body = await res.text().catch(() => "");
        console.error(
          `[release-numbers] Twilio DELETE failed for ${row.phone_number}: ${res.status} ${body}`
        );
        errors++;
      }
    } catch (err) {
      console.error(
        `[release-numbers] Error releasing ${row.phone_number}:`,
        (err as Error).message
      );
      errors++;
    }
  }

  return { released, errors, skipped };
}
