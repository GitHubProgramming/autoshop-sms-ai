import { Worker, Job } from "bullmq";
import { bullmqConnection as connection } from "../queues/redis";
import { moveToDeadLetter } from "../queues/dead-letter";
import { raiseAlert } from "../services/pipeline-alerts";
import { createLogger } from "../utils/logger";

const log = createLogger("sms-worker");
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:3000";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? "";
const MISSED_CALL_ENDPOINT = `${API_INTERNAL_URL}/internal/missed-call-sms`;
const PROCESS_SMS_ENDPOINT = `${API_INTERNAL_URL}/internal/process-sms`;
log.info({ sms: PROCESS_SMS_ENDPOINT, missedCall: MISSED_CALL_ENDPOINT }, "Endpoints configured");

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
    log.info({ jobId: job.id, jobName: job.name }, "Job delivered to API");
  });

  worker.on("failed", (job, err) => {
    log.error(
      { jobId: job?.id, jobName: job?.name, err: err.message },
      "Job failed"
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
