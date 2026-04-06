import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import formbody from "@fastify/formbody";

// vi.hoisted ensures mocks are available inside vi.mock factories
const mocks = vi.hoisted(() => ({
  add: vi.fn().mockResolvedValue({ id: "job-1" }),
  deduplicateWebhook: vi.fn().mockResolvedValue({ isDuplicate: false, source: "twilio_voice_status", eventSid: "" }),
  getTenantByPhoneNumber: vi.fn(),
  getBlockReason: vi.fn((): string | null => null),
  handleMissedCallSms: vi.fn().mockResolvedValue({
    success: true, conversationId: "conv-1", smsSent: true, twilioSid: "SM123", error: null,
  }),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: vi.fn(),
  withTenant: vi.fn(),
}));

vi.mock("../queues/redis", () => ({
  smsInboundQueue: { add: mocks.add },
}));

vi.mock("../db/webhook-events", () => ({
  deduplicateWebhook: mocks.deduplicateWebhook,
}));

vi.mock("../db/tenants", () => ({
  getTenantByPhoneNumber: mocks.getTenantByPhoneNumber,
  getBlockReason: mocks.getBlockReason,
}));

vi.mock("../services/missed-call-sms", () => ({
  handleMissedCallSms: mocks.handleMissedCallSms,
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
    mocks.deduplicateWebhook.mockResolvedValue({ isDuplicate: false, source: "twilio_voice_status", eventSid: "" });
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
    mocks.deduplicateWebhook.mockResolvedValueOnce({ isDuplicate: true, source: "twilio_voice_status", eventSid: TEST_CALL_SID });

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

  it("enqueues a missed-call-trigger job for failed status", async () => {
    const app = await buildApp();

    await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice-status",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: voicePayload({ CallStatus: "failed" }),
    });

    expect(mocks.add).toHaveBeenCalledOnce();
    expect(mocks.add.mock.calls[0][1]).toMatchObject({ triggerType: "missed_call" });
    await app.close();
  });

  it("does NOT enqueue for ringing or in-progress calls", async () => {
    const app = await buildApp();

    for (const status of ["ringing", "in-progress", "queued"]) {
      vi.clearAllMocks();
      mocks.getTenantByPhoneNumber.mockResolvedValue(MOCK_TENANT);
      mocks.deduplicateWebhook.mockResolvedValue({ isDuplicate: false, source: "twilio_voice_status", eventSid: "" });

      const res = await app.inject({
        method: "POST",
        url: "/webhooks/twilio/voice-status",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: voicePayload({ CallStatus: status }),
      });

      expect(res.statusCode).toBe(200);
      expect(mocks.add).not.toHaveBeenCalled();
    }
    await app.close();
  });

  it("calls deduplicateWebhook with correct source and sid for missed calls", async () => {
    const app = await buildApp();

    await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice-status",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: voicePayload({ CallStatus: "no-answer" }),
    });

    expect(mocks.deduplicateWebhook).toHaveBeenCalledWith("twilio_voice_status", TEST_CALL_SID);
    await app.close();
  });

  it("does not process on duplicate", async () => {
    mocks.deduplicateWebhook.mockResolvedValueOnce({ isDuplicate: true, source: "twilio_voice_status", eventSid: TEST_CALL_SID });

    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice-status",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: voicePayload({ CallStatus: "no-answer" }),
    });

    expect(mocks.getTenantByPhoneNumber).not.toHaveBeenCalled();
    await app.close();
  });

  it("enqueues with priority 1 for fast missed-call response", async () => {
    const app = await buildApp();

    await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice-status",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: voicePayload({ CallStatus: "no-answer" }),
    });

    expect(mocks.add).toHaveBeenCalledWith(
      "missed-call-trigger",
      expect.anything(),
      expect.objectContaining({ priority: 1 })
    );
    await app.close();
  });

  it("returns 400 for invalid body (missing required fields)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice-status",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ CallSid: TEST_CALL_SID }).toString(),
    });

    expect(res.statusCode).toBe(400);
    expect(mocks.add).not.toHaveBeenCalled();
    await app.close();
  });

  it("triggers missed-call flow when DialCallStatus is no-answer (from Dial action)", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice-status",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        CallSid: TEST_CALL_SID,
        DialCallStatus: "no-answer",
        To: TEST_TO,
        From: TEST_FROM,
      }).toString(),
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.add).toHaveBeenCalledOnce();
    expect(mocks.add).toHaveBeenCalledWith(
      "missed-call-trigger",
      expect.objectContaining({
        callStatus: "no-answer",
        triggerType: "missed_call",
      }),
      expect.anything()
    );
    await app.close();
  });

  it("DialCallStatus takes priority over CallStatus", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice-status",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        CallSid: TEST_CALL_SID,
        CallStatus: "completed",
        DialCallStatus: "no-answer",
        To: TEST_TO,
        From: TEST_FROM,
      }).toString(),
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.add).toHaveBeenCalledOnce();
    expect(mocks.add).toHaveBeenCalledWith(
      "missed-call-trigger",
      expect.objectContaining({ callStatus: "no-answer" }),
      expect.anything()
    );
    await app.close();
  });

  it("ignores DialCallStatus=completed (call was answered)", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice-status",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        CallSid: TEST_CALL_SID,
        DialCallStatus: "completed",
        To: TEST_TO,
        From: TEST_FROM,
      }).toString(),
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.add).not.toHaveBeenCalled();
    await app.close();
  });

  it("includes callStatus in enqueued job payload", async () => {
    const app = await buildApp();

    await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice-status",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: voicePayload({ CallStatus: "busy" }),
    });

    expect(mocks.add).toHaveBeenCalledWith(
      "missed-call-trigger",
      expect.objectContaining({ callStatus: "busy" }),
      expect.anything()
    );
    await app.close();
  });

  it("does not enqueue when tenant is blocked (canceled)", async () => {
    mocks.getBlockReason.mockReturnValueOnce("service_canceled");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice-status",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: voicePayload({ CallStatus: "no-answer" }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<Response");
    expect(mocks.add).not.toHaveBeenCalled();
    await app.close();
  });

  it("does not enqueue when tenant is blocked (trial_expired)", async () => {
    mocks.getBlockReason.mockReturnValueOnce("trial_expired");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice-status",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: voicePayload({ DialCallStatus: "no-answer" }),
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.add).not.toHaveBeenCalled();
    await app.close();
  });

  // ── Redis-down fallback tests ───────────────────────────────────────────

  it("returns 200 and falls back to handleMissedCallSms when queue.add throws", async () => {
    mocks.add.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice-status",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: voicePayload({ CallStatus: "no-answer" }),
    });

    // Twilio must get 200 immediately
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<Response");

    // Allow setImmediate to fire
    await new Promise((r) => setTimeout(r, 50));

    // Fallback should have been called directly
    expect(mocks.handleMissedCallSms).toHaveBeenCalledOnce();
    expect(mocks.handleMissedCallSms).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: MOCK_TENANT.id,
        customerPhone: TEST_FROM,
        ourPhone: TEST_TO,
        callSid: TEST_CALL_SID,
        callStatus: "no-answer",
      })
    );
    await app.close();
  });

  it("does not call fallback when queue.add succeeds", async () => {
    mocks.add.mockResolvedValueOnce({ id: "job-ok" });
    const app = await buildApp();

    await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice-status",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: voicePayload({ CallStatus: "no-answer" }),
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.handleMissedCallSms).not.toHaveBeenCalled();
    await app.close();
  });

  it("does not crash when both queue and fallback fail", async () => {
    mocks.add.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    mocks.handleMissedCallSms.mockRejectedValueOnce(new Error("DB down too"));
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice-status",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: voicePayload({ CallStatus: "no-answer" }),
    });

    // Must still return 200
    expect(res.statusCode).toBe(200);

    // Allow setImmediate to fire — should not throw
    await new Promise((r) => setTimeout(r, 50));
    await app.close();
  });
});
