// ============================================================
// AutoShop SMS AI — BullMQ Queue Service
// Enqueues jobs for the worker service.
// All heavy processing goes through queues — hot path stays fast.
// ============================================================

import { Queue } from 'bullmq';
import type { JobPayload } from '@autoshop/shared';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
};

// Queue instances (lazily initialized)
const queues: Record<string, Queue> = {};

function getQueue(name: string): Queue {
  if (!queues[name]) {
    queues[name] = new Queue(name, { connection });
  }
  return queues[name];
}

// ──────────────────────────────────────────────────────────
// Job enqueuers
// ──────────────────────────────────────────────────────────

/** Enqueue missed call handler (delayed to simulate human response time) */
export async function enqueueMissedCall(payload: {
  tenant_id: string;
  caller_phone: string;
  twilio_number: string;
  call_sid: string;
}): Promise<void> {
  const delay = randomDelay(5_000, 20_000);
  await getQueue('ai_process').add(
    'missed_call',
    { type: 'missed_call', delay_ms: delay, ...payload },
    {
      delay,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 86400 },
      removeOnFail: { age: 7 * 86400 },
    }
  );
}

/** Enqueue inbound SMS for AI processing */
export async function enqueueSmsInbound(payload: {
  tenant_id: string;
  customer_phone: string;
  twilio_number: string;
  message_body: string;
  twilio_sid: string;
}): Promise<void> {
  await getQueue('ai_process').add(
    'sms_inbound',
    { type: 'sms_inbound', ...payload },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 3_000 },
      removeOnComplete: { age: 86400 },
      removeOnFail: { age: 7 * 86400 },
    }
  );
}

/** Enqueue Google Calendar sync */
export async function enqueueCalendarSync(
  tenantId: string,
  appointmentId: string
): Promise<void> {
  await getQueue('calendar_sync').add(
    'calendar_sync',
    { type: 'calendar_sync', tenant_id: tenantId, appointment_id: appointmentId },
    {
      attempts: 5,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: { age: 86400 },
      removeOnFail: { age: 7 * 86400 },
    }
  );
}

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
