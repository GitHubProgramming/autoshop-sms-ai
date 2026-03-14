import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// ── Set env vars BEFORE module import (PLAN_PRICE_MAP reads at load time) ────

vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_xxx";
  process.env.STRIPE_PRICE_STARTER = "price_starter_123";
  process.env.STRIPE_PRICE_PRO = "price_pro_123";
  process.env.STRIPE_PRICE_PREMIUM = "price_premium_123";
});

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  query: vi.fn().mockResolvedValue([]),
  getTenantById: vi.fn(),
  checkIdempotency: vi.fn().mockResolvedValue(false),
  markIdempotency: vi.fn().mockResolvedValue(undefined),
  requireAuth: vi.fn(),
  stripeCustomersCreate: vi.fn(),
  stripeCheckoutCreate: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

vi.mock("../db/tenants", () => ({
  getTenantById: mocks.getTenantById,
}));

vi.mock("../queues/redis", () => ({
  checkIdempotency: mocks.checkIdempotency,
  markIdempotency: mocks.markIdempotency,
}));

vi.mock("../middleware/require-auth", () => ({
  requireAuth: (req: any, _reply: any, done: any) => {
    req.user = { tenantId: TENANT_ID };
    done();
  },
}));

vi.mock("stripe", () => {
  return {
    default: class StripeMock {
      customers = { create: mocks.stripeCustomersCreate };
      checkout = { sessions: { create: mocks.stripeCheckoutCreate } };
    },
  };
});

import { billingCheckoutRoute } from "../routes/billing/checkout";

// ── Constants ─────────────────────────────────────────────────────────────────

const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const STRIPE_CUSTOMER_ID = "cus_test123";
const SESSION_URL = "https://checkout.stripe.com/session/test";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    plan: "starter",
    successUrl: "https://app.example.com/success",
    cancelUrl: "https://app.example.com/cancel",
    ...overrides,
  };
}

function tenantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TENANT_ID,
    shop_name: "Test Auto Shop",
    owner_email: "owner@test.com",
    stripe_customer_id: null,
    ...overrides,
  };
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(billingCheckoutRoute, { prefix: "/billing" });
  return app;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = "sk_test_xxx";
  process.env.STRIPE_PRICE_STARTER = "price_starter_123";
  process.env.STRIPE_PRICE_PRO = "price_pro_123";
  process.env.STRIPE_PRICE_PREMIUM = "price_premium_123";

  mocks.getTenantById.mockResolvedValue(tenantRow());
  mocks.stripeCustomersCreate.mockResolvedValue({ id: STRIPE_CUSTOMER_ID });
  mocks.stripeCheckoutCreate.mockResolvedValue({ url: SESSION_URL });
  mocks.checkIdempotency.mockResolvedValue(false);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /billing/checkout", () => {
  // ── Happy path ──────────────────────────────────────────────────────────

  it("creates Stripe customer and checkout session for new tenant", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/billing/checkout",
      payload: validBody(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().url).toBe(SESSION_URL);
    expect(mocks.stripeCustomersCreate).toHaveBeenCalledOnce();
    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledOnce();
    expect(mocks.markIdempotency).toHaveBeenCalledWith(`checkout:${TENANT_ID}:starter`);
    await app.close();
  });

  it("skips Stripe customer creation when tenant already has one", async () => {
    mocks.getTenantById.mockResolvedValue(
      tenantRow({ stripe_customer_id: STRIPE_CUSTOMER_ID })
    );

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/billing/checkout",
      payload: validBody(),
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.stripeCustomersCreate).not.toHaveBeenCalled();
    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledOnce();
    await app.close();
  });

  // ── Idempotency ────────────────────────────────────────────────────────

  it("returns 409 when checkout already in progress", async () => {
    mocks.checkIdempotency.mockResolvedValue(true); // already in flight

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/billing/checkout",
      payload: validBody(),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("already in progress");
    // Should NOT call Stripe
    expect(mocks.stripeCustomersCreate).not.toHaveBeenCalled();
    expect(mocks.stripeCheckoutCreate).not.toHaveBeenCalled();
    await app.close();
  });

  it("uses plan-specific idempotency key", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/billing/checkout",
      payload: validBody({ plan: "pro" }),
    });

    expect(mocks.checkIdempotency).toHaveBeenCalledWith(`checkout:${TENANT_ID}:pro`);
    expect(mocks.markIdempotency).toHaveBeenCalledWith(`checkout:${TENANT_ID}:pro`);
    await app.close();
  });

  // ── Validation ──────────────────────────────────────────────────────────

  it("returns 400 for invalid plan", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/billing/checkout",
      payload: validBody({ plan: "enterprise" }),
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("returns 400 for invalid successUrl", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/billing/checkout",
      payload: validBody({ successUrl: "not-a-url" }),
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  // ── Error paths ─────────────────────────────────────────────────────────

  it("returns 503 when Stripe not configured", async () => {
    delete process.env.STRIPE_SECRET_KEY;

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/billing/checkout",
      payload: validBody(),
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toContain("Stripe not configured");
    await app.close();
  });

  it("returns 404 when tenant not found", async () => {
    mocks.getTenantById.mockResolvedValue(null);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/billing/checkout",
      payload: validBody(),
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
