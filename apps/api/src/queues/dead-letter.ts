import { Queue, Job } from "bullmq";
import { bullmqConnection as connection } from "./redis";
import { createLogger } from "../utils/logger";

const log = createLogger("dead-letter");

// ── Dead Letter Queue ────────────────────────────────────────────────────────
// Shared DLQ for all BullMQ workers.  When a job exhausts its retry attempts
// and reaches terminal failure, the worker's `failed` handler calls
// `moveToDeadLetter()` to preserve the failure context for later inspection
// and manual replay.

export const deadLetterQueue = new Queue("dead-letter", {
  connection,
  defaultJobOptions: {
    removeOnComplete: false, // keep DLQ entries indefinitely for ops review
    removeOnFail: 1000,      // cap self-failures to avoid unbounded growth
    attempts: 1,             // DLQ jobs are not retried automatically
  },
});

export interface DeadLetterPayload {
  /** Queue name where the job originally ran */
  sourceQueue: string;
  /** Original job name/type */
  jobName: string;
  /** Original BullMQ job id */
  jobId: string;
  /** Original job payload */
  data: unknown;
  /** Terminal failure message */
  failedReason: string;
  /** Number of attempts the job made before terminal failure */
  attemptsMade: number;
  /** ISO timestamp of the DLQ capture */
  failedAt: string;
}

/**
 * Enqueue a terminally-failed job into the dead letter queue.
 *
 * Call this only when `attemptsMade >= maxAttempts` — i.e., after all
 * retries are exhausted, not on intermediate failures.
 *
 * Logs success and failure of the DLQ write; never throws so it cannot
 * interfere with normal worker event handling.
 */
export async function moveToDeadLetter(
  sourceQueue: string,
  job: Job | undefined,
  error: Error
): Promise<void> {
  const payload: DeadLetterPayload = {
    sourceQueue,
    jobName: job?.name ?? "unknown",
    jobId: job?.id ?? "unknown",
    data: job?.data ?? null,
    failedReason: error.message,
    attemptsMade: job?.attemptsMade ?? 0,
    failedAt: new Date().toISOString(),
  };

  try {
    await deadLetterQueue.add("dead-letter-entry", payload, {
      jobId: `dlq-${sourceQueue}-${payload.jobId}`, // prevent duplicate DLQ inserts
    });
    log.warn(
      { sourceQueue, jobName: payload.jobName, jobId: payload.jobId },
      "Captured terminal failure"
    );
  } catch (dlqErr) {
    // Never swallow silently — log so ops can detect DLQ write failures
    log.error(
      { sourceQueue, jobName: payload.jobName, err: dlqErr instanceof Error ? dlqErr.message : String(dlqErr) },
      "FAILED to enqueue DLQ entry"
    );
  }
}
