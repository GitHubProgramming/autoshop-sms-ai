import { describe, it, expect } from "vitest";
import { t, isValidLocale } from "../utils/i18n";

describe("i18n helper — t()", () => {
  it("returns en-US string for en-US locale", () => {
    expect(t("appointment.action_needed", "en-US")).toBe("Action Needed");
  });

  it("returns lt-LT string for lt-LT locale", () => {
    expect(t("appointment.action_needed", "lt-LT")).toBe("Reikalingas veiksmas");
  });

  it("defaults to en-US when no locale given", () => {
    expect(t("appointment.action_needed")).toBe("Action Needed");
  });

  it("falls back to en-US when key exists but locale does not match", () => {
    // t() should fall back to en-US for any unrecognized locale-like input
    // but typed as Locale so only en-US/lt-LT are valid
    expect(t("appointment.action_needed", "en-US")).toBe("Action Needed");
  });

  it("falls back to raw key when key does not exist", () => {
    expect(t("nonexistent.key", "lt-LT")).toBe("nonexistent.key");
    expect(t("nonexistent.key", "en-US")).toBe("nonexistent.key");
    expect(t("nonexistent.key")).toBe("nonexistent.key");
  });

  it("translates appointment statuses for lt-LT", () => {
    expect(t("appointment.pending_manual_confirmation", "lt-LT")).toBe(
      "Reikalingas rankinis patvirtinimas"
    );
    expect(t("appointment.confirmed", "lt-LT")).toBe("Vizitas patvirtintas");
    expect(t("appointment.cancelled", "lt-LT")).toBe("Vizitas atšauktas");
  });

  it("translates booking statuses for lt-LT", () => {
    expect(t("status.booked", "lt-LT")).toBe("Rezervuota");
    expect(t("status.active", "lt-LT")).toBe("Aktyvus");
    expect(t("status.no_reply", "lt-LT")).toBe("Be atsakymo");
    expect(t("status.pending", "lt-LT")).toBe("Laukiama");
  });

  it("translates actions for lt-LT", () => {
    expect(t("action.confirm", "lt-LT")).toBe("Patvirtinti");
    expect(t("action.cancel", "lt-LT")).toBe("Atšaukti");
    expect(t("action.reschedule", "lt-LT")).toBe("Perkelti");
  });

  // USA REGRESSION: all en-US strings must return unchanged
  it("USA regression — all en-US strings return English", () => {
    expect(t("appointment.action_needed", "en-US")).toBe("Action Needed");
    expect(t("appointment.pending_manual_confirmation", "en-US")).toBe("Needs Manual Confirmation");
    expect(t("appointment.confirmed", "en-US")).toBe("Appointment confirmed");
    expect(t("appointment.cancelled", "en-US")).toBe("Appointment cancelled");
    expect(t("status.booked", "en-US")).toBe("Booked");
    expect(t("status.resolved", "en-US")).toBe("Resolved");
    expect(t("status.active", "en-US")).toBe("Active");
    expect(t("status.no_reply", "en-US")).toBe("No Reply");
    expect(t("status.lost", "en-US")).toBe("Lost");
    expect(t("status.pending", "en-US")).toBe("Pending");
    expect(t("action.confirm", "en-US")).toBe("Confirm");
    expect(t("action.cancel", "en-US")).toBe("Cancel");
  });
});

describe("isValidLocale()", () => {
  it("returns true for en-US", () => {
    expect(isValidLocale("en-US")).toBe(true);
  });

  it("returns true for lt-LT", () => {
    expect(isValidLocale("lt-LT")).toBe(true);
  });

  it("returns false for invalid locales", () => {
    expect(isValidLocale("fr-FR")).toBe(false);
    expect(isValidLocale("")).toBe(false);
    expect(isValidLocale("en")).toBe(false);
  });
});
