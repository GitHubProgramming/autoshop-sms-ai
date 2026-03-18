import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

import { tenantSettingsRoute } from "../routes/tenant/settings";
import { tenantDashboardRoute } from "../routes/tenant/dashboard";

// ── Constants ────────────────────────────────────────────────────────────────

const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const EMAIL = "owner@shop.com";
const JWT_SECRET = "test-secret";

async function buildApp() {
  const app = Fastify({ logger: false });
  app.register(fastifyJwt, { secret: JWT_SECRET });
  await app.register(tenantSettingsRoute, { prefix: "/tenant" });
  await app.register(tenantDashboardRoute, { prefix: "/tenant" });
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
// PUT /tenant/settings — tenant-facing shop_name update
// ═══════════════════════════════════════════════════════════════════════════

describe("PUT /tenant/settings", () => {
  it("updates shop_name in DB and returns it", async () => {
    mocks.query.mockResolvedValueOnce([]); // UPDATE result

    const app = await buildApp();
    const token = makeToken(app);

    const res = await app.inject({
      method: "PUT",
      url: "/tenant/settings",
      headers: { authorization: `Bearer ${token}` },
      payload: { shop_name: "Joe's Garage" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.shop_name).toBe("Joe's Garage");

    // Verify the DB UPDATE was called with correct params
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toContain("UPDATE tenants SET shop_name");
    expect(params[0]).toBe("Joe's Garage");
    expect(params[1]).toBe(TENANT_ID);
  });

  it("rejects empty shop_name", async () => {
    const app = await buildApp();
    const token = makeToken(app);

    const res = await app.inject({
      method: "PUT",
      url: "/tenant/settings",
      headers: { authorization: `Bearer ${token}` },
      payload: { shop_name: "" },
    });

    expect(res.statusCode).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("rejects missing shop_name", async () => {
    const app = await buildApp();
    const token = makeToken(app);

    const res = await app.inject({
      method: "PUT",
      url: "/tenant/settings",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects request without auth token", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "PUT",
      url: "/tenant/settings",
      payload: { shop_name: "Test Shop" },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Round-trip: PUT → GET /tenant/dashboard returns updated shop_name
// ═══════════════════════════════════════════════════════════════════════════

describe("tenant name persistence round-trip", () => {
  it("dashboard returns the shop_name that was saved via PUT", async () => {
    const NEW_NAME = "Mike's Auto Repair";

    // PUT /tenant/settings — mock the UPDATE
    mocks.query.mockResolvedValueOnce([]);

    const app = await buildApp();
    const token = makeToken(app);

    const putRes = await app.inject({
      method: "PUT",
      url: "/tenant/settings",
      headers: { authorization: `Bearer ${token}` },
      payload: { shop_name: NEW_NAME },
    });
    expect(putRes.statusCode).toBe(200);

    // GET /tenant/dashboard — mock DB to return the updated name
    // The dashboard runs 12 queries in Promise.all
    mocks.query
      // 1. tenant identity
      .mockResolvedValueOnce([{
        id: TENANT_ID,
        shop_name: NEW_NAME, // ← DB returns the name we saved
        owner_email: EMAIL,
        billing_status: "trial",
        plan_id: null,
        conv_used_this_cycle: 0,
        conv_limit_this_cycle: 50,
        trial_started_at: new Date().toISOString(),
        trial_ends_at: new Date(Date.now() + 14 * 86400000).toISOString(),
        warned_80pct: false,
        warned_100pct: false,
        created_at: new Date().toISOString(),
      }])
      // 2. google calendar integration
      .mockResolvedValueOnce([])
      // 3. twilio phone
      .mockResolvedValueOnce([])
      // 4. conversations today
      .mockResolvedValueOnce([{ count: 0 }])
      // 5. appointments today
      .mockResolvedValueOnce([{ count: 0 }])
      // 6. active conversations
      .mockResolvedValueOnce([{ count: 0 }])
      // 7. conversations this month
      .mockResolvedValueOnce([{ count: 0 }])
      // 8. appointments this month
      .mockResolvedValueOnce([{ count: 0 }])
      // 9. total conversations
      .mockResolvedValueOnce([{ count: 0 }])
      // 10. total appointments
      .mockResolvedValueOnce([{ count: 0 }])
      // 11. recent conversations
      .mockResolvedValueOnce([])
      // 12. recent bookings
      .mockResolvedValueOnce([]);

    const getRes = await app.inject({
      method: "GET",
      url: "/tenant/dashboard",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(getRes.statusCode).toBe(200);
    const dashboard = JSON.parse(getRes.payload);
    expect(dashboard.tenant.shop_name).toBe(NEW_NAME);
  });
});
