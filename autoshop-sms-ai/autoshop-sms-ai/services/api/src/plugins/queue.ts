import { Queue } from 'bullmq';
import { getRedis } from './redis';
import { QUEUE_NAMES } from '@autoshop/shared';
import type { WorkerJob } from '@autoshop/shared';

const queues: Record<string, Queue> = {};

function getQueue(name: string): Queue {
  if (!queues[name]) {
    queues[name] = new Queue(name, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 86400 },
        removeOnFail: { age: 7 * 86400 },
      },
    });
  }
  return queues[name];
}

export async function enqueueJob(
  queueName: string,
  job: WorkerJob,
  opts?: { delay?: number; priority?: number }
): Promise<void> {
  const q = getQueue(queueName);
  await q.add(job.type, job, {
    delay: opts?.delay,
    priority: opts?.priority,
  });
}

export { getQueue, QUEUE_NAMES };
