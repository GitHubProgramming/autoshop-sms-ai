/**
 * Pipeline Execution Trace Service
 *
 * Records step-by-step execution traces for missed-call and inbound-SMS
 * pipeline runs. Each trace captures every step the pipeline touched,
 * whether it succeeded or failed, and how long it took.
 *
 * This gives operators immediate visibility into "where exactly did it
 * fail?" after a real pilot test attempt.
 *
 * Usage pattern:
 *   const trace = await startTrace({ ... });
 *   await trace.step("tenant_resolved", "ok", "Bob's Auto (abc-123)");
 *   await trace.step("job_enqueued", "ok", "sms-inbound / process-sms");
 *   await trace.complete();        // or trace.fail("reason")
 */

import { query } from "../db/client";

// ── Types ────────────────────────────────────────────────────────────────────

export type TriggerType = "missed_call" | "inbound_sms";
export type StepStatus = "ok" | "fail" | "skip";
export type TraceStatus = "running" | "completed" | "failed";

export interface TraceStep {
  step: string;
  status: StepStatus;
  detail: string | null;
  at: string;        // ISO timestamp
  ms: number | null;  // duration if measured
}

export interface PipelineTrace {
  id: string;
  tenant_id: string | null;
  trigger_type: TriggerType;
  trigger_id: string | null;
  customer_phone: string | null;
  status: TraceStatus;
  steps: TraceStep[];
  started_at: string;
  completed_at: string | null;
  error_summary: string | null;
}

export interface StartTraceInput {
  triggerType: TriggerType;
  triggerId: string | null;
  customerPhone: string | null;
  tenantId?: string | null;
}

export interface TraceHandle {
  id: string;
  /** Record a pipeline step. Non-fatal: silently ignores DB errors. */
  step: (name: string, status: StepStatus, detail?: string | null, durationMs?: number | null) => Promise<void>;
  /** Set tenant_id after resolution (may not be known at trace start). */
  setTenant: (tenantId: string) => Promise<void>;
  /** Mark trace as completed (all steps done). */
  complete: () => Promise<void>;
  /** Mark trace as failed with an error summary. */
  fail: (error: string) => Promise<void>;
}

// ── Core functions ───────────────────────────────────────────────────────────

/**
 * Start a new pipeline execution trace.
 * Returns a handle with step(), complete(), and fail() methods.
 */
export async function startTrace(input: StartTraceInput): Promise<TraceHandle> {
  const rows = await query<{ id: string }>(
    `INSERT INTO pipeline_traces (trigger_type, trigger_id, customer_phone, tenant_id, status)
     VALUES ($1, $2, $3, $4, 'running')
     RETURNING id`,
    [input.triggerType, input.triggerId, input.customerPhone, input.tenantId ?? null]
  );

  const traceId = rows[0].id;

  return buildHandle(traceId);
}

/**
 * Resume an existing trace by ID (used when worker picks up a job
 * that was started at the webhook layer).
 */
export async function resumeTrace(traceId: string): Promise<TraceHandle> {
  return buildHandle(traceId);
}

/**
 * Find trace by trigger_id (CallSid or MessageSid).
 * Returns the trace ID if found, null otherwise.
 */
export async function findTraceByTriggerId(triggerId: string): Promise<string | null> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM pipeline_traces WHERE trigger_id = $1 ORDER BY started_at DESC LIMIT 1`,
    [triggerId]
  );
  return rows.length > 0 ? rows[0].id : null;
}

/**
 * Fetch recent traces for the admin UI.
 */
export async function getRecentTraces(limit = 50): Promise<PipelineTrace[]> {
  return query<PipelineTrace>(
    `SELECT id, tenant_id, trigger_type, trigger_id, customer_phone,
            status, steps, started_at, completed_at, error_summary
     FROM pipeline_traces
     ORDER BY started_at DESC
     LIMIT $1`,
    [limit]
  );
}

/**
 * Fetch a single trace by ID.
 */
export async function getTraceById(id: string): Promise<PipelineTrace | null> {
  const rows = await query<PipelineTrace>(
    `SELECT id, tenant_id, trigger_type, trigger_id, customer_phone,
            status, steps, started_at, completed_at, error_summary
     FROM pipeline_traces
     WHERE id = $1`,
    [id]
  );
  return rows.length > 0 ? rows[0] : null;
}

// ── Internal ─────────────────────────────────────────────────────────────────

function buildHandle(traceId: string): TraceHandle {
  return {
    id: traceId,

    async step(name: string, status: StepStatus, detail?: string | null, durationMs?: number | null) {
      const stepObj: TraceStep = {
        step: name,
        status,
        detail: detail ?? null,
        at: new Date().toISOString(),
        ms: durationMs ?? null,
      };
      try {
        await query(
          `UPDATE pipeline_traces
           SET steps = steps || $1::jsonb
           WHERE id = $2`,
          [JSON.stringify([stepObj]), traceId]
        );
      } catch {
        // Non-fatal: tracing must never break the pipeline
      }
    },

    async setTenant(tenantId: string) {
      try {
        await query(
          `UPDATE pipeline_traces SET tenant_id = $1 WHERE id = $2`,
          [tenantId, traceId]
        );
      } catch {
        // Non-fatal
      }
    },

    async complete() {
      try {
        await query(
          `UPDATE pipeline_traces
           SET status = 'completed', completed_at = now()
           WHERE id = $1`,
          [traceId]
        );
      } catch {
        // Non-fatal
      }
    },

    async fail(error: string) {
      try {
        await query(
          `UPDATE pipeline_traces
           SET status = 'failed', completed_at = now(), error_summary = $1
           WHERE id = $2`,
          [error, traceId]
        );
      } catch {
        // Non-fatal
      }
    },
  };
}
