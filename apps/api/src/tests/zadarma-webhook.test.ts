import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";

// ── Mocks ───────────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

import { zadarmaWebhookRoute } from "../routes/internal/zadarma-webhook";

// ── Helpers ─────────────────────────────────────────────────────────────────
function buildApp() {
  const app = Fastify({ logger: false });
  app.register(zadarmaWebhookRoute, { prefix: "/internal" });
  return app;
}

const originalFetch = globalThis.fetch;

// ── GET tests ───────────────────────────────────────────────────────────────
describe("GET /internal/zadarma-webhook", () => {
  it("returns zd_echo value as text/plain for URL verification", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/internal/zadarma-webhook?zd_echo=abc123token",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toBe("abc123token");
  });

  it("returns health check JSON when no zd_echo param", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/internal/zadarma-webhook",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, status: "ready" });
  });

  it("does NOT require x-internal-key (public endpoint)", async () => {
    // No auth header — should still succeed
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/internal/zadarma-webhook?zd_echo=verify",
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("verify");
  });
});

// ── POST tests ──────────────────────────────────────────────────────────────
describe("POST /internal/zadarma-webhook", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.ZADARMA_WEBHOOK_SECRET = "test-webhook-secret";
    process.env.N8N_LT_ZADARMA_WEBHOOK_URL = "http://localhost:5678/webhook/test";
    // DB audit insert succeeds by default
    mocks.query.mockResolvedValue([]);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.ZADARMA_WEBHOOK_SECRET;
    delete process.env.N8N_LT_ZADARMA_WEBHOOK_URL;
  });

  const SAMPLE_PAYLOAD = {
    event: "NOTIFY_OUT_END",
    caller_id: "+37067577829",
    called_did: "+37045512300",
    call_status: "no answer",
    call_start: "2026-04-12T10:00:00Z",
  };

  it("forwards payload to n8n with x-zadarma-secret header", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
    }) as unknown as typeof fetch;
    globalThis.fetch = fetchSpy;

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/zadarma-webhook",
      payload: SAMPLE_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.forwarded).toBe(true);
    expect(body.n8n_status).toBe(200);

    // Verify fetch was called with correct URL and headers
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = (fetchSpy as unknown as {
      mock: { calls: [string, RequestInit][] };
    }).mock.calls[0];
    expect(calledUrl).toBe("http://localhost:5678/webhook/test");
    const headers = calledInit.headers as Record<string, string>;
    expect(headers["x-zadarma-secret"]).toBe("test-webhook-secret");
    expect(headers["Content-Type"]).toBe("application/json");

    // Verify body forwarded
    const sentBody = JSON.parse(calledInit.body as string);
    expect(sentBody.event).toBe("NOTIFY_OUT_END");
    expect(sentBody.caller_id).toBe("+37067577829");
  });

  it("returns 200 even when n8n returns an error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 502,
      ok: false,
    }) as unknown as typeof fetch;

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/zadarma-webhook",
      payload: SAMPLE_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.forwarded).toBe(true);
    expect(body.n8n_status).toBe(502);
  });

  it("returns 200 even when n8n is unreachable (timeout/network error)", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/zadarma-webhook",
      payload: SAMPLE_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.forwarded).toBe(false);
    expect(body.n8n_status).toBeNull();
  });

  it("returns ok:false when ZADARMA_WEBHOOK_SECRET is not set", async () => {
    delete process.env.ZADARMA_WEBHOOK_SECRET;

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/zadarma-webhook",
      payload: SAMPLE_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().error).toBe("webhook_secret_not_configured");
  });

  it("includes raw payload in audit log insert", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
    }) as unknown as typeof fetch;

    const app = buildApp();
    await app.inject({
      method: "POST",
      url: "/internal/zadarma-webhook",
      payload: SAMPLE_PAYLOAD,
    });

    // Verify DB audit row was inserted
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO zadarma_events");
    expect(params[0]).toBe("NOTIFY_OUT_END");           // event_type
    expect(params[1]).toBe("+37067577829");              // caller_id
    expect(params[2]).toBe("+37045512300");              // called_did
    expect(params[3]).toBe("no answer");                 // call_status
    expect(JSON.parse(params[4] as string)).toMatchObject(SAMPLE_PAYLOAD);
    expect(params[5]).toBe(true);                        // forwarded_to_n8n
    expect(params[6]).toBe(200);                         // n8n_response_status
  });

  it("does NOT require x-internal-key (public endpoint)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
    }) as unknown as typeof fetch;

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/zadarma-webhook",
      payload: SAMPLE_PAYLOAD,
      // No x-internal-key header
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });
});
