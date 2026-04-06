import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";

// ── In-memory Redis mock ─────────────────────────────────────────────────────

const redisStore: Record<string, { value: string; ttl: number }> = {};

const mockRedis = {
  get: vi.fn(async (key: string) => redisStore[key]?.value ?? null),
  incr: vi.fn(async (key: string) => {
    const current = parseInt(redisStore[key]?.value ?? "0", 10);
    const next = current + 1;
    redisStore[key] = { value: String(next), ttl: redisStore[key]?.ttl ?? 0 };
    return next;
  }),
  expire: vi.fn(async (key: string, ttl: number) => {
    if (redisStore[key]) redisStore[key].ttl = ttl;
    return 1;
  }),
  del: vi.fn(async (key: string) => {
    delete redisStore[key];
    return 1;
  }),
};

vi.mock("../queues/redis", () => ({ redis: mockRedis }));

// ── DB mock ──────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: (...args: unknown[]) => mockQuery(...args),
}));

// ── Bcrypt mock ──────────────────────────────────────────────────────────────

const mockCompare = vi.fn();
vi.mock("bcryptjs", () => ({
  compare: (...args: unknown[]) => mockCompare(...args),
  default: { compare: (...args: unknown[]) => mockCompare(...args) },
}));

import { loginRoute } from "../routes/auth/login";

// ── Helpers ──────────────────────────────────────────────────────────────────

const VALID_TENANT = {
  id: "tenant-001",
  shop_name: "Test Shop",
  owner_email: "owner@shop.com",
  password_hash: "$2a$12$hashed",
};

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: "test-secret" });
  await app.register(loginRoute, { prefix: "/auth" });
  return app;
}

function loginRequest(app: ReturnType<typeof Fastify>, email: string, password = "wrong") {
  return app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("POST /auth/login — brute force protection", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Clear Redis store
    for (const key of Object.keys(redisStore)) delete redisStore[key];
    // Default: tenant exists, password fails
    mockQuery.mockResolvedValue([VALID_TENANT]);
    mockCompare.mockResolvedValue(false);
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 429 after 5 failed attempts", async () => {
    // Fail 5 times
    for (let i = 0; i < 5; i++) {
      const res = await loginRequest(app, "owner@shop.com");
      expect(res.statusCode).toBe(401);
    }

    // 6th attempt should be rate-limited
    const res = await loginRequest(app, "owner@shop.com");
    expect(res.statusCode).toBe(429);
    expect(JSON.parse(res.body).error).toContain("Too many failed login attempts");
  });

  it("resets counter on successful login", async () => {
    // Fail 4 times
    for (let i = 0; i < 4; i++) {
      await loginRequest(app, "owner@shop.com");
    }

    // Succeed once
    mockCompare.mockResolvedValueOnce(true);
    const successRes = await loginRequest(app, "owner@shop.com", "correct");
    expect(successRes.statusCode).toBe(200);

    // Counter should be reset — next failure should be attempt 1, not 5
    mockCompare.mockResolvedValue(false);
    const res = await loginRequest(app, "owner@shop.com");
    expect(res.statusCode).toBe(401); // NOT 429
  });

  it("is case-insensitive on email", async () => {
    // Fail with different cases — all count toward the same key
    await loginRequest(app, "Owner@Shop.com");
    await loginRequest(app, "OWNER@SHOP.COM");
    await loginRequest(app, "owner@shop.com");
    await loginRequest(app, "Owner@SHOP.com");
    await loginRequest(app, "owner@Shop.COM");

    // 6th attempt in any case → 429
    const res = await loginRequest(app, "OWNER@shop.com");
    expect(res.statusCode).toBe(429);
  });
});
