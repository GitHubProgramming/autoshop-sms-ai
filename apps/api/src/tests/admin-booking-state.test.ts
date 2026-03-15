import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  query: vi.fn().mockResolvedValue([]),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

vi.mock("bcryptjs", () => ({
  compare: vi.fn().mockResolvedValue(true),
  hash: vi.fn().mockResolvedValue("$2a$12$hashed"),
}));

// Bypass adminGuard — it requires JWT verification which isn't relevant here
vi.mock("../middleware/admin-guard", () => ({
  adminGuard: async () => {},
}));

import { adminRoute } from "../routes/internal/admin";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildApp() {
  const app = Fastify({ logger: false });

  // Stub adminGuard to always pass
  app.decorate("adminGuard", async () => {});
  app.register(
    async (instance) => {
      await adminRoute(instance);
    },
    { prefix: "/internal" },
  );
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /internal/admin/bookings — booking_state visibility", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.ADMIN_EMAILS = "admin@test.com";
  });

  it("returns booking_state for each booking row", async () => {
    const fakeBookings = [
      {
        id: "b1",
        tenant_id: "t1",
        shop_name: "Shop A",
        customer_phone: "+1111",
        customer_name: "Alice",
        service_type: "Oil Change",
        scheduled_at: "2026-03-15T10:00:00Z",
        calendar_synced: true,
        google_event_id: "evt1",
        created_at: "2026-03-15T09:00:00Z",
        conversation_id: "c1",
        booking_state: "CONFIRMED_CALENDAR",
        sync_status: "synced",
      },
      {
        id: "b2",
        tenant_id: "t1",
        shop_name: "Shop A",
        customer_phone: "+2222",
        customer_name: "Bob",
        service_type: "Brake Repair",
        scheduled_at: "2026-03-15T14:00:00Z",
        calendar_synced: false,
        google_event_id: null,
        created_at: "2026-03-15T13:00:00Z",
        conversation_id: "c2",
        booking_state: "PENDING_MANUAL_CONFIRMATION",
        sync_status: "sync_failed",
      },
      {
        id: "b3",
        tenant_id: "t2",
        shop_name: "Shop B",
        customer_phone: "+3333",
        customer_name: "Carol",
        service_type: "Tire Rotation",
        scheduled_at: "2026-03-15T16:00:00Z",
        calendar_synced: false,
        google_event_id: null,
        created_at: "2026-03-15T15:00:00Z",
        conversation_id: "c3",
        booking_state: "FAILED",
        sync_status: "sync_failed",
      },
    ];
    mocks.query.mockResolvedValueOnce(fakeBookings);

    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/internal/admin/bookings",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.bookings).toHaveLength(3);

    // CONFIRMED_CALENDAR is returned
    expect(body.bookings[0].booking_state).toBe("CONFIRMED_CALENDAR");

    // PENDING_MANUAL_CONFIRMATION is returned
    expect(body.bookings[1].booking_state).toBe("PENDING_MANUAL_CONFIRMATION");

    // FAILED is returned
    expect(body.bookings[2].booking_state).toBe("FAILED");
  });
});

describe("GET /internal/admin/overview — booking_state counts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.ADMIN_EMAILS = "admin@test.com";
  });

  it("returns pending_manual_bookings and failed_bookings counts", async () => {
    // The overview endpoint runs 16 parallel queries
    // We need to mock all of them in order
    const overviewMocks = [
      [{ billing_status: "active", count: "2" }], // statusCountsRows
      [{ count: 1 }],  // newSignupsRows
      [],               // signupAttemptsByStatusRows
      [{ count: 3 }],  // convsTodayRows
      [{ count: 2 }],  // bookingsTodayRows
      [{ count: 1 }],  // failedCalendarSyncsRows
      [{ count: 0 }],  // noTwilioRows
      [{ count: 0 }],  // noCalendarRows
      [{ count: 0 }],  // nearExpiryRows
      [{ count: 0 }],  // highUsageRows
      [],               // recentSignupsRows
      [],               // needsAttentionRows
      [],               // recentBillingEventsRows
      [],               // recentConversationsRows
      [{ count: 4 }],  // pendingManualRows
      [{ count: 2 }],  // failedBookingsRows
    ];
    for (const mock of overviewMocks) {
      mocks.query.mockResolvedValueOnce(mock);
    }

    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/internal/admin/overview",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pending_manual_bookings).toBe(4);
    expect(body.failed_bookings).toBe(2);
  });
});

describe("GET /internal/admin/tenants/:id — booking_state in tenant bookings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.ADMIN_EMAILS = "admin@test.com";
  });

  it("returns booking_state in tenant detail bookings", async () => {
    const tenantId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const tenantDetailMocks = [
      [{ id: tenantId, shop_name: "Test Shop" }], // tenantRows
      [],  // usersRows
      [],  // phoneRows
      [],  // calendarRows
      [],  // conversationRows
      [    // bookingRows
        {
          id: "b1",
          customer_phone: "+1111",
          customer_name: "Alice",
          service_type: "Oil Change",
          scheduled_at: "2026-03-15T10:00:00Z",
          calendar_synced: true,
          google_event_id: "evt1",
          booking_state: "CONFIRMED_CALENDAR",
          created_at: "2026-03-15T09:00:00Z",
        },
        {
          id: "b2",
          customer_phone: "+2222",
          customer_name: "Bob",
          service_type: "Brake Repair",
          scheduled_at: "2026-03-15T14:00:00Z",
          calendar_synced: false,
          google_event_id: null,
          booking_state: "PENDING_MANUAL_CONFIRMATION",
          created_at: "2026-03-15T13:00:00Z",
        },
      ],
      [],  // billingEventRows
      [],  // auditRows
      [{ conv_used_this_cycle: 5, conv_limit_this_cycle: 50, usage_pct: 10 }], // usageRows
    ];
    for (const mock of tenantDetailMocks) {
      mocks.query.mockResolvedValueOnce(mock);
    }

    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${tenantId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.bookings).toHaveLength(2);
    expect(body.bookings[0].booking_state).toBe("CONFIRMED_CALENDAR");
    expect(body.bookings[1].booking_state).toBe("PENDING_MANUAL_CONFIRMATION");
  });
});

// ── Action-needed endpoint tests ─────────────────────────────────────────────

describe("GET /internal/admin/bookings/action-needed", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.ADMIN_EMAILS = "admin@test.com";
  });

  it("returns only PENDING_MANUAL_CONFIRMATION and FAILED bookings", async () => {
    const fakeBookings = [
      { id: "b1", tenant_id: "t1", shop_name: "Shop A", booking_state: "PENDING_MANUAL_CONFIRMATION" },
      { id: "b2", tenant_id: "t1", shop_name: "Shop A", booking_state: "FAILED" },
    ];
    mocks.query.mockResolvedValueOnce(fakeBookings);

    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/internal/admin/bookings/action-needed" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(2);
    expect(body.bookings[0].booking_state).toBe("PENDING_MANUAL_CONFIRMATION");
    expect(body.bookings[1].booking_state).toBe("FAILED");
  });
});

// ── State transition tests ───────────────────────────────────────────────────

describe("PATCH /internal/admin/bookings/:id/state — booking state transitions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.ADMIN_EMAILS = "admin@test.com";
  });

  it("allows PENDING_MANUAL_CONFIRMATION → CONFIRMED_MANUAL", async () => {
    // SELECT booking_state
    mocks.query.mockResolvedValueOnce([{ booking_state: "PENDING_MANUAL_CONFIRMATION" }]);
    // UPDATE
    mocks.query.mockResolvedValueOnce([]);
    // SELECT tenant_id for audit
    mocks.query.mockResolvedValueOnce([{ tenant_id: "t1" }]);
    // INSERT audit_log
    mocks.query.mockResolvedValueOnce([]);

    const app = buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/internal/admin/bookings/b1/state",
      payload: { booking_state: "CONFIRMED_MANUAL" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.previous_state).toBe("PENDING_MANUAL_CONFIRMATION");
    expect(body.booking_state).toBe("CONFIRMED_MANUAL");
  });

  it("allows FAILED → RESOLVED", async () => {
    mocks.query.mockResolvedValueOnce([{ booking_state: "FAILED" }]);
    mocks.query.mockResolvedValueOnce([]);
    mocks.query.mockResolvedValueOnce([{ tenant_id: "t1" }]);
    mocks.query.mockResolvedValueOnce([]);

    const app = buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/internal/admin/bookings/b2/state",
      payload: { booking_state: "RESOLVED" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.previous_state).toBe("FAILED");
    expect(body.booking_state).toBe("RESOLVED");
  });

  it("rejects invalid transition: CONFIRMED_CALENDAR → RESOLVED", async () => {
    mocks.query.mockResolvedValueOnce([{ booking_state: "CONFIRMED_CALENDAR" }]);

    const app = buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/internal/admin/bookings/b3/state",
      payload: { booking_state: "RESOLVED" },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe("Invalid state transition");
    expect(body.current_state).toBe("CONFIRMED_CALENDAR");
  });

  it("rejects invalid transition: PENDING_MANUAL_CONFIRMATION → RESOLVED", async () => {
    mocks.query.mockResolvedValueOnce([{ booking_state: "PENDING_MANUAL_CONFIRMATION" }]);

    const app = buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/internal/admin/bookings/b4/state",
      payload: { booking_state: "RESOLVED" },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe("Invalid state transition");
  });

  it("rejects invalid transition: FAILED → CONFIRMED_MANUAL", async () => {
    mocks.query.mockResolvedValueOnce([{ booking_state: "FAILED" }]);

    const app = buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/internal/admin/bookings/b5/state",
      payload: { booking_state: "CONFIRMED_MANUAL" },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe("Invalid state transition");
  });

  it("returns 404 for non-existent booking", async () => {
    mocks.query.mockResolvedValueOnce([]);

    const app = buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/internal/admin/bookings/nonexistent/state",
      payload: { booking_state: "CONFIRMED_MANUAL" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("rejects invalid booking_state value", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/internal/admin/bookings/b1/state",
      payload: { booking_state: "INVALID_STATE" },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ── Filter correctness after operator actions ────────────────────────────────

describe("GET /internal/admin/bookings — filter uses booking_state", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.ADMIN_EMAILS = "admin@test.com";
  });

  it("'failed' filter queries booking_state = FAILED, not calendar_synced", async () => {
    mocks.query.mockResolvedValueOnce([]);
    const app = buildApp();
    await app.inject({ method: "GET", url: "/internal/admin/bookings?filter=failed" });

    const sql = mocks.query.mock.calls[0][0] as string;
    expect(sql).toContain("booking_state = 'FAILED'");
    expect(sql).not.toMatch(/WHEN \$1 = 'failed'.*calendar_synced/);
  });

  it("'pending' filter queries booking_state = PENDING_MANUAL_CONFIRMATION", async () => {
    mocks.query.mockResolvedValueOnce([]);
    const app = buildApp();
    await app.inject({ method: "GET", url: "/internal/admin/bookings?filter=pending" });

    const sql = mocks.query.mock.calls[0][0] as string;
    expect(sql).toContain("booking_state = 'PENDING_MANUAL_CONFIRMATION'");
  });

  it("'synced' filter includes CONFIRMED_CALENDAR, CONFIRMED_MANUAL, and RESOLVED", async () => {
    mocks.query.mockResolvedValueOnce([]);
    const app = buildApp();
    await app.inject({ method: "GET", url: "/internal/admin/bookings?filter=synced" });

    const sql = mocks.query.mock.calls[0][0] as string;
    expect(sql).toContain("CONFIRMED_CALENDAR");
    expect(sql).toContain("CONFIRMED_MANUAL");
    expect(sql).toContain("RESOLVED");
  });

  it("'action_needed' filter matches only PENDING_MANUAL_CONFIRMATION and FAILED", async () => {
    mocks.query.mockResolvedValueOnce([]);
    const app = buildApp();
    await app.inject({ method: "GET", url: "/internal/admin/bookings?filter=action_needed" });

    const sql = mocks.query.mock.calls[0][0] as string;
    // Extract just the action_needed filter line from the SQL
    const actionNeededLine = sql.split("\n").find((l: string) => l.includes("action_needed"));
    expect(actionNeededLine).toBeDefined();
    expect(actionNeededLine).toContain("PENDING_MANUAL_CONFIRMATION");
    expect(actionNeededLine).toContain("FAILED");
    expect(actionNeededLine).not.toContain("CONFIRMED_MANUAL");
    expect(actionNeededLine).not.toContain("RESOLVED");
  });
});

describe("GET /internal/admin/overview — failed_calendar_syncs excludes resolved states", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.ADMIN_EMAILS = "admin@test.com";
  });

  it("failed_calendar_syncs query excludes CONFIRMED_MANUAL and RESOLVED", async () => {
    // Mock all 16 overview queries
    const overviewMocks = [
      [{ billing_status: "active", count: "1" }],
      [{ count: 0 }], [{ count: 0 }], [{ count: 0 }], [{ count: 0 }],
      [{ count: 0 }], [{ count: 0 }], [{ count: 0 }], [{ count: 0 }],
      [{ count: 0 }], [], [], [], [],
      [{ count: 0 }], [{ count: 0 }],
    ];
    for (const mock of overviewMocks) {
      mocks.query.mockResolvedValueOnce(mock);
    }

    const app = buildApp();
    await app.inject({ method: "GET", url: "/internal/admin/overview" });

    // The failed_calendar_syncs query is the 6th query (index 5)
    const failedSyncSql = mocks.query.mock.calls[5][0] as string;
    expect(failedSyncSql).toContain("calendar_synced = false");
    expect(failedSyncSql).toContain("NOT IN ('CONFIRMED_MANUAL', 'RESOLVED')");
  });
});

describe("GET /internal/admin/bookings — sync_status respects booking_state", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.ADMIN_EMAILS = "admin@test.com";
  });

  it("sync_status SQL checks booking_state before calendar_synced", async () => {
    mocks.query.mockResolvedValueOnce([]);
    const app = buildApp();
    await app.inject({ method: "GET", url: "/internal/admin/bookings" });

    const sql = mocks.query.mock.calls[0][0] as string;
    // CONFIRMED_MANUAL and RESOLVED cases should appear before the calendar_synced fallback
    expect(sql).toContain("WHEN a.booking_state = 'CONFIRMED_MANUAL' THEN 'confirmed_manual'");
    expect(sql).toContain("WHEN a.booking_state = 'RESOLVED' THEN 'resolved'");
  });
});
