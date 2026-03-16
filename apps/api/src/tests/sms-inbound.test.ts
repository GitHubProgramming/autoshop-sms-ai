import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import formbody from "@fastify/formbody";

// vi.hoisted ensures these are available inside vi.mock factories (hoisted before imports)
const mocks = vi.hoisted(() => ({
  add: vi.fn().mockResolvedValue({ id: "job-1" }),
  checkIdempotency: vi.fn().mockResolvedValue(false),
  markIdempotency: vi.fn().mockResolvedValue(undefined),
  getTenantByPhoneNumber: vi.fn(),
  getBlockReason: vi.fn((): string | null => null),
}));

// Prevent module-level guard throws (DATABASE_URL / REDIS_URL not set in test env)
vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: vi.fn(),
  withTenant: vi.fn(),
}));

vi.mock("../queues/redis", () => ({
  smsInboundQueue: { add: mocks.add },
  checkIdempotency: mocks.checkIdempotency,
  markIdempotency: mocks.markIdempotency,
}));

vi.mock("../db/tenants", () => ({
  getTenantByPhoneNumber: mocks.getTenantByPhoneNumber,
  getBlockReason: mocks.getBlockReason,
}));

vi.mock("../services/pipeline-trace", () => ({
  startTrace: vi.fn().mockResolvedValue({
    id: "trace-mock-id",
    step: vi.fn().mockResolvedValue(undefined),
    setTenant: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  }),
  resumeTrace: vi.fn().mockResolvedValue({
    id: "trace-mock-id",
    step: vi.fn().mockResolvedValue(undefined),
    setTenant: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { twilioSmsRoute } from "../routes/webhooks/twilio-sms";

// ── Constants ──────────────────────────────────────────────────────────────────

const TEST_TO = "+15550001234";       // shop's Twilio number (= tenant's number)
const TEST_FROM = "+15559876543";     // customer's phone
const TEST_MESSAGE_SID = "SMtest00000000000000000000000001";

const MOCK_TENANT = {
  id: "tenant-uuid-1234",
  shop_name: "Test Shop",
  owner_email: "owner@testshop.com",
  billing_status: "active" as const,
  plan_id: "pro",
  conv_used_this_cycle: 5,
  conv_limit_this_cycle: 400,
  trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  warned_80pct: false,
  warned_100pct: false,
};

function smsPayload(overrides: Record<string, string> = {}): string {
  return new URLSearchParams({
    MessageSid: TEST_MESSAGE_SID,
    AccountSid: "ACtest123",
    From: TEST_FROM,
    To: TEST_TO,
    Body: "Can I book an oil change?",
    ...overrides,
  }).toString();
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(formbody);
  await app.register(twilioSmsRoute, { prefix: "/webhooks/twilio" });
  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("POST /webhooks/twilio/sms", () => {
  let savedNodeEnv: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();

    savedNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    process.env.TWILIO_AUTH_TOKEN = "test_token";
    process.env.SKIP_TWILIO_VALIDATION = "true";

    mocks.getTenantByPhoneNumber.mockResolvedValue(MOCK_TENANT);
    mocks.getBlockReason.mockReturnValue(null);
    mocks.checkIdempotency.mockResolvedValue(false);
    mocks.add.mockResolvedValue({ id: "job-1" });
  });

  afterEach(() => {
    process.env.NODE_ENV = savedNodeEnv;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.SKIP_TWILIO_VALIDATION;
  });

  it("returns HTTP 200 with TwiML <Response/>", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/sms",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: smsPayload(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/xml/);
    expect(res.body).toContain("<Response");
    await app.close();
  });

  it("enqueues a process-sms job on the sms-inbound BullMQ queue", async () => {
    const app = await buildApp();

    await app.inject({
      method: "POST",
      url: "/webhooks/twilio/sms",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: smsPayload({ Body: "Need an oil change" }),
    });

    expect(mocks.add).toHaveBeenCalledOnce();
    expect(mocks.add).toHaveBeenCalledWith(
      "process-sms",
      expect.objectContaining({
        tenantId: MOCK_TENANT.id,
        customerPhone: TEST_FROM,
        ourPhone: TEST_TO,
        messageSid: TEST_MESSAGE_SID,
      }),
      expect.objectContaining({ jobId: `sms-${TEST_MESSAGE_SID}` })
    );
    await app.close();
  });

  it("writes idempotency key to Redis", async () => {
    const app = await buildApp();

    await app.inject({
      method: "POST",
      url: "/webhooks/twilio/sms",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: smsPayload(),
    });

    expect(mocks.markIdempotency).toHaveBeenCalledWith(
      `twilio:${TEST_MESSAGE_SID}`
    );
    await app.close();
  });

  it("returns 200 and skips enqueue on duplicate MessageSid", async () => {
    mocks.checkIdempotency.mockResolvedValueOnce(true); // already seen

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/sms",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: smsPayload(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<Response");
    expect(mocks.add).not.toHaveBeenCalled();
    await app.close();
  });

  it("does not write idempotency key on duplicate", async () => {
    mocks.checkIdempotency.mockResolvedValueOnce(true);

    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/webhooks/twilio/sms",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: smsPayload(),
    });

    expect(mocks.markIdempotency).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 200 without enqueueing when no tenant found", async () => {
    mocks.getTenantByPhoneNumber.mockResolvedValueOnce(null);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/sms",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: smsPayload(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<Response");
    expect(mocks.add).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 200 without enqueueing when tenant is blocked", async () => {
    mocks.getBlockReason.mockReturnValueOnce("trial_limit_reached");

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/sms",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: smsPayload(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<Response");
    expect(mocks.add).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 400 for invalid body (missing required fields)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/sms",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ MessageSid: TEST_MESSAGE_SID }).toString(),
    });

    expect(res.statusCode).toBe(400);
    expect(mocks.add).not.toHaveBeenCalled();
    await app.close();
  });

  it("passes SMS body content in enqueued job payload", async () => {
    const app = await buildApp();

    await app.inject({
      method: "POST",
      url: "/webhooks/twilio/sms",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: smsPayload({ Body: "What time do you close?" }),
    });

    expect(mocks.add).toHaveBeenCalledWith(
      "process-sms",
      expect.objectContaining({ body: "What time do you close?" }),
      expect.anything()
    );
    await app.close();
  });

  it("sets atSoftLimit=true when tenant is at 100% conversation usage", async () => {
    mocks.getTenantByPhoneNumber.mockResolvedValueOnce({
      ...MOCK_TENANT,
      conv_used_this_cycle: 400,
      conv_limit_this_cycle: 400,
    });

    const app = await buildApp();

    await app.inject({
      method: "POST",
      url: "/webhooks/twilio/sms",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: smsPayload(),
    });

    expect(mocks.add).toHaveBeenCalledWith(
      "process-sms",
      expect.objectContaining({ atSoftLimit: true }),
      expect.anything()
    );
    await app.close();
  });

  it("sets atSoftLimit=false when tenant is within limits", async () => {
    const app = await buildApp();

    await app.inject({
      method: "POST",
      url: "/webhooks/twilio/sms",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: smsPayload(),
    });

    expect(mocks.add).toHaveBeenCalledWith(
      "process-sms",
      expect.objectContaining({ atSoftLimit: false }),
      expect.anything()
    );
    await app.close();
  });
});
