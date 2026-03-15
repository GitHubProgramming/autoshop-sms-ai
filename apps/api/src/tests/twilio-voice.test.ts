import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import formbody from "@fastify/formbody";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
  withTenant: vi.fn(),
}));

import { twilioVoiceRoute } from "../routes/webhooks/twilio-voice";

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_TO = "+15550001234"; // shop's Twilio number
const TEST_FROM = "+15559876543"; // customer's phone
const TEST_CALL_SID = "CAtest00000000000000000000000001";
const TEST_FORWARD = "+15551112222"; // shop's real phone

function voicePayload(overrides: Record<string, string> = {}): string {
  return new URLSearchParams({
    CallSid: TEST_CALL_SID,
    To: TEST_TO,
    From: TEST_FROM,
    CallStatus: "ringing",
    ...overrides,
  }).toString();
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(formbody);
  await app.register(twilioVoiceRoute, { prefix: "/webhooks/twilio" });
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /webhooks/twilio/voice", () => {
  let savedNodeEnv: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();

    savedNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    process.env.TWILIO_AUTH_TOKEN = "test_token";
    process.env.SKIP_TWILIO_VALIDATION = "true";
    process.env.API_BASE_URL = "https://autoshop-api.example.com";

    mocks.query.mockResolvedValue([
      { forward_to: TEST_FORWARD, shop_name: "Test Auto Shop" },
    ]);
  });

  afterEach(() => {
    process.env.NODE_ENV = savedNodeEnv;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.SKIP_TWILIO_VALIDATION;
    delete process.env.API_BASE_URL;
  });

  it("returns TwiML with <Dial> forwarding to shop phone", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: voicePayload(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/xml/);
    expect(res.body).toContain("<Dial");
    expect(res.body).toContain(`<Number>${TEST_FORWARD}</Number>`);
    expect(res.body).toContain('timeout="20"');
    await app.close();
  });

  it("includes voice-status action URL in Dial", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: voicePayload(),
    });

    expect(res.body).toContain(
      'action="https://autoshop-api.example.com/webhooks/twilio/voice-status"'
    );
    await app.close();
  });

  it("sets callerId to customer phone so shop sees who is calling", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: voicePayload(),
    });

    expect(res.body).toContain(`callerId="${TEST_FROM}"`);
    await app.close();
  });

  it("returns sorry message when no forward_to is configured", async () => {
    mocks.query.mockResolvedValueOnce([
      { forward_to: null, shop_name: "No Forward Shop" },
    ]);

    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: voicePayload(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<Say");
    expect(res.body).toContain("<Hangup/>");
    expect(res.body).not.toContain("<Dial");
    await app.close();
  });

  it("returns sorry message when no tenant found for phone number", async () => {
    mocks.query.mockResolvedValueOnce([]);

    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: voicePayload(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<Say");
    expect(res.body).toContain("<Hangup/>");
    await app.close();
  });

  it("returns 400 for invalid body", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ CallSid: TEST_CALL_SID }).toString(),
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("handles database errors gracefully", async () => {
    mocks.query.mockRejectedValueOnce(new Error("DB connection lost"));

    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: voicePayload(),
    });

    // Should still return valid TwiML (sorry message), not crash
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<Say");
    await app.close();
  });

  it("queries tenant_phone_numbers with correct phone number", async () => {
    const app = await buildApp();

    await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: voicePayload(),
    });

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("tenant_phone_numbers"),
      [TEST_TO]
    );
    await app.close();
  });
});
