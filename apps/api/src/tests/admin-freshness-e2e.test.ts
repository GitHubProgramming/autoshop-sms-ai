/**
 * End-to-end freshness proof for admin API.
 *
 * Simulates the real stale-data scenario:
 *   1. Fetch admin overview → get value A
 *   2. Change underlying data
 *   3. Fetch admin overview again → must get value B (not A)
 *   4. Change again
 *   5. Fetch again → must get value C (not B)
 *
 * Also verifies that every response carries no-cache headers,
 * proving the browser/CDN cannot serve stale content.
 */
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

// ── Constants ─────────────────────────────────────────────────────────────────

const JWT_SECRET = "test-secret-freshness";
const ADMIN_EMAIL = "admin@autoshop.test";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: JWT_SECRET });
  await app.register(adminRoute, { prefix: "/internal" });
  return app;
}

/** Build a mock result set that returns `count` as the active_tenants value */
function mockOverviewWithCount(count: number) {
  // The overview endpoint runs ~15 concurrent queries via Promise.all.
  // We control what the first query returns (status counts).
  let callIndex = 0;
  mocks.query.mockImplementation(async (sql: string) => {
    callIndex++;
    // The first query is: SELECT billing_status, COUNT(*)... GROUP BY billing_status
    if (sql.includes("billing_status") && sql.includes("GROUP BY")) {
      return [
        { billing_status: "active", count },
        { billing_status: "trial", count: 0 },
      ];
    }
    // All other queries return empty
    return [];
  });
}

function assertNoCacheHeaders(headers: Record<string, string | number | string[] | undefined>) {
  expect(headers["cache-control"]).toContain("no-store");
  expect(headers["cache-control"]).toContain("no-cache");
  expect(headers["cache-control"]).toContain("must-revalidate");
  expect(headers["pragma"]).toBe("no-cache");
  expect(headers["expires"]).toBe("0");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Admin freshness end-to-end proof", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...ORIGINAL_ENV, ADMIN_EMAILS: ADMIN_EMAIL };
  });

  it("returns fresh data on every request — never stale", async () => {
    const app = await buildApp();
    const token = app.jwt.sign({ email: ADMIN_EMAIL, tenantId: "t1" });

    // ── Round 1: Database says 5 active tenants ─────────────────
    mockOverviewWithCount(5);

    const res1 = await app.inject({
      method: "GET",
      url: "/internal/admin/overview",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res1.statusCode).toBe(200);
    assertNoCacheHeaders(res1.headers);
    const body1 = JSON.parse(res1.body);
    expect(body1.status_counts.active).toBe(5);

    // ── Round 2: Database changes to 12 active tenants ──────────
    mockOverviewWithCount(12);

    const res2 = await app.inject({
      method: "GET",
      url: "/internal/admin/overview",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res2.statusCode).toBe(200);
    assertNoCacheHeaders(res2.headers);
    const body2 = JSON.parse(res2.body);
    // PROOF: value changed from 5 → 12, not stale
    expect(body2.status_counts.active).toBe(12);
    expect(body2.status_counts.active).not.toBe(5);

    // ── Round 3: Database changes again to 99 ───────────────────
    mockOverviewWithCount(99);

    const res3 = await app.inject({
      method: "GET",
      url: "/internal/admin/overview",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res3.statusCode).toBe(200);
    assertNoCacheHeaders(res3.headers);
    const body3 = JSON.parse(res3.body);
    // PROOF: value changed from 12 → 99, not stale
    expect(body3.status_counts.active).toBe(99);
    expect(body3.status_counts.active).not.toBe(12);
  });

  it("metrics endpoint also returns fresh data on each call", async () => {
    const app = await buildApp();
    const token = app.jwt.sign({ email: ADMIN_EMAIL, tenantId: "t1" });

    // Round 1: return specific metric data
    mocks.query.mockResolvedValueOnce([
      { day: new Date("2026-03-01"), count: 3 },
      { day: new Date("2026-03-02"), count: 7 },
    ]);

    const res1 = await app.inject({
      method: "GET",
      url: "/internal/admin/metrics/signups",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res1.statusCode).toBe(200);
    assertNoCacheHeaders(res1.headers);
    const body1 = JSON.parse(res1.body);
    expect(body1.data).toEqual([3, 7]);

    // Round 2: different data
    mocks.query.mockResolvedValueOnce([
      { day: new Date("2026-03-01"), count: 10 },
      { day: new Date("2026-03-02"), count: 20 },
    ]);

    const res2 = await app.inject({
      method: "GET",
      url: "/internal/admin/metrics/signups",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res2.statusCode).toBe(200);
    assertNoCacheHeaders(res2.headers);
    const body2 = JSON.parse(res2.body);
    // PROOF: data changed, not stale
    expect(body2.data).toEqual([10, 20]);
    expect(body2.data).not.toEqual([3, 7]);
  });
});
