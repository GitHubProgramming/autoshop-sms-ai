import { Worker, Job } from "bullmq";

const connection = {
  host: process.env.REDIS_HOST || "redis",
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
};

const N8N_INTERNAL_URL = process.env.N8N_INTERNAL_URL ?? "http://n8n:5678";
const N8N_PROVISION_WEBHOOK = `${N8N_INTERNAL_URL}/webhook/provision-number`;

/**
 * BullMQ worker: consumes jobs from "provision-number" queue and forwards
 * each job to n8n WF-007 webhook.
 *
 * Job types handled:
 *   - "provision-twilio-number"  (new subscriber checkout complete)
 *   - "suspend-twilio-number"    (subscription.deleted Stripe event)
 *
 * The jobType field is injected into the payload so WF-007 can route
 * appropriately within the workflow.
 */
export function startProvisionNumberWorker(): Worker {
  const worker = new Worker(
    "provision-number",
    async (job: Job) => {
      const payload = { ...job.data, jobType: job.name };
      const res = await fetch(N8N_PROVISION_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`n8n provision webhook returned ${res.status}: ${body}`);
      }
    },
    { connection, concurrency: 2 }
  );

  worker.on("completed", (job) => {
    console.info(`[provision-worker] job ${job.id} (${job.name}) delivered to n8n`);
  });

  worker.on("failed", (job, err) => {
    console.error(
      `[provision-worker] job ${job?.id} (${job?.name}) failed: ${err.message}`
    );
  });

  return worker;
}
