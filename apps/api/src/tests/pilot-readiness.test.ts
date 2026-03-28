import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  fetchTwilioNumberConfig: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

vi.mock("../middleware/admin-guard", () => ({
  adminGuard: async () => {},
}));

vi.mock("../services/twilio-verify", () => ({
  fetchTwilioNumberConfig: mocks.fetchTwilioNumberConfig,
  verifyWebhookUrls: (
    config: { sms_url: string | null; voice_url: string | null },
    expectedOrigin: string
  ) => {
    const expectedSms = `${expectedOrigin}/webhooks/twilio/sms`;
    const expectedVoice = `${expectedOrigin}/webhooks/twilio/voice`;
    return {
      sms_webhook: {
        pass: config.sms_url === expectedSms,
        expected: expectedSms,
        actual: config.sms_url,
      },
      voice_webhook: {
        pass: config.voice_url === expectedVoice,
        expected: expectedVoice,
        actual: config.voice_url,
      },
    };
  },
}));

vi.mock("../db/app-config", () => ({
  getConfig: async (key: string) => {
    if (key === "TWILIO_ACCOUNT_SID") return "ACtest123";
    if (key === "TWILIO_AUTH_TOKEN") return "authtest123";
    return null;
  },
}));

import { adminRoute } from "../routes/internal/admin";

// ── Constants ────────────────────────────────────────────────────────────────

const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const TEST_ORIGIN = "https://api.autoshop.example.com";

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(adminRoute, { prefix: "/internal" });
  return app;
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PUBLIC_ORIGIN = TEST_ORIGIN;

  // Default: Twilio returns correct webhook URLs
  mocks.fetchTwilioNumberConfig.mockResolvedValue({
    success: true,
    config: {
      sms_url: `${TEST_ORIGIN}/webhooks/twilio/sms`,
      sms_method: "POST",
      voice_url: `${TEST_ORIGIN}/webhooks/twilio/voice`,
      voice_method: "POST",
      status_callback: null,
      status_callback_method: null,
      friendly_name: "AutoShop Test",
    },
    error: null,
  });
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
      twilio_sid: "PNf77089f763ad788a2ea7bf65e71c181a",
    };

    const calendar = overrides.calendar !== undefined ? overrides.calendar : {
      token_expiry: new Date(Date.now() + 3600000).toISOString(),
      connected_at: new Date().toISOString(),
      integration_status: "active",
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

  it("returns 'ready' when all checks pass including Twilio webhooks", async () => {
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
    // Verify Twilio API was called
    expect(mocks.fetchTwilioNumberConfig).toHaveBeenCalledWith("PNf77089f763ad788a2ea7bf65e71c181a");
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
    // Webhook checks should also fail (no phone = no SID to check)
    expect(body.blockers.some((b: any) => b.id === "twilio_sms_webhook")).toBe(true);
    expect(body.blockers.some((b: any) => b.id === "twilio_voice_webhook")).toBe(true);
  });

  it("returns 'not_ready' when forward_to is missing", async () => {
    const app = await buildApp();
    setupMocks({
      phone: { phone_number: "+13257523890", forward_to: null, status: "active", twilio_sid: "PNtest" },
    });

    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/pilot-readiness`,
    });

    const body = res.json();
    expect(body.verdict).toBe("not_ready");
    expect(body.blockers.some((b: any) => b.id === "forward_to")).toBe(true);
  });

  it("returns 'ready_with_warnings' when calendar not connected (non-critical)", async () => {
    const app = await buildApp();
    setupMocks({ calendar: null });

    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/pilot-readiness`,
    });

    const body = res.json();
    expect(body.verdict).toBe("ready_with_warnings");
    expect(body.blockers.some((b: any) => b.id === "calendar_connected")).toBe(false);
    expect(body.warnings.some((w: any) => w.id === "calendar_connected")).toBe(true);
  });

  it("returns 'ready_with_warnings' when calendar refresh has failed (non-critical)", async () => {
    const app = await buildApp();
    setupMocks({
      calendar: {
        connected_at: new Date().toISOString(),
        token_expiry: new Date(Date.now() - 3600000).toISOString(),
        integration_status: "refresh_failed",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/pilot-readiness`,
    });

    const body = res.json();
    expect(body.verdict).toBe("ready_with_warnings");
    expect(body.blockers.some((b: any) => b.id === "calendar_token_valid")).toBe(false);
    expect(body.warnings.some((w: any) => w.id === "calendar_token_valid")).toBe(true);
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
      prompt: null,
      tenant: {
        shop_name: "Joe's Auto",
        owner_phone: "+15125551234",
        billing_status: "trial",
        trial_ends_at: new Date(Date.now() + 7 * 86400000).toISOString(),
        missed_call_sms_template: "Template text",
        business_hours: null,
        services_description: null,
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

  it("includes correct check count in summary (5 critical)", async () => {
    const app = await buildApp();
    setupMocks();

    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/pilot-readiness`,
    });

    const body = res.json();
    expect(body.checks).toHaveLength(11);
    expect(body.summary).toBe("6/6 critical checks passed");
  });

  it("includes operator status fields in response", async () => {
    const app = await buildApp();
    setupMocks();

    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/pilot-readiness`,
    });

    const body = res.json();
    expect(body.onboarding_complete).toBe(true);
    expect(body.phone_active).toBe(true);
    expect(body.has_real_activity).toBe(true);
    expect(body.business_hours_connected).toBe(true);
    expect(body.calendar_connected).toBe(true);
  });

  it("shows operator fields correctly when phone missing", async () => {
    const app = await buildApp();
    setupMocks({ phone: null });

    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/pilot-readiness`,
    });

    const body = res.json();
    expect(body.onboarding_complete).toBe(false);
    expect(body.phone_active).toBe(false);
    expect(body.calendar_connected).toBe(true);
  });

  it("returns all 11 checks in live-path order", async () => {
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
      "twilio_sms_webhook",
      "twilio_voice_webhook",
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

  // ── Twilio webhook verification tests ──────────────────────────────────

  it("returns 'not_ready' when Twilio SMS webhook URL is wrong", async () => {
    const app = await buildApp();
    setupMocks();
    mocks.fetchTwilioNumberConfig.mockResolvedValue({
      success: true,
      config: {
        sms_url: "https://old-domain.example.com/webhooks/twilio/sms",
        sms_method: "POST",
        voice_url: `${TEST_ORIGIN}/webhooks/twilio/voice`,
        voice_method: "POST",
        status_callback: null,
        status_callback_method: null,
        friendly_name: "AutoShop Test",
      },
      error: null,
    });

    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/pilot-readiness`,
    });

    const body = res.json();
    expect(body.verdict).toBe("not_ready");
    const smsCheck = body.checks.find((c: any) => c.id === "twilio_sms_webhook");
    expect(smsCheck.pass).toBe(false);
    expect(smsCheck.detail).toContain("MISMATCH");
    expect(smsCheck.detail).toContain("old-domain.example.com");
    expect(smsCheck.detail).toContain("Twilio Console");
  });

  it("returns 'not_ready' when Twilio Voice webhook URL is wrong", async () => {
    const app = await buildApp();
    setupMocks();
    mocks.fetchTwilioNumberConfig.mockResolvedValue({
      success: true,
      config: {
        sms_url: `${TEST_ORIGIN}/webhooks/twilio/sms`,
        sms_method: "POST",
        voice_url: "https://wrong.example.com/webhooks/twilio/voice",
        voice_method: "POST",
        status_callback: null,
        status_callback_method: null,
        friendly_name: "AutoShop Test",
      },
      error: null,
    });

    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/pilot-readiness`,
    });

    const body = res.json();
    expect(body.verdict).toBe("not_ready");
    const voiceCheck = body.checks.find((c: any) => c.id === "twilio_voice_webhook");
    expect(voiceCheck.pass).toBe(false);
    expect(voiceCheck.detail).toContain("MISMATCH");
    expect(voiceCheck.detail).toContain("wrong.example.com");
  });

  it("shows error detail when Twilio API call fails", async () => {
    const app = await buildApp();
    setupMocks();
    mocks.fetchTwilioNumberConfig.mockResolvedValue({
      success: false,
      config: null,
      error: "Twilio API 401: Authentication failed",
    });

    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/pilot-readiness`,
    });

    const body = res.json();
    expect(body.verdict).toBe("not_ready");
    const smsCheck = body.checks.find((c: any) => c.id === "twilio_sms_webhook");
    expect(smsCheck.pass).toBe(false);
    expect(smsCheck.detail).toContain("Cannot verify");
    expect(smsCheck.detail).toContain("Authentication failed");
  });

  it("shows error when PUBLIC_ORIGIN is not set", async () => {
    const app = await buildApp();
    setupMocks();
    delete process.env.PUBLIC_ORIGIN;
    delete process.env.API_BASE_URL;

    const res = await app.inject({
      method: "GET",
      url: `/internal/admin/tenants/${TENANT_ID}/pilot-readiness`,
    });

    const body = res.json();
    expect(body.verdict).toBe("not_ready");
    const smsCheck = body.checks.find((c: any) => c.id === "twilio_sms_webhook");
    expect(smsCheck.pass).toBe(false);
    expect(smsCheck.detail).toContain("PUBLIC_ORIGIN not configured");

    // Restore for other tests
    process.env.PUBLIC_ORIGIN = TEST_ORIGIN;
  });
});
