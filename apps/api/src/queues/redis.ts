import { Redis } from "ioredis";
import { Queue } from "bullmq";

if (!process.env.REDIS_URL) {
  throw new Error("REDIS_URL environment variable is required");
}

export const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null, // Required for BullMQ
  enableReadyCheck: false,
});

// Parse REDIS_URL for BullMQ connection (works in Docker and on Render/production)
const _parsedRedisUrl = new URL(process.env.REDIS_URL);
export const bullmqConnection = {
  host: _parsedRedisUrl.hostname,
  port: Number(_parsedRedisUrl.port || 6379),
  password: _parsedRedisUrl.password || undefined,
  ...(_parsedRedisUrl.protocol === "rediss:" ? { tls: {} } : {}),
};
const connection = bullmqConnection;

// ── Queue definitions ─────────────────────────────────────────────────────────

const queueDefaults = {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential" as const, delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
};

/** Inbound SMS processing → triggers AI response workflow */
export const smsInboundQueue = new Queue("sms-inbound", queueDefaults);

/** Async Twilio number provisioning — never in sync request */
export const provisionNumberQueue = new Queue(
  "provision-number",
  queueDefaults
);

/** Billing event processing (Stripe webhooks) */
export const billingQueue = new Queue("billing-events", queueDefaults);

/** Calendar sync jobs */
export const calendarQueue = new Queue("calendar-sync", queueDefaults);

// ── Idempotency helpers ───────────────────────────────────────────────────────

const IDEMPOTENCY_TTL = 86_400; // 24 hours

export async function checkIdempotency(key: string): Promise<boolean> {
  const exists = await redis.exists(`idempotency:${key}`);
  return exists === 1;
}

export async function markIdempotency(key: string): Promise<void> {
  await redis.setex(`idempotency:${key}`, IDEMPOTENCY_TTL, "1");
}

// ── Missed-call caller dedupe ─────────────────────────────────────────────────
// Prevents multiple missed-call flows for the same tenant + caller within a
// short time window, regardless of how many distinct CallSids Twilio generates.

const MISSED_CALL_DEDUPE_TTL = 300; // 5 minutes

/**
 * Returns true if a missed-call flow was already triggered for this
 * tenant + caller within the dedupe window.  Atomically sets the key
 * on first call so concurrent webhooks cannot both pass.
 */
export async function checkMissedCallDedupe(
  tenantId: string,
  callerPhone: string
): Promise<boolean> {
  const key = `missed-call-dedupe:${tenantId}:${callerPhone}`;
  // SET NX returns "OK" only if the key did not already exist (atomic)
  const result = await redis.set(key, "1", "EX", MISSED_CALL_DEDUPE_TTL, "NX");
  // result === "OK" → first caller, not a duplicate
  // result === null → key existed, this IS a duplicate
  return result === null;
}
