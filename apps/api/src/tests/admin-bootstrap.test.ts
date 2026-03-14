import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  query: vi.fn().mockResolvedValue([]),
  compare: vi.fn().mockResolvedValue(true),
  hash: vi.fn().mockResolvedValue("$2a$12$hashedpassword"),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

vi.mock("bcryptjs", () => ({
  compare: mocks.compare,
  hash: mocks.hash,
}));

import { adminBootstrapRoute } from "../routes/auth/admin-bootstrap";

// ── Constants ─────────────────────────────────────────────────────────────────

const INTERNAL_KEY = "test-internal-key-12345";
const ADMIN_EMAIL = "admin@autoshop.test";
const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildApp() {
  const app = Fastify({ logger: false });
  app.register(adminBootstrapRoute, { prefix: "/auth" });
  return app;
}

function post(app: ReturnType<typeof Fastify>, body: object, headers: Record<string, string> = {}) {
  return app.inject({
    method: "POST",
    url: "/auth/admin-bootstrap",
    headers: { "content-type": "application/json", ...headers },
    payload: body,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /auth/admin-bootstrap", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.hash.mockResolvedValue("$2a$12$hashedpassword");
    process.env.INTERNAL_API_KEY = INTERNAL_KEY;
    process.env.ADMIN_EMAILS = ADMIN_EMAIL;
  });

  it("rejects request when INTERNAL_API_KEY is not configured", async () => {
    delete process.env.INTERNAL_API_KEY;
    const app = buildApp();
    const res = await post(app, { email: ADMIN_EMAIL, password: "securepass1" });
    expect(res.statusCode).toBe(503);
  });

  it("rejects request with missing internal key", async () => {
    const app = buildApp();
    const res = await post(app, { email: ADMIN_EMAIL, password: "securepass1" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects request with wrong internal key", async () => {
    const app = buildApp();
    const res = await post(
      app,
      { email: ADMIN_EMAIL, password: "securepass1" },
      { "x-internal-key": "wrong-key" },
    );
    expect(res.statusCode).toBe(401);
  });

  it("rejects invalid body (missing password)", async () => {
    const app = buildApp();
    const res = await post(
      app,
      { email: ADMIN_EMAIL },
      { "x-internal-key": INTERNAL_KEY },
    );
    expect(res.statusCode).toBe(400);
  });

  it("rejects password shorter than 8 chars", async () => {
    const app = buildApp();
    const res = await post(
      app,
      { email: ADMIN_EMAIL, password: "short" },
      { "x-internal-key": INTERNAL_KEY },
    );
    expect(res.statusCode).toBe(400);
  });

  it("rejects email not in ADMIN_EMAILS", async () => {
    const app = buildApp();
    const res = await post(
      app,
      { email: "notadmin@example.com", password: "securepass1" },
      { "x-internal-key": INTERNAL_KEY },
    );
    expect(res.statusCode).toBe(403);
  });

  it("rejects when ADMIN_EMAILS is not set", async () => {
    delete process.env.ADMIN_EMAILS;
    const app = buildApp();
    const res = await post(
      app,
      { email: ADMIN_EMAIL, password: "securepass1" },
      { "x-internal-key": INTERNAL_KEY },
    );
    expect(res.statusCode).toBe(503);
  });

  it("sets password_hash on existing tenant with no password", async () => {
    mocks.query.mockResolvedValueOnce([
      { id: TENANT_ID, shop_name: "Test Shop", password_hash: null },
    ]);
    mocks.query.mockResolvedValueOnce([]); // UPDATE result

    const app = buildApp();
    const res = await post(
      app,
      { email: ADMIN_EMAIL, password: "securepass1" },
      { "x-internal-key": INTERNAL_KEY },
    );

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.action).toBe("password_set");
    expect(body.tenantId).toBe(TENANT_ID);

    // Verify UPDATE was called with the hash
    expect(mocks.query).toHaveBeenCalledWith(
      "UPDATE tenants SET password_hash = $1 WHERE id = $2",
      ["$2a$12$hashedpassword", TENANT_ID],
    );
  });

  it("returns 409 if tenant already has a password", async () => {
    mocks.query.mockResolvedValueOnce([
      { id: TENANT_ID, shop_name: "Test Shop", password_hash: "$2a$12$existing" },
    ]);

    const app = buildApp();
    const res = await post(
      app,
      { email: ADMIN_EMAIL, password: "securepass1" },
      { "x-internal-key": INTERNAL_KEY },
    );

    expect(res.statusCode).toBe(409);
  });

  it("creates new tenant when none exists", async () => {
    mocks.query.mockResolvedValueOnce([]); // No existing tenant
    mocks.query.mockResolvedValueOnce([{ id: TENANT_ID }]); // INSERT result

    const app = buildApp();
    const res = await post(
      app,
      { email: ADMIN_EMAIL, password: "securepass1" },
      { "x-internal-key": INTERNAL_KEY },
    );

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.action).toBe("tenant_created");
    expect(body.tenantId).toBe(TENANT_ID);
  });

  it("accepts internal key via Authorization Bearer header", async () => {
    mocks.query.mockResolvedValueOnce([
      { id: TENANT_ID, shop_name: "Test Shop", password_hash: null },
    ]);
    mocks.query.mockResolvedValueOnce([]);

    const app = buildApp();
    const res = await post(
      app,
      { email: ADMIN_EMAIL, password: "securepass1" },
      { authorization: `Bearer ${INTERNAL_KEY}` },
    );

    expect(res.statusCode).toBe(200);
  });
});
