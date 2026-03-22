import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockGetJobs, mockGetJob, mockAdd, mockRemove } = vi.hoisted(() => ({
  mockGetJobs: vi.fn(),
  mockGetJob: vi.fn(),
  mockAdd: vi.fn(),
  mockRemove: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Queue: class MockQueue {
    add = mockAdd;
    close = vi.fn();
    getJobs = mockGetJobs;
    getJob = mockGetJob;
  },
  Job: class MockJob {},
}));

vi.mock("../queues/redis", () => ({
  bullmqConnection: { host: "localhost", port: 6379 },
  smsInboundQueue: { add: mockAdd },
  provisionNumberQueue: { add: mockAdd },
  billingQueue: { add: mockAdd },
  calendarQueue: { add: mockAdd },
}));

import { dlqRoute } from "../routes/internal/dlq";

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = Fastify();
  app.register(dlqRoute, { prefix: "/internal" });
  return app;
}

function fakeDlqJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "dlq-sms-inbound-job-1",
    name: "dead-letter-entry",
    data: {
      sourceQueue: "sms-inbound",
      jobName: "process-sms",
      jobId: "job-1",
      data: { tenantId: "t1" },
      failedReason: "API returned 500",
      attemptsMade: 3,
      failedAt: "2026-03-22T10:00:00.000Z",
    },
    remove: mockRemove,
    ...overrides,
  };
}

// ── Tests: GET /internal/dlq ────────────────────────────────────────────────

describe("GET /internal/dlq", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns DLQ entries with correct shape including dlqJobId", async () => {
    mockGetJobs.mockResolvedValueOnce([fakeDlqJob()]);
    const app = buildApp();

    const res = await app.inject({ method: "GET", url: "/internal/dlq" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual({
      dlqJobId: "dlq-sms-inbound-job-1",
      jobId: "job-1",
      sourceQueue: "sms-inbound",
      jobName: "process-sms",
      data: { tenantId: "t1" },
      failedReason: "API returned 500",
      attemptsMade: 3,
      failedAt: "2026-03-22T10:00:00.000Z",
    });
  });

  it("returns empty array when no DLQ jobs", async () => {
    mockGetJobs.mockResolvedValueOnce([]);
    const app = buildApp();

    const res = await app.inject({ method: "GET", url: "/internal/dlq" });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual([]);
  });

  it("respects limit query param and caps at 100", async () => {
    mockGetJobs.mockResolvedValueOnce([]);
    const app = buildApp();

    await app.inject({ method: "GET", url: "/internal/dlq?limit=50" });
    expect(mockGetJobs).toHaveBeenCalledWith(
      expect.any(Array), 0, 49 // 0-indexed: limit 50 → end index 49
    );

    mockGetJobs.mockResolvedValueOnce([]);
    await app.inject({ method: "GET", url: "/internal/dlq?limit=999" });
    expect(mockGetJobs.mock.calls[1]).toEqual([
      expect.any(Array), 0, 99 // capped at 100 → end index 99
    ]);
  });

  it("sorts newest first", async () => {
    const older = fakeDlqJob({
      id: "dlq-1",
      data: { ...fakeDlqJob().data, failedAt: "2026-03-22T08:00:00.000Z", jobId: "j1" },
    });
    const newer = fakeDlqJob({
      id: "dlq-2",
      data: { ...fakeDlqJob().data, failedAt: "2026-03-22T12:00:00.000Z", jobId: "j2" },
    });
    mockGetJobs.mockResolvedValueOnce([older, newer]);
    const app = buildApp();

    const res = await app.inject({ method: "GET", url: "/internal/dlq" });
    const body = JSON.parse(res.payload);

    expect(body[0].failedAt).toBe("2026-03-22T12:00:00.000Z");
    expect(body[1].failedAt).toBe("2026-03-22T08:00:00.000Z");
  });

  it("returns 500 if queue read fails", async () => {
    mockGetJobs.mockRejectedValueOnce(new Error("Redis down"));
    const app = buildApp();

    const res = await app.inject({ method: "GET", url: "/internal/dlq" });

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.payload).error).toBe("Failed to read dead letter queue");
  });
});

// ── Tests: POST /internal/dlq/replay/:jobId ─────────────────────────────────

describe("POST /internal/dlq/replay/:jobId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("replays a DLQ job to its source queue and removes it", async () => {
    const job = fakeDlqJob();
    mockGetJob.mockResolvedValueOnce(job);
    mockAdd.mockResolvedValueOnce({ id: "new-job-42" });
    mockRemove.mockResolvedValueOnce(undefined);
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/internal/dlq/replay/dlq-sms-inbound-job-1",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toEqual({
      ok: true,
      replayedFromDlqJobId: "dlq-sms-inbound-job-1",
      sourceQueue: "sms-inbound",
      replayedJobId: "new-job-42",
    });
    expect(mockAdd).toHaveBeenCalledWith("process-sms", { tenantId: "t1" });
    expect(mockRemove).toHaveBeenCalled();
  });

  it("returns 404 when DLQ job not found", async () => {
    mockGetJob.mockResolvedValueOnce(null);
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/internal/dlq/replay/nonexistent",
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).error).toBe("DLQ job not found");
  });

  it("returns 400 for invalid payload (missing data)", async () => {
    const job = fakeDlqJob({ data: { sourceQueue: "sms-inbound" } });
    mockGetJob.mockResolvedValueOnce(job);
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/internal/dlq/replay/dlq-bad",
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toBe("Invalid DLQ payload");
  });

  it("returns 400 for unknown source queue", async () => {
    const job = fakeDlqJob({
      data: {
        ...fakeDlqJob().data,
        sourceQueue: "unknown-queue",
      },
    });
    mockGetJob.mockResolvedValueOnce(job);
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/internal/dlq/replay/dlq-unknown",
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe("Unknown source queue");
    expect(body.sourceQueue).toBe("unknown-queue");
    expect(body.allowedQueues).toContain("sms-inbound");
  });

  it("returns 500 when replay enqueue fails", async () => {
    const job = fakeDlqJob();
    mockGetJob.mockResolvedValueOnce(job);
    mockAdd.mockRejectedValueOnce(new Error("Redis down"));
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/internal/dlq/replay/dlq-sms-inbound-job-1",
    });

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.payload).error).toBe("Failed to replay DLQ job");
  });
});
