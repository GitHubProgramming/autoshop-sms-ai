import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

import { ltRecentConversationsRoute } from "../routes/internal/lt-recent-conversations";
import { LT_PROTEROS_TENANT_UUID } from "../utils/lt-tenant";

function buildApp() {
  const app = Fastify({ logger: false });
  app.register(ltRecentConversationsRoute, { prefix: "/internal" });
  return app;
}

function internalHeaders() {
  return { "x-internal-key": "test-key" };
}

describe("GET /internal/lt-recent-conversations", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.INTERNAL_API_KEY = "test-key";
  });

  it("rejects missing x-internal-key with 403", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/internal/lt-recent-conversations?tenant=lt-proteros-servisas",
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects missing tenant query param with 400", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/internal/lt-recent-conversations",
      headers: internalHeaders(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects unknown tenant slug with 400", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/internal/lt-recent-conversations?tenant=lt-unknown",
      headers: internalHeaders(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("unknown_tenant");
  });

  it("rejects limit > 50 with 400", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/internal/lt-recent-conversations?tenant=lt-proteros-servisas&limit=999",
      headers: internalHeaders(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 200 with empty array when no rows match", async () => {
    mocks.query.mockResolvedValueOnce([]);
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/internal/lt-recent-conversations?tenant=lt-proteros-servisas",
      headers: internalHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({ ok: true, count: 0, conversations: [] });
  });

  it("maps DB columns to response shape (caller_number, message_text, created_at)", async () => {
    mocks.query.mockResolvedValueOnce([
      {
        id: "msg-1",
        customer_phone: "+37067577829",
        direction: "outbound",
        source: "zadarma-missed-call",
        body: "Labas, parašykit kuo galim padėti.",
        sent_at: "2026-04-11T16:30:00.000Z",
      },
      {
        id: "msg-2",
        customer_phone: "+37067577829",
        direction: "inbound",
        source: null,
        body: "Noriu užsiregistruoti",
        sent_at: "2026-04-11T16:31:00.000Z",
      },
    ]);

    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/internal/lt-recent-conversations?tenant=lt-proteros-servisas&limit=10",
      headers: internalHeaders(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.count).toBe(2);
    expect(body.conversations).toEqual([
      {
        id: "msg-1",
        caller_number: "+37067577829",
        direction: "outbound",
        source: "zadarma-missed-call",
        message_text: "Labas, parašykit kuo galim padėti.",
        created_at: "2026-04-11T16:30:00.000Z",
      },
      {
        id: "msg-2",
        caller_number: "+37067577829",
        direction: "inbound",
        source: null,
        message_text: "Noriu užsiregistruoti",
        created_at: "2026-04-11T16:31:00.000Z",
      },
    ]);
  });

  it("scopes the SQL query by tenant_id (other tenants excluded)", async () => {
    mocks.query.mockResolvedValueOnce([]);
    const app = buildApp();
    await app.inject({
      method: "GET",
      url: "/internal/lt-recent-conversations?tenant=lt-proteros-servisas",
      headers: internalHeaders(),
    });
    const call = mocks.query.mock.calls[0];
    const sql = call[0] as string;
    const params = call[1] as unknown[];
    expect(sql).toContain("WHERE m.tenant_id = $1");
    expect(sql).toContain("ORDER BY m.sent_at DESC");
    expect(params[0]).toBe(LT_PROTEROS_TENANT_UUID);
  });

  it("defaults limit to 10 and passes it to SQL", async () => {
    mocks.query.mockResolvedValueOnce([]);
    const app = buildApp();
    await app.inject({
      method: "GET",
      url: "/internal/lt-recent-conversations?tenant=lt-proteros-servisas",
      headers: internalHeaders(),
    });
    const params = mocks.query.mock.calls[0][1] as unknown[];
    expect(params[1]).toBe(10);
  });

  it("honors custom limit up to 50", async () => {
    mocks.query.mockResolvedValueOnce([]);
    const app = buildApp();
    await app.inject({
      method: "GET",
      url: "/internal/lt-recent-conversations?tenant=lt-proteros-servisas&limit=25",
      headers: internalHeaders(),
    });
    const params = mocks.query.mock.calls[0][1] as unknown[];
    expect(params[1]).toBe(25);
  });
});
