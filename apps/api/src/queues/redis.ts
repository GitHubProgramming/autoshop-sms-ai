import { Redis } from "ioredis";
import { Queue } from "bullmq";

if (!process.env.REDIS_URL) {
  throw new Error("REDIS_URL environment variable is required");
}

export const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null, // Required for BullMQ
  enableReadyCheck: false,
});

// Plain connection options for BullMQ (avoids Redis instance type conflict)
const connection = {
  host: process.env.REDIS_HOST || "redis",
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
};

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
