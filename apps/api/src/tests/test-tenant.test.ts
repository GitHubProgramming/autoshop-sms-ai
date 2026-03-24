import { describe, it, expect } from "vitest";
import { isTestSignupEmail } from "../utils/test-tenant";

describe("isTestSignupEmail", () => {
  it("does NOT match the pilot base email (real tenant)", () => {
    expect(isTestSignupEmail("mantas.gipiskis@gmail.com")).toBe(false);
  });

  it("matches plus-alias variants (test tenants)", () => {
    expect(isTestSignupEmail("mantas.gipiskis+test@gmail.com")).toBe(true);
    expect(isTestSignupEmail("mantas.gipiskis+shop1@gmail.com")).toBe(true);
    expect(isTestSignupEmail("mantas.gipiskis+anything123@gmail.com")).toBe(true);
  });

  it("rejects plus with empty alias", () => {
    expect(isTestSignupEmail("mantas.gipiskis+@gmail.com")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isTestSignupEmail("Mantas.Gipiskis+TEST@Gmail.com")).toBe(true);
    expect(isTestSignupEmail("MANTAS.GIPISKIS+TEST@GMAIL.COM")).toBe(true);
  });

  it("handles whitespace", () => {
    expect(isTestSignupEmail("  mantas.gipiskis+test@gmail.com  ")).toBe(true);
  });

  it("rejects non-test emails", () => {
    expect(isTestSignupEmail("user@gmail.com")).toBe(false);
    expect(isTestSignupEmail("mantas@gmail.com")).toBe(false);
    expect(isTestSignupEmail("mantas.gipiskis@yahoo.com")).toBe(false);
    expect(isTestSignupEmail("other.mantas.gipiskis@gmail.com")).toBe(false);
    expect(isTestSignupEmail("mantas.gipiskis@gmail.com.evil.com")).toBe(false);
  });

  it("rejects empty and invalid input", () => {
    expect(isTestSignupEmail("")).toBe(false);
    expect(isTestSignupEmail("not-an-email")).toBe(false);
  });
});
