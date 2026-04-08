import { describe, it, expect } from "vitest";
import { isPilotTenant, isUsTenant } from "../utils/tenant-region";

describe("tenant-region helpers", () => {
  it("isPilotTenant returns true when is_pilot_tenant is true", () => {
    expect(isPilotTenant({ is_pilot_tenant: true })).toBe(true);
  });

  it("isPilotTenant returns false when is_pilot_tenant is false", () => {
    expect(isPilotTenant({ is_pilot_tenant: false })).toBe(false);
  });

  it("isUsTenant returns false when is_pilot_tenant is true", () => {
    expect(isUsTenant({ is_pilot_tenant: true })).toBe(false);
  });

  it("isUsTenant returns true when is_pilot_tenant is false", () => {
    expect(isUsTenant({ is_pilot_tenant: false })).toBe(true);
  });

  it.each([
    { is_pilot_tenant: true },
    { is_pilot_tenant: false },
  ])("isPilotTenant and isUsTenant are pure inverses for %o", (t) => {
    expect(isPilotTenant(t)).toBe(!isUsTenant(t));
  });
});
