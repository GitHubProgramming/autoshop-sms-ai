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
// GET /internal/admin/tenants/:id/pilot-readiness
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /internal/admin/tenants/:id/pilot-readiness", () => {
  function setupMocks(overrides: {
    tenant?: any;
    phone?: any;
    calendar?: any;
    prompt?: any;
  } = {}) {
    const tenant = overrides.tenant !== undefined ? overrides.tenant : {
      shop_name: "Joe's Auto",
      owner_phone: "+15125551234",
      billing_status: "trial",
      trial_ends_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      missed_call_sms_template: "Hi from {shop_name}! We missed your call.",
      business_hours: "Mon-Fri 8am-6pm",
      services_description: "Oil changes, brake repair, AC service",
    };

    const phone = overrides.phone !== undefined ? overrides.phone : {
      phone_number: "+13257523890",
      forward_to: "+15125559999",
      status: "active",
    };

    const calendar = overrides.calendar !== undefined ? overrides.calendar : {
      token_expiry: new Date(Date.now() + 3600000).toISOString(),
      connected_at: new Date().toISOString(),
    };

    const prompt = overrides.prompt !== undefined ? overrides.prompt : {
      prompt_text: "You are an AI assistant for Joe's Auto repair shop.",
    };

    mocks.query.mockImplementation((sql: string) => {
      if (sql.includes("missed_call_sms_template")) return tenant ? [tenant] : [];
      if (sql.includes("tenant_phone_numbers")) return phone ? [phone] : [];
      if (sql.includes("tenant_calendar_tokens")) return calendar ? [calendar] : [];
      if (sql.includes("system_prompts")) return prompt ? [prompt] : [];
      return [];
    });
  }

  it("returns 404 for non-existent tenant", async () => {
    const app = await buildApp();
    setupMocks({ tenant: null });

    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/pilot-readiness`,
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 'ready' when all checks pass", async () => {
    const app = await buildApp();
    setupMocks();

    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/pilot-readiness`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.verdict).toBe("ready");
    expect(body.blockers).toHaveLength(0);
    expect(body.warnings).toHaveLength(0);
    expect(body.checks.every((c: any) => c.pass)).toBe(true);
  });

  it("returns 'not_ready' when no phone number", async () => {
    const app = await buildApp();
    setupMocks({ phone: null });

    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/pilot-readiness`,
    });

    const body = res.json();
    expect(body.verdict).toBe("not_ready");
    expect(body.blockers.some((b: any) => b.id === "twilio_number")).toBe(true);
    expect(body.blockers.some((b: any) => b.id === "forward_to")).toBe(true);
  });

  it("returns 'not_ready' when forward_to is missing", async () => {
    const app = await buildApp();
    setupMocks({
      phone: { phone_number: "+13257523890", forward_to: null, status: "active" },
    });

    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/pilot-readiness`,
    });

    const body = res.json();
    expect(body.verdict).toBe("not_ready");
    expect(body.blockers.some((b: any) => b.id === "forward_to")).toBe(true);
  });

  it("returns 'not_ready' when calendar not connected", async () => {
    const app = await buildApp();
    setupMocks({ calendar: null });

    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/pilot-readiness`,
    });

    const body = res.json();
    expect(body.verdict).toBe("not_ready");
    expect(body.blockers.some((b: any) => b.id === "calendar_connected")).toBe(true);
  });

  it("returns 'not_ready' when calendar token expired", async () => {
    const app = await buildApp();
    setupMocks({
      calendar: {
        connected_at: new Date().toISOString(),
        token_expiry: new Date(Date.now() - 3600000).toISOString(),
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/pilot-readiness`,
    });

    const body = res.json();
    expect(body.verdict).toBe("not_ready");
    expect(body.blockers.some((b: any) => b.id === "calendar_token_valid")).toBe(true);
  });

  it("returns 'not_ready' when billing is blocked", async () => {
    const app = await buildApp();
    setupMocks({
      tenant: {
        shop_name: "Joe's Auto",
        owner_phone: "+15125551234",
        billing_status: "trial_expired",
        trial_ends_at: new Date(Date.now() - 86400000).toISOString(),
        missed_call_sms_template: "Template",
        business_hours: "Mon-Fri",
        services_description: "Oil changes",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/pilot-readiness`,
    });

    const body = res.json();
    expect(body.verdict).toBe("not_ready");
    expect(body.blockers.some((b: any) => b.id === "billing_active")).toBe(true);
  });

  it("returns 'not_ready' when SMS template is missing", async () => {
    const app = await buildApp();
    setupMocks({
      tenant: {
        shop_name: "Joe's Auto",
        owner_phone: "+15125551234",
        billing_status: "trial",
        trial_ends_at: new Date(Date.now() + 7 * 86400000).toISOString(),
        missed_call_sms_template: null,
        business_hours: "Mon-Fri",
        services_description: "Oil changes",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/pilot-readiness`,
    });

    const body = res.json();
    expect(body.verdict).toBe("not_ready");
    expect(body.blockers.some((b: any) => b.id === "sms_template")).toBe(true);
  });

  it("returns 'ready_with_warnings' when only non-critical checks fail", async () => {
    const app = await buildApp();
    setupMocks({
      prompt: null, // AI prompt missing (non-critical)
      tenant: {
        shop_name: "Joe's Auto",
        owner_phone: "+15125551234",
        billing_status: "trial",
        trial_ends_at: new Date(Date.now() + 7 * 86400000).toISOString(),
        missed_call_sms_template: "Template text",
        business_hours: null, // missing (non-critical)
        services_description: null, // missing (non-critical)
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/pilot-readiness`,
    });

    const body = res.json();
    expect(body.verdict).toBe("ready_with_warnings");
    expect(body.blockers).toHaveLength(0);
    expect(body.warnings.length).toBeGreaterThan(0);
    expect(body.warnings.some((w: any) => w.id === "ai_prompt")).toBe(true);
  });

  it("includes correct check count in summary", async () => {
    const app = await buildApp();
    setupMocks();

    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/pilot-readiness`,
    });

    const body = res.json();
    expect(body.checks).toHaveLength(9);
    expect(body.summary).toMatch(/\d+\/\d+ critical checks passed/);
  });

  it("returns all 9 checks in live-path order", async () => {
    const app = await buildApp();
    setupMocks();

    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/pilot-readiness`,
    });

    const body = res.json();
    const ids = body.checks.map((c: any) => c.id);
    expect(ids).toEqual([
      "twilio_number",
      "forward_to",
      "sms_template",
      "ai_prompt",
      "business_hours",
      "services",
      "calendar_connected",
      "calendar_token_valid",
      "billing_active",
    ]);
  });
});
