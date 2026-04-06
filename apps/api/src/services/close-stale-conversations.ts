import { query } from "../db/client";
import { checkAndNotifyUsage } from "./usage-warnings";

/**
 * Close stale open conversations that have had no activity for 24+ hours.
 *
 * Rules:
 * - Only closes conversations with status = 'open'
 * - Only closes when last_message_at < NOW() - 24 hours
 * - Sets status = 'closed', close_reason = 'inactivity_24h'
 * - Does NOT increment tenant conv_used_this_cycle (counting happens at OPEN time)
 * - Fires usage warnings for affected tenants after closing
 * - Safe to run repeatedly — already-closed rows are not touched
 */
export async function closeStaleConversations(): Promise<number> {
  // Close stale conversations — no tenant usage increment needed
  // (counting moved to conversation OPEN time in migration 045)
  const result = await query<{ tenant_id: string }>(
    `UPDATE conversations
     SET status       = 'closed',
         close_reason = 'inactivity_24h',
         closed_at    = NOW(),
         counted      = TRUE
     WHERE status         = 'open'
       AND last_message_at < NOW() - INTERVAL '24 hours'
       AND tenant_id NOT IN (SELECT id FROM tenants WHERE billing_status = 'demo')
     RETURNING tenant_id`
  );

  const total = result.length;

  // Fire usage warnings for each affected tenant (non-fatal)
  // Deduplicate tenant IDs to avoid sending multiple warnings
  const tenantIds = [...new Set(result.map((r) => r.tenant_id))];
  for (const tenantId of tenantIds) {
    try {
      await checkAndNotifyUsage(tenantId);
    } catch {
      // Non-fatal: warning failure must not break stale closer
    }
  }

  return total;
}
