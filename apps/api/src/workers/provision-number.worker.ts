import { Worker, Job } from "bullmq";
import { bullmqConnection as connection } from "../queues/redis";

const N8N_INTERNAL_URL = process.env.N8N_INTERNAL_URL ?? "http://n8n:5678";
const N8N_PROVISION_WEBHOOK = `${N8N_INTERNAL_URL}/webhook/provision-number`;
console.info(`[provision-worker] posting to ${N8N_PROVISION_WEBHOOK}`);

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
  });

  return worker;
}
