import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";

// ── Redis mock (fail-open) ──────────────────────────────────────────────────

const mockRedis = {
  get: vi.fn(async () => null),
  incr: vi.fn(async () => 1),
  expire: vi.fn(async () => 1),
  del: vi.fn(async () => 1),
};

vi.mock("../queues/redis", () => ({ redis: mockRedis }));

// ── DB mock ─────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: (...args: unknown[]) => mockQuery(...args),
}));

// ── Bcrypt mock ─────────────────────────────────────────────────────────────

const mockCompare = vi.fn();
vi.mock("bcryptjs", () => ({
  compare: (...args: unknown[]) => mockCompare(...args),
  default: { compare: (...args: unknown[]) => mockCompare(...args) },
}));

import { loginRoute } from "../routes/auth/login";

// ── Helpers ─────────────────────────────────────────────────────────────────

const USA_TENANT = {
  id: "usa-tenant-001",
  shop_name: "Texas Auto Shop",
  owner_email: "owner@texasauto.com",
  password_hash: "$2a$12$hashed",
  locale: "en-US",
  currency: "USD",
  timezone: "America/Chicago",
};

const LT_TENANT = {
  id: "7d82ab25-e991-4d13-b4ac-846865f8b85a",
  shop_name: "Proteros Servisas",
  owner_email: "mantas.gipiskis+lt@gmail.com",
  password_hash: "$2a$12$hashed",
  locale: "lt-LT",
  currency: "EUR",
  timezone: "Europe/Vilnius",
};

const NEW_TENANT_NO_LOCALE = {
  id: "new-tenant-002",
  shop_name: "New Shop",
  owner_email: "new@shop.com",
  password_hash: "$2a$12$hashed",
  // locale/currency/timezone not returned (simulates pre-migration DB)
};

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: "test-secret" });
  await app.register(loginRoute, { prefix: "/auth" });
  return app;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("POST /auth/login — locale in JWT and response", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it("USA tenant login returns locale=en-US, currency=USD", async () => {
    mockQuery.mockResolvedValueOnce([USA_TENANT]);
    mockCompare.mockResolvedValueOnce(true);

    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "owner@texasauto.com", password: "correct" },
    });

    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.locale).toBe("en-US");
    expect(body.currency).toBe("USD");
    expect(body.timezone).toBe("America/Chicago");

    // Verify JWT contains locale claims
    const decoded = app.jwt.decode(body.token) as Record<string, unknown>;
    expect(decoded.locale).toBe("en-US");
    expect(decoded.currency).toBe("USD");
    expect(decoded.timezone).toBe("America/Chicago");
  });

  it("LT tenant login returns locale=lt-LT, currency=EUR", async () => {
    mockQuery.mockResolvedValueOnce([LT_TENANT]);
    mockCompare.mockResolvedValueOnce(true);

    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "mantas.gipiskis+lt@gmail.com", password: "correct" },
    });

    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.locale).toBe("lt-LT");
    expect(body.currency).toBe("EUR");
    expect(body.timezone).toBe("Europe/Vilnius");

    // Verify JWT contains locale claims
    const decoded = app.jwt.decode(body.token) as Record<string, unknown>;
    expect(decoded.locale).toBe("lt-LT");
    expect(decoded.currency).toBe("EUR");
    expect(decoded.timezone).toBe("Europe/Vilnius");
  });

  it("new tenant with missing locale fields defaults to en-US/USD", async () => {
    mockQuery.mockResolvedValueOnce([NEW_TENANT_NO_LOCALE]);
    mockCompare.mockResolvedValueOnce(true);

    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "new@shop.com", password: "correct" },
    });

    const body = res.json();
    expect(res.statusCode).toBe(200);
    // Falls back to en-US defaults when DB columns are null/undefined
    expect(body.locale).toBe("en-US");
    expect(body.currency).toBe("USD");
    expect(body.timezone).toBe("America/Chicago");
  });

  // USA REGRESSION: existing login response shape still includes token, tenantId, shopName
  it("USA regression — login response includes original fields unchanged", async () => {
    mockQuery.mockResolvedValueOnce([USA_TENANT]);
    mockCompare.mockResolvedValueOnce(true);

    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "owner@texasauto.com", password: "correct" },
    });

    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body).toHaveProperty("token");
    expect(body).toHaveProperty("tenantId", "usa-tenant-001");
    expect(body).toHaveProperty("shopName", "Texas Auto Shop");
  });
});

describe("GET /auth/me — locale in session", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it("returns locale/currency/timezone from JWT claims for USA tenant", async () => {
    const token = app.jwt.sign({
      tenantId: "usa-001",
      email: "owner@texasauto.com",
      locale: "en-US",
      currency: "USD",
      timezone: "America/Chicago",
    });

    const res = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });

    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.user.locale).toBe("en-US");
    expect(body.user.currency).toBe("USD");
    expect(body.user.timezone).toBe("America/Chicago");
  });

  it("returns locale/currency/timezone from JWT claims for LT tenant", async () => {
    const token = app.jwt.sign({
      tenantId: "lt-001",
      email: "lt@shop.com",
      locale: "lt-LT",
      currency: "EUR",
      timezone: "Europe/Vilnius",
    });

    const res = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });

    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.user.locale).toBe("lt-LT");
    expect(body.user.currency).toBe("EUR");
    expect(body.user.timezone).toBe("Europe/Vilnius");
  });
});
