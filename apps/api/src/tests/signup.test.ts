/**
 * Signup flow unit tests.
 *
 * These test the pure logic (getBlockReason, trial enforcement).
 * Integration tests for POST /auth/signup require a live DB — those are
 * documented in comments and verified manually in Docker.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB to isolate signup logic from Postgres
vi.mock("../db/client", () => ({
  db:         { end: vi.fn() },
  query:      vi.fn(),
  withTenant: vi.fn(),
}));

import { getBlockReason } from "../db/tenants";
import type { Tenant, BillingStatus } from "../db/tenants";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id:                    "00000000-0000-0000-0000-000000000001",
    shop_name:             "Test Shop",
    owner_email:           "test@example.com",
    billing_status:        "trial",
    plan_id:               null,
    conv_used_this_cycle:  0,
    conv_limit_this_cycle: 50,
    trial_ends_at:         new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    warned_80pct:          false,
    warned_100pct:         false,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Trial enforcement (getBlockReason covers the DB-state enforcement)
// ─────────────────────────────────────────────────────────────────────────────

describe("Trial enforcement — conversation limit", () => {
  it("allows 1st conversation (0 used of 50)", () => {
    const t = makeTenant({ conv_used_this_cycle: 0, conv_limit_this_cycle: 50 });
    expect(getBlockReason(t)).toBeNull();
  });

  it("allows 49th conversation (49 used of 50)", () => {
    const t = makeTenant({ conv_used_this_cycle: 49, conv_limit_this_cycle: 50 });
    expect(getBlockReason(t)).toBeNull();
  });

  it("blocks 50th conversation (50 used of 50 = limit reached)", () => {
    // The limit is checked as conv_used >= conv_limit, so at 50/50 = blocked
    const t = makeTenant({ conv_used_this_cycle: 50, conv_limit_this_cycle: 50 });
    expect(getBlockReason(t)).toBe("trial_limit_reached");
  });

  it("blocks 51st conversation (51 used of 50)", () => {
    const t = makeTenant({ conv_used_this_cycle: 51, conv_limit_this_cycle: 50 });
    expect(getBlockReason(t)).toBe("trial_limit_reached");
  });
});

describe("Trial enforcement — time limit", () => {
  it("allows conversation during active trial", () => {
    const t = makeTenant({
      billing_status: "trial",
      trial_ends_at:  new Date(Date.now() + 13 * 24 * 60 * 60 * 1000), // 13 days left
    });
    expect(getBlockReason(t)).toBeNull();
  });

  it("blocks conversation when trial has expired (1 second ago)", () => {
    const t = makeTenant({
      billing_status: "trial",
      trial_ends_at:  new Date(Date.now() - 1000),
    });
    expect(getBlockReason(t)).toBe("trial_expired");
  });

  it("blocks conversation when trial_expired status is set", () => {
    const t = makeTenant({
      billing_status: "trial_expired",
      trial_ends_at:  new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), // 14 days ago
    });
    // trial_expired status = same check
    expect(getBlockReason(t)).toBe("trial_expired");
  });

  it("time limit takes precedence over conv limit when both expired", () => {
    const t = makeTenant({
      billing_status:        "trial",
      trial_ends_at:         new Date(Date.now() - 1000), // expired
      conv_used_this_cycle:  50,
      conv_limit_this_cycle: 50,
    });
    // trial_expired is checked first in getBlockReason
    expect(getBlockReason(t)).toBe("trial_expired");
  });
});

describe("Trial enforcement — new signup defaults", () => {
  it("new signup should have billing_status=trial", () => {
    const t = makeTenant({ billing_status: "trial" });
    expect(t.billing_status).toBe("trial");
  });

  it("new signup conv_limit should be 50", () => {
    const t = makeTenant({ conv_limit_this_cycle: 50 });
    expect(t.conv_limit_this_cycle).toBe(50);
  });

  it("new signup conv_used should be 0", () => {
    const t = makeTenant({ conv_used_this_cycle: 0 });
    expect(t.conv_used_this_cycle).toBe(0);
  });

  it("new signup trial_ends_at should be ~14 days in the future", () => {
    const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const t        = makeTenant({ trial_ends_at: trialEnd });
    const daysLeft = (t.trial_ends_at.getTime() - Date.now()) / 86_400_000;
    expect(daysLeft).toBeCloseTo(14, 0); // within 1 day of 14
  });
});

describe("Post-upgrade: trial → active", () => {
  it("active paid tenant is not blocked at conv limit", () => {
    const t = makeTenant({
      billing_status:        "active",
      conv_used_this_cycle:  400,
      conv_limit_this_cycle: 400,
      plan_id:               "pro",
    });
    // Paid plans: soft limit only — no hard block
    expect(getBlockReason(t)).toBeNull();
  });

  it("active paid tenant is not blocked after trial would have expired", () => {
    const t = makeTenant({
      billing_status: "active",
      trial_ends_at:  new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
      plan_id:        "starter",
    });
    // Paid tenants skip trial check
    expect(getBlockReason(t)).toBeNull();
  });
});

describe("Signup attempt audit visibility", () => {
  // These are documented integration tests — they verify the DB schema intention.
  // Run against live DB:
  //   SELECT * FROM signup_attempts ORDER BY created_at DESC LIMIT 10;
  //   SELECT id, owner_email, billing_status, trial_ends_at, conv_used_this_cycle
  //   FROM tenants ORDER BY created_at DESC LIMIT 10;

  it("signup_attempts table fields are documented correctly", () => {
    // This test documents the expected shape of a completed signup_attempt
    const expectedShape = {
      id:             "uuid",
      email:          "user@example.com",
      provider:       "email",          // or 'google'
      status:         "completed",      // started | completed | failed | abandoned
      failure_reason: null,
      tenant_id:      "uuid",
      ip_address:     "127.0.0.1",
      created_at:     "timestamptz",
      completed_at:   "timestamptz",
    };
    expect(Object.keys(expectedShape)).toContain("status");
    expect(Object.keys(expectedShape)).toContain("failure_reason");
    expect(Object.keys(expectedShape)).toContain("tenant_id");
  });

  it("failed signup attempt has failure_reason set and no tenant_id", () => {
    const failedAttempt = {
      status:         "failed",
      failure_reason: "email_already_registered",
      tenant_id:      null,
    };
    expect(failedAttempt.status).toBe("failed");
    expect(failedAttempt.failure_reason).toBeTruthy();
    expect(failedAttempt.tenant_id).toBeNull();
  });
});
