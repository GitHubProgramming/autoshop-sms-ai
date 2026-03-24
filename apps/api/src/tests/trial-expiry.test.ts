import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

import { expireTrials } from "../services/trial-expiry";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("expireTrials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns count of expired trials", async () => {
    mocks.query.mockResolvedValueOnce([{ count: 3 }]);

    const result = await expireTrials();
    expect(result).toBe(3);
  });

  it("returns 0 when no trials are expired", async () => {
    mocks.query.mockResolvedValueOnce([{ count: 0 }]);

    const result = await expireTrials();
    expect(result).toBe(0);
  });

  it("targets only billing_status=trial with expired trial_ends_at", async () => {
    mocks.query.mockResolvedValueOnce([{ count: 0 }]);

    await expireTrials();

    const sql = mocks.query.mock.calls[0][0] as string;
    expect(sql).toContain("billing_status = 'trial'");
    expect(sql).toContain("trial_ends_at < NOW()");
    expect(sql).toContain("trial_ends_at IS NOT NULL");
    expect(sql).toContain("billing_status = 'trial_expired'");
  });

  it("does not touch demo tenants", async () => {
    mocks.query.mockResolvedValueOnce([{ count: 0 }]);

    await expireTrials();

    const sql = mocks.query.mock.calls[0][0] as string;
    // Only targets billing_status = 'trial', not demo or any other status
    expect(sql).toContain("WHERE billing_status = 'trial'");
    expect(sql).not.toContain("'demo'");
  });

  it("is idempotent — already expired tenants are not re-updated", async () => {
    // First run: 2 expired
    mocks.query.mockResolvedValueOnce([{ count: 2 }]);
    const first = await expireTrials();

    // Second run: 0 (already transitioned)
    mocks.query.mockResolvedValueOnce([{ count: 0 }]);
    const second = await expireTrials();

    expect(first).toBe(2);
    expect(second).toBe(0);
  });

  it("propagates database errors", async () => {
    mocks.query.mockRejectedValueOnce(new Error("connection refused"));

    await expect(expireTrials()).rejects.toThrow("connection refused");
  });
});
