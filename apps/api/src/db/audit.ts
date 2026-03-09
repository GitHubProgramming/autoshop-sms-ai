import { query } from "./client";

/**
 * Write a structured event to the audit_log table.
 * Non-fatal: failures are logged but never thrown — must not block the calling operation.
 */
export async function writeAuditEvent(
  tenantId: string | null,
  eventType: string,
  actor: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_log (tenant_id, event_type, actor, metadata)
       VALUES ($1, $2, $3, $4)`,
      [tenantId ?? null, eventType, actor, JSON.stringify(metadata)]
    );
  } catch (err) {
    // Non-fatal: audit log failure must never block the caller
    console.error("[audit] Failed to write audit event", { eventType, tenantId, err });
  }
}
