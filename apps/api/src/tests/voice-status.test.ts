import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import formbody from "@fastify/formbody";

// vi.hoisted ensures mocks are available inside vi.mock factories
const mocks = vi.hoisted(() => ({
  add: vi.fn().mockResolvedValue({ id: "job-1" }),
  checkIdempotency: vi.fn().mockResolvedValue(false),
  markIdempotency: vi.fn().mockResolvedValue(undefined),
  getTenantByPhoneNumber: vi.fn(),
}));

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
  getBlockReason: vi.fn(() => null),
}));

import { twilioVoiceStatusRoute } from "../routes/webhooks/twilio-voice-status";

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_TO = "+15550001234";   // shop's Twilio number
const TEST_FROM = "+15559876543"; // customer's phone
const TEST_CALL_SID = "CAtest00000000000000000000000001";

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

function voicePayload(overrides: Record<string, string> = {}): string {
  return new URLSearchParams({
    CallSid: TEST_CALL_SID,
    CallStatus: "no-answer",
    To: TEST_TO,
    From: TEST_FROM,
    Direction: "inbound",
    ...overrides,
  }).toString();
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(formbody);
  await app.register(twilioVoiceStatusRoute, { prefix: "/webhooks/twilio" });
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /webhooks/twilio/voice-status", () => {
  let savedNodeEnv: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();

    savedNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    process.env.TWILIO_AUTH_TOKEN = "test_token";
    process.env.SKIP_TWILIO_VALIDATION = "true";

    mocks.getTenantByPhoneNumber.mockResolvedValue(MOCK_TENANT);
    mocks.checkIdempotency.mockResolvedValue(false);
    mocks.add.mockResolvedValue({ id: "job-1" });
  });

  afterEach(() => {
    process.env.NODE_ENV = savedNodeEnv;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.SKIP_TWILIO_VALIDATION;
  });

  it("returns HTTP 200 with TwiML <Response/> for no-answer", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice-status",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: voicePayload({ CallStatus: "no-answer" }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/xml/);
    expect(res.body).toContain("<Response");
    await app.close();
  });

  it("enqueues a missed-call-trigger job for no-answer", async () => {
    const app = await buildApp();

    await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice-status",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: voicePayload({ CallStatus: "no-answer" }),
    });

    expect(mocks.add).toHaveBeenCalledOnce();
    expect(mocks.add).toHaveBeenCalledWith(
      "missed-call-trigger",
      expect.objectContaining({
        tenantId: MOCK_TENANT.id,
        customerPhone: TEST_FROM,
        ourPhone: TEST_TO,
        callSid: TEST_CALL_SID,
        triggerType: "missed_call",
      }),
      expect.objectContaining({ jobId: `missed-call-${TEST_CALL_SID}` })
    );
    await app.close();
  });

  it("enqueues a missed-call-trigger job for busy status", async () => {
    const app = await buildApp();

    await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice-status",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: voicePayload({ CallStatus: "busy" }),
    });

    expect(mocks.add).toHaveBeenCalledOnce();
    expect(mocks.add.mock.calls[0][1]).toMatchObject({ triggerType: "missed_call" });
    await app.close();
  });

  it("does NOT enqueue for completed calls (not a missed call)", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice-status",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: voicePayload({ CallStatus: "completed" }),
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.add).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 200 and skips enqueue on duplicate CallSid (idempotency)", async () => {
    mocks.checkIdempotency.mockResolvedValueOnce(true); // already seen

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice-status",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: voicePayload({ CallStatus: "no-answer" }),
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.add).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 200 without enqueueing when no tenant found", async () => {
    mocks.getTenantByPhoneNumber.mockResolvedValueOnce(null);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice-status",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: voicePayload({ CallStatus: "no-answer" }),
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.add).not.toHaveBeenCalled();
    await app.close();
  });
});
