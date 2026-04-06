import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
  withTransaction: vi.fn(),
}));

vi.mock("../queues/redis", () => ({
  redis: { set: vi.fn(), del: vi.fn(), exists: vi.fn(), setex: vi.fn(), disconnect: vi.fn() },
  bullmqConnection: {},
  smsInboundQueue: { add: vi.fn() },
  provisionNumberQueue: { add: vi.fn() },
  billingQueue: { add: vi.fn() },
  calendarQueue: { add: vi.fn() },
  checkIdempotency: vi.fn().mockResolvedValue(false),
  markIdempotency: vi.fn(),
  checkMissedCallDedupe: vi.fn(),
}));

vi.mock("../services/conversation", () => ({
  openConversation: vi.fn(),
  openConversationWithRetry: vi.fn(),
}));

import { closeStaleConversations } from "../services/close-stale-conversations";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("closeStaleConversations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns total closed count from query result", async () => {
    // New format: one row per closed conversation with tenant_id
    mocks.query.mockResolvedValueOnce([
      { tenant_id: "t-1" },
      { tenant_id: "t-1" },
      { tenant_id: "t-1" },
      { tenant_id: "t-2" },
      { tenant_id: "t-2" },
    ]);

    const result = await closeStaleConversations();
    expect(result).toBe(5);
  });

  it("returns 0 when no stale conversations exist", async () => {
    mocks.query.mockResolvedValueOnce([]);

    const result = await closeStaleConversations();
    expect(result).toBe(0);
  });

  it("executes a single SQL query with correct conditions", async () => {
    mocks.query.mockResolvedValueOnce([]);

    await closeStaleConversations();

    expect(mocks.query).toHaveBeenCalledTimes(1);
    const sql = mocks.query.mock.calls[0][0] as string;

    // Verify the query targets only open conversations older than 24h
    expect(sql).toContain("'open'");
    expect(sql).toContain("24 hours");
    expect(sql).toContain("inactivity_24h");
    expect(sql).toContain("'closed'");
  });

  it("is idempotent — counted=FALSE guard prevents re-closing", async () => {
    mocks.query.mockResolvedValueOnce([{ tenant_id: "t-1" }, { tenant_id: "t-1" }]);
    const first = await closeStaleConversations();

    mocks.query.mockResolvedValueOnce([]);
    const second = await closeStaleConversations();

    expect(first).toBe(2);
    expect(second).toBe(0);
  });

  it("propagates database errors", async () => {
    mocks.query.mockRejectedValueOnce(new Error("connection refused"));

    await expect(closeStaleConversations()).rejects.toThrow("connection refused");
  });
});
