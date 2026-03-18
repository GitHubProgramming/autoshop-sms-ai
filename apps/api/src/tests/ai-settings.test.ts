import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

import {
  mergeWithDefaults,
  buildRuntimePolicy,
  getMissingRequiredFields,
  getMissingFieldLabels,
  buildPromptPolicySection,
  getTenantAiPolicy,
  AI_SETTINGS_DEFAULTS,
  type AiRuntimePolicy,
  type ConversationCollectedData,
} from "../services/ai-settings";

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// mergeWithDefaults
// ═══════════════════════════════════════════════════════════════════════════

describe("mergeWithDefaults", () => {
  it("returns defaults for null input", () => {
    const result = mergeWithDefaults(null);
    expect(result).toEqual(AI_SETTINGS_DEFAULTS);
  });

  it("returns defaults for undefined input", () => {
    const result = mergeWithDefaults(undefined);
    expect(result).toEqual(AI_SETTINGS_DEFAULTS);
  });

  it("returns defaults for empty object", () => {
    const result = mergeWithDefaults({});
    expect(result.tone).toBe("direct");
    expect(result.requiredFields.customerName).toBe(true);
  });

  it("merges structured format correctly", () => {
    const input = {
      tone: "friendly",
      greetingStyle: "standard",
      requiredFields: {
        customerName: true,
        carModel: false,
        issueDescription: true,
        preferredTime: true,
        licensePlate: true,
        phoneConfirmation: false,
      },
    };
    const result = mergeWithDefaults(input);
    expect(result.tone).toBe("friendly");
    expect(result.greetingStyle).toBe("standard");
    expect(result.requiredFields.carModel).toBe(false);
    expect(result.requiredFields.licensePlate).toBe(true);
    // Non-provided sections use defaults
    expect(result.bookingStrategy.offerEarliestSlot).toBe(true);
  });

  it("handles legacy flat format (frontend localStorage)", () => {
    const legacy = {
      tone: "professional",
      greetingStyle: "short",
      reqName: true,
      reqCar: true,
      reqIssue: false,
      reqTime: true,
      reqPlate: false,
      reqPhone: false,
      offerEarliest: true,
      limitedSlots: false,
      openScheduling: true,
      upsellEnabled: false,
      escalationEnabled: true,
      afterHours: "promise_callback",
      missedSmsEnabled: false,
      smsPreset: "2",
      smsTemplate: "Custom template",
    };
    const result = mergeWithDefaults(legacy);
    expect(result.requiredFields.issueDescription).toBe(false);
    expect(result.bookingStrategy.limitedSlots).toBe(false);
    expect(result.bookingStrategy.openScheduling).toBe(true);
    expect(result.bookingStrategy.afterHoursBehavior).toBe("promise_callback");
    expect(result.missedCallSms.enabled).toBe(false);
    expect(result.missedCallSms.preset).toBe("2");
  });

  it("rejects invalid tone values", () => {
    const result = mergeWithDefaults({ tone: "aggressive" });
    expect(result.tone).toBe("direct"); // falls back to default
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// buildRuntimePolicy
// ═══════════════════════════════════════════════════════════════════════════

describe("buildRuntimePolicy", () => {
  it("separates required and optional fields", () => {
    const settings = mergeWithDefaults(null);
    const policy = buildRuntimePolicy(settings);

    expect(policy.requiredFields).toContain("customerName");
    expect(policy.requiredFields).toContain("carModel");
    expect(policy.requiredFields).toContain("issueDescription");
    expect(policy.requiredFields).toContain("preferredTime");
    expect(policy.optionalFields).toContain("licensePlate");
    expect(policy.optionalFields).toContain("phoneConfirmation");
  });

  it("resolves SMS preset 1 template", () => {
    const settings = mergeWithDefaults(null);
    const policy = buildRuntimePolicy(settings);
    expect(policy.missedCallSmsTemplate).toContain("missed your call");
  });

  it("resolves SMS preset 3 template", () => {
    const settings = mergeWithDefaults({
      missedCallSms: { preset: "3", template: "", enabled: true },
    });
    const policy = buildRuntimePolicy(settings);
    expect(policy.missedCallSmsTemplate).toBe(
      "Missed your call. Send issue + car + time."
    );
  });

  it("uses custom template when preset is custom", () => {
    const settings = mergeWithDefaults({
      missedCallSms: {
        preset: "custom",
        template: "Hey, call us back!",
        enabled: true,
      },
    });
    const policy = buildRuntimePolicy(settings);
    expect(policy.missedCallSmsTemplate).toBe("Hey, call us back!");
  });

  it("flattens booking strategy flags", () => {
    const settings = mergeWithDefaults({
      bookingStrategy: {
        offerEarliestSlot: false,
        limitedSlots: true,
        openScheduling: true,
        suggestAdditionalServices: true,
        escalateUncertainCases: false,
        afterHoursBehavior: "ask_urgent",
      },
    });
    const policy = buildRuntimePolicy(settings);
    expect(policy.offerEarliestSlot).toBe(false);
    expect(policy.limitedSlots).toBe(true);
    expect(policy.openScheduling).toBe(true);
    expect(policy.suggestAdditionalServices).toBe(true);
    expect(policy.escalateUncertainCases).toBe(false);
    expect(policy.afterHoursBehavior).toBe("ask_urgent");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getMissingRequiredFields — SCENARIO VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

describe("getMissingRequiredFields", () => {
  const defaultPolicy = buildRuntimePolicy(mergeWithDefaults(null));

  // Scenario A: License Plate OFF → AI books without plate
  it("Scenario A: license plate OFF — does not require plate", () => {
    const collected: ConversationCollectedData = {
      customerName: "John",
      carModel: "Honda Civic",
      issueDescription: "brake repair",
      preferredTime: "2026-03-20T10:00:00",
      licensePlate: null,
      phoneConfirmation: null,
    };
    const missing = getMissingRequiredFields(defaultPolicy, collected);
    expect(missing).toEqual([]);
  });

  // Scenario B: License Plate ON → AI asks for plate before booking
  it("Scenario B: license plate ON — requires plate", () => {
    const settings = mergeWithDefaults({
      requiredFields: {
        customerName: true,
        carModel: true,
        issueDescription: true,
        preferredTime: true,
        licensePlate: true,
        phoneConfirmation: false,
      },
    });
    const policy = buildRuntimePolicy(settings);

    const collected: ConversationCollectedData = {
      customerName: "John",
      carModel: "Honda Civic",
      issueDescription: "brake repair",
      preferredTime: "2026-03-20T10:00:00",
      licensePlate: null,
      phoneConfirmation: null,
    };
    const missing = getMissingRequiredFields(policy, collected);
    expect(missing).toEqual(["licensePlate"]);
  });

  // Scenario E: Required fields incomplete → booking creation blocked
  it("Scenario E: required fields incomplete — blocks booking", () => {
    const collected: ConversationCollectedData = {
      customerName: "John",
      carModel: null,
      issueDescription: null,
      preferredTime: "2026-03-20T10:00:00",
    };
    const missing = getMissingRequiredFields(defaultPolicy, collected);
    expect(missing).toContain("carModel");
    expect(missing).toContain("issueDescription");
    expect(missing.length).toBe(2);
  });

  // Scenario F: All required fields present → booking proceeds normally
  it("Scenario F: all required fields present — no missing", () => {
    const collected: ConversationCollectedData = {
      customerName: "Jane Doe",
      carModel: "Toyota Camry",
      issueDescription: "oil change",
      preferredTime: "2026-03-20T14:00:00",
    };
    const missing = getMissingRequiredFields(defaultPolicy, collected);
    expect(missing).toEqual([]);
  });

  it("treats empty string as missing", () => {
    const collected: ConversationCollectedData = {
      customerName: "",
      carModel: "Ford F-150",
      issueDescription: "tire rotation",
      preferredTime: "2026-03-20T10:00:00",
    };
    const missing = getMissingRequiredFields(defaultPolicy, collected);
    expect(missing).toContain("customerName");
  });

  it("treats whitespace-only string as missing", () => {
    const collected: ConversationCollectedData = {
      customerName: "  ",
      carModel: "Ford F-150",
      issueDescription: "tire rotation",
      preferredTime: "2026-03-20T10:00:00",
    };
    const missing = getMissingRequiredFields(defaultPolicy, collected);
    expect(missing).toContain("customerName");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getMissingFieldLabels
// ═══════════════════════════════════════════════════════════════════════════

describe("getMissingFieldLabels", () => {
  it("returns human-readable labels", () => {
    const labels = getMissingFieldLabels(["customerName", "carModel"]);
    expect(labels).toEqual(["customer name", "car make and model"]);
  });

  it("falls back to key name for unknown fields", () => {
    const labels = getMissingFieldLabels(["unknownField"]);
    expect(labels).toEqual(["unknownField"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// buildPromptPolicySection
// ═══════════════════════════════════════════════════════════════════════════

describe("buildPromptPolicySection", () => {
  it("includes tone instruction", () => {
    const policy = buildRuntimePolicy(mergeWithDefaults({ tone: "friendly" }));
    const prompt = buildPromptPolicySection(policy);
    expect(prompt).toContain("warm, friendly");
  });

  it("includes required fields instruction", () => {
    const policy = buildRuntimePolicy(mergeWithDefaults(null));
    const prompt = buildPromptPolicySection(policy);
    expect(prompt).toContain("customer name");
    expect(prompt).toContain("MUST collect ALL");
    expect(prompt).toContain("Do NOT confirm");
  });

  it("includes greeting=none instruction", () => {
    const policy = buildRuntimePolicy(
      mergeWithDefaults({ greetingStyle: "none" })
    );
    const prompt = buildPromptPolicySection(policy);
    expect(prompt).toContain("Do not use a greeting");
  });

  // Scenario D: Limited slots ON → AI shows max 2-3 options
  it("Scenario D: limited slots ON — prompt includes 2-3 limit", () => {
    const policy = buildRuntimePolicy(mergeWithDefaults(null));
    const prompt = buildPromptPolicySection(policy);
    expect(prompt).toContain("maximum of 2-3");
  });

  it("open scheduling OFF — no vague time questions", () => {
    const policy = buildRuntimePolicy(mergeWithDefaults(null));
    const prompt = buildPromptPolicySection(policy);
    expect(prompt).toContain("Do NOT ask vague");
  });

  it("includes restrictions when set", () => {
    const settings = mergeWithDefaults({
      shopContext: { services: "", restrictions: "No price quotes" },
    });
    const policy = buildRuntimePolicy(settings);
    const prompt = buildPromptPolicySection(policy);
    expect(prompt).toContain("No price quotes");
  });

  it("includes no-hallucination rule", () => {
    const policy = buildRuntimePolicy(mergeWithDefaults(null));
    const prompt = buildPromptPolicySection(policy);
    expect(prompt).toContain("Never invent or hallucinate");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getTenantAiPolicy — DB integration
// ═══════════════════════════════════════════════════════════════════════════

describe("getTenantAiPolicy", () => {
  it("returns defaults when tenant has no ai_settings", async () => {
    mocks.query.mockResolvedValueOnce([{ ai_settings: null }]);
    const policy = await getTenantAiPolicy("tenant-123");
    expect(policy.tone).toBe("direct");
    expect(policy.requiredFields).toContain("customerName");
    expect(policy.missedCallSmsEnabled).toBe(true);
  });

  it("returns stored settings merged with defaults", async () => {
    mocks.query.mockResolvedValueOnce([
      {
        ai_settings: {
          tone: "professional",
          requiredFields: { customerName: true, carModel: false, issueDescription: true, preferredTime: true, licensePlate: true, phoneConfirmation: false },
        },
      },
    ]);
    const policy = await getTenantAiPolicy("tenant-123");
    expect(policy.tone).toBe("professional");
    expect(policy.requiredFields).not.toContain("carModel");
    expect(policy.requiredFields).toContain("licensePlate");
  });

  // Scenario C: Missed-call SMS OFF → check the flag
  it("Scenario C: missed-call SMS OFF — policy reflects disabled", async () => {
    mocks.query.mockResolvedValueOnce([
      {
        ai_settings: {
          missedCallSms: { enabled: false, preset: "1", template: "" },
        },
      },
    ]);
    const policy = await getTenantAiPolicy("tenant-123");
    expect(policy.missedCallSmsEnabled).toBe(false);
  });

  it("returns defaults on DB error", async () => {
    mocks.query.mockRejectedValueOnce(new Error("DB down"));
    const policy = await getTenantAiPolicy("tenant-123");
    expect(policy.tone).toBe("direct");
    expect(policy.requiredFields.length).toBe(4);
  });
});
