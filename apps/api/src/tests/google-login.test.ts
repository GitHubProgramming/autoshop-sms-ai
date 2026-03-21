import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  query: vi.fn().mockResolvedValue([]),
  fetch: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

// Mock global fetch for Google API calls
vi.stubGlobal("fetch", mocks.fetch);

import { googleAuthRoute, oauthStateStore, authCodeStore } from "../routes/auth/google";

// ── Constants ─────────────────────────────────────────────────────────────────

const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const TEST_EMAIL = "shop@example.com";
const PUBLIC_ORIGIN = "https://autoshopsmsai.com";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildApp() {
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/auth/google/callback";
  process.env.PUBLIC_ORIGIN = PUBLIC_ORIGIN;
  process.env.JWT_SECRET = "test-jwt-secret-for-encryption";

  const app = Fastify({ logger: false });
  app.register(fastifyJwt, { secret: "test-jwt-secret" });
  app.register(googleAuthRoute, { prefix: "/auth/google" });
  return app;
}

/** Seed a valid nonce into the state store so callback tests pass state validation. */
function seedNonce(nonce: string) {
  oauthStateStore.set(nonce, { createdAt: Date.now() });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /auth/google/login/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    oauthStateStore.clear();
  });

  it("redirects to Google OAuth consent URL", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/auth/google/login/start",
    });
    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location).toContain("accounts.google.com/o/oauth2/v2/auth");
    expect(location).toContain("client_id=test-client-id");
    expect(location).toContain("scope=openid+email+profile");
    // State should start with "login:"
    expect(location).toMatch(/state=login%3A[0-9a-f]+/);
  });

  it("persists nonce in server-side state store", async () => {
    const app = buildApp();
    expect(oauthStateStore.size).toBe(0);
    await app.inject({ method: "GET", url: "/auth/google/login/start" });
    expect(oauthStateStore.size).toBe(1);
  });

  it("returns 503 when Google OAuth not configured", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const app = Fastify({ logger: false });
    app.register(fastifyJwt, { secret: "test-jwt-secret" });
    app.register(googleAuthRoute, { prefix: "/auth/google" });
    const res = await app.inject({
      method: "GET",
      url: "/auth/google/login/start",
    });
    expect(res.statusCode).toBe(503);
    // Restore for other tests
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
  });
});

describe("GET /auth/google/callback (login flow)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    oauthStateStore.clear();
    authCodeStore.clear();
  });

  it("rejects callback with invalid/missing state nonce", async () => {
    // Do NOT seed nonce — state is unknown to server
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/auth/google/callback?code=authcode123&state=login:unknown_nonce",
    });
    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location).toContain("/login?error=");
    expect(location).toContain("Invalid+session");
  });

  it("rejects callback with reused state nonce", async () => {
    seedNonce("reuse_nonce");
    // First use consumes it
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "google-token-123" }),
    });
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ email: "nobody@example.com" }),
    });
    mocks.query.mockResolvedValueOnce([]); // no tenant
    const app = buildApp();
    await app.inject({
      method: "GET",
      url: "/auth/google/callback?code=authcode&state=login:reuse_nonce",
    });

    // Second use should fail — nonce was consumed
    const res2 = await app.inject({
      method: "GET",
      url: "/auth/google/callback?code=authcode2&state=login:reuse_nonce",
    });
    expect(res2.statusCode).toBe(302);
    expect((res2.headers.location as string)).toContain("Invalid+session");
  });

  it("rejects callback with expired state nonce", async () => {
    // Seed nonce with expired timestamp (11 minutes ago)
    oauthStateStore.set("expired_nonce", { createdAt: Date.now() - 11 * 60 * 1000 });
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/auth/google/callback?code=authcode&state=login:expired_nonce",
    });
    expect(res.statusCode).toBe(302);
    expect((res.headers.location as string)).toContain("expired");
  });

  it("redirects to login with error when OAuth denied", async () => {
    seedNonce("abc123");
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/auth/google/callback?state=login:abc123&error=access_denied",
    });
    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location).toContain("/login?error=");
    expect(location).toContain("cancelled");
  });

  it("redirects to login with error when no matching account", async () => {
    seedNonce("abc123");
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "google-token-123" }),
    });
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ email: "nobody@example.com" }),
    });
    mocks.query.mockResolvedValueOnce([]);

    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/auth/google/callback?code=authcode123&state=login:abc123",
    });
    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location).toContain("/login?error=");
    expect(location).toContain("No+account+found");
  });

  it("redirects with auth code (NOT JWT) when account matches", async () => {
    seedNonce("abc123");
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "google-token-123" }),
    });
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ email: TEST_EMAIL }),
    });
    mocks.query.mockResolvedValueOnce([
      { id: TENANT_ID, shop_name: "Test Auto", owner_email: TEST_EMAIL },
    ]);

    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/auth/google/callback?code=authcode123&state=login:abc123",
    });
    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    // Must have auth code, NOT JWT
    expect(location).toContain("/login?google_code=");
    expect(location).not.toContain("google_token=");
    expect(location).not.toContain("tenantId=");
    // Auth code should be stored server-side
    expect(authCodeStore.size).toBe(1);
  });

  it("handles Google token exchange failure gracefully", async () => {
    seedNonce("abc123");
    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => "bad request",
    });

    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/auth/google/callback?code=badcode&state=login:abc123",
    });
    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location).toContain("/login?error=");
    expect(location).toContain("failed");
  });

  it("does NOT create a new account (login-only enforcement)", async () => {
    seedNonce("abc123");
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "google-token-123" }),
    });
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ email: "newuser@example.com" }),
    });
    mocks.query.mockResolvedValueOnce([]); // tenant not found

    const app = buildApp();
    await app.inject({
      method: "GET",
      url: "/auth/google/callback?code=authcode123&state=login:abc123",
    });

    // Ensure no INSERT INTO tenants was called
    for (const call of mocks.query.mock.calls) {
      expect(call[0]).not.toContain("INSERT INTO tenants");
    }
  });
});

describe("POST /auth/google/exchange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authCodeStore.clear();
  });

  it("returns JWT for valid auth code", async () => {
    const app = buildApp();
    authCodeStore.set("valid-code-123", {
      jwt: "test.jwt.token",
      tenantId: TENANT_ID,
      shopName: "Test Auto",
      email: TEST_EMAIL,
      isNewAccount: true,
      createdAt: Date.now(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/auth/google/exchange",
      headers: { "content-type": "application/json" },
      payload: { code: "valid-code-123" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toBe("test.jwt.token");
    expect(body.tenantId).toBe(TENANT_ID);
    expect(body.shopName).toBe("Test Auto");
    expect(body.email).toBe(TEST_EMAIL);
    expect(body.isNewAccount).toBe(true);
  });

  it("rejects invalid auth code", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/google/exchange",
      headers: { "content-type": "application/json" },
      payload: { code: "nonexistent-code" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("auth code is single-use (second attempt fails)", async () => {
    const app = buildApp();
    authCodeStore.set("one-time-code", {
      jwt: "test.jwt.token",
      tenantId: TENANT_ID,
      shopName: "Test Auto",
      email: TEST_EMAIL,
      isNewAccount: false,
      createdAt: Date.now(),
    });

    const res1 = await app.inject({
      method: "POST",
      url: "/auth/google/exchange",
      headers: { "content-type": "application/json" },
      payload: { code: "one-time-code" },
    });
    expect(res1.statusCode).toBe(200);

    // Second use must fail
    const res2 = await app.inject({
      method: "POST",
      url: "/auth/google/exchange",
      headers: { "content-type": "application/json" },
      payload: { code: "one-time-code" },
    });
    expect(res2.statusCode).toBe(400);
  });

  it("rejects expired auth code", async () => {
    const app = buildApp();
    authCodeStore.set("expired-code", {
      jwt: "test.jwt.token",
      tenantId: TENANT_ID,
      shopName: "Test Auto",
      email: TEST_EMAIL,
      isNewAccount: false,
      createdAt: Date.now() - 2 * 60 * 1000, // 2 minutes ago (> 1 min TTL)
    });

    const res = await app.inject({
      method: "POST",
      url: "/auth/google/exchange",
      headers: { "content-type": "application/json" },
      payload: { code: "expired-code" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for missing code in body", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/google/exchange",
      headers: { "content-type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /auth/google/callback (calendar flow — backward compatibility)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("still handles UUID state as calendar flow", async () => {
    // Mock tenant exists
    mocks.query.mockResolvedValueOnce([{ id: TENANT_ID }]);
    // Mock Google token exchange
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "calendar-token",
        refresh_token: "calendar-refresh",
        expires_in: 3600,
      }),
    });
    // Mock Google userinfo
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ email: TEST_EMAIL }),
    });
    // Mock upsert calendar tokens
    mocks.query.mockResolvedValueOnce([]);

    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=authcode&state=${TENANT_ID}`,
    });
    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location).toContain("/app/dashboard?calendar=connected");
  });
});
