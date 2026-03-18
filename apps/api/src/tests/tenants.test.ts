import { describe, it, expect, vi } from "vitest";

const mockQuery = vi.fn().mockResolvedValue([]);

// db/client throws at module level when DATABASE_URL is missing.
// getBlockReason is a pure function; no real DB connection needed.
vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: (...args: unknown[]) => mockQuery(...args),
  withTenant: vi.fn(),
}));

import { getBlockReason, getTenantByPhoneNumber } from "../db/tenants";
import type { Tenant, BillingStatus } from "../db/tenants";

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    shop_name: "Test Shop",
    owner_email: "test@example.com",
    billing_status: "active",
    plan_id: "pro",
    conv_used_this_cycle: 0,
    conv_limit_this_cycle: 400,
    trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    warned_80pct: false,
    warned_100pct: false,
    ...overrides,
  };
}

describe("getBlockReason", () => {
  it("returns null for active tenant within limits", () => {
    expect(getBlockReason(makeTenant())).toBeNull();
  });

  it("blocks canceled tenants", () => {
    expect(getBlockReason(makeTenant({ billing_status: "canceled" }))).toBe("service_canceled");
  });

  it("blocks paused tenants", () => {
    expect(getBlockReason(makeTenant({ billing_status: "paused" }))).toBe("service_paused");
  });

  it("blocks past_due_blocked tenants", () => {
    expect(getBlockReason(makeTenant({ billing_status: "past_due_blocked" }))).toBe("payment_failed");
  });

  it("does NOT block past_due tenants (grace period)", () => {
    expect(getBlockReason(makeTenant({ billing_status: "past_due" }))).toBeNull();
  });

  it("blocks trial tenants that have exceeded conversation limit", () => {
    const tenant = makeTenant({
      billing_status: "trial",
      conv_used_this_cycle: 50,
      conv_limit_this_cycle: 50,
    });
    expect(getBlockReason(tenant)).toBe("trial_limit_reached");
  });

  it("blocks trial tenants that have exceeded time limit", () => {
    const tenant = makeTenant({
      billing_status: "trial",
      trial_ends_at: new Date(Date.now() - 1000), // expired
    });
    expect(getBlockReason(tenant)).toBe("trial_expired");
  });

  it("does NOT block active paid tenant at soft limit (80%)", () => {
    const tenant = makeTenant({
      billing_status: "active",
      conv_used_this_cycle: 320, // 80% of 400
      conv_limit_this_cycle: 400,
    });
    // Paid plans: no hard block at 80%
    expect(getBlockReason(tenant)).toBeNull();
  });

  it("does NOT hard-block active paid tenant at 100% limit", () => {
    const tenant = makeTenant({
      billing_status: "active",
      conv_used_this_cycle: 400,
      conv_limit_this_cycle: 400,
    });
    // Paid plans: soft block only (AI sends upgrade message, no hard block)
    expect(getBlockReason(tenant)).toBeNull();
  });
});

describe("getTenantByPhoneNumber", () => {
  it("queries for both active and suspended phone numbers", async () => {
    mockQuery.mockResolvedValueOnce([]);
    await getTenantByPhoneNumber("+15551234567");

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("'active'");
    expect(sql).toContain("'suspended'");
    expect(mockQuery.mock.calls[0][1]).toEqual(["+15551234567"]);
  });

  it("returns tenant when found", async () => {
    const tenant = makeTenant();
    mockQuery.mockResolvedValueOnce([tenant]);
    const result = await getTenantByPhoneNumber("+15551234567");
    expect(result).toEqual(tenant);
  });

  it("returns null when no matching number", async () => {
    mockQuery.mockResolvedValueOnce([]);
    const result = await getTenantByPhoneNumber("+15559999999");
    expect(result).toBeNull();
  });
});
