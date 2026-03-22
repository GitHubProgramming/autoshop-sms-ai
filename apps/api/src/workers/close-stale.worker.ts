import { Worker, Queue } from "bullmq";
import { bullmqConnection as connection } from "../queues/redis";
import { closeStaleConversations } from "../services/close-stale-conversations";

const QUEUE_NAME = "close-stale-conversations";

/** Queue with a repeatable job — runs every 15 minutes */
const closeStaleQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

export function startCloseStaleWorker(): Worker {
  // Ensure the repeatable job exists (idempotent — BullMQ deduplicates by repeat key)
  closeStaleQueue
    .add("close-stale", {}, { repeat: { every: 15 * 60 * 1000 } })
    .catch((err) =>
      console.error("[close-stale-worker] Failed to register repeatable job:", err)
    );

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      const closed = await closeStaleConversations();
      console.info(
        `[close-stale-worker] Auto-closed ${closed} stale conversation(s)`
      );
    },
    { connection, concurrency: 1 }
  );

  worker.on("failed", (_job, err) => {
    console.error("[close-stale-worker] Job failed:", err.message);
  });

  return worker;
}
