import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { Pool } from 'pg';
import twilio from 'twilio';
import { QUEUE_NAMES } from '@autoshop/shared';

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);

interface SmsSendPayload {
  type: string;
  from: string;
  to: string;
  body: string;
  conversation_id: string;
  tenant_id: string;
}

export function startSmsSendWorker(redis: IORedis, pool: Pool) {
  const worker = new Worker(
    QUEUE_NAMES.SMS_SEND,
    async (job: Job) => {
      const { from, to, body, conversation_id, tenant_id } = job.data as SmsSendPayload;

      const msg = await twilioClient.messages.create({ from, to, body });

      const client = await pool.connect();
      try {
        await client.query(
          `INSERT INTO messages (conversation_id, tenant_id, direction, body, twilio_sid)
           VALUES ($1, $2, 'outbound', $3, $4)`,
          [conversation_id, tenant_id, body, msg.sid]
        );
      } finally {
        client.release();
      }
    },
    {
      connection: redis,
      concurrency: 20,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      },
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[SMS Worker] Job ${job?.id} failed:`, err.message);
  });

  console.log('[SMS Worker] Started on queue:', QUEUE_NAMES.SMS_SEND);
  return worker;
}
