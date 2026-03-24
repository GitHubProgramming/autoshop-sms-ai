import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

const mocks = vi.hoisted(() => ({
  query: vi.fn().mockResolvedValue([]),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

vi.mock("../middleware/require-auth", () => ({
  requireAuth: (req: any, _reply: any, done: any) => {
    req.user = { tenantId: TENANT_ID, email: "test@test.com" };
    done();
  },
}));

import { tenantKpiRoute } from "../routes/tenant/kpi";

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

function buildApp() {
  const app = Fastify({ logger: false });
  app.register(tenantKpiRoute, { prefix: "/tenant" });
  return app;
}

// ── GET /tenant/kpi/recovered-revenue ────────────────────────────────────────

describe("GET /tenant/kpi/recovered-revenue", () => {
  it("returns 0 when no appointments exist", async () => {
    mocks.query
      .mockResolvedValueOnce([{ total: "0", count: "0" }])
      .mockResolvedValueOnce([{ total: "0" }]);

    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/tenant/kpi/recovered-revenue" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.recovered_revenue).toBe(0);
    expect(body.booking_count).toBe(0);
    expect(body.change_pct).toBe(0);
  });

  it("returns real revenue from completed AI appointments", async () => {
    mocks.query
      .mockResolvedValueOnce([{ total: "1250.50", count: "3" }])
      .mockResolvedValueOnce([{ total: "800.00" }]);

    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/tenant/kpi/recovered-revenue" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.recovered_revenue).toBe(1250.50);
    expect(body.booking_count).toBe(3);
    expect(body.previous_period).toBe(800);
    expect(body.change_pct).toBe(56.3); // (1250.50 - 800) / 800 * 100
  });

  it("queries appointments table with conversation_id filter", async () => {
    mocks.query
      .mockResolvedValueOnce([{ total: "0", count: "0" }])
      .mockResolvedValueOnce([{ total: "0" }]);

    const app = buildApp();
    await app.inject({ method: "GET", url: "/tenant/kpi/recovered-revenue" });

    const firstCall = mocks.query.mock.calls[0];
    expect(firstCall[1]).toEqual([TENANT_ID]);
    expect(firstCall[0]).toContain("appointments");
    expect(firstCall[0]).toContain("completed_at IS NOT NULL");
    expect(firstCall[0]).toContain("conversation_id IS NOT NULL");
    expect(firstCall[0]).toContain("30 days");
  });
});

// ── GET /tenant/kpi/total-revenue ────────────────────────────────────────────

describe("GET /tenant/kpi/total-revenue", () => {
  it("returns 0 when no appointments exist", async () => {
    mocks.query
      .mockResolvedValueOnce([{ total: "0", count: "0" }])
      .mockResolvedValueOnce([{ total: "0" }]);

    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/tenant/kpi/total-revenue" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total_revenue).toBe(0);
    expect(body.booking_count).toBe(0);
  });

  it("returns real total revenue including all sources", async () => {
    mocks.query
      .mockResolvedValueOnce([{ total: "5400.00", count: "10" }])
      .mockResolvedValueOnce([{ total: "3000.00" }]);

    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/tenant/kpi/total-revenue" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total_revenue).toBe(5400);
    expect(body.booking_count).toBe(10);
    expect(body.change_pct).toBe(80); // (5400 - 3000) / 3000 * 100
  });
});

// ── GET /tenant/kpi/summary ──────────────────────────────────────────────────

describe("GET /tenant/kpi/summary", () => {
  it("returns all zeros when no data exists", async () => {
    // 7 parallel queries
    for (let i = 0; i < 7; i++) {
      mocks.query.mockResolvedValueOnce([{ total: "0", count: "0" }]);
    }

    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/tenant/kpi/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.recovered_revenue).toBe(0);
    expect(body.total_revenue).toBe(0);
    expect(body.ai_booked_this_month).toBe(0);
    expect(body.appointments_today).toBe(0);
    expect(body.active_conversations).toBe(0);
    expect(body.conversations_this_month).toBe(0);
    expect(body.booking_rate_pct).toBe(0);
  });

  it("returns real computed values", async () => {
    mocks.query
      .mockResolvedValueOnce([{ total: "2700.00", count: "5" }])  // recovered rev
      .mockResolvedValueOnce([{ total: "4500.00" }])               // total rev
      .mockResolvedValueOnce([{ count: "8" }])                     // ai booked this month
      .mockResolvedValueOnce([{ count: "2" }])                     // appts today
      .mockResolvedValueOnce([{ count: "3" }])                     // active convs
      .mockResolvedValueOnce([{ count: "20" }])                    // convs this month
      .mockResolvedValueOnce([{ count: "15" }]);                   // booked convs

    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/tenant/kpi/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.recovered_revenue).toBe(2700);
    expect(body.total_revenue).toBe(4500);
    expect(body.ai_booked_this_month).toBe(8);
    expect(body.appointments_today).toBe(2);
    expect(body.active_conversations).toBe(3);
    expect(body.conversations_this_month).toBe(20);
    expect(body.conversations_booked).toBe(15);
    expect(body.booking_rate_pct).toBe(75);
  });

  it("does not contain any hardcoded demo values", async () => {
    for (let i = 0; i < 7; i++) {
      mocks.query.mockResolvedValueOnce([{ total: "0", count: "0" }]);
    }

    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/tenant/kpi/summary" });
    const body = res.json();
    const jsonStr = JSON.stringify(body);

    // Must NOT contain any known fake values
    expect(jsonStr).not.toContain("24580");
    expect(jsonStr).not.toContain("18.2");
    expect(jsonStr).not.toContain("12.5");
    expect(jsonStr).not.toContain("94.2");
    expect(jsonStr).not.toContain("5.1");
    expect(jsonStr).not.toContain("540");
    expect(jsonStr).not.toContain("127");
    expect(jsonStr).not.toContain("43");
  });

  it("queries appointments table not bookings", async () => {
    for (let i = 0; i < 7; i++) {
      mocks.query.mockResolvedValueOnce([{ total: "0", count: "0" }]);
    }

    const app = buildApp();
    await app.inject({ method: "GET", url: "/tenant/kpi/summary" });

    // First 4 queries should hit appointments, not bookings
    for (let i = 0; i < 4; i++) {
      const sql = mocks.query.mock.calls[i][0] as string;
      expect(sql).toContain("appointments");
      expect(sql).not.toContain("FROM bookings");
    }
  });
});

// ── GET /tenant/customers/list ───────────────────────────────────────────────

describe("GET /tenant/customers/list", () => {
  it("returns empty array when no customers", async () => {
    mocks.query.mockResolvedValueOnce([]);

    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/tenant/customers/list" });

    expect(res.statusCode).toBe(200);
    expect(res.json().customers).toEqual([]);
  });

  it("returns customer data derived from appointments", async () => {
    mocks.query.mockResolvedValueOnce([
      {
        id: "appt-1",
        name: "John Doe",
        phone: "+15125551234",
        email: null,
        last_visit: "2026-03-10T10:00:00Z",
        appointments_count: "3",
        total_spent: "1620.00",
        created_at: "2026-01-15T10:00:00Z",
      },
    ]);

    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/tenant/customers/list" });

    expect(res.statusCode).toBe(200);
    const cust = res.json().customers[0];
    expect(cust.name).toBe("John Doe");
    expect(cust.appointments_count).toBe(3);
    expect(cust.total_spent).toBe(1620);
    expect(cust.last_visit).toBe("2026-03-10T10:00:00Z");
  });

  it("queries appointments table grouped by phone", async () => {
    mocks.query.mockResolvedValueOnce([]);

    const app = buildApp();
    await app.inject({ method: "GET", url: "/tenant/customers/list" });

    const sql = mocks.query.mock.calls[0][0] as string;
    expect(sql).toContain("appointments");
    expect(sql).toContain("customer_phone");
    expect(sql).toContain("GROUP BY");
    expect(sql).not.toContain("FROM customers");
  });
});

// ── PATCH /tenant/appointments/:id/complete ──────────────────────────────────

describe("PATCH /tenant/appointments/:id/complete", () => {
  it("marks appointment as completed with final_price", async () => {
    mocks.query.mockResolvedValueOnce([{ id: "appt-1", final_price: 540 }]);

    const app = buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/tenant/appointments/appt-1/complete",
      payload: { final_price: 540 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("completed");
    expect(res.json().final_price).toBe(540);

    const call = mocks.query.mock.calls[0];
    expect(call[0]).toContain("UPDATE appointments");
    expect(call[0]).toContain("final_price = $1");
    expect(call[0]).toContain("COALESCE(completed_at, NOW())");
    expect(call[0]).toContain("booking_state NOT IN ('CANCELLED')");
    expect(call[1]).toEqual([540, "appt-1", TENANT_ID]);
  });

  it("rejects negative final_price", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/tenant/appointments/appt-1/complete",
      payload: { final_price: -100 },
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects NaN final_price", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/tenant/appointments/appt-1/complete",
      payload: { final_price: "not-a-number" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects Infinity final_price", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/tenant/appointments/appt-1/complete",
      payload: { final_price: Infinity },
    });

    // JSON.stringify(Infinity) → null, so typeof !== "number"
    expect(res.statusCode).toBe(400);
  });

  it("rounds price to 2 decimal places", async () => {
    mocks.query.mockResolvedValueOnce([{ id: "appt-1", final_price: 100 }]);

    const app = buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/tenant/appointments/appt-1/complete",
      payload: { final_price: 99.999 },
    });

    expect(res.statusCode).toBe(200);
    const call = mocks.query.mock.calls[0];
    expect(call[1][0]).toBe(100);
  });

  it("returns 404 for cancelled appointment", async () => {
    mocks.query.mockResolvedValueOnce([]);

    const app = buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/tenant/appointments/appt-cancelled/complete",
      payload: { final_price: 200 },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for non-existent appointment", async () => {
    mocks.query.mockResolvedValueOnce([]);

    const app = buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/tenant/appointments/nonexistent/complete",
      payload: { final_price: 100 },
    });

    expect(res.statusCode).toBe(404);
  });
});
