import { Worker, Job } from "bullmq";
import { bullmqConnection as connection } from "../queues/redis";
import { moveToDeadLetter } from "../queues/dead-letter";
import { query } from "../db/client";

const N8N_INTERNAL_URL = process.env.N8N_INTERNAL_URL ?? "http://n8n:5678";
const N8N_PROVISION_WEBHOOK = `${N8N_INTERNAL_URL}/webhook/provision-number`;
console.info(`[provision-worker] posting to ${N8N_PROVISION_WEBHOOK}`);

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
    console.error(
      `[provision-worker] failed to set provisioning_state=${state} for tenant ${tenantId}:`,
      err
    );
  }
}

/**
 * BullMQ worker: consumes jobs from "provision-number" queue and forwards
 * each job's payload to the n8n WF-007 webhook trigger.
 *
 * Job type: "provision-twilio-number"
 * Payload: { tenantId, areaCode, shopName }
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
        signal: AbortSignal.timeout(60_000), // provisioning may take longer than SMS
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`n8n provision webhook returned ${res.status}: ${body}`);
      }

      // n8n succeeded — mark tenant as ready.
      // The actual phone number row is inserted by n8n; this tracks the tenant-level state.
      if (tenantId) {
        await setProvisioningState(tenantId, "ready");
      }
    },
    {
      connection,
      concurrency: 2, // provisioning is rare — low concurrency is fine
    }
  );

  worker.on("completed", (job) => {
    console.info(
      `[provision-worker] job ${job.id} (${job.name}) completed`
    );
  });

  worker.on("failed", (job, err) => {
    console.error(
      `[provision-worker] job ${job?.id} (${job?.name}) FAILED: ${err.message}`
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
