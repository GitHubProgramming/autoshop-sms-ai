import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock BullMQ Queue ────────────────────────────────────────────────────────

const { mockAdd } = vi.hoisted(() => {
  const mockAdd = vi.fn();
  return { mockAdd };
});

vi.mock("bullmq", () => {
  return {
    Queue: class MockQueue {
      add = mockAdd;
      close = vi.fn();
    },
    Job: class MockJob {},
  };
});

vi.mock("../queues/redis", () => ({
  bullmqConnection: { host: "localhost", port: 6379 },
}));

import { moveToDeadLetter, type DeadLetterPayload } from "../queues/dead-letter";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fakeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-123",
    name: "process-sms",
    data: { tenantId: "t1", customerPhone: "+15551234567" },
    attemptsMade: 3,
    opts: { attempts: 3 },
    ...overrides,
  } as never; // cast to Job type
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("dead-letter queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enqueues failure context with correct payload shape", async () => {
    mockAdd.mockResolvedValueOnce({});
    const err = new Error("API process-sms returned 500: internal error");
    const job = fakeJob();

    await moveToDeadLetter("sms-inbound", job, err);

    expect(mockAdd).toHaveBeenCalledOnce();
    const [jobName, payload, opts] = mockAdd.mock.calls[0];

    expect(jobName).toBe("dead-letter-entry");
    expect(opts.jobId).toBe("dlq-sms-inbound-job-123");

    const p = payload as DeadLetterPayload;
    expect(p.sourceQueue).toBe("sms-inbound");
    expect(p.jobName).toBe("process-sms");
    expect(p.jobId).toBe("job-123");
    expect(p.data).toEqual({ tenantId: "t1", customerPhone: "+15551234567" });
    expect(p.failedReason).toBe("API process-sms returned 500: internal error");
    expect(p.attemptsMade).toBe(3);
    expect(p.failedAt).toBeTruthy();
  });

  it("handles undefined job gracefully", async () => {
    mockAdd.mockResolvedValueOnce({});
    const err = new Error("unknown failure");

    await moveToDeadLetter("calendar-sync", undefined as never, err);

    expect(mockAdd).toHaveBeenCalledOnce();
    const [, payload] = mockAdd.mock.calls[0];
    const p = payload as DeadLetterPayload;
    expect(p.jobName).toBe("unknown");
    expect(p.jobId).toBe("unknown");
    expect(p.data).toBeNull();
  });

  it("does not throw when DLQ enqueue itself fails", async () => {
    mockAdd.mockRejectedValueOnce(new Error("Redis connection lost"));
    const err = new Error("original failure");

    // Should not throw
    await expect(
      moveToDeadLetter("provision-number", fakeJob(), err)
    ).resolves.toBeUndefined();
  });

  it("uses deterministic jobId to prevent duplicate DLQ inserts", async () => {
    mockAdd.mockResolvedValue({});
    const err = new Error("fail");
    const job = fakeJob({ id: "abc-456" });

    await moveToDeadLetter("billing-events", job, err);
    await moveToDeadLetter("billing-events", job, err);

    // Both calls use the same deterministic jobId — BullMQ deduplicates
    const ids = mockAdd.mock.calls.map((c: unknown[]) => (c[2] as { jobId: string }).jobId);
    expect(ids[0]).toBe("dlq-billing-events-abc-456");
    expect(ids[1]).toBe("dlq-billing-events-abc-456");
  });
});
