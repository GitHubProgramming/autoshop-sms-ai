import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  sendTwilioSms: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

vi.mock("../services/missed-call-sms", () => ({
  sendTwilioSms: mocks.sendTwilioSms,
}));

import { checkAndNotifyUsage } from "../services/usage-warnings";

// ── Constants ────────────────────────────────────────────────────────────────

const TENANT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("checkAndNotifyUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendTwilioSms.mockResolvedValue({ sid: "SM_WARN_001", error: null, numSegments: 1 });
  });

  it("returns 'none' when no warning threshold crossed", async () => {
    mocks.query
      .mockResolvedValueOnce([{ check_usage_warnings: "none" }]); // DB function

    const result = await checkAndNotifyUsage(TENANT_ID);

    expect(result).toBe("none");
    expect(mocks.sendTwilioSms).not.toHaveBeenCalled();
  });

  it("sends 80% warning SMS to owner phone", async () => {
    mocks.query
      .mockResolvedValueOnce([{ check_usage_warnings: "warn_80" }])
      .mockResolvedValueOnce([{
        owner_phone: "+15125551234",
        shop_name: "Mike's Auto",
        conv_used_this_cycle: 40,
        conv_limit_this_cycle: 50,
      }]);

    const result = await checkAndNotifyUsage(TENANT_ID);

    expect(result).toBe("warn_80");
    expect(mocks.sendTwilioSms).toHaveBeenCalledTimes(1);
    const smsBody = mocks.sendTwilioSms.mock.calls[0][1] as string;
    expect(smsBody).toContain("80%");
    expect(smsBody).toContain("Mike's Auto");
    expect(smsBody).toContain("40/50");
  });

  it("sends 100% warning SMS to owner phone", async () => {
    mocks.query
      .mockResolvedValueOnce([{ check_usage_warnings: "warn_100" }])
      .mockResolvedValueOnce([{
        owner_phone: "+15125551234",
        shop_name: "Mike's Auto",
        conv_used_this_cycle: 50,
        conv_limit_this_cycle: 50,
      }]);

    const result = await checkAndNotifyUsage(TENANT_ID);

    expect(result).toBe("warn_100");
    expect(mocks.sendTwilioSms).toHaveBeenCalledTimes(1);
    const smsBody = mocks.sendTwilioSms.mock.calls[0][1] as string;
    expect(smsBody).toContain("reached your conversation limit");
    expect(smsBody).toContain("50/50");
  });

  it("skips SMS when owner has no phone number", async () => {
    mocks.query
      .mockResolvedValueOnce([{ check_usage_warnings: "warn_80" }])
      .mockResolvedValueOnce([{
        owner_phone: null,
        shop_name: "Mike's Auto",
        conv_used_this_cycle: 40,
        conv_limit_this_cycle: 50,
      }]);

    const result = await checkAndNotifyUsage(TENANT_ID);

    expect(result).toBe("warn_80");
    expect(mocks.sendTwilioSms).not.toHaveBeenCalled();
  });

  it("never throws — returns 'none' on error", async () => {
    mocks.query.mockRejectedValueOnce(new Error("connection refused"));

    const result = await checkAndNotifyUsage(TENANT_ID);

    expect(result).toBe("none");
  });

  it("uses default shop label when shop_name is null", async () => {
    mocks.query
      .mockResolvedValueOnce([{ check_usage_warnings: "warn_80" }])
      .mockResolvedValueOnce([{
        owner_phone: "+15125551234",
        shop_name: null,
        conv_used_this_cycle: 40,
        conv_limit_this_cycle: 50,
      }]);

    await checkAndNotifyUsage(TENANT_ID);

    const smsBody = mocks.sendTwilioSms.mock.calls[0][1] as string;
    expect(smsBody).toContain("Your shop");
  });

  it("calls check_usage_warnings DB function with tenant ID", async () => {
    mocks.query.mockResolvedValueOnce([{ check_usage_warnings: "none" }]);

    await checkAndNotifyUsage(TENANT_ID);

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("check_usage_warnings"),
      [TENANT_ID]
    );
  });
});
