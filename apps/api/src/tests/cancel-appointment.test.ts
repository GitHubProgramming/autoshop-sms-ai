import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  deleteCalendarEvent: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

vi.mock("../services/google-calendar", () => ({
  deleteCalendarEvent: mocks.deleteCalendarEvent,
}));

// Must also mock ai-settings since kpi.ts is in the same route file
// and other routes in the file may reference it indirectly
vi.mock("../services/missed-call-sms", () => ({
  sendTwilioSms: vi.fn().mockResolvedValue({ error: null, sid: "SM123", numSegments: 1 }),
}));

import { tenantKpiRoute } from "../routes/tenant/kpi";

// ── Constants ────────────────────────────────────────────────────────────────

const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const EMAIL = "owner@shop.com";
const JWT_SECRET = "test-secret";
const APPT_ID = "d4e5f6a7-b8c9-0123-defa-234567890123";
const GOOGLE_EVENT_ID = "gcal_event_abc123";

async function buildApp() {
  const app = Fastify({ logger: false });
  app.register(fastifyJwt, { secret: JWT_SECRET });
  await app.register(tenantKpiRoute, { prefix: "/tenant" });
  return app;
}

function makeToken(app: ReturnType<typeof Fastify>) {
  return (app as any).jwt.sign({ tenantId: TENANT_ID, email: EMAIL });
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /tenant/appointments/:id/cancel
// ═══════════════════════════════════════════════════════════════════════════

describe("PATCH /tenant/appointments/:id/cancel", () => {
  it("cancels appointment without calendar event", async () => {
    // DB update returns the cancelled row with no google_event_id
    mocks.query.mockResolvedValueOnce([{ id: APPT_ID, google_event_id: null }]);

    const app = await buildApp();
    const token = makeToken(app);

    const res = await app.inject({
      method: "PATCH",
      url: `/tenant/appointments/${APPT_ID}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe("cancelled");
    expect(body.calendar_event_deleted).toBe(false);
    expect(body.calendar_error).toBe(null);

    // deleteCalendarEvent should NOT have been called
    expect(mocks.deleteCalendarEvent).not.toHaveBeenCalled();
  });

  it("cancels appointment and deletes Google Calendar event", async () => {
    // DB update returns the cancelled row WITH google_event_id
    mocks.query.mockResolvedValueOnce([{ id: APPT_ID, google_event_id: GOOGLE_EVENT_ID }]);
    // Calendar deletion succeeds
    mocks.deleteCalendarEvent.mockResolvedValueOnce({ success: true, error: null });

    const app = await buildApp();
    const token = makeToken(app);

    const res = await app.inject({
      method: "PATCH",
      url: `/tenant/appointments/${APPT_ID}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe("cancelled");
    expect(body.calendar_event_deleted).toBe(true);
    expect(body.calendar_error).toBe(null);

    // deleteCalendarEvent should have been called with correct args
    expect(mocks.deleteCalendarEvent).toHaveBeenCalledWith(
      TENANT_ID,
      APPT_ID,
      GOOGLE_EVENT_ID
    );
  });

  it("cancels appointment but surfaces calendar deletion failure", async () => {
    // DB update returns the cancelled row WITH google_event_id
    mocks.query.mockResolvedValueOnce([{ id: APPT_ID, google_event_id: GOOGLE_EVENT_ID }]);
    // Calendar deletion fails
    mocks.deleteCalendarEvent.mockResolvedValueOnce({
      success: false,
      error: "Google Calendar API error 403: insufficient permissions",
    });

    const app = await buildApp();
    const token = makeToken(app);

    const res = await app.inject({
      method: "PATCH",
      url: `/tenant/appointments/${APPT_ID}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    });

    // Cancellation itself succeeds (DB state changed)
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe("cancelled");
    expect(body.calendar_event_deleted).toBe(false);
    expect(body.calendar_error).toContain("403");
  });

  it("returns 404 for already cancelled appointment", async () => {
    // DB update returns empty (no matching rows — already cancelled)
    mocks.query.mockResolvedValueOnce([]);

    const app = await buildApp();
    const token = makeToken(app);

    const res = await app.inject({
      method: "PATCH",
      url: `/tenant/appointments/${APPT_ID}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.payload);
    expect(body.error).toContain("already");
  });

  it("returns 401 without auth token", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: `/tenant/appointments/${APPT_ID}/cancel`,
    });

    expect(res.statusCode).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// KPI exclusion of cancelled appointments
// ═══════════════════════════════════════════════════════════════════════════

describe("KPI summary excludes cancelled appointments", () => {
  it("ai_booked_this_month and appointments_today exclude CANCELLED", async () => {
    const app = await buildApp();
    const token = makeToken(app);

    // Mock the 8 queries in kpi/summary Promise.all
    mocks.query
      .mockResolvedValueOnce([{ total: "0", count: "0" }]) // recovered revenue
      .mockResolvedValueOnce([{ total: "0", count: "0" }]) // total revenue
      .mockResolvedValueOnce([{ count: "3" }]) // ai_booked_this_month
      .mockResolvedValueOnce([{ count: "2" }]) // appointments_today
      .mockResolvedValueOnce([{ count: "1" }]) // active conversations
      .mockResolvedValueOnce([{ count: "5" }]) // conversations this month
      .mockResolvedValueOnce([{ count: "2" }]) // conversations booked
      .mockResolvedValueOnce([{ count: "1" }]); // pending completion

    const res = await app.inject({
      method: "GET",
      url: "/tenant/kpi/summary",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);

    // Verify the SQL for ai_booked_this_month excludes CANCELLED
    const aiBookedCall = mocks.query.mock.calls[2];
    expect(aiBookedCall[0]).toContain("CANCELLED");
    expect(aiBookedCall[0]).toContain("NOT IN");

    // Verify the SQL for appointments_today excludes CANCELLED
    const apptTodayCall = mocks.query.mock.calls[3];
    expect(apptTodayCall[0]).toContain("CANCELLED");
    expect(apptTodayCall[0]).toContain("NOT IN");

    // Values pass through correctly
    expect(body.ai_booked_this_month).toBe(3);
    expect(body.appointments_today).toBe(2);
  });
});
