import { Worker, Queue } from "bullmq";
import { bullmqConnection as connection } from "../queues/redis";
import { expireTrials } from "../services/trial-expiry";

const QUEUE_NAME = "trial-expiry";

/** Queue with a repeatable job — runs every hour */
const trialExpiryQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

export function startTrialExpiryWorker(): Worker {
  // Ensure the repeatable job exists (idempotent — BullMQ deduplicates by repeat key)
  trialExpiryQueue
    .add("expire-trials", {}, { repeat: { every: 60 * 60 * 1000 } })
    .catch((err) =>
      console.error("[trial-expiry-worker] Failed to register repeatable job:", err)
    );

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      const expired = await expireTrials();
      if (expired > 0) {
        console.info(
          `[trial-expiry-worker] Expired ${expired} trial(s)`
        );
      }
    },
    { connection, concurrency: 1 }
  );

  worker.on("failed", (_job, err) => {
    console.error("[trial-expiry-worker] Job failed:", err.message);
  });

  return worker;
}
