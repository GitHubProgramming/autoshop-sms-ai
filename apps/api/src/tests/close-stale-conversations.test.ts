import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

import { closeStaleConversations } from "../services/close-stale-conversations";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("closeStaleConversations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns total closed count from query result", async () => {
    mocks.query.mockResolvedValueOnce([
      { closed_count: 3 },
      { closed_count: 2 },
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

    // Verify the query targets only open, uncounted conversations older than 24h
    expect(sql).toContain("status         = 'open'");
    expect(sql).toContain("counted        = FALSE");
    expect(sql).toContain("INTERVAL '24 hours'");
    expect(sql).toContain("close_reason = 'inactivity_24h'");
    expect(sql).toContain("status       = 'closed'");
  });

  it("is idempotent — counted=FALSE guard prevents re-closing", async () => {
    mocks.query.mockResolvedValueOnce([{ closed_count: 2 }]);
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
