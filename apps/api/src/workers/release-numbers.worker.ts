import { Worker, Queue } from "bullmq";
import { bullmqConnection as connection } from "../queues/redis";
import { releaseExpiredSuspendedNumbers } from "../services/release-twilio-number";
import { createLogger } from "../utils/logger";

const log = createLogger("release-numbers-worker");
const QUEUE_NAME = "release-suspended-numbers";

/** Queue with a repeatable job — runs once per day (every 24 hours) */
const releaseNumbersQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

export function startReleaseNumbersWorker(): Worker {
  // Ensure the repeatable job exists (idempotent — BullMQ deduplicates by repeat key)
  releaseNumbersQueue
    .add("release-numbers", {}, { repeat: { every: 24 * 60 * 60 * 1000 } })
    .catch((err) =>
      log.error({ err }, "Failed to register repeatable job")
    );

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      const result = await releaseExpiredSuspendedNumbers();
      if (result.released > 0 || result.errors > 0 || result.skipped > 0) {
        log.info(
          { released: result.released, errors: result.errors, skipped: result.skipped },
          "Release cycle complete"
        );
      }
    },
    { connection, concurrency: 1 }
  );

  worker.on("failed", (_job, err) => {
    log.error({ err: err.message }, "Job failed");
  });

  return worker;
}
