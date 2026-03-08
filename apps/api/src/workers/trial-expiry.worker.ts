/**
 * Trial Expiry Worker
 *
 * Runs every hour. Finds tenants whose trial_ends_at < NOW() and
 * billing_status is still 'trial', then marks them 'trial_expired'.
 *
 * This is a belt-and-suspenders pass — getBlockReason() already checks
 * trial_ends_at in real-time for every inbound SMS. This cron updates the
 * DB status field so reporting / admin queries reflect the correct state
 * without requiring a live date comparison in every SQL query.
 */

import { Worker, Queue } from "bullmq";

const connection = {
  host:     process.env.REDIS_HOST     ?? "redis",
  port:     Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD ?? undefined,
};

const QUEUE_NAME = "trial-expiry";

export function startTrialExpiryWorker(): Worker {
  const queue = new Queue(QUEUE_NAME, { connection });

  // Register a repeating job (cron: every hour at :00)
  // The first run fires on startup, subsequent runs follow the cron schedule.
  queue
    .add(
      "expire-trials",
      {},
      {
        jobId:           "expire-trials-cron",
        repeat:          { pattern: "0 * * * *" },
        removeOnComplete: 10,
        removeOnFail:     5,
      }
    )
    .catch((err) => {
      // Non-fatal: repeating job may already be registered from a previous run
      if (!(err as Error).message?.includes("already exists")) {
        console.error("[trial-expiry] Failed to register repeating job:", (err as Error).message);
      }
    });

  const worker = new Worker(
    QUEUE_NAME,
    async (_job) => {
      // Lazy import to avoid circular dependency at startup
      const { query } = await import("../db/client");

      const expired = await query<{ id: string; owner_email: string }>(
        `UPDATE tenants
         SET billing_status = 'trial_expired', updated_at = NOW()
         WHERE billing_status = 'trial'
           AND trial_ends_at < NOW()
         RETURNING id, owner_email`,
        []
      );

      if (expired.length > 0) {
        for (const t of expired) {
          console.info(
            `[trial-expiry] Tenant ${t.id} (${t.owner_email}) trial expired — billing_status → trial_expired`
          );
        }
      }
    },
    { connection }
  );

  worker.on("failed", (job, err) => {
    console.error("[trial-expiry] Job failed:", job?.id, err.message);
  });

  return worker;
}
