// ============================================================
// AutoShop SMS AI — Idempotency Middleware for Webhooks
// Inserts webhook_events record; short-circuits duplicates.
// Uses UNIQUE(source, event_sid) constraint for safety.
// ============================================================

import { query } from '../db/client';

export interface IdempotencyResult {
  isDuplicate: boolean;
  eventId: string;
}

/**
 * Records a webhook event and returns whether it's a duplicate.
 * If isDuplicate=true, the caller should return 204 immediately.
 */
export async function recordWebhookEvent(
  source: 'twilio' | 'stripe',
  eventSid: string,
  eventType: string,
  payload: Record<string, any>,
  tenantId?: string
): Promise<IdempotencyResult> {
  const result = await query<{ id: string }>(
    `INSERT INTO webhook_events (source, event_sid, tenant_id, event_type, payload)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (source, event_sid) DO NOTHING
     RETURNING id`,
    [source, eventSid, tenantId || null, eventType, JSON.stringify(payload)]
  );

  if (result.rowCount === 0) {
    // Duplicate — already processed
    return { isDuplicate: true, eventId: '' };
  }

  return { isDuplicate: false, eventId: result.rows[0].id };
}

/**
 * Mark a webhook event as processed (or failed).
 */
export async function markWebhookProcessed(
  eventSid: string,
  source: 'twilio' | 'stripe',
  error?: string
): Promise<void> {
  await query(
    `UPDATE webhook_events
     SET processed = TRUE, processed_at = NOW(), error = $3
     WHERE event_sid = $1 AND source = $2`,
    [eventSid, source, error || null]
  );
}
