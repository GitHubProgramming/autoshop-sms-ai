import { Worker, Job } from "bullmq";
import { bullmqConnection as connection } from "../queues/redis";
import { moveToDeadLetter } from "../queues/dead-letter";
import { query } from "../db/client";
import { createLogger } from "../utils/logger";

const log = createLogger("billing-worker");

/**
 * BullMQ worker: consumes jobs from "billing-events" queue.
 *
 * Job types:
 *   - "grace-period-check" — if tenant is still past_due after 3 days, block them
 */
export function startBillingEventsWorker(): Worker {
  const worker = new Worker(
    "billing-events",
    async (job: Job) => {
      if (job.name === "grace-period-check") {
        const { tenantId } = job.data;

        const updated = await query<{ id: string }>(
          `UPDATE tenants
           SET billing_status = 'past_due_blocked', updated_at = NOW()
           WHERE id = $1 AND billing_status = 'past_due'
           RETURNING id`,
          [tenantId]
        );

        if (updated.length > 0) {
          log.warn({ tenantId }, "Tenant blocked: still past_due after grace period");
        } else {
          log.info({ tenantId }, "Tenant no longer past_due — no action needed");
        }
      } else {
        log.warn({ jobName: job.name }, "Unknown job type");
      }
    },
    {
      connection,
      concurrency: 5,
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

    // Preserve in dead letter queue when all retries exhausted
    const attempts = job?.attemptsMade ?? 0;
    const maxAttempts = job?.opts?.attempts ?? 3;
    if (attempts >= maxAttempts) {
      moveToDeadLetter("billing-events", job, err);
    }
  });

  return worker;
}
