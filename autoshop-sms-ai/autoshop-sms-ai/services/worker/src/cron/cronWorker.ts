import { Worker, Queue, QueueScheduler } from 'bullmq';
import IORedis from 'ioredis';
import { Pool } from 'pg';
import { QUEUE_NAMES } from '@autoshop/shared';

export function startCronWorker(redis: IORedis, pool: Pool) {
  const cronQueue = new Queue(QUEUE_NAMES.CRON_TASKS, { connection: redis });

  // ── Schedule recurring jobs ────────────────────────────────
  // Trial expiry check: every 15 minutes
  cronQueue.upsertJobScheduler('check-trial-expiry', { every: 15 * 60 * 1000 }, {
    name: 'check_trial_expiry',
    data: { type: 'check_trial_expiry' },
  });

  // Close inactive conversations: every 30 minutes
  cronQueue.upsertJobScheduler('close-inactive-conversations', { every: 30 * 60 * 1000 }, {
    name: 'close_inactive_conversations',
    data: { type: 'close_inactive_conversations' },
  });

  // Past-due → suspended after 7 days: every hour
  cronQueue.upsertJobScheduler('check-past-due-suspension', { every: 60 * 60 * 1000 }, {
    name: 'check_past_due_suspension',
    data: { type: 'check_past_due_suspension' },
  });

  // ── Cron worker ────────────────────────────────────────────
  const worker = new Worker(
    QUEUE_NAMES.CRON_TASKS,
    async (job) => {
      switch (job.data.type) {
        case 'check_trial_expiry':
          await checkTrialExpiry(pool);
          break;
        case 'close_inactive_conversations':
          await closeInactiveConversations(pool);
          break;
        case 'check_past_due_suspension':
          await checkPastDueSuspension(pool);
          break;
        default:
          console.warn(`[Cron] Unknown job type: ${job.data.type}`);
      }
    },
    { connection: redis, concurrency: 1 }
  );

  worker.on('failed', (job, err) => {
    console.error(`[Cron Worker] Job ${job?.id} (${job?.data?.type}) failed:`, err.message);
  });

  console.log('[Cron Worker] Started.');
  return worker;
}

// Check and expire trials that have hit time OR conversation limit
async function checkTrialExpiry(pool: Pool) {
  const client = await pool.connect();
  try {
    // Time-based expiry
    const timeExpired = await client.query(
      `UPDATE tenants
       SET billing_state = 'trial_expired', updated_at = NOW()
       WHERE billing_state = 'trial' AND trial_ends_at <= NOW()
       RETURNING id`
    );

    // Conversation-count-based expiry: 50+ conversations in trial
    const countExpired = await client.query(
      `UPDATE tenants t
       SET billing_state = 'trial_expired', updated_at = NOW()
       FROM (
         SELECT ur.tenant_id, SUM(ur.conversations_count) as total
         FROM usage_records ur
         JOIN tenants t2 ON t2.id = ur.tenant_id
         WHERE t2.billing_state = 'trial'
         GROUP BY ur.tenant_id
         HAVING SUM(ur.conversations_count) >= 50
       ) expiring
       WHERE t.id = expiring.tenant_id
       RETURNING t.id`
    );

    const total = (timeExpired.rowCount ?? 0) + (countExpired.rowCount ?? 0);
    if (total > 0) {
      console.log(`[Cron] Expired ${total} trial tenants`);
    }
  } finally {
    client.release();
  }
}

// Close conversations with no activity for 24 hours
async function closeInactiveConversations(pool: Pool) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `UPDATE conversations
       SET status = 'closed_inactive',
           close_reason = 'inactivity_24h',
           closed_at = NOW()
       WHERE status = 'open'
         AND last_activity_at < NOW() - INTERVAL '24 hours'
       RETURNING id`
    );
    if ((result.rowCount ?? 0) > 0) {
      console.log(`[Cron] Closed ${result.rowCount} inactive conversations`);
    }
  } finally {
    client.release();
  }
}

// Transition past_due → suspended after 7 days
async function checkPastDueSuspension(pool: Pool) {
  const client = await pool.connect();
  try {
    // Find tenants past_due for > 7 days
    // We track this by checking when billing_state was last updated
    // In production, store a past_due_since_at column; here we use a safe approximation
    // via subscriptions.updated_at where status = 'past_due'
    const result = await client.query(
      `UPDATE tenants t
       SET billing_state = 'suspended', updated_at = NOW()
       FROM subscriptions s
       WHERE t.id = s.tenant_id
         AND t.billing_state = 'past_due'
         AND s.status = 'past_due'
         AND s.updated_at < NOW() - INTERVAL '7 days'
       RETURNING t.id`
    );
    if ((result.rowCount ?? 0) > 0) {
      console.log(`[Cron] Suspended ${result.rowCount} past-due tenants`);
    }
  } finally {
    client.release();
  }
}
