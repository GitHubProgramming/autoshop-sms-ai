import { Worker, Job } from "bullmq";
import { bullmqConnection as connection } from "../queues/redis";

const N8N_INTERNAL_URL = process.env.N8N_INTERNAL_URL ?? "http://n8n:5678";
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:3000";
const N8N_SMS_WEBHOOK = `${N8N_INTERNAL_URL}/webhook/sms-inbound`;
const MISSED_CALL_ENDPOINT = `${API_INTERNAL_URL}/internal/missed-call-sms`;
console.info(`[sms-worker] SMS replies → ${N8N_SMS_WEBHOOK}`);
console.info(`[sms-worker] Missed calls → ${MISSED_CALL_ENDPOINT}`);

/**
 * BullMQ worker: consumes jobs from "sms-inbound" queue and routes them:
 *
 *   - "process-sms"         → n8n WF-001 (AI conversation flow)
 *   - "missed-call-trigger" → API /internal/missed-call-sms (initial outbound SMS)
 *
 * Missed calls are handled by the API directly because:
 * 1. No AI needed for the first message (it's a template)
 * 2. The API has Twilio credentials and DB access
 * 3. Faster response (no n8n round-trip)
 */
export function startSmsInboundWorker(): Worker {
  const worker = new Worker(
    "sms-inbound",
    async (job: Job) => {
      const isMissedCall = job.name === "missed-call-trigger";
      const targetUrl = isMissedCall ? MISSED_CALL_ENDPOINT : N8N_SMS_WEBHOOK;

      const res = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(job.data),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const target = isMissedCall ? "API missed-call-sms" : "n8n webhook";
        throw new Error(`${target} returned ${res.status}: ${body}`);
      }
    },
    {
      connection,
      concurrency: 10,
    }
  );

  worker.on("completed", (job) => {
    const target = job.name === "missed-call-trigger" ? "API" : "n8n";
    console.info(
      `[sms-worker] job ${job.id} (${job.name}) delivered to ${target}`
    );
  });

  worker.on("failed", (job, err) => {
    console.error(
      `[sms-worker] job ${job?.id} (${job?.name}) failed: ${err.message}`
    );
  });

  return worker;
}
