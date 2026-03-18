import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: (...args: unknown[]) => mockQuery(...args),
  withTenant: vi.fn(),
}));

vi.mock("../services/missed-call-sms", () => ({
  sendTwilioSms: vi.fn().mockResolvedValue({ sid: "SM_ALERT_001" }),
}));

import {
  raiseAlert,
  classifyError,
  alertFromTraceFailure,
  getAlerts,
  acknowledgeAlert,
  countUnacknowledgedAlerts,
} from "../services/pipeline-alerts";
import { sendTwilioSms } from "../services/missed-call-sms";

// ── Setup ────────────────────────────────────────────────────────────────────

const ALERT_ID = "11111111-2222-3333-4444-555555555555";
const TENANT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TRACE_ID = "ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb";

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue([]);
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("pipeline-alerts", () => {
  describe("raiseAlert", () => {
    it("inserts an alert record into pipeline_alerts", async () => {
      // Insert alert
      mockQuery.mockResolvedValueOnce([{ id: ALERT_ID }]);
      // Tenant lookup for SMS (critical + tenantId triggers this)
      mockQuery.mockResolvedValueOnce([{ owner_phone: null, shop_name: "Test" }]);

      const alertId = await raiseAlert({
        tenantId: TENANT_ID,
        traceId: TRACE_ID,
        severity: "critical",
        alertType: "ai_error",
        summary: "OpenAI API error 500",
        details: "Internal server error",
      });

      expect(alertId).toBe(ALERT_ID);
      expect(mockQuery.mock.calls[0][0]).toContain("INSERT INTO pipeline_alerts");
      expect(mockQuery.mock.calls[0][1]).toEqual([
        TENANT_ID,
        TRACE_ID,
        "critical",
        "ai_error",
        "OpenAI API error 500",
        "Internal server error",
      ]);
    });

    it("notifies owner via SMS for critical alerts", async () => {
      // Insert alert
      mockQuery.mockResolvedValueOnce([{ id: ALERT_ID }]);
      // Tenant lookup
      mockQuery.mockResolvedValueOnce([{ owner_phone: "+15559990000", shop_name: "Bob's Auto" }]);
      // Update owner_notified
      mockQuery.mockResolvedValueOnce([]);

      const mockFetch = vi.fn().mockResolvedValue({ ok: true });

      await raiseAlert(
        {
          tenantId: TENANT_ID,
          traceId: TRACE_ID,
          severity: "critical",
          alertType: "sms_send_failed",
          summary: "SMS delivery failed",
        },
        mockFetch as any
      );

      expect(sendTwilioSms).toHaveBeenCalledWith(
        "+15559990000",
        expect.stringContaining("AutoShop AI Alert"),
        mockFetch
      );
      // Should update owner_notified
      expect(mockQuery.mock.calls[2][0]).toContain("owner_notified = TRUE");
    });

    it("skips SMS notification for warning-severity alerts", async () => {
      mockQuery.mockResolvedValueOnce([{ id: ALERT_ID }]);

      await raiseAlert({
        tenantId: TENANT_ID,
        traceId: TRACE_ID,
        severity: "warning",
        alertType: "calendar_sync_failed",
        summary: "Calendar sync failed",
      });

      expect(sendTwilioSms).not.toHaveBeenCalled();
    });

    it("skips SMS when tenant has no owner_phone", async () => {
      mockQuery.mockResolvedValueOnce([{ id: ALERT_ID }]);
      mockQuery.mockResolvedValueOnce([{ owner_phone: null, shop_name: "Test Shop" }]);

      await raiseAlert({
        tenantId: TENANT_ID,
        traceId: TRACE_ID,
        severity: "critical",
        alertType: "ai_error",
        summary: "AI failed",
      });

      expect(sendTwilioSms).not.toHaveBeenCalled();
    });

    it("never throws even on DB error", async () => {
      mockQuery.mockRejectedValueOnce(new Error("connection refused"));

      const alertId = await raiseAlert({
        tenantId: TENANT_ID,
        traceId: null,
        severity: "critical",
        alertType: "pipeline_failed",
        summary: "DB down",
      });

      expect(alertId).toBeNull();
    });

    it("handles null tenantId without SMS lookup", async () => {
      mockQuery.mockResolvedValueOnce([{ id: ALERT_ID }]);

      const alertId = await raiseAlert({
        tenantId: null,
        traceId: null,
        severity: "critical",
        alertType: "worker_exhausted",
        summary: "Worker died",
      });

      expect(alertId).toBe(ALERT_ID);
      // Only 1 call (insert), no tenant lookup
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe("classifyError", () => {
    it("classifies OpenAI errors as ai_error/critical", () => {
      expect(classifyError("OpenAI API error 500: Internal server error")).toEqual({
        alertType: "ai_error",
        severity: "critical",
      });
    });

    it("classifies SMS failures as sms_send_failed/critical", () => {
      expect(classifyError("SMS send failed: Twilio error")).toEqual({
        alertType: "sms_send_failed",
        severity: "critical",
      });
    });

    it("classifies calendar failures as calendar_sync_failed/warning", () => {
      expect(classifyError("Calendar sync failed: no tokens")).toEqual({
        alertType: "calendar_sync_failed",
        severity: "warning",
      });
    });

    it("classifies appointment failures as booking_failed/critical", () => {
      expect(classifyError("Appointment creation failed: DB error")).toEqual({
        alertType: "booking_failed",
        severity: "critical",
      });
    });

    it("defaults to pipeline_failed/critical for unknown errors", () => {
      expect(classifyError("Something weird happened")).toEqual({
        alertType: "pipeline_failed",
        severity: "critical",
      });
    });

    it("handles null error", () => {
      expect(classifyError(null)).toEqual({
        alertType: "pipeline_failed",
        severity: "critical",
      });
    });
  });

  describe("alertFromTraceFailure", () => {
    it("creates alert with classified type and customer phone suffix", async () => {
      // Insert alert
      mockQuery.mockResolvedValueOnce([{ id: ALERT_ID }]);
      // Tenant lookup for SMS notification (critical severity)
      mockQuery.mockResolvedValueOnce([{ owner_phone: null, shop_name: "Test" }]);

      await alertFromTraceFailure(
        TENANT_ID,
        TRACE_ID,
        "OpenAI API error 429: rate limited",
        "+15551234567"
      );

      const args = mockQuery.mock.calls[0][1];
      expect(args[0]).toBe(TENANT_ID);
      expect(args[1]).toBe(TRACE_ID);
      expect(args[2]).toBe("critical");
      expect(args[3]).toBe("ai_error");
      expect(args[4]).toContain("4567"); // last 4 digits
    });
  });

  describe("getAlerts", () => {
    it("queries unacknowledged alerts by default", async () => {
      const mockAlert = {
        id: ALERT_ID,
        tenant_id: TENANT_ID,
        severity: "critical",
        alert_type: "ai_error",
        summary: "AI failed",
        acknowledged: false,
      };
      mockQuery.mockResolvedValueOnce([mockAlert]);

      const alerts = await getAlerts();

      expect(mockQuery.mock.calls[0][0]).toContain("acknowledged = $1");
      expect(mockQuery.mock.calls[0][1]).toEqual([false, 50]);
      expect(alerts).toEqual([mockAlert]);
    });

    it("supports acknowledged filter and custom limit", async () => {
      mockQuery.mockResolvedValueOnce([]);

      await getAlerts({ acknowledged: true, limit: 10 });

      expect(mockQuery.mock.calls[0][1]).toEqual([true, 10]);
    });
  });

  describe("acknowledgeAlert", () => {
    it("marks alert as acknowledged", async () => {
      mockQuery.mockResolvedValueOnce([{ id: ALERT_ID }]);

      const result = await acknowledgeAlert(ALERT_ID, "admin@example.com");

      expect(result).toBe(true);
      expect(mockQuery.mock.calls[0][0]).toContain("acknowledged = TRUE");
      expect(mockQuery.mock.calls[0][1]).toEqual(["admin@example.com", ALERT_ID]);
    });

    it("returns false if alert not found", async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await acknowledgeAlert("nonexistent", "admin@example.com");
      expect(result).toBe(false);
    });
  });

  describe("countUnacknowledgedAlerts", () => {
    it("returns count from DB", async () => {
      mockQuery.mockResolvedValueOnce([{ count: 5 }]);

      const count = await countUnacknowledgedAlerts();

      expect(count).toBe(5);
      expect(mockQuery.mock.calls[0][0]).toContain("acknowledged = FALSE");
    });

    it("returns 0 when no alerts", async () => {
      mockQuery.mockResolvedValueOnce([]);

      const count = await countUnacknowledgedAlerts();
      expect(count).toBe(0);
    });
  });
});
