import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: (...args: unknown[]) => mockQuery(...args),
  withTenant: vi.fn(),
}));

import {
  startTrace,
  resumeTrace,
  findTraceByTriggerId,
  getRecentTraces,
  getTraceById,
} from "../services/pipeline-trace";

// ── Setup ────────────────────────────────────────────────────────────────────

const TRACE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue([]);
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("pipeline-trace", () => {
  describe("startTrace", () => {
    it("inserts a new trace and returns a handle", async () => {
      mockQuery.mockResolvedValueOnce([{ id: TRACE_ID }]);

      const handle = await startTrace({
        triggerType: "inbound_sms",
        triggerId: "SM123",
        customerPhone: "+15551234567",
      });

      expect(handle.id).toBe(TRACE_ID);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][0]).toContain("INSERT INTO pipeline_traces");
      expect(mockQuery.mock.calls[0][1]).toEqual([
        "inbound_sms",
        "SM123",
        "+15551234567",
        null,
      ]);
    });

    it("accepts optional tenantId", async () => {
      mockQuery.mockResolvedValueOnce([{ id: TRACE_ID }]);

      await startTrace({
        triggerType: "missed_call",
        triggerId: "CA456",
        customerPhone: "+15559999999",
        tenantId: "tenant-1",
      });

      expect(mockQuery.mock.calls[0][1]).toEqual([
        "missed_call",
        "CA456",
        "+15559999999",
        "tenant-1",
      ]);
    });
  });

  describe("TraceHandle.step", () => {
    it("appends a step via JSONB concat", async () => {
      mockQuery.mockResolvedValueOnce([{ id: TRACE_ID }]);
      const handle = await startTrace({
        triggerType: "inbound_sms",
        triggerId: "SM123",
        customerPhone: "+15551234567",
      });

      mockQuery.mockResolvedValueOnce([]);
      await handle.step("webhook_received", "ok", "POST /webhooks/twilio/sms");

      expect(mockQuery).toHaveBeenCalledTimes(2);
      const stepCall = mockQuery.mock.calls[1];
      expect(stepCall[0]).toContain("steps || $1::jsonb");
      const stepData = JSON.parse(stepCall[1][0]);
      expect(stepData).toHaveLength(1);
      expect(stepData[0].step).toBe("webhook_received");
      expect(stepData[0].status).toBe("ok");
      expect(stepData[0].detail).toBe("POST /webhooks/twilio/sms");
      expect(stepData[0].at).toBeDefined();
    });

    it("records duration if provided", async () => {
      mockQuery.mockResolvedValueOnce([{ id: TRACE_ID }]);
      const handle = await startTrace({
        triggerType: "inbound_sms",
        triggerId: "SM123",
        customerPhone: "+15551234567",
      });

      mockQuery.mockResolvedValueOnce([]);
      await handle.step("ai_replied", "ok", "200 chars", 350);

      const stepData = JSON.parse(mockQuery.mock.calls[1][1][0]);
      expect(stepData[0].ms).toBe(350);
    });

    it("silently ignores db errors (non-fatal)", async () => {
      mockQuery.mockResolvedValueOnce([{ id: TRACE_ID }]);
      const handle = await startTrace({
        triggerType: "inbound_sms",
        triggerId: "SM123",
        customerPhone: "+15551234567",
      });

      mockQuery.mockRejectedValueOnce(new Error("db down"));
      // Should not throw
      await handle.step("tenant_resolved", "fail", "no tenant");
    });
  });

  describe("TraceHandle.setTenant", () => {
    it("updates tenant_id on the trace", async () => {
      mockQuery.mockResolvedValueOnce([{ id: TRACE_ID }]);
      const handle = await startTrace({
        triggerType: "inbound_sms",
        triggerId: "SM123",
        customerPhone: "+15551234567",
      });

      mockQuery.mockResolvedValueOnce([]);
      await handle.setTenant("tenant-abc");

      expect(mockQuery.mock.calls[1][0]).toContain("SET tenant_id");
      expect(mockQuery.mock.calls[1][1]).toEqual(["tenant-abc", TRACE_ID]);
    });
  });

  describe("TraceHandle.complete", () => {
    it("sets status to completed with timestamp", async () => {
      mockQuery.mockResolvedValueOnce([{ id: TRACE_ID }]);
      const handle = await startTrace({
        triggerType: "inbound_sms",
        triggerId: "SM123",
        customerPhone: "+15551234567",
      });

      mockQuery.mockResolvedValueOnce([]);
      await handle.complete();

      expect(mockQuery.mock.calls[1][0]).toContain("status = 'completed'");
      expect(mockQuery.mock.calls[1][0]).toContain("completed_at = now()");
    });
  });

  describe("TraceHandle.fail", () => {
    it("sets status to failed with error summary", async () => {
      mockQuery.mockResolvedValueOnce([{ id: TRACE_ID }]);
      const handle = await startTrace({
        triggerType: "inbound_sms",
        triggerId: "SM123",
        customerPhone: "+15551234567",
      });

      mockQuery.mockResolvedValueOnce([]);
      await handle.fail("No tenant found");

      expect(mockQuery.mock.calls[1][0]).toContain("status = 'failed'");
      expect(mockQuery.mock.calls[1][1]).toEqual(["No tenant found", TRACE_ID]);
    });
  });

  describe("resumeTrace", () => {
    it("returns a handle for an existing trace ID", async () => {
      const handle = await resumeTrace(TRACE_ID);
      expect(handle.id).toBe(TRACE_ID);
    });

    it("can add steps to a resumed trace", async () => {
      const handle = await resumeTrace(TRACE_ID);
      mockQuery.mockResolvedValueOnce([]);
      await handle.step("worker_picked_up", "ok", "started");
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe("findTraceByTriggerId", () => {
    it("returns trace id when found", async () => {
      mockQuery.mockResolvedValueOnce([{ id: TRACE_ID }]);
      const result = await findTraceByTriggerId("SM123");
      expect(result).toBe(TRACE_ID);
      expect(mockQuery.mock.calls[0][1]).toEqual(["SM123"]);
    });

    it("returns null when not found", async () => {
      mockQuery.mockResolvedValueOnce([]);
      const result = await findTraceByTriggerId("SM999");
      expect(result).toBeNull();
    });
  });

  describe("getRecentTraces", () => {
    it("queries with default limit of 50", async () => {
      mockQuery.mockResolvedValueOnce([]);
      await getRecentTraces();
      expect(mockQuery.mock.calls[0][1]).toEqual([50]);
    });

    it("queries with custom limit", async () => {
      mockQuery.mockResolvedValueOnce([]);
      await getRecentTraces(10);
      expect(mockQuery.mock.calls[0][1]).toEqual([10]);
    });

    it("returns trace records", async () => {
      const mockTrace = {
        id: TRACE_ID,
        tenant_id: "t1",
        trigger_type: "inbound_sms",
        trigger_id: "SM123",
        customer_phone: "+15551234567",
        status: "completed",
        steps: [],
        started_at: "2026-03-16T12:00:00Z",
        completed_at: "2026-03-16T12:00:02Z",
        error_summary: null,
      };
      mockQuery.mockResolvedValueOnce([mockTrace]);
      const result = await getRecentTraces();
      expect(result).toEqual([mockTrace]);
    });
  });

  describe("getTraceById", () => {
    it("returns trace when found", async () => {
      const mockTrace = { id: TRACE_ID, status: "completed" };
      mockQuery.mockResolvedValueOnce([mockTrace]);
      const result = await getTraceById(TRACE_ID);
      expect(result).toEqual(mockTrace);
    });

    it("returns null when not found", async () => {
      mockQuery.mockResolvedValueOnce([]);
      const result = await getTraceById("nonexistent");
      expect(result).toBeNull();
    });
  });
});
