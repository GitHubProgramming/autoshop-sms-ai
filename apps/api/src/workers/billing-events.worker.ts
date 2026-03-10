import { Worker, Job } from "bullmq";
import { bullmqConnection as connection } from "../queues/redis";
import { query } from "../db/client";

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
          console.warn(
            `[billing-worker] Tenant ${tenantId} blocked: still past_due after grace period`
          );
        } else {
          console.info(
            `[billing-worker] Tenant ${tenantId} no longer past_due — no action needed`
          );
        }
      } else {
        console.warn(`[billing-worker] Unknown job type: ${job.name}`);
      }
    },
    {
      connection,
      concurrency: 5,
    }
  );

  worker.on("completed", (job) => {
    console.info(`[billing-worker] job ${job.id} (${job.name}) completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(
      `[billing-worker] job ${job?.id} (${job?.name}) FAILED: ${err.message}`
    );
  });

  return worker;
}
