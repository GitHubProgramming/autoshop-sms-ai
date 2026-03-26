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

import { ltLogConversationRoute } from "../routes/internal/lt-log-conversation";

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = Fastify({ logger: false });
  app.register(ltLogConversationRoute, { prefix: "/internal" });
  return app;
}

const VALID_TENANT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const VALID_BODY = {
  tenantId: VALID_TENANT_ID,
  customerPhone: "+37067577829",
  inboundBody: "Noriu užsiregistruoti",
  outboundBody: "Sveiki! Kokia paslauga jus domina?",
  source: "sms",
};

function internalHeaders() {
  return { "x-internal-key": "test-key" };
}

describe("POST /internal/lt-log-conversation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.INTERNAL_API_KEY = "test-key";
  });

  it("rejects missing tenantId", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/lt-log-conversation",
      headers: internalHeaders(),
      payload: { customerPhone: "+37067577829", inboundBody: "hello" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects missing x-internal-key", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/lt-log-conversation",
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 when tenant not found", async () => {
    mocks.query.mockResolvedValueOnce([]); // tenant lookup
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/lt-log-conversation",
      headers: internalHeaders(),
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(404);
  });

  it("creates new conversation and logs messages", async () => {
    const convId = "11111111-2222-3333-4444-555555555555";
    mocks.query
      .mockResolvedValueOnce([{ id: VALID_TENANT_ID }]) // tenant exists
      .mockResolvedValueOnce([])                          // no open conversation
      .mockResolvedValueOnce([{ id: convId }])           // INSERT conversation
      .mockResolvedValueOnce([])                          // INSERT inbound message
      .mockResolvedValueOnce([]);                         // INSERT outbound message

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/lt-log-conversation",
      headers: internalHeaders(),
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.conversationId).toBe(convId);
    expect(body.messagesLogged).toBe(2);
  });

  it("reuses existing open conversation", async () => {
    const existingConvId = "22222222-3333-4444-5555-666666666666";
    mocks.query
      .mockResolvedValueOnce([{ id: VALID_TENANT_ID }])                   // tenant exists
      .mockResolvedValueOnce([{ id: existingConvId, status: "open" }])   // existing conversation
      .mockResolvedValueOnce([])                                           // UPDATE touch
      .mockResolvedValueOnce([])                                           // INSERT inbound message
      .mockResolvedValueOnce([]);                                          // INSERT outbound message

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/lt-log-conversation",
      headers: internalHeaders(),
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().conversationId).toBe(existingConvId);
  });

  it("logs only inbound when outboundBody not provided", async () => {
    const convId = "33333333-4444-5555-6666-777777777777";
    mocks.query
      .mockResolvedValueOnce([{ id: VALID_TENANT_ID }]) // tenant exists
      .mockResolvedValueOnce([])                          // no open conversation
      .mockResolvedValueOnce([{ id: convId }])           // INSERT conversation
      .mockResolvedValueOnce([]);                         // INSERT inbound message only

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/lt-log-conversation",
      headers: internalHeaders(),
      payload: {
        tenantId: VALID_TENANT_ID,
        customerPhone: "+37067577829",
        inboundBody: "Sveiki",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().messagesLogged).toBe(1);
  });

  it("marks conversation as booked when bookingDetected=true", async () => {
    const convId = "44444444-5555-6666-7777-888888888888";
    mocks.query
      .mockResolvedValueOnce([{ id: VALID_TENANT_ID }]) // tenant exists
      .mockResolvedValueOnce([])                          // no open conversation
      .mockResolvedValueOnce([{ id: convId }])           // INSERT conversation
      .mockResolvedValueOnce([])                          // INSERT inbound message
      .mockResolvedValueOnce([])                          // INSERT outbound message
      .mockResolvedValueOnce([]);                         // UPDATE status to booked

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/lt-log-conversation",
      headers: internalHeaders(),
      payload: { ...VALID_BODY, bookingDetected: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().bookingDetected).toBe(true);

    // Verify the UPDATE booked query was called
    const calls = mocks.query.mock.calls;
    const bookedCall = calls.find(
      (c: string[]) => typeof c[0] === "string" && c[0].includes("booked")
    );
    expect(bookedCall).toBeDefined();
  });

  it("defaults source to sms", async () => {
    const convId = "55555555-6666-7777-8888-999999999999";
    mocks.query
      .mockResolvedValueOnce([{ id: VALID_TENANT_ID }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: convId }])
      .mockResolvedValueOnce([]);

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/lt-log-conversation",
      headers: internalHeaders(),
      payload: {
        tenantId: VALID_TENANT_ID,
        customerPhone: "+37067577829",
        inboundBody: "Test",
      },
    });
    expect(res.statusCode).toBe(200);
  });
});
