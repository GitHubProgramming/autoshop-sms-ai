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

import { googleAuthRoute } from "../routes/auth/google";

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /auth/google/login/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  it("redirects to login with error when OAuth denied", async () => {
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
    // Mock Google token exchange
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "google-token-123" }),
    });
    // Mock Google userinfo
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ email: "nobody@example.com" }),
    });
    // Mock tenant lookup — not found
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

  it("issues JWT and redirects when account matches", async () => {
    // Mock Google token exchange
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "google-token-123" }),
    });
    // Mock Google userinfo
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ email: TEST_EMAIL }),
    });
    // Mock tenant lookup — found
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
    expect(location).toContain("/login?google_token=");
    expect(location).toContain("tenantId=");
    expect(location).toContain("shopName=");
  });

  it("handles Google token exchange failure gracefully", async () => {
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
