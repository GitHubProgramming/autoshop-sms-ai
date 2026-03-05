import IORedis from 'ioredis';

let redis: IORedis;

export function initRedis(): IORedis {
  if (!redis) {
    redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: null, // Required for BullMQ
      enableReadyCheck: false,
    });
    redis.on('error', (err) => console.error('Redis error:', err));
  }
  return redis;
}

export function getRedis(): IORedis {
  if (!redis) throw new Error('Redis not initialized');
  return redis;
}

// Circuit breaker: check if phone is quarantined
export async function isQuarantined(tenantId: string, phone: string): Promise<boolean> {
  const key = `quarantine:${tenantId}:${phone}`;
  const val = await redis.get(key);
  return val !== null;
}

// Circuit breaker: increment message counter, return count
export async function incrMsgCounter(tenantId: string, phone: string): Promise<number> {
  const key = `msgcount:${tenantId}:${phone}`;
  const count = await redis.incr(key);
  if (count === 1) {
    // Set 10-minute expiry on first message
    await redis.expire(key, 10 * 60);
  }
  return count;
}

// Quarantine a phone for 1 hour
export async function quarantinePhone(tenantId: string, phone: string): Promise<void> {
  const key = `quarantine:${tenantId}:${phone}`;
  await redis.set(key, '1', 'EX', 3600);
}

// Idempotency key check (for additional in-memory guard before DB)
export async function checkAndSetIdempotency(sid: string): Promise<boolean> {
  const key = `idem:${sid}`;
  const result = await redis.set(key, '1', 'NX', 'EX', 86400); // 24h TTL
  return result === 'OK'; // true = first time, false = duplicate
}
