import { Worker, Job } from "bullmq";
import { bullmqConnection as connection } from "../queues/redis";
import { moveToDeadLetter } from "../queues/dead-letter";
import { query } from "../db/client";
import { createLogger } from "../utils/logger";
import {
  provisionNumberForTenant,
  verifyNumberInMessagingService,
} from "../services/twilio-provisioning";
import { sendWelcomeEmailForProvisionedTenant } from "../services/welcome-email";

const log = createLogger("provision-worker");

/**
 * Parse a 3-digit US area code from an E.164 phone number. Returns null if
 * the input doesn't look like a +1 number with at least 4 digits after the
 * country code.
 */
function parseAreaCodeFromPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const m = phone.match(/^\+?1?(\d{3})\d{4,}$/);
  return m ? m[1]! : null;
}

async function setProvisioningState(
  tenantId: string,
  state: "provisioning" | "ready" | "error",
  reason: string | null = null,
): Promise<void> {
  try {
    await query(
      `UPDATE tenants
         SET provisioning_state = $1,
             provisioning_error_reason = $2,
             updated_at = NOW()
       WHERE id = $3`,
      [state, reason, tenantId],
    );
  } catch (err) {
    log.error({ tenantId, state, err }, "Failed to set provisioning_state");
  }
}

/**
 * Process one provision-number job.
 *
 * Flow:
 *   1. Mark tenant 'provisioning' (clear any prior error_reason)
 *   2. Look up tenant, derive area code from owner_phone (default '512')
 *   3. Call provisionNumberForTenant() — handles search, purchase, add to
 *      Messaging Service, verify, and area-code fallback
 *   4. INSERT into tenant_phone_numbers (active row)
 *   5. Mark tenant 'ready'
 *
 * On any failure: tenant goes to 'error' with provisioning_error_reason set
 * to the error message (truncated to 500 chars). The job throws so BullMQ
 * retries via the configured backoff.
 */
async function processProvisionJob(job: Job): Promise<{
  success: boolean;
  phoneNumber?: string;
  sid?: string;
}> {
  const tenantId: string | undefined = job.data?.tenantId;
  if (!tenantId) {
    throw new Error("provision_job_missing_tenantId");
  }

  await setProvisioningState(tenantId, "provisioning");

  try {
    const tenantRows = await query<{
      shop_name: string;
      owner_phone: string | null;
    }>(
      `SELECT shop_name, owner_phone FROM tenants WHERE id = $1 LIMIT 1`,
      [tenantId],
    );
    if (tenantRows.length === 0) {
      throw new Error(`tenant_not_found: ${tenantId}`);
    }
    const tenant = tenantRows[0]!;

    // Idempotency: if this tenant already has an active phone number
    // (e.g., a previous attempt purchased + service-added but the worker
    // died before the DB INSERT), skip the purchase and just mark ready.
    // This prevents orphaned Twilio numbers on retry after mid-flow crashes.
    const existingRows = await query<{
      twilio_sid: string;
      phone_number: string;
    }>(
      `SELECT twilio_sid, phone_number
         FROM tenant_phone_numbers
        WHERE tenant_id = $1 AND status = 'active'
        LIMIT 1`,
      [tenantId],
    );

    if (existingRows.length > 0) {
      const existing = existingRows[0]!;
      log.info(
        {
          tenantId,
          existingSid: existing.twilio_sid,
          existingPhone: existing.phone_number,
        },
        "tenant already has active number — verifying and marking ready",
      );

      // Sanity check: confirm the number is still in the Messaging Service.
      // If not, something is wrong and we surface it as an error rather than
      // attempting auto-recovery (safer to alert ops).
      const stillInService = await verifyNumberInMessagingService(
        existing.twilio_sid,
      );
      if (!stillInService) {
        throw new Error(
          `existing_number_not_in_messaging_service: ${existing.twilio_sid}`,
        );
      }

      await setProvisioningState(tenantId, "ready", null);
      await sendWelcomeEmailForProvisionedTenant(
        tenantId,
        existing.phone_number,
        query,
      );
      return {
        success: true,
        phoneNumber: existing.phone_number,
        sid: existing.twilio_sid,
      };
    }

    const preferredAreaCode =
      // Job-level area code override (e.g., manual retry with a specific code)
      (typeof job.data?.areaCode === "string" && /^\d{3}$/.test(job.data.areaCode)
        ? job.data.areaCode
        : null) ??
      parseAreaCodeFromPhone(tenant.owner_phone) ??
      "512";

    log.info(
      { tenantId, preferredAreaCode, shopName: tenant.shop_name },
      "starting provision",
    );

    const result = await provisionNumberForTenant({
      preferredAreaCode,
      shopName: tenant.shop_name,
    });

    await query(
      `INSERT INTO tenant_phone_numbers (tenant_id, twilio_sid, phone_number, status, provisioned_at)
       VALUES ($1, $2, $3, 'active', NOW())
       ON CONFLICT (twilio_sid) DO NOTHING`,
      [tenantId, result.sid, result.phoneNumber],
    );

    await setProvisioningState(tenantId, "ready", null);

    await sendWelcomeEmailForProvisionedTenant(
      tenantId,
      result.phoneNumber,
      query,
    );

    log.info(
      {
        tenantId,
        phoneNumber: result.phoneNumber,
        sid: result.sid,
        areaCodeUsed: result.areaCodeUsed,
        attemptedAreaCodes: result.attemptedAreaCodes,
      },
      "provisioning succeeded",
    );

    return { success: true, phoneNumber: result.phoneNumber, sid: result.sid };
  } catch (err: any) {
    const reason = (err?.message ?? "unknown_error").substring(0, 500);
    log.error({ tenantId, err: reason }, "provisioning failed");
    await setProvisioningState(tenantId, "error", reason);
    throw err;
  }
}

/**
 * BullMQ worker entrypoint. Consumes the "provision-number" queue with
 * concurrency 2. All Twilio API calls happen inline — no n8n.
 *
 * State transitions:
 *   pending_setup → provisioning  (job starts)
 *   provisioning  → ready         (purchase + service add + verify all OK)
 *   provisioning  → error         (any failure; provisioning_error_reason set)
 */
export function startProvisionNumberWorker(): Worker {
  const worker = new Worker("provision-number", processProvisionJob, {
    connection,
    concurrency: 2,
  });

  worker.on("completed", (job) => {
    log.info({ jobId: job.id, jobName: job.name }, "Job completed");
  });

  worker.on("failed", (job, err) => {
    log.error(
      { jobId: job?.id, jobName: job?.name, err: err.message },
      "Job FAILED",
    );

    const tenantId = job?.data?.tenantId;
    const attempts = job?.attemptsMade ?? 0;
    const maxAttempts = job?.opts?.attempts ?? 3;
    if (attempts >= maxAttempts) {
      if (tenantId) {
        // Final failure — already marked 'error' inside processProvisionJob,
        // but ensure the reason is up-to-date with the last attempt's message.
        setProvisioningState(
          tenantId,
          "error",
          (err.message ?? "max_retries_exceeded").substring(0, 500),
        );
      }
      moveToDeadLetter("provision-number", job, err);
    }
  });

  return worker;
}

// Exported for tests
export const __test__ = { processProvisionJob, parseAreaCodeFromPhone };
