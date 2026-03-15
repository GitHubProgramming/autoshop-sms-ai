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
