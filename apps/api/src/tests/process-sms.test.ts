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

// Mock google calendar token decryption
vi.mock("../routes/auth/google", () => ({
  decryptToken: vi.fn((t: string) => t),
}));

import { processSms, ProcessSmsInput } from "../services/process-sms";
import { processSmsRoute } from "../routes/internal/process-sms";

// ── Constants ────────────────────────────────────────────────────────────────

const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const PHONE = "+15551234567";
const OUR_PHONE = "+15559876543";
const CONVERSATION_ID = "c3d4e5f6-a7b8-9012-cdef-123456789012";
const APPOINTMENT_ID = "d4e5f6a7-b8c9-0123-def4-567890123456";
const MESSAGE_SID = "SM1234567890abcdef";
const TWILIO_SID = "SM0987654321fedcba";

function validInput(overrides: Partial<ProcessSmsInput> = {}): ProcessSmsInput {
  return {
    tenantId: TENANT_ID,
    customerPhone: PHONE,
    ourPhone: OUR_PHONE,
    body: "I need an oil change",
    messageSid: MESSAGE_SID,
    atSoftLimit: false,
    ...overrides,
  };
}

// Mock fetch that handles both OpenAI and Twilio calls
function mockFetchAll(options: {
  aiResponse?: string;
  aiError?: boolean;
  twilioOk?: boolean;
  googleOk?: boolean;
} = {}): typeof fetch {
  const aiResponse = options.aiResponse ?? "Sure! When would you like to come in for an oil change?";
  const twilioOk = options.twilioOk ?? true;

  return vi.fn().mockImplementation(async (url: string) => {
    // OpenAI
    if (typeof url === "string" && url.includes("openai.com")) {
      if (options.aiError) {
        return { ok: false, status: 500, text: () => Promise.resolve("Internal error") };
      }
      return {
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: aiResponse } }],
            usage: { total_tokens: 150 },
          }),
      };
    }

    // Twilio
    if (typeof url === "string" && url.includes("twilio.com")) {
      if (!twilioOk) {
        return {
          ok: false,
          status: 400,
          json: () => Promise.resolve({ message: "Invalid phone" }),
        };
      }
      return {
        ok: true,
        json: () => Promise.resolve({ sid: TWILIO_SID }),
      };
    }

    // Google Calendar
    if (typeof url === "string" && url.includes("googleapis.com")) {
      if (options.googleOk === false) {
        return { ok: false, status: 401, text: () => Promise.resolve("Unauthorized") };
      }
      return {
        ok: true,
        json: () => Promise.resolve({ id: "gcal_event_123" }),
      };
    }

    return { ok: true, json: () => Promise.resolve({}) };
  }) as unknown as typeof fetch;
}

// Standard DB mock setup for successful flow
function setupDbMocks(options: {
  conversationBlocked?: boolean;
  hasSystemPrompt?: boolean;
  hasHistory?: boolean;
  hasCalendarTokens?: boolean;
} = {}) {
  mocks.query.mockImplementation(async (sql: string, params?: unknown[]) => {
    // get_or_create_conversation
    if (sql.includes("get_or_create_conversation")) {
      if (options.conversationBlocked) return [];
      return [{ conversation_id: CONVERSATION_ID, is_new: false }];
    }

    // Insert message (inbound or outbound)
    if (sql.includes("INSERT INTO messages")) {
      return [{ id: "msg-123" }];
    }

    // touch_conversation
    if (sql.includes("touch_conversation")) {
      return [];
    }

    // system_prompts
    if (sql.includes("system_prompts")) {
      if (options.hasSystemPrompt) {
        return [{ prompt_text: "You are Joe's Auto Repair assistant." }];
      }
      return [];
    }

    // Fetch message history
    if (sql.includes("SELECT direction, body FROM messages")) {
      if (options.hasHistory) {
        return [
          { direction: "outbound", body: "Hi! How can we help?" },
          { direction: "inbound", body: "I need an oil change" },
        ];
      }
      return [];
    }

    // Tenant lookup (for appointments)
    if (sql.includes("SELECT id FROM tenants")) {
      return [{ id: TENANT_ID }];
    }

    // Appointment insert
    if (sql.includes("INSERT INTO appointments")) {
      return [{
        id: APPOINTMENT_ID,
        tenant_id: TENANT_ID,
        conversation_id: CONVERSATION_ID,
        customer_phone: PHONE,
        customer_name: null,
        service_type: "oil change",
        scheduled_at: new Date().toISOString(),
        duration_minutes: 60,
        notes: null,
        google_event_id: null,
        calendar_synced: false,
        created_at: new Date().toISOString(),
        xmax: "0",
      }];
    }

    // Calendar token lookup (idempotency check)
    if (sql.includes("SELECT google_event_id FROM appointments")) {
      return [];
    }

    // Calendar tokens
    if (sql.includes("SELECT access_token, calendar_id")) {
      if (options.hasCalendarTokens) {
        return [{ access_token: "test_access_token", calendar_id: "primary" }];
      }
      return [];
    }

    // Update appointment with google_event_id
    if (sql.includes("UPDATE appointments")) {
      return [];
    }

    // close_conversation
    if (sql.includes("close_conversation")) {
      return [{ close_conversation: true }];
    }

    return [];
  });
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(processSmsRoute, { prefix: "/internal" });
  return app;
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TWILIO_ACCOUNT_SID = "AC_test_sid";
  process.env.TWILIO_AUTH_TOKEN = "test_auth_token";
  process.env.TWILIO_MESSAGING_SERVICE_SID = "MG_test_sid";
  process.env.OPENAI_API_KEY = "sk-test-key";
});

// ═══════════════════════════════════════════════════════════════════════════
// processSms — service unit tests
// ═══════════════════════════════════════════════════════════════════════════

describe("processSms — happy path", () => {
  it("processes inbound SMS and returns AI response", async () => {
    setupDbMocks();
    const fetchMock = mockFetchAll();

    const result = await processSms(validInput(), fetchMock);

    expect(result.success).toBe(true);
    expect(result.conversationId).toBe(CONVERSATION_ID);
    expect(result.aiResponse).toContain("oil change");
    expect(result.smsSent).toBe(true);
    expect(result.isBooked).toBe(false);
  });

  it("uses tenant system prompt when available", async () => {
    setupDbMocks({ hasSystemPrompt: true });
    const fetchMock = mockFetchAll();

    await processSms(validInput(), fetchMock);

    // Verify OpenAI was called with the right messages
    const openaiCall = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("openai.com")
    );
    expect(openaiCall).toBeDefined();
    const body = JSON.parse((openaiCall![1] as { body: string }).body);
    expect(body.messages[0].content).toBe("You are Joe's Auto Repair assistant.");
  });

  it("includes conversation history in OpenAI request", async () => {
    setupDbMocks({ hasHistory: true });
    const fetchMock = mockFetchAll();

    await processSms(validInput(), fetchMock);

    const openaiCall = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("openai.com")
    );
    const body = JSON.parse((openaiCall![1] as { body: string }).body);
    // system + 2 history + 1 new message = 4
    expect(body.messages.length).toBe(4);
    // History reversed from DESC: [outbound, inbound] → [inbound, outbound]
    expect(body.messages[1].role).toBe("user");
    expect(body.messages[2].role).toBe("assistant");
  });
});

describe("processSms — booking flow", () => {
  it("creates appointment when AI confirms booking", async () => {
    setupDbMocks();
    const fetchMock = mockFetchAll({
      aiResponse: "Your appointment is confirmed for Monday at 2 PM for an oil change!",
    });

    const result = await processSms(validInput(), fetchMock);

    expect(result.success).toBe(true);
    expect(result.isBooked).toBe(true);
    expect(result.appointmentId).toBe(APPOINTMENT_ID);
    expect(result.conversationClosed).toBe(true);
  });

  it("syncs to Google Calendar when tokens available", async () => {
    setupDbMocks({ hasCalendarTokens: true });
    const fetchMock = mockFetchAll({
      aiResponse: "Your appointment is confirmed for Tuesday at 10 AM.",
      googleOk: true,
    });

    const result = await processSms(validInput(), fetchMock);

    expect(result.isBooked).toBe(true);
    expect(result.calendarSynced).toBe(true);
  });

  it("creates appointment even when calendar sync fails", async () => {
    setupDbMocks({ hasCalendarTokens: true });
    const fetchMock = mockFetchAll({
      aiResponse: "Your appointment is confirmed for Wednesday at 3 PM.",
      googleOk: false,
    });

    const result = await processSms(validInput(), fetchMock);

    expect(result.isBooked).toBe(true);
    expect(result.appointmentId).toBe(APPOINTMENT_ID);
    expect(result.calendarSynced).toBe(false);
  });

  it("skips calendar when no tokens for tenant", async () => {
    setupDbMocks({ hasCalendarTokens: false });
    const fetchMock = mockFetchAll({
      aiResponse: "Booking confirmed for Thursday at 9 AM.",
    });

    const result = await processSms(validInput(), fetchMock);

    expect(result.isBooked).toBe(true);
    expect(result.calendarSynced).toBe(false);
  });
});

describe("processSms — conversation close", () => {
  it("closes conversation when user sends stop", async () => {
    setupDbMocks();
    const fetchMock = mockFetchAll({
      aiResponse: "No problem! Have a great day.",
    });

    const result = await processSms(
      validInput({ body: "stop" }),
      fetchMock
    );

    expect(result.success).toBe(true);
    expect(result.conversationClosed).toBe(true);
    expect(result.isBooked).toBe(false);
  });

  it("closes conversation on cancel", async () => {
    setupDbMocks();
    const fetchMock = mockFetchAll({
      aiResponse: "Understood, no worries!",
    });

    const result = await processSms(
      validInput({ body: "cancel" }),
      fetchMock
    );

    expect(result.conversationClosed).toBe(true);
  });
});

describe("processSms — soft limit", () => {
  it("sends soft limit response instead of AI", async () => {
    setupDbMocks();
    const fetchMock = mockFetchAll();

    const result = await processSms(
      validInput({ atSoftLimit: true }),
      fetchMock
    );

    expect(result.success).toBe(true);
    expect(result.aiResponse).toContain("monthly messaging limit");
    // Should NOT call OpenAI
    const openaiCall = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("openai.com")
    );
    expect(openaiCall).toBeUndefined();
  });
});

describe("processSms — error handling", () => {
  it("returns error when conversation creation is blocked", async () => {
    setupDbMocks({ conversationBlocked: true });
    const fetchMock = mockFetchAll();

    const result = await processSms(validInput(), fetchMock);

    expect(result.success).toBe(false);
    expect(result.error).toContain("cooldown");
  });

  it("returns error when conversation creation throws", async () => {
    mocks.query.mockRejectedValueOnce(new Error("DB connection lost"));
    const fetchMock = mockFetchAll();

    const result = await processSms(validInput(), fetchMock);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Conversation creation failed");
  });

  it("returns error when OPENAI_API_KEY not set", async () => {
    delete process.env.OPENAI_API_KEY;
    setupDbMocks();
    const fetchMock = mockFetchAll();

    const result = await processSms(validInput(), fetchMock);

    expect(result.success).toBe(false);
    expect(result.error).toContain("OPENAI_API_KEY");
  });

  it("returns error when OpenAI API fails", async () => {
    setupDbMocks();
    const fetchMock = mockFetchAll({ aiError: true });

    const result = await processSms(validInput(), fetchMock);

    expect(result.success).toBe(false);
    expect(result.error).toContain("OpenAI API error");
  });

  it("returns error when OpenAI returns empty response", async () => {
    setupDbMocks();
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("openai.com")) {
        return {
          ok: true,
          json: () => Promise.resolve({ choices: [{ message: { content: "" } }] }),
        };
      }
      return { ok: true, json: () => Promise.resolve({ sid: TWILIO_SID }) };
    }) as unknown as typeof fetch;

    const result = await processSms(validInput(), fetchMock);

    expect(result.success).toBe(false);
    expect(result.error).toContain("empty response");
  });

  it("returns error when OpenAI request times out", async () => {
    setupDbMocks();
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("openai.com")) {
        throw new Error("The operation was aborted due to timeout");
      }
      return { ok: true, json: () => Promise.resolve({ sid: TWILIO_SID }) };
    }) as unknown as typeof fetch;

    const result = await processSms(validInput(), fetchMock);

    expect(result.success).toBe(false);
    expect(result.error).toContain("timeout");
  });

  it("succeeds with SMS error when Twilio send fails", async () => {
    setupDbMocks();
    const fetchMock = mockFetchAll({ twilioOk: false });

    const result = await processSms(validInput(), fetchMock);

    // success is true because AI processing worked, but smsSent is false
    expect(result.success).toBe(true);
    expect(result.smsSent).toBe(false);
    expect(result.error).toContain("SMS send failed");
    expect(result.aiResponse).toBeTruthy();
  });

  it("continues with empty history when history query fails", async () => {
    let callCount = 0;
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("get_or_create_conversation")) {
        return [{ conversation_id: CONVERSATION_ID, is_new: false }];
      }
      if (sql.includes("SELECT direction, body FROM messages")) {
        throw new Error("DB timeout");
      }
      if (sql.includes("system_prompts")) {
        return [];
      }
      return [];
    });
    const fetchMock = mockFetchAll();

    const result = await processSms(validInput(), fetchMock);

    expect(result.success).toBe(true);
    expect(result.aiResponse).toBeTruthy();
  });
});

describe("processSms — message logging", () => {
  it("logs inbound message with twilio_sid", async () => {
    setupDbMocks();
    const fetchMock = mockFetchAll();

    await processSms(validInput(), fetchMock);

    const insertCalls = mocks.query.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === "string" && (call[0] as string).includes("INSERT INTO messages") && (call[0] as string).includes("inbound")
    );
    expect(insertCalls.length).toBeGreaterThanOrEqual(1);
    // Check twilio_sid was passed
    expect(insertCalls[0][1]).toContain(MESSAGE_SID);
  });

  it("logs outbound AI message with token count and model", async () => {
    setupDbMocks();
    const fetchMock = mockFetchAll();

    await processSms(validInput(), fetchMock);

    const insertCalls = mocks.query.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === "string" && (call[0] as string).includes("INSERT INTO messages") && (call[0] as string).includes("tokens_used")
    );
    expect(insertCalls.length).toBeGreaterThanOrEqual(1);
    // Check tokens_used and model_version were passed
    expect(insertCalls[0][1]).toContain(150); // total_tokens from mock
    expect(insertCalls[0][1]).toContain("gpt-4o-mini");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /internal/process-sms — route tests
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /internal/process-sms — route", () => {
  it("returns 200 on successful processing", async () => {
    setupDbMocks();
    const app = await buildApp();

    // Need to mock fetch globally for route test since we can't inject it
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchAll();

    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/process-sms",
        payload: {
          tenantId: TENANT_ID,
          customerPhone: PHONE,
          ourPhone: OUR_PHONE,
          body: "I need an oil change",
          messageSid: MESSAGE_SID,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.conversationId).toBe(CONVERSATION_ID);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns 400 on missing required fields", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/internal/process-sms",
      payload: { tenantId: "not-a-uuid" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Validation failed");
  });

  it("returns 400 on empty body", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/internal/process-sms",
      payload: {
        tenantId: TENANT_ID,
        customerPhone: PHONE,
        ourPhone: OUR_PHONE,
        body: "",
        messageSid: MESSAGE_SID,
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 500 when processing fails", async () => {
    setupDbMocks({ conversationBlocked: true });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/internal/process-sms",
      payload: {
        tenantId: TENANT_ID,
        customerPhone: PHONE,
        ourPhone: OUR_PHONE,
        body: "hello",
        messageSid: MESSAGE_SID,
      },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toContain("cooldown");
  });

  it("defaults atSoftLimit to false", async () => {
    setupDbMocks();
    const app = await buildApp();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchAll();

    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/process-sms",
        payload: {
          tenantId: TENANT_ID,
          customerPhone: PHONE,
          ourPhone: OUR_PHONE,
          body: "hello",
          messageSid: MESSAGE_SID,
          // atSoftLimit not provided — should default to false
        },
      });

      expect(res.statusCode).toBe(200);
      // Should have AI response, not soft limit response
      expect(res.json().aiResponse).not.toContain("monthly messaging limit");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
