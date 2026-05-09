import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// ── Mocks ───────────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  handleMissedCallSms: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

vi.mock("../services/missed-call-sms", () => ({
  handleMissedCallSms: mocks.handleMissedCallSms,
}));

import { zadarmaWebhookRoute } from "../routes/internal/zadarma-webhook";

const LT_PILOT_TENANT_ID = "7d82ab25-e991-4d13-b4ac-846865f8b85a";
const LT_PILOT_OUR_PHONE = "+37066806130";

// ── Helpers ─────────────────────────────────────────────────────────────────
function buildApp() {
  const app = Fastify({ logger: false });
  app.register(zadarmaWebhookRoute, { prefix: "/internal" });
  return app;
}

function notifyEnd(overrides: Record<string, unknown> = {}) {
  return {
    event: "NOTIFY_END",
    caller_id: "+37067577829",
    called_did: "37045512300",
    call_status: "answered",
    disposition: "answered",
    duration: "12",
    pbx_call_id: "in_abc123",
    ...overrides,
  };
}

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
    mocks.query.mockResolvedValue([]);
    mocks.handleMissedCallSms.mockResolvedValue({
      success: true,
      conversationId: "conv-1",
      smsSent: true,
      twilioSid: "SM123",
      error: null,
    });
  });

  it("calls handleMissedCallSms for NOTIFY_END with valid external caller", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/zadarma-webhook",
      payload: notifyEnd(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, processed: true });

    expect(mocks.handleMissedCallSms).toHaveBeenCalledTimes(1);
    const arg = mocks.handleMissedCallSms.mock.calls[0][0];
    expect(arg.tenantId).toBe(LT_PILOT_TENANT_ID);
    expect(arg.ourPhone).toBe(LT_PILOT_OUR_PHONE);
    expect(arg.customerPhone).toBe("+37067577829");
    expect(arg.callSid).toBe("zadarma-in_abc123");
    expect(arg.callStatus).toBe("no-answer");
  });

  it("normalizes caller_id without leading + before forwarding", async () => {
    const app = buildApp();
    await app.inject({
      method: "POST",
      url: "/internal/zadarma-webhook",
      payload: notifyEnd({ caller_id: "37067577829" }),
    });

    expect(mocks.handleMissedCallSms).toHaveBeenCalledTimes(1);
    expect(mocks.handleMissedCallSms.mock.calls[0][0].customerPhone).toBe(
      "+37067577829"
    );
  });

  it("does NOT call handleMissedCallSms for NOTIFY_START", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/zadarma-webhook",
      payload: notifyEnd({ event: "NOTIFY_START" }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().processed).toBe(false);
    expect(mocks.handleMissedCallSms).not.toHaveBeenCalled();
  });

  it("does NOT call handleMissedCallSms for NOTIFY_INTERNAL", async () => {
    const app = buildApp();
    await app.inject({
      method: "POST",
      url: "/internal/zadarma-webhook",
      payload: notifyEnd({ event: "NOTIFY_INTERNAL" }),
    });

    expect(mocks.handleMissedCallSms).not.toHaveBeenCalled();
  });

  it("skips when caller_id is empty", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/zadarma-webhook",
      payload: notifyEnd({ caller_id: "" }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().processed).toBe(false);
    expect(mocks.handleMissedCallSms).not.toHaveBeenCalled();
  });

  it("skips when caller_id equals called_did (self-call)", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/zadarma-webhook",
      payload: notifyEnd({
        caller_id: "+37045512300",
        called_did: "37045512300",
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().processed).toBe(false);
    expect(mocks.handleMissedCallSms).not.toHaveBeenCalled();
  });

  it("returns 200 even when handleMissedCallSms throws", async () => {
    mocks.handleMissedCallSms.mockRejectedValueOnce(new Error("boom"));

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/zadarma-webhook",
      payload: notifyEnd(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("persists audit row with raw payload on every event", async () => {
    const app = buildApp();
    const payload = notifyEnd();
    await app.inject({
      method: "POST",
      url: "/internal/zadarma-webhook",
      payload,
    });

    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO zadarma_events");
    expect(params[0]).toBe("NOTIFY_END");
    expect(params[1]).toBe("+37067577829");
    expect(params[2]).toBe("37045512300");
    expect(params[3]).toBe("answered");
    expect(JSON.parse(params[4] as string)).toMatchObject(payload);
    expect(params[5]).toBe(true); // processed
    expect(params[6]).toBe(200); // process_status (success)
  });

  it("persists audit row even for skipped events (NOTIFY_START)", async () => {
    const app = buildApp();
    await app.inject({
      method: "POST",
      url: "/internal/zadarma-webhook",
      payload: notifyEnd({ event: "NOTIFY_START" }),
    });

    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBe("NOTIFY_START");
    expect(params[5]).toBe(false);
    expect(params[6]).toBeNull();
  });

  it("audit row records process_status=500 when service returns success=false", async () => {
    mocks.handleMissedCallSms.mockResolvedValueOnce({
      success: false,
      conversationId: null,
      smsSent: false,
      twilioSid: null,
      error: "Tenant billing is blocked",
    });

    const app = buildApp();
    await app.inject({
      method: "POST",
      url: "/internal/zadarma-webhook",
      payload: notifyEnd(),
    });

    const [, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(params[5]).toBe(true);
    expect(params[6]).toBe(500);
  });

  it("does NOT require x-internal-key (public endpoint)", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/zadarma-webhook",
      payload: notifyEnd(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });
});
