import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockGetJobs } = vi.hoisted(() => ({
  mockGetJobs: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Queue: class MockQueue {
    add = vi.fn();
    close = vi.fn();
    getJobs = mockGetJobs;
  },
  Job: class MockJob {},
}));

vi.mock("../queues/redis", () => ({
  bullmqConnection: { host: "localhost", port: 6379 },
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
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("GET /internal/dlq", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns DLQ entries with correct shape", async () => {
    mockGetJobs.mockResolvedValueOnce([fakeDlqJob()]);
    const app = buildApp();

    const res = await app.inject({ method: "GET", url: "/internal/dlq" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual({
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
