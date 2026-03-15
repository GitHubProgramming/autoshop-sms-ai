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

import { adminRoute } from "../routes/internal/admin";
import { buildMissedCallSms } from "../services/missed-call-sms";

// ── Constants ────────────────────────────────────────────────────────────────

const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(adminRoute, { prefix: "/internal" });
  return app;
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// buildMissedCallSms — template support
// ═══════════════════════════════════════════════════════════════════════════

describe("buildMissedCallSms with template", () => {
  it("uses custom template when provided", () => {
    const sms = buildMissedCallSms("Joe's Auto", "Hello from {shop_name}! We missed your call.");
    expect(sms).toBe("Hello from Joe's Auto! We missed your call.");
  });

  it("replaces {shop_name} placeholder case-insensitively", () => {
    const sms = buildMissedCallSms("Joe's Auto", "Hi from {Shop_Name}!");
    expect(sms).toBe("Hi from Joe's Auto!");
  });

  it("uses default shop name when shop_name is null", () => {
    const sms = buildMissedCallSms(null, "Call from {shop_name} missed.");
    expect(sms).toBe("Call from our shop missed.");
  });

  it("falls back to default SMS when template is null", () => {
    const sms = buildMissedCallSms("Joe's Auto", null);
    expect(sms).toContain("Joe's Auto");
    expect(sms).toContain("couldn't pick up");
  });

  it("falls back to default SMS when template is empty", () => {
    const sms = buildMissedCallSms("Joe's Auto", "   ");
    expect(sms).toContain("Joe's Auto");
    expect(sms).toContain("couldn't pick up");
  });

  it("falls back to default SMS when template is undefined", () => {
    const sms = buildMissedCallSms("Joe's Auto");
    expect(sms).toContain("Joe's Auto");
    expect(sms).toContain("couldn't pick up");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /internal/admin/tenants/:id/settings
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /internal/admin/tenants/:id/settings", () => {
  it("returns tenant settings with system prompt", async () => {
    mocks.query
      .mockResolvedValueOnce([{
        shop_name: "Joe's Auto",
        missed_call_sms_template: "Hey {shop_name} missed you!",
        business_hours: "Mon-Fri 8-6",
        services_description: "Oil changes, brakes",
      }])
      .mockResolvedValueOnce([{ prompt_text: "You are Joe's assistant." }]);

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/settings`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.shop_name).toBe("Joe's Auto");
    expect(body.missed_call_sms_template).toBe("Hey {shop_name} missed you!");
    expect(body.ai_system_prompt).toBe("You are Joe's assistant.");
    expect(body.business_hours).toBe("Mon-Fri 8-6");
    expect(body.services_description).toBe("Oil changes, brakes");
  });

  it("returns nulls when no settings configured", async () => {
    mocks.query
      .mockResolvedValueOnce([{
        shop_name: "Default Shop",
        missed_call_sms_template: null,
        business_hours: null,
        services_description: null,
      }])
      .mockResolvedValueOnce([]);

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/settings`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.missed_call_sms_template).toBeNull();
    expect(body.ai_system_prompt).toBeNull();
    expect(body.business_hours).toBeNull();
    expect(body.services_description).toBeNull();
  });

  it("returns 404 for unknown tenant", async () => {
    mocks.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/settings`,
    });

    expect(res.statusCode).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT /internal/admin/tenants/:id/settings
// ═══════════════════════════════════════════════════════════════════════════

describe("PUT /internal/admin/tenants/:id/settings", () => {
  it("updates tenant columns and system prompt", async () => {
    // exists check
    mocks.query.mockResolvedValueOnce([{ id: TENANT_ID }]);
    // tenant UPDATE
    mocks.query.mockResolvedValueOnce([]);
    // deactivate old prompts
    mocks.query.mockResolvedValueOnce([]);
    // insert new prompt
    mocks.query.mockResolvedValueOnce([]);

    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/internal/admin/tenants/${TENANT_ID}/settings`,
      payload: {
        shop_name: "New Name",
        missed_call_sms_template: "Hello from {shop_name}!",
        ai_system_prompt: "Be helpful.",
        business_hours: "Mon-Sat 9-5",
        services_description: "Full service auto repair",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);

    // Verify tenant UPDATE was called with all fields
    const updateCall = mocks.query.mock.calls[1];
    expect(updateCall[0]).toContain("shop_name");
    expect(updateCall[0]).toContain("missed_call_sms_template");
    expect(updateCall[0]).toContain("business_hours");
    expect(updateCall[0]).toContain("services_description");

    // Verify system prompt insert
    const insertCall = mocks.query.mock.calls[3];
    expect(insertCall[0]).toContain("INSERT INTO system_prompts");
    expect(insertCall[1]).toContain("Be helpful.");
  });

  it("clears system prompt when null", async () => {
    mocks.query.mockResolvedValueOnce([{ id: TENANT_ID }]);
    // deactivate prompts
    mocks.query.mockResolvedValueOnce([]);

    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/internal/admin/tenants/${TENANT_ID}/settings`,
      payload: { ai_system_prompt: null },
    });

    expect(res.statusCode).toBe(200);
    // Should have called deactivate but not insert
    const deactivateCall = mocks.query.mock.calls[1];
    expect(deactivateCall[0]).toContain("SET is_active = FALSE");
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it("returns 404 for unknown tenant", async () => {
    mocks.query.mockResolvedValueOnce([]);

    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/internal/admin/tenants/${TENANT_ID}/settings`,
      payload: { shop_name: "New" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for invalid payload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/internal/admin/tenants/${TENANT_ID}/settings`,
      payload: { shop_name: "" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("handles partial updates (only some fields)", async () => {
    mocks.query.mockResolvedValueOnce([{ id: TENANT_ID }]);
    mocks.query.mockResolvedValueOnce([]);

    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/internal/admin/tenants/${TENANT_ID}/settings`,
      payload: { business_hours: "24/7" },
    });

    expect(res.statusCode).toBe(200);
    const updateCall = mocks.query.mock.calls[1];
    expect(updateCall[0]).toContain("business_hours");
    expect(updateCall[0]).not.toContain("shop_name");
  });

  it("allows clearing template with null", async () => {
    mocks.query.mockResolvedValueOnce([{ id: TENANT_ID }]);
    mocks.query.mockResolvedValueOnce([]);

    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/internal/admin/tenants/${TENANT_ID}/settings`,
      payload: { missed_call_sms_template: null },
    });

    expect(res.statusCode).toBe(200);
    const updateCall = mocks.query.mock.calls[1];
    expect(updateCall[0]).toContain("missed_call_sms_template");
    expect(updateCall[1]).toContain(null);
  });
});
