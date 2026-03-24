import { query } from "../db/client";

/**
 * Close stale open conversations that have had no activity for 24+ hours.
 *
 * Rules:
 * - Only closes conversations with status = 'open'
 * - Only closes when last_message_at < NOW() - 24 hours
 * - Sets status = 'closed', close_reason = 'inactivity_24h'
 * - Uses counted = FALSE guard for idempotency (matches close_conversation() semantics)
 * - Increments tenant conv_used_this_cycle for each closed conversation
 * - Safe to run repeatedly — already-closed rows are not touched
 */
export async function closeStaleConversations(): Promise<number> {
  const result = await query<{ closed_count: number }>(
    `WITH stale AS (
       UPDATE conversations
       SET status       = 'closed',
           close_reason = 'inactivity_24h',
           closed_at    = NOW(),
           counted      = TRUE
       WHERE status         = 'open'
         AND counted        = FALSE
         AND last_message_at < NOW() - INTERVAL '24 hours'
         AND tenant_id NOT IN (SELECT id FROM tenants WHERE billing_status = 'demo')
       RETURNING tenant_id
     )
     UPDATE tenants
     SET conv_used_this_cycle = conv_used_this_cycle + sub.cnt,
         updated_at           = NOW()
     FROM (
       SELECT tenant_id, COUNT(*)::INT AS cnt
       FROM stale
       GROUP BY tenant_id
     ) sub
     WHERE tenants.id = sub.tenant_id
     RETURNING sub.cnt AS closed_count`
  );

  const total = result.reduce((sum, r) => sum + r.closed_count, 0);
  return total;
}
