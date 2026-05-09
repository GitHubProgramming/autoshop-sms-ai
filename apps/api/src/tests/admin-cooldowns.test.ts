import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

import { adminCooldownsRoute } from "../routes/internal/admin-cooldowns";

const TENANT_ID = "7d82ab25-e991-4d13-b4ac-846865f8b85a";
const PHONE = "+37067577829";

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(adminCooldownsRoute, { prefix: "/internal" });
  return app;
}

describe("POST /internal/admin/cooldowns/clear", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INTERNAL_API_KEY = "test-internal-key";
  });

  afterEach(() => {
    delete process.env.INTERNAL_API_KEY;
  });

  it("clears cooldown row and returns deleted count", async () => {
    mocks.query.mockResolvedValueOnce([{ id: TENANT_ID }]); // DELETE returns 1 row

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/admin/cooldowns/clear",
      headers: { "x-internal-key": "test-internal-key" },
      payload: { tenantId: TENANT_ID, customerPhone: PHONE },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, deleted: 1 });

    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("DELETE FROM conversation_cooldowns");
    expect(sql).toContain("RETURNING");
    expect(params).toEqual([TENANT_ID, PHONE]);
  });

  it("returns deleted:0 when no cooldown row exists (not an error)", async () => {
    mocks.query.mockResolvedValueOnce([]);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/admin/cooldowns/clear",
      headers: { "x-internal-key": "test-internal-key" },
      payload: { tenantId: TENANT_ID, customerPhone: PHONE },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, deleted: 0 });
  });

  it("with closeOpen=true also closes any open conversation rows", async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: TENANT_ID }]) // cooldown DELETE
      .mockResolvedValueOnce([{ id: "conv-1" }, { id: "conv-2" }]); // conversations UPDATE

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/admin/cooldowns/clear",
      headers: { "x-internal-key": "test-internal-key" },
      payload: { tenantId: TENANT_ID, customerPhone: PHONE, closeOpen: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, deleted: 1, closed: 2 });

    expect(mocks.query).toHaveBeenCalledTimes(2);
    const [sql2, params2] = mocks.query.mock.calls[1] as [string, unknown[]];
    expect(sql2).toContain("UPDATE conversations");
    expect(sql2).toContain("status = 'closed'");
    expect(sql2).toContain("close_reason = 'admin_cleared'");
    expect(sql2).toContain("WHERE tenant_id");
    expect(sql2).toContain("status = 'open'");
    expect(params2).toEqual([TENANT_ID, PHONE]);
  });

  it("returns 400 on missing tenantId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/admin/cooldowns/clear",
      headers: { "x-internal-key": "test-internal-key" },
      payload: { customerPhone: PHONE },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Validation failed");
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid E.164 phone", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/admin/cooldowns/clear",
      headers: { "x-internal-key": "test-internal-key" },
      payload: { tenantId: TENANT_ID, customerPhone: "not-a-phone" },
    });

    expect(res.statusCode).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("rejects 403 without x-internal-key", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/admin/cooldowns/clear",
      payload: { tenantId: TENANT_ID, customerPhone: PHONE },
    });

    expect(res.statusCode).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
