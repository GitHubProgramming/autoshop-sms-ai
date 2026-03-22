import { Queue } from "bullmq";
import { FastifyInstance } from "fastify";
import { deadLetterQueue, type DeadLetterPayload } from "../../queues/dead-letter";
import { requireInternal } from "../../middleware/require-internal";
import {
  smsInboundQueue,
  provisionNumberQueue,
  billingQueue,
  calendarQueue,
} from "../../queues/redis";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Allowlist of queues that DLQ replay can target */
const REPLAYABLE_QUEUES: Record<string, Queue> = {
  "sms-inbound": smsInboundQueue,
  "provision-number": provisionNumberQueue,
  "billing-events": billingQueue,
  "calendar-sync": calendarQueue,
};

/**
 * GET /internal/dlq
 *
 * Read-only inspection of dead letter queue entries.
 * Returns recent terminally-failed jobs, newest first.
 *
 * Query params:
 *   limit — number of entries (default 20, max 100)
 */
export async function dlqRoute(app: FastifyInstance) {
  app.get("/dlq", { preHandler: [requireInternal] }, async (request, reply) => {
    const raw = (request.query as Record<string, string>).limit;
    const parsed = raw ? Math.min(Math.max(1, Math.floor(Number(raw)) || DEFAULT_LIMIT), MAX_LIMIT) : DEFAULT_LIMIT;

    try {
      // DLQ jobs sit in "waiting" because no worker consumes the dead-letter queue.
      const jobs = await deadLetterQueue.getJobs(["waiting", "delayed", "completed", "failed"], 0, parsed - 1);

      const entries = jobs
        .map((job) => {
          const p = job.data as DeadLetterPayload | undefined;
          return {
            dlqJobId: job.id,
            jobId: p?.jobId ?? job.id,
            sourceQueue: p?.sourceQueue ?? "unknown",
            jobName: p?.jobName ?? job.name,
            data: p?.data ?? null,
            failedReason: p?.failedReason ?? "",
            attemptsMade: p?.attemptsMade ?? 0,
            failedAt: p?.failedAt ?? "",
          };
        })
        .sort((a, b) => (b.failedAt > a.failedAt ? 1 : b.failedAt < a.failedAt ? -1 : 0));

      return reply.send(entries);
    } catch (err) {
      request.log.error({ err }, "Failed to read dead letter queue");
      return reply.status(500).send({ error: "Failed to read dead letter queue" });
    }
  });

  /**
   * POST /internal/dlq/replay/:jobId
   *
   * Replay a single DLQ entry back into its original source queue.
   * Removes the DLQ entry on successful replay to prevent duplicate replays.
   */
  app.post<{ Params: { jobId: string } }>(
    "/dlq/replay/:jobId",
    { preHandler: [requireInternal] },
    async (request, reply) => {
      const { jobId } = request.params;

      try {
        const dlqJob = await deadLetterQueue.getJob(jobId);
        if (!dlqJob) {
          return reply.status(404).send({ error: "DLQ job not found", jobId });
        }

        const payload = dlqJob.data as DeadLetterPayload | undefined;
        if (!payload?.sourceQueue || payload.data === undefined) {
          request.log.warn({ jobId }, "[dlq-replay] Invalid DLQ payload");
          return reply.status(400).send({ error: "Invalid DLQ payload", jobId });
        }

        const targetQueue = REPLAYABLE_QUEUES[payload.sourceQueue];
        if (!targetQueue) {
          request.log.warn({ jobId, sourceQueue: payload.sourceQueue }, "[dlq-replay] Unknown source queue");
          return reply.status(400).send({
            error: "Unknown source queue",
            sourceQueue: payload.sourceQueue,
            allowedQueues: Object.keys(REPLAYABLE_QUEUES),
          });
        }

        const jobName = payload.jobName || "replayed-job";
        const replayedJob = await targetQueue.add(jobName, payload.data);

        // Remove DLQ entry after successful re-enqueue to prevent duplicate replays
        await dlqJob.remove();

        request.log.info(
          { dlqJobId: jobId, sourceQueue: payload.sourceQueue, replayedJobId: replayedJob.id },
          "[dlq-replay] Job replayed successfully"
        );

        return reply.send({
          ok: true,
          replayedFromDlqJobId: jobId,
          sourceQueue: payload.sourceQueue,
          replayedJobId: replayedJob.id,
        });
      } catch (err) {
        request.log.error({ err, jobId }, "[dlq-replay] Failed to replay DLQ job");
        return reply.status(500).send({ error: "Failed to replay DLQ job", jobId });
      }
    }
  );
}
