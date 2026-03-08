/**
 * Admin guard and admin API access control tests.
 *
 * These test the critical auth model: JWT + ADMIN_EMAILS allowlist.
 * All tests run without a live DB — adminGuard logic is pure middleware.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import fastifyJwt from "@fastify/jwt";

// We import adminGuard after setting env vars because it reads process.env
// at call time (not module load time).
import { adminGuard } from "../middleware/admin-guard";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(fastifyJwt, {
    secret: "test_secret_minimum_32_characters_long_here",
  });

  app.get("/admin-test", { preHandler: [adminGuard] }, async (_req, reply) => {
    return reply.send({ ok: true });
  });

  await app.ready();
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin guard access control
// ─────────────────────────────────────────────────────────────────────────────

describe("adminGuard — access control", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    process.env.ADMIN_EMAILS = "admin@test.com,ops@test.com";
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    delete process.env.ADMIN_EMAILS;
  });

  it("returns 401 for unauthenticated request (no token)", async () => {
    const res = await app.inject({ method: "GET", url: "/admin-test" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 for request with invalid/malformed token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin-test",
      headers: { Authorization: "Bearer not.a.valid.jwt" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for valid JWT with non-admin email", async () => {
    const token = app.jwt.sign({ tenantId: "t1", email: "customer@test.com" });
    const res = await app.inject({
      method: "GET",
      url: "/admin-test",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toMatch(/not an admin/);
  });

  it("returns 200 for valid JWT with admin email", async () => {
    const token = app.jwt.sign({ tenantId: "t1", email: "admin@test.com" });
    const res = await app.inject({
      method: "GET",
      url: "/admin-test",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("returns 200 for second admin in the allowlist", async () => {
    const token = app.jwt.sign({ tenantId: "t2", email: "ops@test.com" });
    const res = await app.inject({
      method: "GET",
      url: "/admin-test",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("is case-insensitive for email comparison", async () => {
    const token = app.jwt.sign({ tenantId: "t1", email: "Admin@Test.COM" });
    const res = await app.inject({
      method: "GET",
      url: "/admin-test",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 503 when ADMIN_EMAILS env var is not set", async () => {
    delete process.env.ADMIN_EMAILS;
    const token = app.jwt.sign({ tenantId: "t1", email: "admin@test.com" });
    const res = await app.inject({
      method: "GET",
      url: "/admin-test",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error).toMatch(/ADMIN_EMAILS/);
  });

  it("returns 503 when ADMIN_EMAILS is set to empty string", async () => {
    process.env.ADMIN_EMAILS = "   ";
    const token = app.jwt.sign({ tenantId: "t1", email: "admin@test.com" });
    const res = await app.inject({
      method: "GET",
      url: "/admin-test",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Trial days left calculation (mirrors admin API enrichment logic)
// ─────────────────────────────────────────────────────────────────────────────

describe("Trial days left calculation", () => {
  function trialDaysLeft(billingStatus: string, trialEndsAt: Date | null): number | null {
    if (billingStatus !== "trial" || !trialEndsAt) return null;
    return Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86_400_000));
  }

  it("returns null for non-trial billing status", () => {
    expect(trialDaysLeft("active", new Date(Date.now() + 7 * 86400000))).toBeNull();
  });

  it("returns null when trial_ends_at is null", () => {
    expect(trialDaysLeft("trial", null)).toBeNull();
  });

  it("returns 0 when trial has expired", () => {
    const expired = new Date(Date.now() - 1000);
    expect(trialDaysLeft("trial", expired)).toBe(0);
  });

  it("returns correct days for 7-day remaining trial", () => {
    const sevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    expect(trialDaysLeft("trial", sevenDays)).toBe(7);
  });

  it("returns 14 for brand new trial", () => {
    const fourteenDays = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    expect(trialDaysLeft("trial", fourteenDays)).toBe(14);
  });

  it("rounds up partial days (23h remaining = 1 day left, not 0)", () => {
    const almostOneDayLeft = new Date(Date.now() + 23 * 60 * 60 * 1000);
    expect(trialDaysLeft("trial", almostOneDayLeft)).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Usage percentage calculation (mirrors admin API usage_pct logic)
// ─────────────────────────────────────────────────────────────────────────────

describe("Usage percentage calculation", () => {
  function usagePct(used: number, limit: number): number {
    if (limit <= 0) return 0;
    return Math.round((used / limit) * 100);
  }

  it("returns 0% when no conversations used", () => {
    expect(usagePct(0, 50)).toBe(0);
  });

  it("calculates 80% threshold correctly", () => {
    expect(usagePct(40, 50)).toBe(80);
  });

  it("calculates 100% when at limit", () => {
    expect(usagePct(50, 50)).toBe(100);
  });

  it("handles zero limit without division by zero", () => {
    expect(usagePct(5, 0)).toBe(0);
  });

  it("can exceed 100% (soft limit for paid plans)", () => {
    // Paid plans never hard-block, so usage can go over
    expect(usagePct(120, 100)).toBe(120);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Attention filter logic (mirrors /internal/admin/tenants?attention=1 WHERE clause)
// ─────────────────────────────────────────────────────────────────────────────

describe("Needs-attention filter logic", () => {
  interface TenantRow {
    billing_status: string;
    trial_ends_at: Date | null;
    conv_used_this_cycle: number;
    conv_limit_this_cycle: number;
  }

  function needsAttention(t: TenantRow): boolean {
    if (t.billing_status === "past_due" || t.billing_status === "past_due_blocked") return true;
    if (
      t.billing_status === "trial" &&
      t.trial_ends_at !== null &&
      t.trial_ends_at <= new Date(Date.now() + 3 * 86_400_000)
    )
      return true;
    if (
      t.conv_limit_this_cycle > 0 &&
      t.conv_used_this_cycle / t.conv_limit_this_cycle >= 0.8
    )
      return true;
    return false;
  }

  it("flags past_due accounts", () => {
    expect(needsAttention({ billing_status: "past_due", trial_ends_at: null, conv_used_this_cycle: 0, conv_limit_this_cycle: 50 })).toBe(true);
  });

  it("flags past_due_blocked accounts", () => {
    expect(needsAttention({ billing_status: "past_due_blocked", trial_ends_at: null, conv_used_this_cycle: 0, conv_limit_this_cycle: 50 })).toBe(true);
  });

  it("flags trial accounts expiring within 3 days", () => {
    const soon = new Date(Date.now() + 2 * 86_400_000); // 2 days
    expect(needsAttention({ billing_status: "trial", trial_ends_at: soon, conv_used_this_cycle: 0, conv_limit_this_cycle: 50 })).toBe(true);
  });

  it("does not flag trial accounts with > 3 days remaining", () => {
    const later = new Date(Date.now() + 10 * 86_400_000); // 10 days
    expect(needsAttention({ billing_status: "trial", trial_ends_at: later, conv_used_this_cycle: 0, conv_limit_this_cycle: 50 })).toBe(false);
  });

  it("flags high-usage accounts (>= 80%)", () => {
    expect(needsAttention({ billing_status: "active", trial_ends_at: null, conv_used_this_cycle: 40, conv_limit_this_cycle: 50 })).toBe(true);
  });

  it("does not flag healthy active accounts", () => {
    expect(needsAttention({ billing_status: "active", trial_ends_at: null, conv_used_this_cycle: 10, conv_limit_this_cycle: 50 })).toBe(false);
  });
});
