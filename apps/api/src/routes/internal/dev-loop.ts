/**
 * Dev-Loop Operator Routes
 *
 * Endpoints for operator task visibility and review.
 *
 * Admin routes (require adminGuard):
 *   GET  /internal/admin/dev-loop/tasks          — list tasks
 *   GET  /internal/admin/dev-loop/tasks/:taskId   — task detail
 *   POST /internal/admin/dev-loop/tasks/:taskId/review — mark reviewed
 *   GET  /internal/admin/dev-loop/counts          — status counts
 *
 * Webhook callback (internal, no auth — called by n8n):
 *   POST /internal/dev-loop/task-submit           — record new task
 *   POST /internal/dev-loop/task-result           — record execution result
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { adminGuard } from "../../middleware/admin-guard";
import { requireInternal } from "../../middleware/require-internal";
import {
  createTask,
  updateTaskResult,
  listTasks,
  getTaskDetail,
  reviewTask,
  taskCounts,
} from "../../services/dev-loop-tasks";

export async function devLoopRoute(app: FastifyInstance) {
  // ── POST /internal/dev-loop/task-submit ───────────────────────────────────
  // Called by n8n workflow or CLI to register a new task
  const TaskSubmitSchema = z.object({
    task_id: z.string().min(1),
    title: z.string().min(1),
    goal: z.string().min(1),
    scope_boundaries: z.array(z.string()).optional(),
    files_allowed: z.array(z.string()).optional(),
    files_forbidden: z.array(z.string()).optional(),
    critical_systems_risk: z.boolean().optional(),
    expected_output: z.array(z.string()).optional(),
    checks_required: z.array(z.string()).optional(),
  });

  app.post("/dev-loop/task-submit", { preHandler: [requireInternal] }, async (request, reply) => {
    const parsed = TaskSubmitSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }

    try {
      const id = await createTask(parsed.data);
      request.log.info({ task_id: parsed.data.task_id, id }, "[dev-loop] Task registered");
      return reply.status(201).send({ id, task_id: parsed.data.task_id, status: "pending" });
    } catch (err) {
      request.log.error({ task_id: parsed.data.task_id, err: (err as Error).message }, "[dev-loop] Failed to register task");
      return reply.status(500).send({ error: "Failed to register task", detail: (err as Error).message });
    }
  });

  // ── POST /internal/dev-loop/task-result ───────────────────────────────────
  // Called by n8n workflow to store execution result + review packet
  const TaskResultSchema = z.object({
    task_id: z.string().min(1),
    status: z.enum(["done", "failed", "blocked"]),
    files_changed: z.array(z.string()).optional(),
    checks_run: z.any().optional(),
    critical_files_touched: z.array(z.string()).optional(),
    execution_summary: z.string().optional(),
    open_issues: z.array(z.string()).optional(),
    retry_recommended: z.boolean().optional(),
    goal_match: z.enum(["full", "partial", "failed"]).optional(),
    risk_level: z.enum(["low", "medium", "high"]).optional(),
    review_decision: z.enum(["SAFE_AUTOMERGE", "FIX_AND_RETRY", "ESCALATE"]).optional(),
    operator_notes: z.string().optional(),
    branch: z.string().optional(),
    git_diff_summary: z.string().optional(),
    retry_count: z.number().optional(),
    logical_gaps: z.array(z.string()).optional(),
  });

  app.post("/dev-loop/task-result", { preHandler: [requireInternal] }, async (request, reply) => {
    const parsed = TaskResultSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }

    try {
      const updated = await updateTaskResult(parsed.data);
      if (!updated) {
        request.log.warn({ task_id: parsed.data.task_id }, "[dev-loop] Task not found for result update");
        return reply.status(404).send({ error: `Task ${parsed.data.task_id} not found` });
      }
      request.log.info({ task_id: parsed.data.task_id, status: parsed.data.status, decision: parsed.data.review_decision }, "[dev-loop] Result saved");
      return reply.status(200).send({ task_id: parsed.data.task_id, status: parsed.data.status });
    } catch (err) {
      request.log.error({ task_id: parsed.data.task_id, err: (err as Error).message }, "[dev-loop] Failed to save task result");
      return reply.status(500).send({ error: "Failed to save task result", detail: (err as Error).message });
    }
  });

  // ── GET /internal/admin/dev-loop/tasks ────────────────────────────────────
  app.get("/admin/dev-loop/tasks", { preHandler: [adminGuard] }, async (request, reply) => {
    const q = request.query as { status?: string; reviewed?: string; limit?: string };
    const tasks = await listTasks({
      status: q.status || undefined,
      reviewed: q.reviewed === "true" ? true : q.reviewed === "false" ? false : undefined,
      limit: q.limit ? parseInt(q.limit, 10) : 50,
    });
    return reply.send({ count: tasks.length, tasks });
  });

  // ── GET /internal/admin/dev-loop/tasks/:taskId ────────────────────────────
  app.get("/admin/dev-loop/tasks/:taskId", { preHandler: [adminGuard] }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const task = await getTaskDetail(taskId);
    if (!task) {
      return reply.status(404).send({ error: "Task not found" });
    }
    return reply.send(task);
  });

  // ── POST /internal/admin/dev-loop/tasks/:taskId/review ────────────────────
  const ReviewSchema = z.object({
    action: z.enum(["approve", "reject", "retry", "escalate"]),
    comment: z.string().optional(),
  });

  app.post("/admin/dev-loop/tasks/:taskId/review", { preHandler: [adminGuard] }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const parsed = ReviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }

    const adminEmail = (request as any).adminEmail || "unknown";
    const updated = await reviewTask(taskId, parsed.data.action, adminEmail, parsed.data.comment);
    if (!updated) {
      return reply.status(404).send({ error: "Task not found or already reviewed" });
    }
    return reply.send({ task_id: taskId, reviewed: true, action: parsed.data.action });
  });

  // ── GET /internal/admin/dev-loop/counts ───────────────────────────────────
  app.get("/admin/dev-loop/counts", { preHandler: [adminGuard] }, async (_request, reply) => {
    const counts = await taskCounts();
    return reply.send(counts);
  });
}
