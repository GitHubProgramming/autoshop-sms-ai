import { Worker, Job } from "bullmq";
import { bullmqConnection as connection } from "../queues/redis";
import { moveToDeadLetter } from "../queues/dead-letter";
import { raiseAlert } from "../services/pipeline-alerts";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:3000";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? "";
const MISSED_CALL_ENDPOINT = `${API_INTERNAL_URL}/internal/missed-call-sms`;
const PROCESS_SMS_ENDPOINT = `${API_INTERNAL_URL}/internal/process-sms`;
console.info(`[sms-worker] SMS replies → ${PROCESS_SMS_ENDPOINT}`);
console.info(`[sms-worker] Missed calls → ${MISSED_CALL_ENDPOINT}`);

/**
 * BullMQ worker: consumes jobs from "sms-inbound" queue and routes them:
 *
 *   - "process-sms"         → API /internal/process-sms (AI conversation flow)
 *   - "missed-call-trigger" → API /internal/missed-call-sms (initial outbound SMS)
 *
 * Both job types are now handled by the API directly (no n8n dependency):
 * 1. process-sms: full AI conversation loop (OpenAI → booking detection → appointment → calendar)
 * 2. missed-call-trigger: template SMS + conversation creation
 */
export function startSmsInboundWorker(): Worker {
  const worker = new Worker(
    "sms-inbound",
    async (job: Job) => {
      const isMissedCall = job.name === "missed-call-trigger";
      const targetUrl = isMissedCall ? MISSED_CALL_ENDPOINT : PROCESS_SMS_ENDPOINT;

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (INTERNAL_API_KEY) headers["x-internal-key"] = INTERNAL_API_KEY;

      const res = await fetch(targetUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(job.data),
        signal: AbortSignal.timeout(60_000), // 60s for AI processing
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const target = isMissedCall ? "API missed-call-sms" : "API process-sms";
        throw new Error(`${target} returned ${res.status}: ${body}`);
      }
    },
    {
      connection,
      concurrency: 10,
    }
  );

  worker.on("completed", (job) => {
    console.info(
      `[sms-worker] job ${job.id} (${job.name}) delivered to API`
    );
  });

  worker.on("failed", (job, err) => {
    console.error(
      `[sms-worker] job ${job?.id} (${job?.name}) failed: ${err.message}`
    );

    // Raise alert when job exhausts all retries (dead letter)
    const attempts = job?.attemptsMade ?? 0;
    const maxAttempts = (job?.opts?.attempts ?? 3);
    if (attempts >= maxAttempts) {
      const tenantId = job?.data?.tenantId ?? null;
      const customerPhone = job?.data?.customerPhone ?? null;
      const traceId = job?.data?.traceId ?? null;
      const phoneSuffix = customerPhone ? ` (customer: ${customerPhone.slice(-4)})` : "";

      raiseAlert({
        tenantId,
        traceId,
        severity: "critical",
        alertType: "worker_exhausted",
        summary: `Job ${job?.name ?? "unknown"} exhausted all ${maxAttempts} retries${phoneSuffix}`,
        details: err.message,
      }).catch(() => { /* non-fatal */ });

      // Preserve in dead letter queue for inspection/replay
      moveToDeadLetter("sms-inbound", job, err);
    }
  });

  return worker;
}
