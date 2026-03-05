// ============================================================
// AutoShop SMS AI — Worker Entry Point
// BullMQ Queue Mode workers.
// Runs alongside n8n workers or as standalone MVP processor.
// ============================================================

import 'dotenv/config';
import { Worker, QueueEvents } from 'bullmq';
import { Pool } from 'pg';
import { handleMissedCall, handleSmsInbound } from './jobs/ai-process';
import { handleCalendarSync } from './jobs/calendar-sync';
import { startCronJobs } from './cron/jobs';
import type { MissedCallJobPayload, SmsInboundJobPayload, CalendarSyncJobPayload } from '@autoshop/shared';

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

// Per-tenant concurrency limit (max N jobs running simultaneously per tenant)
// In production, use BullMQ Pro's per-tenant rate limiter
const MAX_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '5', 10);

// ──────────────────────────────────────────────────────────
// AI Process Worker (missed_call + sms_inbound)
// ──────────────────────────────────────────────────────────
const aiWorker = new Worker(
  'ai_process',
  async (job) => {
    const { type } = job.data;

    if (type === 'missed_call') {
      await handleMissedCall(job as any, pool);
    } else if (type === 'sms_inbound') {
      await handleSmsInbound(job as any, pool);
    } else {
      throw new Error(`Unknown job type: ${type}`);
    }
  },
  {
    connection,
    concurrency: MAX_CONCURRENCY,
    limiter: {
      max: 50,
      duration: 60_000, // 50 jobs per minute global rate limit
    },
  }
);

aiWorker.on('completed', (job) => {
  console.log(`[WORKER:ai] Job ${job.id} (${job.data.type}) completed`);
});

aiWorker.on('failed', (job, err) => {
  console.error(`[WORKER:ai] Job ${job?.id} failed:`, err.message);
});

aiWorker.on('error', (err) => {
  console.error('[WORKER:ai] Worker error:', err);
});

// ──────────────────────────────────────────────────────────
// Calendar Sync Worker
// ──────────────────────────────────────────────────────────
const calendarWorker = new Worker(
  'calendar_sync',
  async (job) => {
    await handleCalendarSync(job as any, pool);
  },
  {
    connection,
    concurrency: 10,
  }
);

calendarWorker.on('completed', (job) => {
  console.log(`[WORKER:calendar] Job ${job.id} completed`);
});

calendarWorker.on('failed', (job, err) => {
  console.error(`[WORKER:calendar] Job ${job?.id} failed:`, err.message);
});

// ──────────────────────────────────────────────────────────
// Cron Jobs
// ──────────────────────────────────────────────────────────
startCronJobs(pool);

// ──────────────────────────────────────────────────────────
// Graceful shutdown
// ──────────────────────────────────────────────────────────
async function shutdown() {
  console.log('[WORKER] Shutting down...');
  await aiWorker.close();
  await calendarWorker.close();
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log(`[WORKER] Workers started. Concurrency: ${MAX_CONCURRENCY}`);
console.log('[WORKER] Queues: ai_process, calendar_sync');
