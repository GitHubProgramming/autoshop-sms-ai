import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

import {
  isOptedOut,
  recordOptOut,
  recordOptIn,
  isOptOutKeyword,
  isOptInKeyword,
} from "../services/opt-out";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── isOptOutKeyword ──────────────────────────────────────────────────────────

describe("isOptOutKeyword", () => {
  it.each(["stop", "STOP", "Stop", "STOPALL", "unsubscribe", "cancel", "end", "quit"])(
    "returns true for '%s'",
    (keyword) => {
      expect(isOptOutKeyword(keyword)).toBe(true);
    }
  );

  it.each(["  STOP  ", " unsubscribe ", "\tquit\n"])(
    "trims whitespace for '%s'",
    (keyword) => {
      expect(isOptOutKeyword(keyword)).toBe(true);
    }
  );

  it.each([
    "hello",
    "stop please",
    "I want to cancel my appointment",
    "brakes grind when I stop",
    "yes",
    "",
  ])("returns false for '%s'", (msg) => {
    expect(isOptOutKeyword(msg)).toBe(false);
  });
});

// ── isOptInKeyword ───────────────────────────────────────────────────────────

describe("isOptInKeyword", () => {
  it.each(["start", "START", "Start", "unstop", "UNSTOP", "yes", "YES"])(
    "returns true for '%s'",
    (keyword) => {
      expect(isOptInKeyword(keyword)).toBe(true);
    }
  );

  it.each(["no", "stop", "hello", "start texting", "yes please"])(
    "returns false for '%s'",
    (msg) => {
      expect(isOptInKeyword(msg)).toBe(false);
    }
  );
});

// ── isOptedOut ───────────────────────────────────────────────────────────────

describe("isOptedOut", () => {
  it("returns false when no opt-out record exists", async () => {
    mocks.query.mockResolvedValueOnce([]);
    const result = await isOptedOut("tenant-1", "+15551234567");
    expect(result).toBe(false);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("SELECT id FROM opt_outs"),
      ["tenant-1", "+15551234567"]
    );
  });

  it("returns true when an active opt-out record exists", async () => {
    mocks.query.mockResolvedValueOnce([{ id: "opt-1" }]);
    const result = await isOptedOut("tenant-1", "+15551234567");
    expect(result).toBe(true);
  });
});

// ── recordOptOut ─────────────────────────────────────────────────────────────

describe("recordOptOut", () => {
  it("inserts opt-out record via upsert", async () => {
    mocks.query.mockResolvedValueOnce([]);
    await recordOptOut("tenant-1", "+15551234567");
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO opt_outs"),
      ["tenant-1", "+15551234567"]
    );
  });
});

// ── recordOptIn ──────────────────────────────────────────────────────────────

describe("recordOptIn", () => {
  it("deactivates opt-out record", async () => {
    mocks.query.mockResolvedValueOnce([]);
    await recordOptIn("tenant-1", "+15551234567");
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE opt_outs"),
      ["tenant-1", "+15551234567"]
    );
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("is_active = FALSE"),
      expect.any(Array)
    );
  });
});
