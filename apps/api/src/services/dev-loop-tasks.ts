/**
 * Dev-Loop Task Service
 *
 * CRUD operations for operator-visible task tracking.
 * Tasks are created when submitted to the dev-loop webhook,
 * updated when execution completes, and reviewed by operators.
 */

import { query } from "../db/client";

// ── Types ────────────────────────────────────────────────────────────────────

export interface DevLoopTask {
  id: string;
  task_id: string;
  title: string;
  goal: string;
  status: string;
  review_decision: string | null;
  risk_level: string | null;
  goal_match: string | null;
  branch: string | null;
  reviewed: boolean;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_action: string | null;
  review_comment: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

export interface DevLoopTaskDetail extends DevLoopTask {
  scope_boundaries: string[];
  files_allowed: string[];
  files_forbidden: string[];
  critical_systems_risk: boolean;
  expected_output: string[];
  checks_required: string[];
  files_changed: string[];
  checks_run: any;
  critical_files_touched: string[];
  execution_summary: string | null;
  open_issues: string[];
  retry_recommended: boolean | null;
  operator_notes: string | null;
  git_diff_summary: string | null;
  logical_gaps: string[];
}

export interface CreateTaskInput {
  task_id: string;
  title: string;
  goal: string;
  scope_boundaries?: string[];
  files_allowed?: string[];
  files_forbidden?: string[];
  critical_systems_risk?: boolean;
  expected_output?: string[];
  checks_required?: string[];
}

export interface UpdateResultInput {
  task_id: string;
  status: string;
  files_changed?: string[];
  checks_run?: any;
  critical_files_touched?: string[];
  execution_summary?: string;
  open_issues?: string[];
  retry_recommended?: boolean;
  goal_match?: string;
  risk_level?: string;
  review_decision?: string;
  operator_notes?: string;
  branch?: string;
  git_diff_summary?: string;
  retry_count?: number;
  logical_gaps?: string[];
}

// ── Create ───────────────────────────────────────────────────────────────────

export async function createTask(input: CreateTaskInput): Promise<string> {
  const rows = await query<{ id: string }>(
    `INSERT INTO dev_loop_tasks (task_id, title, goal, scope_boundaries, files_allowed,
       files_forbidden, critical_systems_risk, expected_output, checks_required, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
     ON CONFLICT (task_id) DO UPDATE SET
       title = EXCLUDED.title, goal = EXCLUDED.goal,
       scope_boundaries = EXCLUDED.scope_boundaries,
       files_allowed = EXCLUDED.files_allowed,
       files_forbidden = EXCLUDED.files_forbidden,
       critical_systems_risk = EXCLUDED.critical_systems_risk,
       expected_output = EXCLUDED.expected_output,
       checks_required = EXCLUDED.checks_required,
       status = 'pending', updated_at = NOW()
     RETURNING id`,
    [
      input.task_id,
      input.title,
      input.goal,
      input.scope_boundaries ?? [],
      input.files_allowed ?? [],
      input.files_forbidden ?? [],
      input.critical_systems_risk ?? false,
      input.expected_output ?? [],
      input.checks_required ?? [],
    ]
  );
  return rows[0].id;
}

// ── Update result ────────────────────────────────────────────────────────────

export async function updateTaskResult(input: UpdateResultInput): Promise<boolean> {
  const rows = await query(
    `UPDATE dev_loop_tasks SET
       status = $2, files_changed = $3, checks_run = $4,
       critical_files_touched = $5, execution_summary = $6,
       open_issues = $7, retry_recommended = $8,
       goal_match = $9, risk_level = $10, review_decision = $11,
       operator_notes = $12, branch = $13, git_diff_summary = $14,
       retry_count = $15, logical_gaps = $16, updated_at = NOW()
     WHERE task_id = $1
     RETURNING id`,
    [
      input.task_id,
      input.status,
      input.files_changed ?? [],
      input.checks_run ? JSON.stringify(input.checks_run) : null,
      input.critical_files_touched ?? [],
      input.execution_summary ?? null,
      input.open_issues ?? [],
      input.retry_recommended ?? false,
      input.goal_match ?? null,
      input.risk_level ?? null,
      input.review_decision ?? null,
      input.operator_notes ?? null,
      input.branch ?? null,
      input.git_diff_summary ?? null,
      input.retry_count ?? 0,
      input.logical_gaps ?? [],
    ]
  );
  return (rows as any[]).length > 0;
}

// ── List ─────────────────────────────────────────────────────────────────────

export async function listTasks(
  opts: { status?: string; reviewed?: boolean; limit?: number } = {}
): Promise<DevLoopTask[]> {
  const limit = opts.limit ?? 50;
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (opts.status) {
    conditions.push(`status = $${idx++}`);
    params.push(opts.status);
  }
  if (opts.reviewed !== undefined) {
    conditions.push(`reviewed = $${idx++}`);
    params.push(opts.reviewed);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);

  return query<DevLoopTask>(
    `SELECT id, task_id, title, goal, status, review_decision, risk_level,
            goal_match, branch, reviewed, reviewed_at, reviewed_by,
            review_action, review_comment, retry_count, created_at, updated_at
     FROM dev_loop_tasks
     ${where}
     ORDER BY created_at DESC
     LIMIT $${idx}`,
    params
  );
}

// ── Get detail ───────────────────────────────────────────────────────────────

export async function getTaskDetail(taskId: string): Promise<DevLoopTaskDetail | null> {
  const rows = await query<DevLoopTaskDetail>(
    `SELECT * FROM dev_loop_tasks WHERE task_id = $1`,
    [taskId]
  );
  return rows[0] ?? null;
}

// ── Review ───────────────────────────────────────────────────────────────────

export async function reviewTask(
  taskId: string,
  action: string,
  reviewedBy: string,
  comment?: string
): Promise<boolean> {
  const rows = await query(
    `UPDATE dev_loop_tasks SET
       reviewed = TRUE, reviewed_at = NOW(), reviewed_by = $2,
       review_action = $3, review_comment = $4, updated_at = NOW()
     WHERE task_id = $1 AND reviewed = FALSE
     RETURNING id`,
    [taskId, reviewedBy, action, comment ?? null]
  );
  return (rows as any[]).length > 0;
}

// ── Counts ───────────────────────────────────────────────────────────────────

export async function taskCounts(): Promise<{
  total: number;
  pending: number;
  running: number;
  done: number;
  failed: number;
  blocked: number;
  needs_review: number;
}> {
  const rows = await query<any>(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
       COUNT(*) FILTER (WHERE status = 'running')::int AS running,
       COUNT(*) FILTER (WHERE status = 'done')::int AS done,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
       COUNT(*) FILTER (WHERE status = 'blocked')::int AS blocked,
       COUNT(*) FILTER (WHERE reviewed = FALSE AND status IN ('done','failed','blocked'))::int AS needs_review
     FROM dev_loop_tasks`
  );
  return rows[0];
}
