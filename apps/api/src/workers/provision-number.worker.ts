import { Worker, Job } from "bullmq";
import { bullmqConnection as connection } from "../queues/redis";
import { moveToDeadLetter } from "../queues/dead-letter";
import { query } from "../db/client";
import { createLogger } from "../utils/logger";

const log = createLogger("provision-worker");
const N8N_INTERNAL_URL = process.env.N8N_INTERNAL_URL ?? "http://n8n:5678";
const N8N_PROVISION_WEBHOOK = `${N8N_INTERNAL_URL}/webhook/provision-number`;
log.info({ endpoint: N8N_PROVISION_WEBHOOK }, "Provisioning endpoint configured");

/**
 * Update provisioning_state on the tenant row.
 * Best-effort — failure here should not crash the worker.
 */
async function setProvisioningState(
  tenantId: string,
  state: "provisioning" | "ready" | "error"
): Promise<void> {
  try {
    await query(
      `UPDATE tenants SET provisioning_state = $1, updated_at = NOW() WHERE id = $2`,
      [state, tenantId]
    );
  } catch (err) {
    log.error(
      { tenantId, state, err },
      "Failed to set provisioning_state"
    );
  }
}

/**
 * Check tenant_phone_numbers for an active row — the only proof that
 * Twilio actually purchased and registered a number for this tenant.
 */
async function hasActivePhoneNumber(tenantId: string): Promise<boolean> {
  try {
    const rows = await query(
      `SELECT 1 FROM tenant_phone_numbers WHERE tenant_id = $1 AND status = 'active' LIMIT 1`,
      [tenantId]
    );
    return (rows as any[]).length > 0;
  } catch (err) {
    log.error(
      { tenantId, err },
      "Failed to check phone number"
    );
    return false;
  }
}

/**
 * BullMQ worker: consumes jobs from "provision-number" queue and forwards
 * each job's payload to the n8n WF-007 webhook trigger.
 *
 * Job type: "provision-twilio-number"
 * Payload: { tenantId, areaCode, shopName }
 *
 * State transitions:
 *   pending_setup → provisioning  (job starts)
 *   provisioning  → ready         (ONLY if tenant_phone_numbers has active row)
 *   provisioning  → error         (n8n failed OR no active row after n8n returned)
 */
export function startProvisionNumberWorker(): Worker {
  const worker = new Worker(
    "provision-number",
    async (job: Job) => {
      const tenantId = job.data?.tenantId;

      // Mark provisioning in-progress
      if (tenantId) {
        await setProvisioningState(tenantId, "provisioning");
      }

      const res = await fetch(N8N_PROVISION_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(job.data),
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`n8n provision webhook returned ${res.status}: ${body}`);
      }

      // n8n returned 200 — but that only means the workflow ran.
      // Verify the number was actually purchased and saved to DB.
      if (tenantId) {
        const active = await hasActivePhoneNumber(tenantId);
        if (active) {
          await setProvisioningState(tenantId, "ready");
          log.info({ tenantId }, "Phone number confirmed active");
        } else {
          // n8n said OK but no active number in DB — treat as failure
          log.error(
            { tenantId },
            "n8n returned 200 but no active phone number found in DB"
          );
          await setProvisioningState(tenantId, "error");
        }
      }
    },
    {
      connection,
      concurrency: 2,
    }
  );

  worker.on("completed", (job) => {
    log.info({ jobId: job.id, jobName: job.name }, "Job completed");
  });

  worker.on("failed", (job, err) => {
    log.error(
      { jobId: job?.id, jobName: job?.name, err: err.message },
      "Job FAILED"
    );

    // Update provisioning state on final failure
    const tenantId = job?.data?.tenantId;
    const attempts = job?.attemptsMade ?? 0;
    const maxAttempts = job?.opts?.attempts ?? 3;
    if (attempts >= maxAttempts) {
      if (tenantId) {
        setProvisioningState(tenantId, "error");
      }
      moveToDeadLetter("provision-number", job, err);
    }
  });

  return worker;
}
