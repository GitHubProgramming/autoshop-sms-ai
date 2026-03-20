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

import { passwordResetRoute } from "../routes/auth/password-reset";

// ── Constants ─────────────────────────────────────────────────────────────────

const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const TEST_EMAIL = "shop@example.com";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildApp() {
  const app = Fastify({ logger: false });
  app.register(passwordResetRoute, { prefix: "/auth" });
  return app;
}

function postForgot(
  app: ReturnType<typeof Fastify>,
  body: object
) {
  return app.inject({
    method: "POST",
    url: "/auth/forgot-password",
    headers: { "content-type": "application/json" },
    payload: body,
  });
}

function postReset(
  app: ReturnType<typeof Fastify>,
  body: object
) {
  return app.inject({
    method: "POST",
    url: "/auth/reset-password",
    headers: { "content-type": "application/json" },
    payload: body,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /auth/forgot-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for invalid email", async () => {
    const app = buildApp();
    const res = await postForgot(app, { email: "not-an-email" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 200 with neutral message when account exists", async () => {
    // First call: tenant lookup returns a result
    mocks.query
      .mockResolvedValueOnce([{ id: TENANT_ID }]) // SELECT tenant
      .mockResolvedValueOnce([])  // UPDATE invalidate old tokens
      .mockResolvedValueOnce([]); // INSERT new token
    const app = buildApp();
    const res = await postForgot(app, { email: TEST_EMAIL });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.message).toContain("If an account exists");
  });

  it("returns 200 with same neutral message when account does NOT exist (no enumeration)", async () => {
    mocks.query.mockResolvedValueOnce([]); // tenant not found
    const app = buildApp();
    const res = await postForgot(app, { email: "nobody@example.com" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.message).toContain("If an account exists");
  });

  it("invalidates old tokens before creating a new one", async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: TENANT_ID }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const app = buildApp();
    await postForgot(app, { email: TEST_EMAIL });
    // Second query should be the UPDATE to invalidate old tokens
    expect(mocks.query).toHaveBeenCalledTimes(3);
    const invalidateCall = mocks.query.mock.calls[1];
    expect(invalidateCall[0]).toContain("UPDATE password_reset_tokens");
    expect(invalidateCall[1]).toEqual([TENANT_ID]);
  });

  it("stores hashed token (not plaintext)", async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: TENANT_ID }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const app = buildApp();
    await postForgot(app, { email: TEST_EMAIL });
    // Third query should be the INSERT with token_hash
    const insertCall = mocks.query.mock.calls[2];
    expect(insertCall[0]).toContain("INSERT INTO password_reset_tokens");
    // token_hash should be 64 hex chars (SHA-256)
    const tokenHash = insertCall[1]?.[1] as string;
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("normalizes email to lowercase", async () => {
    mocks.query.mockResolvedValueOnce([]);
    const app = buildApp();
    await postForgot(app, { email: "Shop@Example.COM" });
    expect(mocks.query.mock.calls[0][1]).toEqual(["shop@example.com"]);
  });
});

describe("POST /auth/reset-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for missing token", async () => {
    const app = buildApp();
    const res = await postReset(app, { password: "newpass1234" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for short password", async () => {
    const app = buildApp();
    const res = await postReset(app, { token: "sometoken", password: "short" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid token (not found)", async () => {
    mocks.query.mockResolvedValueOnce([]); // token not found
    const app = buildApp();
    const res = await postReset(app, { token: "invalidtoken", password: "newpass1234" });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain("Invalid or expired");
  });

  it("returns 400 for already-used token", async () => {
    mocks.query.mockResolvedValueOnce([
      {
        id: "token-id",
        tenant_id: TENANT_ID,
        expires_at: new Date(Date.now() + 3600000),
        used_at: new Date(), // already used
      },
    ]);
    const app = buildApp();
    const res = await postReset(app, { token: "usedtoken", password: "newpass1234" });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain("already been used");
  });

  it("returns 400 for expired token", async () => {
    mocks.query.mockResolvedValueOnce([
      {
        id: "token-id",
        tenant_id: TENANT_ID,
        expires_at: new Date(Date.now() - 1000), // expired
        used_at: null,
      },
    ]);
    const app = buildApp();
    const res = await postReset(app, { token: "expiredtoken", password: "newpass1234" });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain("expired");
  });

  it("returns 200 and updates password for valid token", async () => {
    mocks.query
      .mockResolvedValueOnce([
        {
          id: "token-id",
          tenant_id: TENANT_ID,
          expires_at: new Date(Date.now() + 3600000),
          used_at: null,
        },
      ])
      .mockResolvedValueOnce([]) // UPDATE tenants SET password_hash
      .mockResolvedValueOnce([]); // UPDATE password_reset_tokens SET used_at
    const app = buildApp();
    const res = await postReset(app, { token: "validtoken", password: "newsecurepassword" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.message).toContain("reset successfully");
  });

  it("hashes new password with bcrypt before storing", async () => {
    mocks.query
      .mockResolvedValueOnce([
        {
          id: "token-id",
          tenant_id: TENANT_ID,
          expires_at: new Date(Date.now() + 3600000),
          used_at: null,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const app = buildApp();
    await postReset(app, { token: "validtoken", password: "newsecurepassword" });
    // bcrypt.hash should have been called
    expect(mocks.hash).toHaveBeenCalledWith("newsecurepassword", 12);
    // UPDATE tenants should use the hashed value
    const updateCall = mocks.query.mock.calls[1];
    expect(updateCall[0]).toContain("UPDATE tenants SET password_hash");
    expect(updateCall[1]?.[0]).toBe("$2a$12$hashedpassword");
  });

  it("marks token as used after successful reset", async () => {
    mocks.query
      .mockResolvedValueOnce([
        {
          id: "token-id",
          tenant_id: TENANT_ID,
          expires_at: new Date(Date.now() + 3600000),
          used_at: null,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const app = buildApp();
    await postReset(app, { token: "validtoken", password: "newsecurepassword" });
    const markUsedCall = mocks.query.mock.calls[2];
    expect(markUsedCall[0]).toContain("UPDATE password_reset_tokens SET used_at");
    expect(markUsedCall[1]).toEqual(["token-id"]);
  });
});
