import { Worker, Job } from "bullmq";
import { redis } from "../queues/redis";

const N8N_INTERNAL_URL = process.env.N8N_INTERNAL_URL ?? "http://n8n:5678";
const N8N_SMS_WEBHOOK = `${N8N_INTERNAL_URL}/webhook/sms-inbound`;
console.info(`[sms-worker] posting to ${N8N_SMS_WEBHOOK}`);

/**
 * BullMQ worker: consumes jobs from "sms-inbound" queue and forwards
 * each job's payload to the n8n WF-001 webhook trigger.
 *
 * Both job types land here:
 *   - "process-sms"         (inbound SMS from Twilio)
 *   - "missed-call-trigger" (missed call → initiate outbound SMS flow)
 */
export function startSmsInboundWorker(): Worker {
  const worker = new Worker(
    "sms-inbound",
    async (job: Job) => {
      const res = await fetch(N8N_SMS_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(job.data),
        signal: AbortSignal.timeout(30_000), // n8n must accept within 30s
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`n8n webhook returned ${res.status}: ${body}`);
      }
    },
    {
      connection: redis,
      concurrency: 10,
    }
  );

  worker.on("completed", (job) => {
    console.info(`[sms-worker] job ${job.id} (${job.name}) delivered to n8n`);
  });

  worker.on("failed", (job, err) => {
    console.error(
      `[sms-worker] job ${job?.id} (${job?.name}) failed: ${err.message}`
    );
  });

  return worker;
}
