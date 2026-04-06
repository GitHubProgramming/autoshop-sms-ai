import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  query: vi.fn().mockResolvedValue([]),
  deduplicateWebhook: vi.fn().mockResolvedValue({ isDuplicate: false, source: "stripe", eventSid: "" }),
  billingQueueAdd: vi.fn().mockResolvedValue({ id: "job-1" }),
  provisionQueueAdd: vi.fn().mockResolvedValue({ id: "job-2" }),
  updateBillingStatus: vi.fn().mockResolvedValue(undefined),
  constructEvent: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
  withTenant: vi.fn(),
}));

vi.mock("../queues/redis", () => ({
  billingQueue: { add: mocks.billingQueueAdd },
  provisionNumberQueue: { add: mocks.provisionQueueAdd },
}));

vi.mock("../db/webhook-events", () => ({
  deduplicateWebhook: mocks.deduplicateWebhook,
}));

vi.mock("../db/tenants", () => ({
  updateBillingStatus: mocks.updateBillingStatus,
  activateTrial: vi.fn().mockResolvedValue(undefined),
}));

const mockRaiseAlert = vi.fn().mockResolvedValue("alert-id");
vi.mock("../services/pipeline-alerts", () => ({
  raiseAlert: (...args: unknown[]) => mockRaiseAlert(...args),
}));

// Mock Stripe constructor so constructEvent is controllable
vi.mock("stripe", () => {
  return {
    default: class StripeMock {
      webhooks = { constructEvent: mocks.constructEvent };
    },
  };
});

import { stripeRoute } from "../routes/webhooks/stripe";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_TENANT_ID = "tenant-uuid-stripe-001";
const TEST_EVENT_ID = "evt_test_001";
const TEST_SUB_ID = "sub_test_001";

function makeEvent(
  type: string,
  obj: Record<string, unknown>,
  id = TEST_EVENT_ID
): unknown {
  return { id, type, data: { object: obj } };
}

function subscriptionObject(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_SUB_ID,
    items: { data: [{ price: { id: "price_starter_test" } }] },
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
    metadata: { tenant_id: TEST_TENANT_ID },
    ...overrides,
  };
}

function invoiceObject(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv_test_001",
    period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
    metadata: { tenant_id: TEST_TENANT_ID },
    ...overrides,
  };
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(stripeRoute, { prefix: "/webhooks" });
  return app;
}

function postStripe(app: ReturnType<typeof Fastify>, body = "{}") {
  return app.inject({
    method: "POST",
    url: "/webhooks/stripe",
    headers: {
      "content-type": "application/json",
      "stripe-signature": "t=123,v1=sig",
    },
    payload: body,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /webhooks/stripe", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    vi.clearAllMocks();

    savedEnv = {
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      STRIPE_PRICE_STARTER: process.env.STRIPE_PRICE_STARTER,
      STRIPE_PRICE_PRO: process.env.STRIPE_PRICE_PRO,
      STRIPE_PRICE_PREMIUM: process.env.STRIPE_PRICE_PREMIUM,
    };

    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    process.env.STRIPE_SECRET_KEY = "sk_test_xxx";
    process.env.STRIPE_PRICE_STARTER = "price_starter_test";
    process.env.STRIPE_PRICE_PRO = "price_pro_test";
    process.env.STRIPE_PRICE_PREMIUM = "price_premium_test";

    mocks.deduplicateWebhook.mockResolvedValue({ isDuplicate: false, source: "stripe", eventSid: "" });
    mocks.query.mockResolvedValue([]);
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  // ── Signature validation ──────────────────────────────────────────────────

  it("returns 500 when STRIPE_WEBHOOK_SECRET is not set", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const app = await buildApp();

    const res = await postStripe(app);

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toContain("misconfiguration");
    await app.close();
  });

  it("returns 400 when Stripe signature is invalid", async () => {
    mocks.constructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature");
    });
    const app = await buildApp();

    const res = await postStripe(app);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain("Webhook error");
    await app.close();
  });

  it("returns 200 when signature is valid and event is processed", async () => {
    const evt = makeEvent("customer.subscription.created", subscriptionObject());
    mocks.constructEvent.mockReturnValue(evt);
    const app = await buildApp();

    const res = await postStripe(app);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ received: true });
    await app.close();
  });

  // ── Idempotency ───────────────────────────────────────────────────────────

  it("skips processing on duplicate event (idempotency)", async () => {
    mocks.deduplicateWebhook.mockResolvedValueOnce({ isDuplicate: true, source: "stripe", eventSid: TEST_EVENT_ID });
    const evt = makeEvent("customer.subscription.created", subscriptionObject());
    mocks.constructEvent.mockReturnValue(evt);
    const app = await buildApp();

    const res = await postStripe(app);

    expect(res.statusCode).toBe(200);
    expect(mocks.query).not.toHaveBeenCalled(); // no DB write
    await app.close();
  });

  it("calls deduplicateWebhook with correct source and event id", async () => {
    const evt = makeEvent("customer.subscription.created", subscriptionObject());
    mocks.constructEvent.mockReturnValue(evt);
    const app = await buildApp();

    await postStripe(app);

    expect(mocks.deduplicateWebhook).toHaveBeenCalledWith("stripe", TEST_EVENT_ID);
    await app.close();
  });

  // ── Billing event logging ─────────────────────────────────────────────────

  it("inserts billing_events row for every event", async () => {
    const sub = subscriptionObject();
    const evt = makeEvent("customer.subscription.created", sub);
    mocks.constructEvent.mockReturnValue(evt);
    const app = await buildApp();

    await postStripe(app);

    // First query call should be the billing_events INSERT
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO billing_events"),
      expect.arrayContaining([TEST_EVENT_ID, TEST_TENANT_ID, "customer.subscription.created"])
    );
    await app.close();
  });

  // ── Event: customer.subscription.created ──────────────────────────────────

  it("sets tenant to active with correct plan on subscription.created", async () => {
    const sub = subscriptionObject();
    const evt = makeEvent("customer.subscription.created", sub);
    mocks.constructEvent.mockReturnValue(evt);
    const app = await buildApp();

    await postStripe(app);

    // Should update tenants with plan info
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE tenants SET"),
      expect.arrayContaining(["starter", TEST_SUB_ID, 150, expect.any(Number), TEST_TENANT_ID])
    );
    await app.close();
  });

  it("provisions Twilio number on first subscription when tenant has no number", async () => {
    const sub = subscriptionObject();
    const evt = makeEvent("customer.subscription.created", sub);
    mocks.constructEvent.mockReturnValue(evt);

    // No existing phone number
    mocks.query
      .mockResolvedValueOnce([]) // billing_events INSERT
      .mockResolvedValueOnce([{ billing_status: "trial" }]) // SELECT billing_status (demo→trial check)
      .mockResolvedValueOnce([]) // UPDATE tenants
      .mockResolvedValueOnce([]) // SELECT tenant_phone_numbers (none)
      .mockResolvedValueOnce([{ shop_name: "Joe's Auto", owner_phone: "+15125551234" }]); // SELECT tenant

    const app = await buildApp();
    await postStripe(app);

    expect(mocks.provisionQueueAdd).toHaveBeenCalledWith(
      "provision-twilio-number",
      expect.objectContaining({
        tenantId: TEST_TENANT_ID,
        areaCode: "512",
        shopName: "Joe's Auto",
      }),
      expect.objectContaining({
        jobId: `provision-${TEST_TENANT_ID}`,
        attempts: 5,
      })
    );
    await app.close();
  });

  it("does NOT provision number if tenant already has an active number", async () => {
    const sub = subscriptionObject();
    const evt = makeEvent("customer.subscription.created", sub);
    mocks.constructEvent.mockReturnValue(evt);

    mocks.query
      .mockResolvedValueOnce([]) // billing_events INSERT
      .mockResolvedValueOnce([{ billing_status: "trial" }]) // SELECT billing_status
      .mockResolvedValueOnce([]) // UPDATE tenants
      .mockResolvedValueOnce([{ id: "phone-1" }]); // existing phone found

    const app = await buildApp();
    await postStripe(app);

    expect(mocks.provisionQueueAdd).not.toHaveBeenCalled();
    await app.close();
  });

  // ── Event: customer.subscription.updated ──────────────────────────────────

  it("updates plan on subscription.updated without provisioning", async () => {
    const sub = subscriptionObject({
      items: { data: [{ price: { id: "price_pro_test" } }] },
    });
    const evt = makeEvent("customer.subscription.updated", sub);
    mocks.constructEvent.mockReturnValue(evt);
    const app = await buildApp();

    await postStripe(app);

    // Should update with pro plan limits
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE tenants SET"),
      expect.arrayContaining(["pro", TEST_SUB_ID, 400, expect.any(Number), TEST_TENANT_ID])
    );
    // subscription.updated does NOT trigger provisioning
    expect(mocks.provisionQueueAdd).not.toHaveBeenCalled();
    await app.close();
  });

  it("maps premium price to 1000 conversation limit", async () => {
    const sub = subscriptionObject({
      items: { data: [{ price: { id: "price_premium_test" } }] },
    });
    const evt = makeEvent("customer.subscription.created", sub);
    mocks.constructEvent.mockReturnValue(evt);

    // Has existing phone (skip provisioning path)
    mocks.query
      .mockResolvedValueOnce([]) // billing_events INSERT
      .mockResolvedValueOnce([{ billing_status: "trial" }]) // SELECT billing_status
      .mockResolvedValueOnce([]) // UPDATE tenants
      .mockResolvedValueOnce([{ id: "phone-1" }]); // existing phone

    const app = await buildApp();
    await postStripe(app);

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE tenants SET"),
      expect.arrayContaining(["premium", TEST_SUB_ID, 1000])
    );
    await app.close();
  });

  it("skips processing for unknown price ID instead of defaulting", async () => {
    const sub = subscriptionObject({
      items: { data: [{ price: { id: "price_unknown_xxx" } }] },
    });
    const evt = makeEvent("customer.subscription.updated", sub);
    mocks.constructEvent.mockReturnValue(evt);
    const app = await buildApp();

    const res = await postStripe(app);

    // Should NOT have written any tenant update with a plan
    const tenantUpdateCalls = mocks.query.mock.calls.filter(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("UPDATE tenants SET") && c[0].includes("plan_id")
    );
    expect(tenantUpdateCalls).toHaveLength(0);
    expect(res.statusCode).toBe(200); // still 200 to Stripe
    await app.close();
  });

  // ── Event: invoice.payment_succeeded ──────────────────────────────────────

  it("resets cycle on payment_succeeded", async () => {
    const inv = invoiceObject();
    const evt = makeEvent("invoice.payment_succeeded", inv);
    mocks.constructEvent.mockReturnValue(evt);
    const app = await buildApp();

    await postStripe(app);

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("conv_used_this_cycle = 0"),
      expect.arrayContaining([expect.any(Number), TEST_TENANT_ID])
    );
    await app.close();
  });

  // ── Event: invoice.payment_failed ─────────────────────────────────────────

  it("sets past_due and schedules grace period check on payment_failed", async () => {
    const inv = invoiceObject();
    const evt = makeEvent("invoice.payment_failed", inv);
    mocks.constructEvent.mockReturnValue(evt);
    const app = await buildApp();

    await postStripe(app);

    expect(mocks.updateBillingStatus).toHaveBeenCalledWith(TEST_TENANT_ID, "past_due");
    expect(mocks.billingQueueAdd).toHaveBeenCalledWith(
      "grace-period-check",
      { tenantId: TEST_TENANT_ID },
      expect.objectContaining({
        delay: 3 * 24 * 60 * 60 * 1000, // 3 days
        jobId: `grace-${TEST_TENANT_ID}`,
      })
    );
    await app.close();
  });

  // ── Event: customer.subscription.deleted ──────────────────────────────────

  it("sets canceled on subscription.deleted and suspends phone number", async () => {
    const sub = subscriptionObject();
    const evt = makeEvent("customer.subscription.deleted", sub);
    mocks.constructEvent.mockReturnValue(evt);
    const app = await buildApp();

    await postStripe(app);

    expect(mocks.updateBillingStatus).toHaveBeenCalledWith(TEST_TENANT_ID, "canceled");
    // Should suspend tenant phone numbers
    const suspendCalls = mocks.query.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("tenant_phone_numbers") && (c[0] as string).includes("suspended")
    );
    expect(suspendCalls).toHaveLength(1);
    expect(suspendCalls[0][1]).toEqual([TEST_TENANT_ID]);
    await app.close();
  });

  // ── Event: charge.dispute.created ─────────────────────────────────────────

  it("pauses tenant on charge.dispute.created and raises admin alert", async () => {
    const obj = { id: "dp_test_001", metadata: { tenant_id: TEST_TENANT_ID } };
    const evt = makeEvent("charge.dispute.created", obj);
    mocks.constructEvent.mockReturnValue(evt);
    const app = await buildApp();

    await postStripe(app);

    expect(mocks.updateBillingStatus).toHaveBeenCalledWith(TEST_TENANT_ID, "paused");
    expect(mockRaiseAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TEST_TENANT_ID,
        severity: "critical",
        summary: expect.stringContaining("Chargeback"),
      })
    );
    await app.close();
  });

  // ── Missing tenant_id ─────────────────────────────────────────────────────

  it("logs event but does not route when tenant_id is missing from metadata", async () => {
    const sub = subscriptionObject({ metadata: {} });
    const evt = makeEvent("customer.subscription.created", sub);
    mocks.constructEvent.mockReturnValue(evt);
    const app = await buildApp();

    const res = await postStripe(app);

    expect(res.statusCode).toBe(200);
    // Should insert billing_events with null tenant_id
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO billing_events"),
      expect.arrayContaining([TEST_EVENT_ID, null, "customer.subscription.created"])
    );
    // Should NOT have called UPDATE tenants (no routing)
    const updateCalls = mocks.query.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("UPDATE tenants")
    );
    expect(updateCalls).toHaveLength(0);
    await app.close();
  });

  // ── Unhandled event type ──────────────────────────────────────────────────

  it("returns 200 for unhandled event types (logged, not routed)", async () => {
    const evt = makeEvent("payment_intent.created", {
      id: "pi_test",
      metadata: { tenant_id: TEST_TENANT_ID },
    });
    mocks.constructEvent.mockReturnValue(evt);
    const app = await buildApp();

    const res = await postStripe(app);

    expect(res.statusCode).toBe(200);
    expect(mocks.updateBillingStatus).not.toHaveBeenCalled();
    expect(mocks.billingQueueAdd).not.toHaveBeenCalled();
    expect(mocks.provisionQueueAdd).not.toHaveBeenCalled();
    await app.close();
  });

  // ── Area code extraction ──────────────────────────────────────────────────

  it("extracts area code from owner phone for provisioning", async () => {
    const sub = subscriptionObject();
    const evt = makeEvent("customer.subscription.created", sub);
    mocks.constructEvent.mockReturnValue(evt);

    mocks.query
      .mockResolvedValueOnce([]) // billing_events INSERT
      .mockResolvedValueOnce([{ billing_status: "trial" }]) // SELECT billing_status
      .mockResolvedValueOnce([]) // UPDATE tenants
      .mockResolvedValueOnce([]) // no existing phone
      .mockResolvedValueOnce([{ shop_name: "Dallas Auto", owner_phone: "+12145559999" }]);

    const app = await buildApp();
    await postStripe(app);

    expect(mocks.provisionQueueAdd).toHaveBeenCalledWith(
      "provision-twilio-number",
      expect.objectContaining({ areaCode: "214" }),
      expect.anything()
    );
    await app.close();
  });

  it("defaults to area code 512 when owner has no phone", async () => {
    const sub = subscriptionObject();
    const evt = makeEvent("customer.subscription.created", sub);
    mocks.constructEvent.mockReturnValue(evt);

    mocks.query
      .mockResolvedValueOnce([]) // billing_events INSERT
      .mockResolvedValueOnce([{ billing_status: "trial" }]) // SELECT billing_status
      .mockResolvedValueOnce([]) // UPDATE tenants
      .mockResolvedValueOnce([]) // no existing phone
      .mockResolvedValueOnce([{ shop_name: "No Phone Shop", owner_phone: null }]);

    const app = await buildApp();
    await postStripe(app);

    expect(mocks.provisionQueueAdd).toHaveBeenCalledWith(
      "provision-twilio-number",
      expect.objectContaining({ areaCode: "512" }),
      expect.anything()
    );
    await app.close();
  });

  it("sets provisioning_state=error and raises alert when queue enqueue fails", async () => {
    mocks.provisionQueueAdd.mockRejectedValueOnce(new Error("Redis connection refused"));

    const evt = makeEvent("customer.subscription.created", subscriptionObject({
      status: "trialing",
      trial_end: Math.floor(Date.now() / 1000) + 14 * 86400,
    }));
    mocks.constructEvent.mockReturnValue(evt);

    mocks.query
      .mockResolvedValueOnce([]) // billing_events INSERT
      .mockResolvedValueOnce([{ billing_status: "demo" }]) // SELECT billing_status
      .mockResolvedValueOnce([]) // UPDATE tenants (subscription data)
      .mockResolvedValueOnce([]) // no existing phone
      .mockResolvedValueOnce([{ shop_name: "Queue Fail Shop", owner_phone: "+15125551234", is_test: false }]) // tenant info
      .mockResolvedValueOnce([]) // UPDATE provisioning_state = 'error'
    ;

    const app = await buildApp();
    const res = await postStripe(app);

    // Webhook must still return 200 — Stripe should not retry
    expect(res.statusCode).toBe(200);

    // provisioning_state should be set to 'error'
    const provStateCall = mocks.query.mock.calls.find(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("provisioning_state = 'error'")
    );
    expect(provStateCall).toBeTruthy();

    // raiseAlert should have been called with provisioning_failed
    expect(mockRaiseAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TEST_TENANT_ID,
        severity: "critical",
        alertType: "pipeline_failed",
      })
    );

    await app.close();
  });
});
