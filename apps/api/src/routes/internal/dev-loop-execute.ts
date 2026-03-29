/**
 * Dev-Loop Execution Route
 *
 * POST /internal/dev-loop/execute
 *   Receives an approved task payload and executes it via the execution worker.
 *   Creates a branch, applies file changes, commits, and pushes to GitHub.
 *   Returns structured execution result.
 *
 *   Auth: requireInternal (x-internal-key header)
 *
 *   Called by: n8n orchestrator after SAFE_AUTOMERGE decision
 */

import { FastifyInstance } from "fastify";
import { requireInternal } from "../../middleware/require-internal";
import {
  executeTask,
  validateExecutionRequest,
} from "../../services/execution-worker";
import { updateTaskResult } from "../../services/dev-loop-tasks";

export async function devLoopExecuteRoute(app: FastifyInstance) {
  app.post(
    "/dev-loop/execute",
    { preHandler: [requireInternal] },
    async (request, reply) => {
      // ── Validate request ──────────────────────────────────
      const validation = validateExecutionRequest(request.body);
      if (!validation.valid || !validation.data) {
        return reply.status(400).send({
          error: "Validation failed",
          details: validation.errors,
        });
      }

      const task = validation.data;
      request.log.info(
        { task_id: task.task_id, title: task.title },
        "[execution-worker] Starting task execution"
      );

      // ── Execute ───────────────────────────────────────────
      const result = await executeTask(task);

      request.log.info(
        {
          task_id: result.task_id,
          branch: result.branch,
          status: result.execution_status,
          push: result.push_status,
          commit: result.commit_sha,
          error: result.error_reason,
        },
        "[execution-worker] Task execution complete"
      );

      // ── Persist result to dev_loop_tasks ──────────────────
      try {
        await updateTaskResult({
          task_id: task.task_id,
          status: result.execution_status === "success" ? "done" : "failed",
          files_changed: result.files_changed,
          execution_summary: result.error_reason
            ? `Execution failed: ${result.error_reason}`
            : `Branch ${result.branch} pushed with ${result.files_changed.length} file(s) [host: ${result.execution_host}]`,
          branch: result.branch,
        });
      } catch (dbErr) {
        request.log.warn(
          { task_id: task.task_id, err: (dbErr as Error).message },
          "[execution-worker] Failed to persist result to DB (non-fatal)"
        );
      }

      // ── Return structured result ──────────────────────────
      const httpStatus = result.execution_status === "success" ? 200 : 422;
      return reply.status(httpStatus).send(result);
    }
  );
}
