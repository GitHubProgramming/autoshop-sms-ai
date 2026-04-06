/**
 * Pipeline Alert Service
 *
 * Creates alerts when the core pipeline fails and notifies tenant owners
 * via SMS. Alerts persist in the database until acknowledged by an admin.
 *
 * Alert types:
 *   - sms_send_failed:       Reply SMS could not be delivered
 *   - ai_error:              OpenAI API failure
 *   - booking_failed:        Appointment creation failed
 *   - calendar_sync_failed:  Google Calendar write failed
 *   - worker_exhausted:      BullMQ job exhausted all retries
 *   - pipeline_failed:       Generic pipeline failure
 */

import { query } from "../db/client";
import { sendTwilioSms } from "./missed-call-sms";
import { createLogger } from "../utils/logger";

const pipelineLog = createLogger("pipeline-alerts");

// ── Types ────────────────────────────────────────────────────────────────────

export type AlertSeverity = "critical" | "warning";

export type AlertType =
  | "sms_send_failed"
  | "ai_error"
  | "booking_failed"
  | "calendar_sync_failed"
  | "worker_exhausted"
  | "pipeline_failed";

export interface RaiseAlertInput {
  tenantId: string | null;
  traceId: string | null;
  severity: AlertSeverity;
  alertType: AlertType;
  summary: string;
  details?: string | null;
}

export interface PipelineAlert {
  id: string;
  tenant_id: string | null;
  trace_id: string | null;
  severity: string;
  alert_type: string;
  summary: string;
  details: string | null;
  owner_notified: boolean;
  acknowledged: boolean;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  created_at: string;
  shop_name?: string | null;
}

// ── Core functions ───────────────────────────────────────────────────────────

/**
 * Create a pipeline alert and optionally notify the tenant owner via SMS.
 * Non-fatal: never throws — alerting must not break the pipeline.
 */
export async function raiseAlert(
  input: RaiseAlertInput,
  fetchFn: typeof fetch = fetch
): Promise<string | null> {
  try {
    // Insert alert record
    const rows = await query<{ id: string }>(
      `INSERT INTO pipeline_alerts (tenant_id, trace_id, severity, alert_type, summary, details)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        input.tenantId,
        input.traceId,
        input.severity,
        input.alertType,
        input.summary,
        input.details ?? null,
      ]
    );

    const alertId = rows[0]?.id ?? null;

    // Notify owner via SMS if tenant has owner_phone (skip demo accounts)
    if (input.tenantId && input.severity === "critical") {
      try {
        const tenantRows = await query<{ owner_phone: string | null; shop_name: string | null; billing_status: string }>(
          `SELECT owner_phone, shop_name, billing_status FROM tenants WHERE id = $1`,
          [input.tenantId]
        );

        // Demo tenants must never receive real SMS — alert record is enough
        if (tenantRows[0]?.billing_status === "demo") {
          return alertId;
        }

        const ownerPhone = tenantRows[0]?.owner_phone;
        if (ownerPhone) {
          const shopLabel = tenantRows[0]?.shop_name ?? "Your shop";
          const alertSms =
            `AutoShop AI Alert (${shopLabel}): ${input.summary}. ` +
            `Check your dashboard or contact support.`;

          const smsResult = await sendTwilioSms(ownerPhone, alertSms, fetchFn);

          if (smsResult.sid && alertId) {
            await query(
              `UPDATE pipeline_alerts SET owner_notified = TRUE WHERE id = $1`,
              [alertId]
            );
          }
        }
      } catch {
        // Non-fatal: alert was created even if SMS notification fails
      }
    }

    return alertId;
  } catch (err) {
    // Non-fatal: alerting must never break the pipeline
    pipelineLog.error({ err: (err as Error).message }, "Failed to raise alert");
    return null;
  }
}

/**
 * Classify a pipeline error into an alert type and severity.
 */
export function classifyError(error: string | null): { alertType: AlertType; severity: AlertSeverity } {
  if (!error) return { alertType: "pipeline_failed", severity: "critical" };

  const lower = error.toLowerCase();

  if (lower.includes("openai") || lower.includes("api error")) {
    return { alertType: "ai_error", severity: "critical" };
  }
  if (lower.includes("sms send failed") || lower.includes("sms not sent")) {
    return { alertType: "sms_send_failed", severity: "critical" };
  }
  if (lower.includes("calendar sync") || lower.includes("calendar") && lower.includes("fail")) {
    return { alertType: "calendar_sync_failed", severity: "warning" };
  }
  if (lower.includes("appointment") && lower.includes("fail")) {
    return { alertType: "booking_failed", severity: "critical" };
  }

  return { alertType: "pipeline_failed", severity: "critical" };
}

/**
 * Raise an alert from a failed pipeline trace result.
 * Call this after trace.fail() in route handlers.
 */
export async function alertFromTraceFailure(
  tenantId: string | null,
  traceId: string | null,
  error: string | null,
  customerPhone: string | null,
  fetchFn: typeof fetch = fetch
): Promise<void> {
  const { alertType, severity } = classifyError(error);

  const phoneSuffix = customerPhone ? ` (customer: ${customerPhone.slice(-4)})` : "";
  const summary = `Pipeline failed: ${error ?? "unknown error"}${phoneSuffix}`;

  await raiseAlert(
    {
      tenantId,
      traceId,
      severity,
      alertType,
      summary,
      details: error,
    },
    fetchFn
  );
}

// ── Admin queries ────────────────────────────────────────────────────────────

/**
 * Get unacknowledged alerts (for admin dashboard).
 */
export async function getAlerts(
  opts: { acknowledged?: boolean; limit?: number } = {}
): Promise<PipelineAlert[]> {
  const acked = opts.acknowledged ?? false;
  const limit = opts.limit ?? 50;

  return query<PipelineAlert>(
    `SELECT pa.id, pa.tenant_id, pa.trace_id, pa.severity, pa.alert_type,
            pa.summary, pa.details, pa.owner_notified, pa.acknowledged,
            pa.acknowledged_at, pa.acknowledged_by, pa.created_at,
            t.shop_name
     FROM pipeline_alerts pa
     LEFT JOIN tenants t ON t.id = pa.tenant_id
     WHERE pa.acknowledged = $1
     ORDER BY pa.created_at DESC
     LIMIT $2`,
    [acked, limit]
  );
}

/**
 * Acknowledge an alert (admin action).
 */
export async function acknowledgeAlert(
  alertId: string,
  adminEmail: string
): Promise<boolean> {
  const rows = await query(
    `UPDATE pipeline_alerts
     SET acknowledged = TRUE, acknowledged_at = now(), acknowledged_by = $1
     WHERE id = $2 AND acknowledged = FALSE
     RETURNING id`,
    [adminEmail, alertId]
  );
  return (rows as any[]).length > 0;
}

/**
 * Count unacknowledged alerts (for overview badge).
 */
export async function countUnacknowledgedAlerts(): Promise<number> {
  const rows = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM pipeline_alerts WHERE acknowledged = FALSE`
  );
  return rows[0]?.count ?? 0;
}
