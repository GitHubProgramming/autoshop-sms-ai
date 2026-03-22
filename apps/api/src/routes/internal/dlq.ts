import { FastifyInstance } from "fastify";
import { deadLetterQueue, type DeadLetterPayload } from "../../queues/dead-letter";
import { requireInternal } from "../../middleware/require-internal";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

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
}
