import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import formbody from "@fastify/formbody";
import twilio from "twilio";

// Mock DB and Redis to isolate middleware tests
const mocks = vi.hoisted(() => ({
  add: vi.fn().mockResolvedValue({ id: "job-1" }),
  deduplicateWebhook: vi.fn().mockResolvedValue({ isDuplicate: false, source: "twilio_sms", eventSid: "" }),
  getTenantByPhoneNumber: vi.fn(),
  getBlockReason: vi.fn((): string | null => null),
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

import { twilioSmsRoute } from "../routes/webhooks/twilio-sms";

// ── Constants ─────────────────────────────────────────────────────────────────

const AUTH_TOKEN = "test_auth_token_for_signature_validation";
const WEBHOOK_URL = "http://localhost:80/webhooks/twilio/sms";

const TEST_TO = "+15550001234";
const TEST_FROM = "+15559876543";
const TEST_MESSAGE_SID = "SMvalidate000000000000000000001";

const MOCK_TENANT = {
  id: "tenant-uuid-validate",
  shop_name: "Validate Shop",
  owner_email: "owner@validate.com",
  billing_status: "active" as const,
  plan_id: "pro",
  conv_used_this_cycle: 5,
  conv_limit_this_cycle: 400,
  trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  warned_80pct: false,
  warned_100pct: false,
};

function smsParams(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    MessageSid: TEST_MESSAGE_SID,
    AccountSid: "ACtest123",
    From: TEST_FROM,
    To: TEST_TO,
    Body: "Hello, I need an appointment",
    ...overrides,
  };
}

function generateValidSignature(params: Record<string, string>, url = WEBHOOK_URL): string {
  return twilio.getExpectedTwilioSignature(AUTH_TOKEN, url, params);
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(formbody);
  await app.register(twilioSmsRoute, { prefix: "/webhooks/twilio" });
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Twilio webhook signature validation", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    vi.clearAllMocks();

    savedEnv = {
      TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
      SKIP_TWILIO_VALIDATION: process.env.SKIP_TWILIO_VALIDATION,
      NODE_ENV: process.env.NODE_ENV,
    };

    // Enable validation (do NOT skip)
    process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
    delete process.env.SKIP_TWILIO_VALIDATION;
    process.env.NODE_ENV = "production";

    mocks.getTenantByPhoneNumber.mockResolvedValue(MOCK_TENANT);
    mocks.getBlockReason.mockReturnValue(null);
    mocks.deduplicateWebhook.mockResolvedValue({ isDuplicate: false, source: "twilio_sms", eventSid: "" });
  });

  afterEach(() => {
    process.env.TWILIO_AUTH_TOKEN = savedEnv.TWILIO_AUTH_TOKEN;
    if (savedEnv.SKIP_TWILIO_VALIDATION !== undefined) {
      process.env.SKIP_TWILIO_VALIDATION = savedEnv.SKIP_TWILIO_VALIDATION;
    } else {
      delete process.env.SKIP_TWILIO_VALIDATION;
    }
    process.env.NODE_ENV = savedEnv.NODE_ENV;
  });

  it("accepts request with valid Twilio signature and processes normally", async () => {
    const app = await buildApp();
    const params = smsParams();
    const signature = generateValidSignature(params);

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/sms",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signature,
      },
      payload: new URLSearchParams(params).toString(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<Response");
    // Verify the request reached the handler — job was enqueued
    expect(mocks.add).toHaveBeenCalledOnce();
    expect(mocks.add).toHaveBeenCalledWith(
      "process-sms",
      expect.objectContaining({
        tenantId: MOCK_TENANT.id,
        customerPhone: TEST_FROM,
        messageSid: TEST_MESSAGE_SID,
      }),
      expect.anything()
    );
    await app.close();
  });

  it("rejects request with missing x-twilio-signature header (403)", async () => {
    const app = await buildApp();
    const params = smsParams();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/sms",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        // no x-twilio-signature
      },
      payload: new URLSearchParams(params).toString(),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("Missing Twilio signature");
    // Handler should NOT have been reached
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.deduplicateWebhook).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects request with invalid signature (403)", async () => {
    const app = await buildApp();
    const params = smsParams();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/sms",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "invalidSignatureValue123",
      },
      payload: new URLSearchParams(params).toString(),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("Invalid Twilio signature");
    expect(mocks.add).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects request with signature from wrong auth token (403)", async () => {
    const app = await buildApp();
    const params = smsParams();
    // Generate signature with a different token
    const wrongSignature = twilio.getExpectedTwilioSignature(
      "wrong_auth_token_completely_different",
      WEBHOOK_URL,
      params
    );

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/sms",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": wrongSignature,
      },
      payload: new URLSearchParams(params).toString(),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("Invalid Twilio signature");
    expect(mocks.add).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects when body has been tampered with (403)", async () => {
    const app = await buildApp();
    const originalParams = smsParams();
    const signature = generateValidSignature(originalParams);

    // Tamper with the body after signing
    const tamperedParams = { ...originalParams, Body: "INJECTED MALICIOUS BODY" };

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/sms",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signature,
      },
      payload: new URLSearchParams(tamperedParams).toString(),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("Invalid Twilio signature");
    expect(mocks.add).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 500 when TWILIO_AUTH_TOKEN is not set", async () => {
    delete process.env.TWILIO_AUTH_TOKEN;

    const app = await buildApp();
    const params = smsParams();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/sms",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "any-value",
      },
      payload: new URLSearchParams(params).toString(),
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("Server misconfiguration");
    expect(mocks.add).not.toHaveBeenCalled();
    await app.close();
  });

  it("skips validation when SKIP_TWILIO_VALIDATION=true", async () => {
    process.env.SKIP_TWILIO_VALIDATION = "true";

    const app = await buildApp();
    const params = smsParams();

    // No signature header at all — should still pass because validation is skipped
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/sms",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: new URLSearchParams(params).toString(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<Response");
    // Handler was reached
    expect(mocks.add).toHaveBeenCalledOnce();
    await app.close();
  });

  it("valid signature still triggers full handler flow (regression)", async () => {
    const app = await buildApp();
    const params = smsParams({ Body: "I need a brake inspection" });
    const signature = generateValidSignature(params);

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/sms",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signature,
      },
      payload: new URLSearchParams(params).toString(),
    });

    // Full flow executed
    expect(res.statusCode).toBe(200);
    expect(mocks.deduplicateWebhook).toHaveBeenCalledWith("twilio_sms", TEST_MESSAGE_SID);
    expect(mocks.getTenantByPhoneNumber).toHaveBeenCalledWith(TEST_TO);
    expect(mocks.add).toHaveBeenCalledWith(
      "process-sms",
      expect.objectContaining({
        body: "I need a brake inspection",
        customerPhone: TEST_FROM,
        ourPhone: TEST_TO,
      }),
      expect.anything()
    );
    await app.close();
  });
});
