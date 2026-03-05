// ============================================================
// AutoShop SMS AI — Cron Jobs
// - Every 15 minutes: check trial expiry
// - Every 15 minutes: close 24h inactive conversations
// - Every hour: suspend past_due > 7 days
// ============================================================

import cron from 'node-cron';
import { Pool } from 'pg';

export function startCronJobs(pool: Pool): void {
  // ──────────────────────────────────────────────────────────
  // Trial expiry check — every 15 minutes
  // Handles: 14-day time expiry
  // (Count-based expiry handled atomically in open_conversation procedure)
  // ──────────────────────────────────────────────────────────
  cron.schedule('*/15 * * * *', async () => {
    try {
      const { rowCount, rows } = await pool.query<{ id: string; shop_name: string }>(
        `UPDATE tenants
         SET billing_state = 'trial_expired', updated_at = NOW()
         WHERE billing_state = 'trial'
           AND trial_ends_at < NOW()
         RETURNING id, shop_name`
      );

      if (rowCount && rowCount > 0) {
        console.log(`[CRON] Trial expired for ${rowCount} tenants:`, rows.map((r) => r.id));
        // TODO: enqueue expiry notification emails
      }
    } catch (err) {
      console.error('[CRON] Trial expiry check failed:', err);
    }
  });

  // ──────────────────────────────────────────────────────────
  // Close inactive conversations — every 15 minutes
  // Closes threads with no activity for 24 hours
  // ──────────────────────────────────────────────────────────
  cron.schedule('*/15 * * * *', async () => {
    try {
      const { rowCount } = await pool.query(
        `UPDATE conversations
         SET status = 'closed_inactive',
             close_reason = 'inactivity_24h',
             closed_at = NOW()
         WHERE status = 'open'
           AND last_activity_at < NOW() - INTERVAL '24 hours'`
      );

      if (rowCount && rowCount > 0) {
        console.log(`[CRON] Closed ${rowCount} inactive conversations`);
      }
    } catch (err) {
      console.error('[CRON] Inactive conversation close failed:', err);
    }
  });

  // ──────────────────────────────────────────────────────────
  // Suspend past_due > 7 days — every hour
  // ──────────────────────────────────────────────────────────
  cron.schedule('0 * * * *', async () => {
    try {
      const { rowCount, rows } = await pool.query<{ id: string }>(
        `UPDATE tenants
         SET billing_state = 'suspended', updated_at = NOW()
         WHERE billing_state = 'past_due'
           AND past_due_since < NOW() - INTERVAL '7 days'
         RETURNING id`
      );

      if (rowCount && rowCount > 0) {
        console.log(`[CRON] Suspended ${rowCount} overdue tenants:`, rows.map((r) => r.id));
        // TODO: enqueue suspension notice emails
      }
    } catch (err) {
      console.error('[CRON] Past-due suspension check failed:', err);
    }
  });

  // ──────────────────────────────────────────────────────────
  // Daily: retry failed calendar syncs
  // ──────────────────────────────────────────────────────────
  cron.schedule('0 8 * * *', async () => {
    try {
      const { rows } = await pool.query<{ id: string; tenant_id: string }>(
        `SELECT id, tenant_id FROM appointments
         WHERE sync_status = 'failed'
           AND sync_attempts < 5
           AND created_at > NOW() - INTERVAL '7 days'`
      );

      console.log(`[CRON] ${rows.length} appointments pending calendar retry`);
      // TODO: re-enqueue calendar_sync jobs for each
    } catch (err) {
      console.error('[CRON] Calendar retry check failed:', err);
    }
  });

  console.log('[CRON] All cron jobs started');
}
