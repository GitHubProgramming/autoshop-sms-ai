/**
 * Tests for the two-tier webhook idempotency layer.
 *
 * Verifies:
 * 1. Same webhook sent twice → processed once
 * 2. Redis down → DB catches duplicates
 * 3. DB conflict → returns isDuplicate: true
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  checkIdempotency: vi.fn().mockResolvedValue(false),
  markIdempotency: vi.fn().mockResolvedValue(undefined),
  query: vi.fn().mockResolvedValue([{ id: 1 }]),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
  withTenant: vi.fn(),
}));

vi.mock("../queues/redis", () => ({
  checkIdempotency: mocks.checkIdempotency,
  markIdempotency: mocks.markIdempotency,
}));

import { deduplicateWebhook } from "../db/webhook-events";

describe("deduplicateWebhook — two-tier idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkIdempotency.mockResolvedValue(false);
    mocks.markIdempotency.mockResolvedValue(undefined);
    mocks.query.mockResolvedValue([{ id: 1 }]); // INSERT succeeded
  });

  it("returns isDuplicate=false on first encounter", async () => {
    const result = await deduplicateWebhook("twilio_sms", "SM_first_001");

    expect(result.isDuplicate).toBe(false);
    expect(result.source).toBe("twilio_sms");
    expect(result.eventSid).toBe("SM_first_001");
  });

  it("checks Redis first", async () => {
    await deduplicateWebhook("twilio_sms", "SM_redis_check");

    expect(mocks.checkIdempotency).toHaveBeenCalledWith("twilio_sms:SM_redis_check");
  });

  it("returns isDuplicate=true when Redis reports hit", async () => {
    mocks.checkIdempotency.mockResolvedValueOnce(true);

    const result = await deduplicateWebhook("stripe", "evt_redis_hit");

    expect(result.isDuplicate).toBe(true);
    // Should NOT have queried DB (fast path)
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("returns isDuplicate=true when DB INSERT conflicts (Redis miss)", async () => {
    mocks.checkIdempotency.mockResolvedValue(false);
    // INSERT returns no rows = conflict (ON CONFLICT DO NOTHING)
    mocks.query.mockResolvedValueOnce([]);

    const result = await deduplicateWebhook("twilio_voice_status", "CA_db_conflict");

    expect(result.isDuplicate).toBe(true);
    // Should backfill Redis
    expect(mocks.markIdempotency).toHaveBeenCalledWith("twilio_voice_status:CA_db_conflict");
  });

  it("marks Redis after successful DB insert (new event)", async () => {
    mocks.query.mockResolvedValueOnce([{ id: 42 }]); // INSERT succeeded

    await deduplicateWebhook("twilio_sms", "SM_new_event");

    expect(mocks.markIdempotency).toHaveBeenCalledWith("twilio_sms:SM_new_event");
  });

  it("inserts correct values into webhook_events table", async () => {
    await deduplicateWebhook("stripe", "evt_insert_check", "tenant-uuid-123");

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO webhook_events"),
      ["stripe", "evt_insert_check", "tenant-uuid-123"]
    );
  });

  it("passes null tenant_id when not provided", async () => {
    await deduplicateWebhook("twilio_voice", "CA_no_tenant");

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO webhook_events"),
      ["twilio_voice", "CA_no_tenant", null]
    );
  });

  it("handles Redis being down gracefully (falls through to DB)", async () => {
    mocks.checkIdempotency.mockRejectedValueOnce(new Error("Redis connection refused"));
    mocks.query.mockResolvedValueOnce([{ id: 1 }]); // DB insert succeeds

    const result = await deduplicateWebhook("twilio_sms", "SM_redis_down");

    expect(result.isDuplicate).toBe(false);
    // Should still try to mark Redis (even if it might fail again)
    expect(mocks.markIdempotency).toHaveBeenCalled();
  });

  it("handles DB being down gracefully (processes event)", async () => {
    mocks.checkIdempotency.mockResolvedValue(false);
    mocks.query.mockRejectedValueOnce(new Error("DB connection lost"));

    const result = await deduplicateWebhook("twilio_sms", "SM_db_down");

    // Should NOT mark as duplicate — better to double-process than drop
    expect(result.isDuplicate).toBe(false);
  });

  it("works for all webhook source types", async () => {
    const sources = [
      "twilio_sms",
      "twilio_voice",
      "twilio_voice_status",
      "stripe",
    ] as const;

    for (const source of sources) {
      vi.clearAllMocks();
      mocks.checkIdempotency.mockResolvedValue(false);
      mocks.query.mockResolvedValue([{ id: 1 }]);

      const result = await deduplicateWebhook(source, `test-${source}`);
      expect(result.isDuplicate).toBe(false);
      expect(result.source).toBe(source);
    }
  });
});
