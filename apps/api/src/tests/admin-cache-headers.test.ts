import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  query: vi.fn().mockResolvedValue([]),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

vi.mock("bcryptjs", () => ({
  compare: vi.fn(),
  hash: vi.fn(),
}));

import { adminRoute } from "../routes/internal/admin";
import { configRoute } from "../routes/internal/config";

// ── Constants ─────────────────────────────────────────────────────────────────

const JWT_SECRET = "test-secret-for-cache-header-tests";
const ADMIN_EMAIL = "admin@autoshop.test";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: JWT_SECRET });
  // Register admin routes (scoped hook should apply here)
  await app.register(adminRoute, { prefix: "/internal" });
  // Register config routes (no-cache hook should NOT apply here)
  await app.register(configRoute, { prefix: "/internal" });
  return app;
}

function signJwt(app: ReturnType<typeof Fastify>) {
  return app.jwt.sign({ email: ADMIN_EMAIL, tenantId: "test-tenant" });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Admin cache-control headers", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...ORIGINAL_ENV, ADMIN_EMAILS: ADMIN_EMAIL };
  });

  it("admin API responses include Cache-Control: no-store", async () => {
    // Mock the overview query to return minimal data
    mocks.query.mockResolvedValue([]);

    const app = await buildApp();
    const token = signJwt(app);

    const res = await app.inject({
      method: "GET",
      url: "/internal/admin/overview",
      headers: { authorization: `Bearer ${token}` },
    });

    // The response should have anti-cache headers
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.headers["cache-control"]).toContain("no-cache");
    expect(res.headers["cache-control"]).toContain("must-revalidate");
    expect(res.headers["pragma"]).toBe("no-cache");
    expect(res.headers["expires"]).toBe("0");
  });

  it("admin metrics responses include Cache-Control: no-store", async () => {
    mocks.query.mockResolvedValue([]);

    const app = await buildApp();
    const token = signJwt(app);

    const res = await app.inject({
      method: "GET",
      url: "/internal/admin/metrics/signups",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.headers["pragma"]).toBe("no-cache");
  });

  it("non-admin /internal/ routes do NOT get admin cache headers", async () => {
    mocks.query.mockResolvedValue([{ key: "TWILIO_ACCOUNT_SID", value: "ACxxx" }]);

    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/internal/config/TWILIO_ACCOUNT_SID",
    });

    // Config route should NOT have the admin no-store header
    const cc = res.headers["cache-control"] || "";
    expect(cc).not.toContain("no-store");
  });
});
