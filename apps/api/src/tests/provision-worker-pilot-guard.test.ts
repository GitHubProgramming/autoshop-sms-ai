import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
const mockProvision = vi.fn();
const mockVerify = vi.fn();
const mockWelcome = vi.fn();

vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

vi.mock("../queues/redis", () => ({
  bullmqConnection: {},
}));

vi.mock("../queues/dead-letter", () => ({
  moveToDeadLetter: vi.fn(),
}));

vi.mock("../services/twilio-provisioning", () => ({
  provisionNumberForTenant: (...args: unknown[]) => mockProvision(...args),
  verifyNumberInMessagingService: (...args: unknown[]) => mockVerify(...args),
}));

vi.mock("../services/welcome-email", () => ({
  sendWelcomeEmailForProvisionedTenant: (...args: unknown[]) => mockWelcome(...args),
}));

import { __test__ } from "../workers/provision-number.worker";
const { processProvisionJob } = __test__;

const TENANT_ID = "00000000-0000-0000-0000-000000000abc";

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    data: { tenantId: TENANT_ID, ...overrides },
  } as any;
}

describe("provision-number worker — pilot tenant guard", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockProvision.mockReset();
    mockVerify.mockReset();
    mockWelcome.mockReset();
  });

  it("US tenant baseline — runs full provisioning when is_pilot_tenant=false (regression)", async () => {
    mockQuery
      .mockResolvedValueOnce(undefined) // setProvisioningState 'provisioning'
      .mockResolvedValueOnce([
        { shop_name: "Joe's Auto", owner_phone: "+15125551234", is_pilot_tenant: false },
      ]) // SELECT tenant
      .mockResolvedValueOnce([]) // SELECT existing tenant_phone_numbers (none)
      .mockResolvedValueOnce(undefined) // INSERT tenant_phone_numbers
      .mockResolvedValueOnce(undefined); // setProvisioningState 'ready'

    mockProvision.mockResolvedValueOnce({
      sid: "PN123",
      phoneNumber: "+15125559999",
      areaCodeUsed: "512",
      attemptedAreaCodes: ["512"],
    });

    const result = await processProvisionJob(makeJob());

    expect(mockProvision).toHaveBeenCalledTimes(1);
    expect(mockProvision).toHaveBeenCalledWith(
      expect.objectContaining({ preferredAreaCode: "512", shopName: "Joe's Auto" }),
    );
    expect(result).toEqual({ success: true, phoneNumber: "+15125559999", sid: "PN123" });
  });

  it("LT pilot tenant — skips Twilio provisioning when is_pilot_tenant=true", async () => {
    mockQuery
      .mockResolvedValueOnce(undefined) // setProvisioningState 'provisioning'
      .mockResolvedValueOnce([
        { shop_name: "Proteros Servisas", owner_phone: "+37067577829", is_pilot_tenant: true },
      ]) // SELECT tenant
      .mockResolvedValueOnce(undefined); // setProvisioningState 'ready' (from guard)

    const result = await processProvisionJob(makeJob());

    expect(mockProvision).not.toHaveBeenCalled();
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockWelcome).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });
});
