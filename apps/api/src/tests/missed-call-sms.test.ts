import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

vi.mock("../services/pipeline-trace", () => ({
  resumeTrace: vi.fn().mockResolvedValue({
    id: "trace-mock-id",
    step: vi.fn().mockResolvedValue(undefined),
    setTenant: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { missedCallSmsRoute } from "../routes/internal/missed-call-sms";
import {
  handleMissedCallSms,
  buildMissedCallSms,
  sendTwilioSms,
} from "../services/missed-call-sms";

// ── Constants ────────────────────────────────────────────────────────────────

const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const PHONE = "+15551234567";
const OUR_PHONE = "+15559876543";
const CALL_SID = "CA1234567890abcdef";
const CONVERSATION_ID = "c3d4e5f6-a7b8-9012-cdef-123456789012";
const TWILIO_SID = "SM1234567890abcdef";

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT_ID,
    customerPhone: PHONE,
    ourPhone: OUR_PHONE,
    callSid: CALL_SID,
    callStatus: "no-answer",
    ...overrides,
  };
}

function mockFetchSuccess(): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ sid: TWILIO_SID }),
  }) as unknown as typeof fetch;
}

function mockFetchFailure(status = 400, message = "Bad Request"): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve({ message }),
  }) as unknown as typeof fetch;
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(missedCallSmsRoute, { prefix: "/internal" });
  return app;
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Set Twilio env vars for tests
  process.env.TWILIO_ACCOUNT_SID = "AC_test_sid";
  process.env.TWILIO_AUTH_TOKEN = "test_auth_token";
  process.env.TWILIO_MESSAGING_SERVICE_SID = "MG_test_sid";
});

// ═══════════════════════════════════════════════════════════════════════════
// buildMissedCallSms — unit tests
// ═══════════════════════════════════════════════════════════════════════════

describe("buildMissedCallSms", () => {
  it("includes shop name when provided", () => {
    const sms = buildMissedCallSms("Joe's Auto Repair");
    expect(sms).toContain("Joe's Auto Repair");
    expect(sms).toContain("How can we help");
  });

  it("uses fallback when shop name is null", () => {
    const sms = buildMissedCallSms(null);
    expect(sms).toContain("our shop");
    expect(sms).toContain("How can we help");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// sendTwilioSms — unit tests
// ═══════════════════════════════════════════════════════════════════════════

describe("sendTwilioSms", () => {
  it("returns SID on success", async () => {
    const result = await sendTwilioSms(PHONE, "Test message", mockFetchSuccess());
    expect(result.sid).toBe(TWILIO_SID);
    expect(result.error).toBeNull();
  });

  it("returns error on Twilio API failure", async () => {
    const result = await sendTwilioSms(
      PHONE,
      "Test message",
      mockFetchFailure(400, "Invalid phone")
    );
    expect(result.sid).toBeNull();
    expect(result.error).toContain("Twilio API error 400");
  });

  it("returns error when fetch throws", async () => {
    const failFetch = vi.fn().mockRejectedValue(
      new Error("network timeout")
    ) as unknown as typeof fetch;
    const result = await sendTwilioSms(PHONE, "Test message", failFetch);
    expect(result.sid).toBeNull();
    expect(result.error).toContain("network timeout");
  });

  it("returns error when Twilio credentials missing", async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    const result = await sendTwilioSms(PHONE, "Test message", mockFetchSuccess());
    expect(result.sid).toBeNull();
    expect(result.error).toContain("credentials not configured");
  });

  it("sends correct request to Twilio API", async () => {
    const fakeFetch = mockFetchSuccess();
    await sendTwilioSms(PHONE, "Hello world", fakeFetch);

    expect(fakeFetch).toHaveBeenCalledOnce();
    const [url, opts] = (fakeFetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("api.twilio.com");
    expect(url).toContain("AC_test_sid");
    expect(opts.method).toBe("POST");
    expect(opts.body).toContain(encodeURIComponent(PHONE));
    expect(opts.body).toContain(encodeURIComponent("Hello world"));
    expect(opts.body).toContain("MG_test_sid");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// handleMissedCallSms — service tests
// ═══════════════════════════════════════════════════════════════════════════

describe("handleMissedCallSms", () => {
  it("completes full flow successfully", async () => {
    mocks.query
      .mockResolvedValueOnce([
        { id: TENANT_ID, shop_name: "Joe's Auto", billing_status: "active" },
      ])
      .mockResolvedValueOnce([
        { conversation_id: CONVERSATION_ID, is_new: true },
      ])
      .mockResolvedValueOnce([]) // log inbound
      .mockResolvedValueOnce([]) // log outbound
      .mockResolvedValueOnce([]); // touch conversation

    const result = await handleMissedCallSms(validInput(), mockFetchSuccess());

    expect(result.success).toBe(true);
    expect(result.conversationId).toBe(CONVERSATION_ID);
    expect(result.smsSent).toBe(true);
    expect(result.twilioSid).toBe(TWILIO_SID);
    expect(result.error).toBeNull();
  });

  it("returns error when tenant not found", async () => {
    mocks.query.mockResolvedValueOnce([]);
    const result = await handleMissedCallSms(validInput(), mockFetchSuccess());
    expect(result.success).toBe(false);
    expect(result.error).toBe("Tenant not found");
  });

  it("returns error when tenant billing is blocked", async () => {
    mocks.query.mockResolvedValueOnce([
      { id: TENANT_ID, shop_name: "Joe's Auto", billing_status: "blocked" },
    ]);
    const result = await handleMissedCallSms(validInput(), mockFetchSuccess());
    expect(result.success).toBe(false);
    expect(result.error).toBe("Tenant billing is blocked");
  });

  it("returns error when conversation blocked by cooldown", async () => {
    mocks.query
      .mockResolvedValueOnce([
        { id: TENANT_ID, shop_name: "Joe's Auto", billing_status: "active" },
      ])
      .mockResolvedValueOnce([{ conversation_id: null, is_new: false }]);

    const result = await handleMissedCallSms(validInput(), mockFetchSuccess());
    expect(result.success).toBe(false);
    expect(result.error).toContain("cooldown");
  });

  it("returns error when Twilio SMS fails", async () => {
    mocks.query
      .mockResolvedValueOnce([
        { id: TENANT_ID, shop_name: "Joe's Auto", billing_status: "active" },
      ])
      .mockResolvedValueOnce([
        { conversation_id: CONVERSATION_ID, is_new: true },
      ])
      .mockResolvedValueOnce([]) // log inbound
      .mockResolvedValueOnce([]) // log outbound
      .mockResolvedValueOnce([]); // touch

    const result = await handleMissedCallSms(
      validInput(),
      mockFetchFailure(400, "Invalid phone number")
    );

    expect(result.success).toBe(false);
    expect(result.conversationId).toBe(CONVERSATION_ID);
    expect(result.smsSent).toBe(false);
    expect(result.error).toContain("Twilio API error");
  });

  it("handles tenant lookup failure", async () => {
    mocks.query.mockRejectedValueOnce(new Error("connection refused"));
    const result = await handleMissedCallSms(validInput(), mockFetchSuccess());
    expect(result.success).toBe(false);
    expect(result.error).toContain("Tenant lookup failed");
  });

  it("handles conversation creation failure", async () => {
    mocks.query
      .mockResolvedValueOnce([
        { id: TENANT_ID, shop_name: "Joe's Auto", billing_status: "active" },
      ])
      .mockRejectedValueOnce(new Error("DB error"));

    const result = await handleMissedCallSms(validInput(), mockFetchSuccess());
    expect(result.success).toBe(false);
    expect(result.error).toContain("Conversation creation failed");
  });

  it("continues even if inbound message logging fails", async () => {
    mocks.query
      .mockResolvedValueOnce([
        { id: TENANT_ID, shop_name: "Joe's Auto", billing_status: "active" },
      ])
      .mockResolvedValueOnce([
        { conversation_id: CONVERSATION_ID, is_new: true },
      ])
      .mockRejectedValueOnce(new Error("log fail")) // inbound log fails
      .mockResolvedValueOnce([]) // outbound log
      .mockResolvedValueOnce([]); // touch

    const result = await handleMissedCallSms(validInput(), mockFetchSuccess());
    expect(result.success).toBe(true);
    expect(result.smsSent).toBe(true);
  });

  it("includes shop name in SMS text", async () => {
    const fakeFetch = mockFetchSuccess();
    mocks.query
      .mockResolvedValueOnce([
        { id: TENANT_ID, shop_name: "Joe's Auto Repair", billing_status: "active" },
      ])
      .mockResolvedValueOnce([
        { conversation_id: CONVERSATION_ID, is_new: true },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await handleMissedCallSms(validInput(), fakeFetch);

    // The SMS body should contain the shop name
    const [, opts] = (fakeFetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = opts.body as string;
    expect(body).toContain(encodeURIComponent("Joe's Auto Repair"));
  });

  it("allows trial billing status", async () => {
    mocks.query
      .mockResolvedValueOnce([
        { id: TENANT_ID, shop_name: "Test Shop", billing_status: "trial" },
      ])
      .mockResolvedValueOnce([
        { conversation_id: CONVERSATION_ID, is_new: true },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await handleMissedCallSms(validInput(), mockFetchSuccess());
    expect(result.success).toBe(true);
  });

  it("logs missed call info in inbound message", async () => {
    mocks.query
      .mockResolvedValueOnce([
        { id: TENANT_ID, shop_name: "Test Shop", billing_status: "active" },
      ])
      .mockResolvedValueOnce([
        { conversation_id: CONVERSATION_ID, is_new: true },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await handleMissedCallSms(validInput(), mockFetchSuccess());

    // Third query is the inbound message log
    const inboundCall = mocks.query.mock.calls[2];
    expect(inboundCall[1][2]).toContain("Missed call");
    expect(inboundCall[1][2]).toContain("no-answer");
    expect(inboundCall[1][2]).toContain(PHONE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Route integration tests
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /internal/missed-call-sms — route", () => {
  it("returns 200 on success", async () => {
    mocks.query
      .mockResolvedValueOnce([
        { id: TENANT_ID, shop_name: "Test Shop", billing_status: "active" },
      ])
      .mockResolvedValueOnce([
        { conversation_id: CONVERSATION_ID, is_new: true },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    // Mock global fetch for Twilio
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sid: TWILIO_SID }),
    }) as unknown as typeof fetch;

    try {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/internal/missed-call-sms",
        payload: validInput(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.smsSent).toBe(true);
      expect(body.conversationId).toBe(CONVERSATION_ID);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns 404 when tenant not found", async () => {
    mocks.query.mockResolvedValueOnce([]);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/missed-call-sms",
      payload: validInput(),
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 402 when tenant billing is blocked", async () => {
    mocks.query.mockResolvedValueOnce([
      { id: TENANT_ID, shop_name: "Test Shop", billing_status: "blocked" },
    ]);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/missed-call-sms",
      payload: validInput(),
    });

    expect(res.statusCode).toBe(402);
  });

  it("returns 400 on missing tenantId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/missed-call-sms",
      payload: {
        customerPhone: PHONE,
        ourPhone: OUR_PHONE,
        callSid: CALL_SID,
        callStatus: "no-answer",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Validation failed");
  });

  it("returns 400 on invalid tenantId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/missed-call-sms",
      payload: validInput({ tenantId: "not-uuid" }),
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 on missing customerPhone", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/missed-call-sms",
      payload: validInput({ customerPhone: undefined }),
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 on missing callSid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/missed-call-sms",
      payload: validInput({ callSid: undefined }),
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 on empty callStatus", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/missed-call-sms",
      payload: validInput({ callStatus: "" }),
    });

    expect(res.statusCode).toBe(400);
  });
});
