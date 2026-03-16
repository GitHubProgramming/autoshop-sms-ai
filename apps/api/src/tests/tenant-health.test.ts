import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

vi.mock("../middleware/admin-guard", () => ({
  adminGuard: async () => {},
}));

vi.mock("../services/twilio-verify", () => ({
  fetchTwilioNumberConfig: vi.fn(),
  verifyWebhookUrls: vi.fn(),
}));

vi.mock("../db/app-config", () => ({
  getConfig: async () => null,
}));

vi.mock("../services/pipeline-trace", () => ({
  getRecentTraces: vi.fn().mockResolvedValue([]),
  getTraceById: vi.fn().mockResolvedValue(null),
}));

import { adminRoute } from "../routes/internal/admin";

const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(adminRoute, { prefix: "/internal" });
  return app;
}

// Standard mock return values for the 6 parallel queries
function healthQueryMocks(overrides: Partial<{
  tenant: any[];
  convStats: any[];
  bookingStats: any[];
  pipelineStats: any[];
  lastActivity: any[];
  calendar: any[];
}> = {}) {
  const defaults = {
    tenant: [{ id: TENANT_ID, shop_name: "Test Shop" }],
    convStats: [{
      total: 10, completed: 7, still_open: 3, with_booking: 3,
      avg_turns: "4.2", avg_duration_min: "35.5",
    }],
    bookingStats: [{
      total: 5, synced: 4, action_needed: 1, confirmed_calendar: 3,
      confirmed_manual: 1, failed: 1,
    }],
    pipelineStats: [{
      total: 8, completed: 7, failed: 1,
      last_trace_at: "2026-03-15T12:00:00Z",
    }],
    lastActivity: [{
      last_conversation_at: "2026-03-15T11:00:00Z",
      last_booking_at: "2026-03-15T10:00:00Z",
      last_inbound_sms_at: "2026-03-15T10:30:00Z",
      last_outbound_sms_at: "2026-03-15T10:31:00Z",
    }],
    calendar: [{
      integration_status: "active",
      last_refreshed: "2026-03-15T12:00:00Z",
      last_error: null,
      connected_at: "2026-03-10T08:00:00Z",
      google_account_email: "shop@gmail.com",
    }],
  };

  const merged = { ...defaults, ...overrides };
  const callResults = [
    merged.tenant,
    merged.convStats,
    merged.bookingStats,
    merged.pipelineStats,
    merged.lastActivity,
    merged.calendar,
  ];

  let callIndex = 0;
  mocks.query.mockImplementation(() => Promise.resolve(callResults[callIndex++]));
}

describe("GET /internal/admin/tenants/:id/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 for non-existent tenant", async () => {
    healthQueryMocks({ tenant: [] });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/health`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Tenant not found");
  });

  it("returns full health metrics for active tenant", async () => {
    healthQueryMocks();
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/health`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.tenant_id).toBe(TENANT_ID);
    expect(body.shop_name).toBe("Test Shop");

    // Conversation metrics
    expect(body.conversations.total_30d).toBe(10);
    expect(body.conversations.completed).toBe(7);
    expect(body.conversations.still_open).toBe(3);
    expect(body.conversations.with_booking).toBe(3);
    expect(body.conversations.completion_rate_pct).toBe(70);
    expect(body.conversations.booking_rate_pct).toBe(30);
    expect(body.conversations.avg_turns).toBe(4.2);
    expect(body.conversations.avg_duration_min).toBe(35.5);

    // Booking metrics
    expect(body.bookings.total).toBe(5);
    expect(body.bookings.synced).toBe(4);
    expect(body.bookings.action_needed).toBe(1);
    expect(body.bookings.failed).toBe(1);
    expect(body.bookings.sync_rate_pct).toBe(80);

    // Pipeline metrics
    expect(body.pipeline.total_30d).toBe(8);
    expect(body.pipeline.completed).toBe(7);
    expect(body.pipeline.failed).toBe(1);
    expect(body.pipeline.success_rate_pct).toBe(88);

    // Last activity
    expect(body.last_activity.last_conversation_at).toBeTruthy();
    expect(body.last_activity.last_booking_at).toBeTruthy();
    expect(body.last_activity.last_inbound_sms_at).toBeTruthy();
    expect(body.last_activity.last_outbound_sms_at).toBeTruthy();

    // Calendar
    expect(body.calendar.status).toBe("active");
    expect(body.calendar.google_account_email).toBe("shop@gmail.com");
    expect(body.calendar.last_error).toBeNull();
  });

  it("returns null rates when no conversations exist", async () => {
    healthQueryMocks({
      convStats: [{ total: 0, completed: 0, still_open: 0, with_booking: 0, avg_turns: null, avg_duration_min: null }],
      bookingStats: [{ total: 0, synced: 0, action_needed: 0, confirmed_calendar: 0, confirmed_manual: 0, failed: 0 }],
      pipelineStats: [{ total: 0, completed: 0, failed: 0, last_trace_at: null }],
      lastActivity: [{ last_conversation_at: null, last_booking_at: null, last_inbound_sms_at: null, last_outbound_sms_at: null }],
      calendar: [],
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/health`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.conversations.total_30d).toBe(0);
    expect(body.conversations.completion_rate_pct).toBeNull();
    expect(body.conversations.booking_rate_pct).toBeNull();
    expect(body.bookings.sync_rate_pct).toBeNull();
    expect(body.pipeline.success_rate_pct).toBeNull();
    expect(body.calendar).toBeNull();
  });

  it("shows calendar errors when refresh_failed", async () => {
    healthQueryMocks({
      calendar: [{
        integration_status: "refresh_failed",
        last_refreshed: "2026-03-14T08:00:00Z",
        last_error: "Token expired and refresh failed",
        connected_at: "2026-03-10T08:00:00Z",
        google_account_email: "shop@gmail.com",
      }],
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/health`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.calendar.status).toBe("refresh_failed");
    expect(body.calendar.last_error).toBe("Token expired and refresh failed");
  });

  it("calculates correct percentage rounding", async () => {
    healthQueryMocks({
      convStats: [{ total: 3, completed: 1, still_open: 2, with_booking: 1, avg_turns: "2.0", avg_duration_min: "10.0" }],
      bookingStats: [{ total: 3, synced: 1, action_needed: 0, confirmed_calendar: 1, confirmed_manual: 0, failed: 0 }],
      pipelineStats: [{ total: 3, completed: 2, failed: 1, last_trace_at: null }],
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/health`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // 1/3 = 33.33... → rounded to 33
    expect(body.conversations.completion_rate_pct).toBe(33);
    expect(body.conversations.booking_rate_pct).toBe(33);
    expect(body.bookings.sync_rate_pct).toBe(33);
    // 2/3 = 66.66... → rounded to 67
    expect(body.pipeline.success_rate_pct).toBe(67);
  });
});
