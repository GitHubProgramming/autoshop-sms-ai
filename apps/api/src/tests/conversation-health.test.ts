import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

vi.mock("../middleware/admin-guard", () => ({
  adminGuard: async () => {
    /* no-op — tests bypass auth */
  },
}));

vi.mock("bcryptjs", () => ({
  hash: vi.fn(),
  compare: vi.fn(),
}));

import { adminRoute } from "../routes/internal/admin";

// ── Constants ────────────────────────────────────────────────────────────────

const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(adminRoute, { prefix: "/internal" });
  return app;
}

function summaryRow(overrides: Record<string, unknown> = {}) {
  return {
    total: 100,
    completed: 75,
    still_open: 25,
    avg_turns: 4.2,
    avg_duration_minutes: 35.5,
    ...overrides,
  };
}

function closeReasonRows() {
  return [
    { reason: "booking_completed", count: 40 },
    { reason: "user_closed", count: 20 },
    { reason: "inactivity_24h", count: 10 },
    { reason: "still_open", count: 25 },
    { reason: "system_blocked", count: 5 },
  ];
}

function dailyRows(days: number) {
  const rows = [];
  for (let i = days; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    rows.push({
      day: d,
      opened: 3,
      closed: 2,
      booked: 1,
    });
  }
  return rows;
}

function bookingConversionRow(overrides: Record<string, unknown> = {}) {
  return {
    conversations_with_booking: 30,
    synced_to_calendar: 25,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("GET /internal/admin/metrics/conversation-health", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 200 with full metrics for default 30-day period", async () => {
    mocks.query
      .mockResolvedValueOnce([summaryRow()])       // summary
      .mockResolvedValueOnce(closeReasonRows())    // close reasons
      .mockResolvedValueOnce(dailyRows(30))        // daily
      .mockResolvedValueOnce([bookingConversionRow()]); // booking conversion

    const res = await app.inject({
      method: "GET",
      url: "/internal/admin/metrics/conversation-health",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.period_days).toBe(30);
    expect(body.tenant_id).toBeNull();
    expect(body.summary.total_conversations).toBe(100);
    expect(body.summary.completed).toBe(75);
    expect(body.summary.still_open).toBe(25);
    expect(body.summary.completion_rate_pct).toBe(75);
    expect(body.summary.avg_turns).toBe(4.2);
    expect(body.summary.avg_duration_minutes).toBe(35.5);
    expect(body.summary.booking_rate_pct).toBe(30);
    expect(body.summary.conversations_with_booking).toBe(30);
    expect(body.summary.bookings_synced_to_calendar).toBe(25);
    expect(body.close_reason_breakdown.booking_completed).toBe(40);
    expect(body.close_reason_breakdown.user_closed).toBe(20);
    expect(body.close_reason_breakdown.inactivity_24h).toBe(10);
    expect(body.close_reason_breakdown.still_open).toBe(25);
    expect(body.daily).toHaveLength(31); // 30 days + today
  });

  it("accepts custom days parameter", async () => {
    mocks.query
      .mockResolvedValueOnce([summaryRow({ total: 10, completed: 8, still_open: 2 })])
      .mockResolvedValueOnce([{ reason: "booking_completed", count: 8 }])
      .mockResolvedValueOnce(dailyRows(7))
      .mockResolvedValueOnce([bookingConversionRow({ conversations_with_booking: 5, synced_to_calendar: 5 })]);

    const res = await app.inject({
      method: "GET",
      url: "/internal/admin/metrics/conversation-health?days=7",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.period_days).toBe(7);
    // Verify the query was called with "7" as days parameter
    expect(mocks.query).toHaveBeenCalledTimes(4);
    const firstCallArgs = mocks.query.mock.calls[0];
    expect(firstCallArgs[1][0]).toBe("7");
  });

  it("filters by tenant_id when provided", async () => {
    mocks.query
      .mockResolvedValueOnce([summaryRow({ total: 5, completed: 4, still_open: 1 })])
      .mockResolvedValueOnce([{ reason: "booking_completed", count: 4 }])
      .mockResolvedValueOnce(dailyRows(30))
      .mockResolvedValueOnce([bookingConversionRow({ conversations_with_booking: 3, synced_to_calendar: 2 })]);

    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/metrics/conversation-health?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tenant_id).toBe(TENANT_ID);
    // Verify tenant_id was passed to all queries
    for (const call of mocks.query.mock.calls) {
      expect(call[1][1]).toBe(TENANT_ID);
    }
  });

  it("handles zero conversations gracefully", async () => {
    mocks.query
      .mockResolvedValueOnce([summaryRow({
        total: 0, completed: 0, still_open: 0,
        avg_turns: null, avg_duration_minutes: null,
      })])
      .mockResolvedValueOnce([])  // no close reasons
      .mockResolvedValueOnce(dailyRows(30))
      .mockResolvedValueOnce([bookingConversionRow({
        conversations_with_booking: 0, synced_to_calendar: 0,
      })]);

    const res = await app.inject({
      method: "GET",
      url: "/internal/admin/metrics/conversation-health",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary.total_conversations).toBe(0);
    expect(body.summary.completion_rate_pct).toBe(0);
    expect(body.summary.booking_rate_pct).toBe(0);
    expect(body.summary.avg_turns).toBe(0);
    expect(body.summary.avg_duration_minutes).toBeNull();
    expect(body.close_reason_breakdown).toEqual({});
  });

  it("calculates completion_rate_pct correctly with rounding", async () => {
    // 33 completed out of 100 = 33.0%
    mocks.query
      .mockResolvedValueOnce([summaryRow({ total: 100, completed: 33, still_open: 67 })])
      .mockResolvedValueOnce(closeReasonRows())
      .mockResolvedValueOnce(dailyRows(30))
      .mockResolvedValueOnce([bookingConversionRow()]);

    const res = await app.inject({
      method: "GET",
      url: "/internal/admin/metrics/conversation-health",
    });

    const body = res.json();
    expect(body.summary.completion_rate_pct).toBe(33);
  });

  it("calculates booking_rate_pct correctly", async () => {
    // 7 bookings out of 30 conversations = 23.3%
    mocks.query
      .mockResolvedValueOnce([summaryRow({ total: 30, completed: 25, still_open: 5 })])
      .mockResolvedValueOnce(closeReasonRows())
      .mockResolvedValueOnce(dailyRows(30))
      .mockResolvedValueOnce([bookingConversionRow({
        conversations_with_booking: 7, synced_to_calendar: 5,
      })]);

    const res = await app.inject({
      method: "GET",
      url: "/internal/admin/metrics/conversation-health",
    });

    const body = res.json();
    expect(body.summary.booking_rate_pct).toBe(23.3);
    expect(body.summary.conversations_with_booking).toBe(7);
    expect(body.summary.bookings_synced_to_calendar).toBe(5);
  });

  it("clamps days to minimum 1", async () => {
    mocks.query
      .mockResolvedValueOnce([summaryRow()])
      .mockResolvedValueOnce(closeReasonRows())
      .mockResolvedValueOnce(dailyRows(1))
      .mockResolvedValueOnce([bookingConversionRow()]);

    const res = await app.inject({
      method: "GET",
      url: "/internal/admin/metrics/conversation-health?days=0",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.period_days).toBe(1);
  });

  it("clamps days to maximum 365", async () => {
    mocks.query
      .mockResolvedValueOnce([summaryRow()])
      .mockResolvedValueOnce(closeReasonRows())
      .mockResolvedValueOnce(dailyRows(365))
      .mockResolvedValueOnce([bookingConversionRow()]);

    const res = await app.inject({
      method: "GET",
      url: "/internal/admin/metrics/conversation-health?days=999",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.period_days).toBe(365);
  });

  it("handles invalid days parameter as default 30", async () => {
    mocks.query
      .mockResolvedValueOnce([summaryRow()])
      .mockResolvedValueOnce(closeReasonRows())
      .mockResolvedValueOnce(dailyRows(30))
      .mockResolvedValueOnce([bookingConversionRow()]);

    const res = await app.inject({
      method: "GET",
      url: "/internal/admin/metrics/conversation-health?days=abc",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.period_days).toBe(30);
  });

  it("returns all close_reason types in breakdown", async () => {
    const reasons = [
      { reason: "booking_completed", count: 40 },
      { reason: "user_closed", count: 20 },
      { reason: "inactivity_24h", count: 15 },
      { reason: "system_blocked", count: 5 },
      { reason: "turn_limit", count: 3 },
      { reason: "still_open", count: 17 },
    ];

    mocks.query
      .mockResolvedValueOnce([summaryRow()])
      .mockResolvedValueOnce(reasons)
      .mockResolvedValueOnce(dailyRows(30))
      .mockResolvedValueOnce([bookingConversionRow()]);

    const res = await app.inject({
      method: "GET",
      url: "/internal/admin/metrics/conversation-health",
    });

    const body = res.json();
    expect(Object.keys(body.close_reason_breakdown)).toHaveLength(6);
    expect(body.close_reason_breakdown.turn_limit).toBe(3);
    expect(body.close_reason_breakdown.system_blocked).toBe(5);
  });

  it("daily array entries have correct shape", async () => {
    const daily = [
      { day: new Date("2026-03-10"), opened: 5, closed: 3, booked: 1 },
      { day: new Date("2026-03-11"), opened: 8, closed: 6, booked: 2 },
    ];

    mocks.query
      .mockResolvedValueOnce([summaryRow()])
      .mockResolvedValueOnce(closeReasonRows())
      .mockResolvedValueOnce(daily)
      .mockResolvedValueOnce([bookingConversionRow()]);

    const res = await app.inject({
      method: "GET",
      url: "/internal/admin/metrics/conversation-health",
    });

    const body = res.json();
    expect(body.daily).toHaveLength(2);
    expect(body.daily[0]).toEqual({ day: "2026-03-10", opened: 5, closed: 3, booked: 1 });
    expect(body.daily[1]).toEqual({ day: "2026-03-11", opened: 8, closed: 6, booked: 2 });
  });

  it("handles empty summary row gracefully", async () => {
    mocks.query
      .mockResolvedValueOnce([])  // empty summary
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]); // empty conversion

    const res = await app.inject({
      method: "GET",
      url: "/internal/admin/metrics/conversation-health",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary.total_conversations).toBe(0);
    expect(body.summary.completion_rate_pct).toBe(0);
    expect(body.summary.booking_rate_pct).toBe(0);
    expect(body.daily).toEqual([]);
  });

  it("uses both days and tenant_id filters together", async () => {
    mocks.query
      .mockResolvedValueOnce([summaryRow({ total: 3, completed: 2, still_open: 1 })])
      .mockResolvedValueOnce([{ reason: "booking_completed", count: 2 }])
      .mockResolvedValueOnce(dailyRows(7))
      .mockResolvedValueOnce([bookingConversionRow({ conversations_with_booking: 1, synced_to_calendar: 1 })]);

    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/metrics/conversation-health?days=7&tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.period_days).toBe(7);
    expect(body.tenant_id).toBe(TENANT_ID);
    // All 4 queries should have days="7" and tenant_id
    for (const call of mocks.query.mock.calls) {
      expect(call[1][0]).toBe("7");
      expect(call[1][1]).toBe(TENANT_ID);
    }
  });

  it("100% completion rate when all conversations are completed", async () => {
    mocks.query
      .mockResolvedValueOnce([summaryRow({ total: 50, completed: 50, still_open: 0 })])
      .mockResolvedValueOnce([{ reason: "booking_completed", count: 50 }])
      .mockResolvedValueOnce(dailyRows(30))
      .mockResolvedValueOnce([bookingConversionRow({ conversations_with_booking: 50, synced_to_calendar: 50 })]);

    const res = await app.inject({
      method: "GET",
      url: "/internal/admin/metrics/conversation-health",
    });

    const body = res.json();
    expect(body.summary.completion_rate_pct).toBe(100);
    expect(body.summary.booking_rate_pct).toBe(100);
  });
});
