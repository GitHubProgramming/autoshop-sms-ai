import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";

// ── Mocks (must be hoisted so vi.mock picks them up) ─────────────────────────
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

// fetchWithTimeout just delegates to global fetch — override globalThis.fetch.
import { ltSendSmsRoute } from "../routes/internal/lt-send-sms";
import { LT_PROTEROS_TENANT_UUID } from "../utils/lt-tenant";

// ── Helpers ──────────────────────────────────────────────────────────────────
function buildApp() {
  const app = Fastify({ logger: false });
  app.register(ltSendSmsRoute, { prefix: "/internal" });
  return app;
}

function internalHeaders() {
  return { "x-internal-key": "test-key" };
}

const VALID_BODY = {
  to: "+37061234567",
  message: "Labas, parašykit kuo galim padėti.",
  tenant_id: "lt-proteros-servisas",
  source: "zadarma-missed-call",
};

function mockZadarmaFetch(
  response: unknown,
  { ok = true, status = 200 }: { ok?: boolean; status?: number } = {}
) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(response)),
  }) as unknown as typeof fetch;
}

const originalFetch = globalThis.fetch;

describe("POST /internal/lt-send-sms", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.INTERNAL_API_KEY = "test-key";
    process.env.ZADARMA_API_KEY = "test_key";
    process.env.ZADARMA_API_SECRET = "test_secret_12345";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.ZADARMA_API_KEY;
    delete process.env.ZADARMA_API_SECRET;
  });

  it("rejects missing x-internal-key with 403", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/lt-send-sms",
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects invalid E.164 `to` with 400", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/lt-send-sms",
      headers: internalHeaders(),
      payload: { ...VALID_BODY, to: "37061234567" }, // no leading +
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("validation_failed");
  });

  it("rejects empty message with 400", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/lt-send-sms",
      headers: internalHeaders(),
      payload: { ...VALID_BODY, message: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects unknown tenant slug with 400", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/lt-send-sms",
      headers: internalHeaders(),
      payload: { ...VALID_BODY, tenant_id: "lt-unknown-shop" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("unknown_tenant");
  });

  it("returns 503 when ZADARMA_API_KEY is missing", async () => {
    delete process.env.ZADARMA_API_KEY;
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/lt-send-sms",
      headers: internalHeaders(),
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("zadarma_credentials_not_configured");
  });

  it("returns 503 when ZADARMA_API_SECRET is missing", async () => {
    delete process.env.ZADARMA_API_SECRET;
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/lt-send-sms",
      headers: internalHeaders(),
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(503);
  });

  it("signs the request correctly and persists conversation on success", async () => {
    const convId = "11111111-2222-3333-4444-555555555555";
    mocks.query
      .mockResolvedValueOnce([{ id: LT_PROTEROS_TENANT_UUID }]) // tenant exists
      .mockResolvedValueOnce([])                                  // no open conv
      .mockResolvedValueOnce([{ id: convId }])                    // INSERT conv
      .mockResolvedValueOnce([]);                                  // INSERT outbound msg

    const fetchSpy = mockZadarmaFetch({
      status: "success",
      messages: 1,
      message_id: "zd-123",
    });
    globalThis.fetch = fetchSpy;

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/lt-send-sms",
      headers: internalHeaders(),
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.conversation_id).toBe(convId);
    expect(body.zadarma_status).toMatchObject({ status: "success" });

    // Verify the outbound fetch call to Zadarma:
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = (fetchSpy as unknown as {
      mock: { calls: [string, RequestInit][] };
    }).mock.calls[0];
    expect(calledUrl).toBe("https://api.zadarma.com/v1/sms/send/");
    expect((calledInit.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded"
    );
    const authHeader = (calledInit.headers as Record<string, string>)[
      "Authorization"
    ];
    // Literal `apiKey:signature`, no "Bearer " prefix:
    expect(authHeader.startsWith("test_key:")).toBe(true);
    // Body is sorted alphabetically:
    expect(typeof calledInit.body).toBe("string");
    const bodyStr = calledInit.body as string;
    const firstEq = bodyStr.indexOf("=");
    expect(bodyStr.slice(0, firstEq)).toBe("caller_id");

    // Verify the outbound message was persisted with source:
    const insertCall = mocks.query.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === "string" && (c[0] as string).includes("INSERT INTO messages")
    );
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as unknown[];
    expect(params[2]).toBe(VALID_BODY.message);
    expect(params[3]).toBe("zadarma-missed-call");
  });

  it("reuses existing open conversation on success", async () => {
    const existingConvId = "22222222-3333-4444-5555-666666666666";
    mocks.query
      .mockResolvedValueOnce([{ id: LT_PROTEROS_TENANT_UUID }])
      .mockResolvedValueOnce([{ id: existingConvId }]) // open conv found
      .mockResolvedValueOnce([])                        // UPDATE touch
      .mockResolvedValueOnce([]);                       // INSERT outbound msg

    globalThis.fetch = mockZadarmaFetch({ status: "success" });

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/lt-send-sms",
      headers: internalHeaders(),
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().conversation_id).toBe(existingConvId);
  });

  it("returns ok:false + 200 when Zadarma rejects the SMS", async () => {
    globalThis.fetch = mockZadarmaFetch({
      status: "error",
      message: "wrong signature",
    });

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/lt-send-sms",
      headers: internalHeaders(),
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(200); // still 200 so n8n doesn't retry
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("zadarma_send_failed");
    expect(body.zadarma_response).toMatchObject({ status: "error" });
    // No DB writes should have happened:
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("returns ok:false + 200 on network error", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNRESET")) as unknown as typeof fetch;

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/lt-send-sms",
      headers: internalHeaders(),
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("zadarma_request_failed");
  });

  it("accepts a raw tenant UUID as well as a slug", async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: LT_PROTEROS_TENANT_UUID }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "conv-uuid" }])
      .mockResolvedValueOnce([]);
    globalThis.fetch = mockZadarmaFetch({ status: "success" });

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/lt-send-sms",
      headers: internalHeaders(),
      payload: { ...VALID_BODY, tenant_id: LT_PROTEROS_TENANT_UUID },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });
});
