/**
 * Persistent webhook idempotency layer.
 *
 * Two-tier dedup:
 *   1. Redis (fast, ephemeral — 24h TTL)
 *   2. PostgreSQL webhook_events table (permanent)
 *
 * A webhook is considered duplicate if EITHER tier reports it as seen.
 * On first processing, BOTH tiers are written to ensure coverage.
 */

import { query } from "./client";
import { checkIdempotency, markIdempotency } from "../queues/redis";

export type WebhookSource =
  | "twilio_sms"
  | "twilio_voice"
  | "twilio_voice_status"
  | "stripe";

interface DeduplicateResult {
  isDuplicate: boolean;
  source: WebhookSource;
  eventSid: string;
}

/**
 * Check-and-mark idempotency for a webhook event.
 *
 * Returns { isDuplicate: true } if this event was already processed.
 * Returns { isDuplicate: false } and marks both Redis + DB if new.
 *
 * IMPORTANT: Always returns 200 to the webhook caller regardless — the
 * caller is responsible for short-circuiting on isDuplicate === true.
 */
export async function deduplicateWebhook(
  source: WebhookSource,
  eventSid: string,
  tenantId?: string | null
): Promise<DeduplicateResult> {
  const redisKey = `${source}:${eventSid}`;

  // ── Tier 1: Redis fast check ──────────────────────────────────────────────
  try {
    const redisHit = await checkIdempotency(redisKey);
    if (redisHit) {
      return { isDuplicate: true, source, eventSid };
    }
  } catch {
    // Redis down — fall through to DB check
  }

  // ── Tier 2: PostgreSQL persistent check + insert ──────────────────────────
  try {
    const rows = await query<{ id: number }>(
      `INSERT INTO webhook_events (source, event_sid, tenant_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (source, event_sid) DO NOTHING
       RETURNING id`,
      [source, eventSid, tenantId ?? null]
    );

    if (rows.length === 0) {
      // Conflict — event already exists in DB
      // Backfill Redis so future checks are fast
      try {
        await markIdempotency(redisKey);
      } catch {
        // Non-fatal
      }
      return { isDuplicate: true, source, eventSid };
    }
  } catch {
    // DB insert failed (not a conflict) — this is unexpected but not fatal.
    // Fall through and process (better to double-process once than drop events).
  }

  // ── Mark Redis for fast future lookups ────────────────────────────────────
  try {
    await markIdempotency(redisKey);
  } catch {
    // Non-fatal: DB has the record
  }

  return { isDuplicate: false, source, eventSid };
}
