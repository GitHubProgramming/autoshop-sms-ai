import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";

// ── DB mock ─────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: (...args: unknown[]) => mockQuery(...args),
}));

// ── Calendar mock ───────────────────────────────────────────────────────────

vi.mock("../services/google-calendar", () => ({
  deleteCalendarEvent: vi.fn(async () => ({ success: true, error: null })),
}));

// ── Tenant timezone mock ────────────────────────────────────────────────────

vi.mock("../db/tenants", () => ({
  getTenantTimezone: vi.fn(async () => "America/Chicago"),
}));

import { tenantKpiRoute } from "../routes/tenant/kpi";

// ── Helpers ─────────────────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: "test-secret" });
  await app.register(tenantKpiRoute, { prefix: "/tenant" });
  return app;
}

function makeToken(app: ReturnType<typeof Fastify>, tenantId = "t-001") {
  return app.jwt.sign({
    tenantId,
    email: "owner@shop.com",
    locale: "en-US",
    currency: "USD",
    timezone: "America/Chicago",
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("PATCH /tenant/appointments/:id/confirm", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it("confirms a pending appointment", async () => {
    mockQuery.mockResolvedValueOnce([{ id: "appt-1", booking_state: "CONFIRMED_MANUAL" }]);

    const res = await app.inject({
      method: "PATCH",
      url: "/tenant/appointments/appt-1/confirm",
      headers: { authorization: `Bearer ${makeToken(app)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe("appt-1");
    expect(body.status).toBe("confirmed");
  });

  it("returns 404 for already confirmed appointment", async () => {
    mockQuery.mockResolvedValueOnce([]);

    const res = await app.inject({
      method: "PATCH",
      url: "/tenant/appointments/appt-2/confirm",
      headers: { authorization: `Bearer ${makeToken(app)}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for cancelled appointment", async () => {
    mockQuery.mockResolvedValueOnce([]);

    const res = await app.inject({
      method: "PATCH",
      url: "/tenant/appointments/appt-3/confirm",
      headers: { authorization: `Bearer ${makeToken(app)}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("requires authentication", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/tenant/appointments/appt-1/confirm",
    });

    expect(res.statusCode).toBe(401);
  });

  // USA regression: confirm endpoint works for USA tenants too
  it("USA regression — confirm endpoint works for USA tenant", async () => {
    mockQuery.mockResolvedValueOnce([{ id: "usa-appt-1", booking_state: "CONFIRMED_MANUAL" }]);

    const token = app.jwt.sign({
      tenantId: "usa-tenant-001",
      email: "usa@shop.com",
      locale: "en-US",
      currency: "USD",
      timezone: "America/Chicago",
    });

    const res = await app.inject({
      method: "PATCH",
      url: "/tenant/appointments/usa-appt-1/confirm",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("confirmed");
  });
});
