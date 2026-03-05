import 'dotenv/config';
import IORedis from 'ioredis';
import { Pool } from 'pg';
import { startAiWorker } from './queues/aiWorker';
import { startSmsSendWorker } from './queues/smsSendWorker';
import { startCalendarWorker } from './queues/calendarWorker';
import { startCronWorker } from './cron/cronWorker';

const redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

async function start() {
  console.log('Starting AutoShop SMS AI workers...');

  startAiWorker(redis, pool);
  startSmsSendWorker(redis, pool);
  startCalendarWorker(redis, pool);
  startCronWorker(redis, pool);

  console.log('All workers started.');

  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down workers...');
    await redis.quit();
    await pool.end();
    process.exit(0);
  });
}

start().catch(err => {
  console.error('Worker startup failed:', err);
  process.exit(1);
});
