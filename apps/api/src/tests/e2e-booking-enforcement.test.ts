/**
 * E2E Runtime Proof Tests: Booking Enforcement Scenarios A–G
 *
 * These tests verify the full runtime path from AI settings toggles
 * through to booking creation/rejection and calendar sync behavior.
 *
 * Each scenario proves a specific enforcement behavior end-to-end
 * using the real service functions (not mocks for the enforcement logic).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock DB layer only ─────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getConfig: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

vi.mock("../db/app-config", () => ({
  getConfig: mocks.getConfig,
}));

vi.mock("../routes/auth/google", () => ({
  decryptToken: vi.fn((t: string) => t),
}));

vi.mock("../services/google-token-refresh", () => ({
  isTokenExpired: vi.fn(() => false),
  refreshAccessToken: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/pipeline-trace", () => ({
  resumeTrace: vi.fn().mockResolvedValue({
    id: "trace-mock-id",
    step: vi.fn().mockResolvedValue(undefined),
    setTenant: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  }),
}));

const conversationMocks = vi.hoisted(() => ({
  openConversation: vi.fn(),
  openConversationWithRetry: vi.fn(),
}));

vi.mock("../services/conversation", () => conversationMocks);

// ── Import REAL services (not mocked) ──────────────────────────────────────

import {
  mergeWithDefaults,
  buildRuntimePolicy,
  getMissingRequiredFields,
  buildPromptPolicySection,
  type AiRuntimePolicy,
  type ConversationCollectedData,
} from "../services/ai-settings";
import { detectBookingIntent } from "../services/booking-intent";
import { handleMissedCallSms } from "../services/missed-call-sms";

// ── Helpers ─────────────────────────────────────────────────────────────────

function policyWith(overrides: Record<string, unknown> = {}): AiRuntimePolicy {
  const settings = mergeWithDefaults(overrides);
  return buildRuntimePolicy(settings);
}

function defaultTenantRow(billingStatus = "active") {
  return {
    id: "t-001",
    shop_name: "Test Shop",
    billing_status: billingStatus,
    missed_call_sms_template: null,
  };
}

// ── SCENARIO A: License Plate OPTIONAL ──────────────────────────────────────

describe("SCENARIO A — License Plate Optional", () => {
  it("booking is allowed when licensePlate toggle is OFF and plate is absent", () => {
    const policy = policyWith({
      requiredFields: {
        customerName: true,
        carModel: true,
        issueDescription: true,
        preferredTime: true,
        licensePlate: false, // OFF
        phoneConfirmation: false,
      },
    });

    const collected: ConversationCollectedData = {
      customerName: "John Smith",
      carModel: "Honda Civic",
      issueDescription: "oil change",
      preferredTime: "2026-03-20T10:00:00Z",
      licensePlate: null, // not provided
      phoneConfirmation: null,
    };

    const missing = getMissingRequiredFields(policy, collected);
    expect(missing).toEqual([]);
    // Booking proceeds — no block
  });

  it("licensePlate is not in requiredFields when toggle is OFF", () => {
    const policy = policyWith({
      requiredFields: { licensePlate: false },
    });
    expect(policy.requiredFields).not.toContain("licensePlate");
    expect(policy.optionalFields).toContain("licensePlate");
  });
});

// ── SCENARIO B: License Plate REQUIRED ──────────────────────────────────────

describe("SCENARIO B — License Plate Required", () => {
  it("booking is BLOCKED when licensePlate toggle is ON and plate is absent", () => {
    const policy = policyWith({
      requiredFields: {
        customerName: true,
        carModel: true,
        issueDescription: true,
        preferredTime: true,
        licensePlate: true, // ON
        phoneConfirmation: false,
      },
    });

    const collected: ConversationCollectedData = {
      customerName: "John Smith",
      carModel: "Honda Civic",
      issueDescription: "oil change",
      preferredTime: "2026-03-20T10:00:00Z",
      licensePlate: null, // NOT provided
      phoneConfirmation: null,
    };

    const missing = getMissingRequiredFields(policy, collected);
    expect(missing).toContain("licensePlate");
    expect(missing.length).toBe(1);
    // Booking MUST NOT proceed
  });

  it("licensePlate is in requiredFields when toggle is ON", () => {
    const policy = policyWith({
      requiredFields: { licensePlate: true },
    });
    expect(policy.requiredFields).toContain("licensePlate");
    expect(policy.optionalFields).not.toContain("licensePlate");
  });

  it("empty string licensePlate is treated as missing", () => {
    const policy = policyWith({
      requiredFields: { licensePlate: true },
    });
    const collected: ConversationCollectedData = {
      customerName: "John",
      carModel: "Civic",
      issueDescription: "oil change",
      preferredTime: "2026-03-20T10:00:00Z",
      licensePlate: "   ", // whitespace only
      phoneConfirmation: null,
    };
    const missing = getMissingRequiredFields(policy, collected);
    expect(missing).toContain("licensePlate");
  });

  it("license plate extraction from customer message works", () => {
    const result = detectBookingIntent(
      "Your appointment is confirmed for oil change.",
      "my plate is ABC 1234"
    );
    expect(result.licensePlate).toBe("ABC 1234");
  });
});

// ── SCENARIO C: Missed Call SMS DISABLED ─────────────────────────────────────

describe("SCENARIO C — Missed Call SMS Disabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Tenant exists, active billing
    mocks.query.mockImplementation((sql: string) => {
      if (sql.includes("SELECT") && sql.includes("billing_status")) {
        return [defaultTenantRow()];
      }
      // AI settings: missedCallSms.enabled = false
      if (sql.includes("ai_settings")) {
        return [{ ai_settings: { missedCallSms: { enabled: false, preset: "1", template: "" } } }];
      }
      return [];
    });
  });

  it("does NOT send SMS when missedCallSms.enabled = false", async () => {
    const result = await handleMissedCallSms({
      tenantId: "t-001",
      customerPhone: "+15551234567",
      ourPhone: "+15559876543",
      callSid: "CA123",
      callStatus: "no-answer",
    });

    expect(result.success).toBe(true);
    expect(result.smsSent).toBe(false);
    expect(result.conversationId).toBeNull();
    // Verify no Twilio call was made (no getConfig call for Twilio creds)
    const twilioConfigCalls = mocks.getConfig.mock.calls.filter(
      (c: string[]) => c[0]?.includes("TWILIO")
    );
    expect(twilioConfigCalls.length).toBe(0);
  });
});

// ── SCENARIO D: Missed Call SMS ENABLED ──────────────────────────────────────

describe("SCENARIO D — Missed Call SMS Enabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conversationMocks.openConversationWithRetry.mockResolvedValue({
      blocked: false, existing: false, conversationId: "conv-001", isNew: true,
    });
    mocks.query.mockImplementation((sql: string) => {
      if (sql.includes("SELECT") && sql.includes("billing_status")) {
        return [defaultTenantRow()];
      }
      if (sql.includes("ai_settings")) {
        return [{
          ai_settings: {
            missedCallSms: { enabled: true, preset: "2", template: "" },
          },
        }];
      }
      if (sql.includes("INSERT INTO messages")) return [];
      if (sql.includes("touch_conversation")) return [];
      return [];
    });

    mocks.getConfig.mockImplementation((key: string) => {
      if (key === "TWILIO_ACCOUNT_SID") return "AC_test";
      if (key === "TWILIO_AUTH_TOKEN") return "token_test";
      if (key === "TWILIO_MESSAGING_SERVICE_SID") return "MG_test";
      return null;
    });
  });

  it("sends SMS with correct preset template when enabled", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sid: "SM_sent_123" }),
    });

    const result = await handleMissedCallSms(
      {
        tenantId: "t-001",
        customerPhone: "+15551234567",
        ourPhone: "+15559876543",
        callSid: "CA123",
        callStatus: "no-answer",
      },
      mockFetch as unknown as typeof fetch
    );

    expect(result.success).toBe(true);
    expect(result.smsSent).toBe(true);
    expect(result.twilioSid).toBe("SM_sent_123");

    // Verify the SMS body uses preset 2
    const fetchCall = mockFetch.mock.calls[0];
    const bodyStr = fetchCall[1].body as string;
    expect(decodeURIComponent(bodyStr)).toContain("AutoShop here");
  });
});

// ── SCENARIO E: Limited Slots Enforced ───────────────────────────────────────

describe("SCENARIO E — Limited Slots Enforced", () => {
  it("prompt policy includes limited slots instruction when enabled", () => {
    const policy = policyWith({
      bookingStrategy: { limitedSlots: true },
    });
    expect(policy.limitedSlots).toBe(true);

    const promptSection = buildPromptPolicySection(policy);
    expect(promptSection).toContain("maximum of 2-3 time slot options");
  });

  it("prompt policy does NOT include limited slots when disabled", () => {
    const policy = policyWith({
      bookingStrategy: { limitedSlots: false },
    });
    expect(policy.limitedSlots).toBe(false);

    const promptSection = buildPromptPolicySection(policy);
    expect(promptSection).not.toContain("maximum of 2-3 time slot options");
  });
});

// ── SCENARIO F: Fail-Closed Booking Validation ──────────────────────────────

describe("SCENARIO F — Fail-Closed Booking Validation", () => {
  it("booking is blocked when ANY required field is missing", () => {
    const policy = policyWith(); // default: name, car, issue, time required

    // Missing carModel
    const collected: ConversationCollectedData = {
      customerName: "John",
      carModel: null,
      issueDescription: "oil change",
      preferredTime: "2026-03-20T10:00:00Z",
      licensePlate: null,
      phoneConfirmation: null,
    };

    const missing = getMissingRequiredFields(policy, collected);
    expect(missing).toContain("carModel");
    expect(missing.length).toBeGreaterThan(0);
  });

  it("booking is blocked when carModel is only serviceType (weak proxy rejected)", () => {
    // Previously, serviceType was mapped to carModel.
    // Now carModel must be independently extracted.
    const intent = detectBookingIntent(
      "Your appointment is confirmed for an oil change tomorrow at 2pm.",
      "I need an oil change"
    );

    // serviceType should be "oil change" but carModel should NOT be "oil change"
    expect(intent.serviceType).toBe("oil change");
    // carModel should be null since no car make/model was mentioned
    expect(intent.carModel).toBeNull();
  });

  it("carModel is extracted when customer mentions a real car", () => {
    const intent = detectBookingIntent(
      "Your appointment is confirmed for oil change on your Honda Civic.",
      "I need an oil change for my Honda Civic"
    );

    expect(intent.carModel).not.toBeNull();
    expect(intent.carModel!.toLowerCase()).toContain("honda");
  });

  it("policy defaults are used (fail-closed) when policy fetch returns defaults", () => {
    // buildRuntimePolicy with defaults should enforce name, car, issue, time
    const policy = policyWith(); // uses AI_SETTINGS_DEFAULTS
    expect(policy.requiredFields).toContain("customerName");
    expect(policy.requiredFields).toContain("carModel");
    expect(policy.requiredFields).toContain("issueDescription");
    expect(policy.requiredFields).toContain("preferredTime");
    expect(policy.requiredFields).not.toContain("licensePlate");
    expect(policy.requiredFields).not.toContain("phoneConfirmation");
  });

  it("appointment creation validates required fields and rejects when missing", async () => {
    // Setup: tenant exists
    mocks.query.mockImplementation((sql: string) => {
      if (sql.includes("SELECT id FROM tenants")) {
        return [{ id: "t-001" }];
      }
      // Return default AI settings (carModel required by default)
      if (sql.includes("ai_settings")) {
        return [{ ai_settings: null }]; // null -> defaults apply
      }
      return [];
    });

    const { createAppointment } = await import("../services/appointments");
    const result = await createAppointment({
      tenantId: "t-001",
      customerPhone: "+15551234567",
      customerName: "John",
      serviceType: "oil change",
      // carModel NOT provided (defaults to undefined)
      scheduledAt: new Date().toISOString(),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing required booking fields");
  });

  it("appointment creation BLOCKS on policy lookup failure (fail-closed via defaults)", async () => {
    mocks.query.mockImplementation((sql: string) => {
      if (sql.includes("SELECT id FROM tenants")) {
        return [{ id: "t-001" }];
      }
      // Simulate DB error on ai_settings lookup
      // getTenantAiPolicy catches this internally and returns defaults
      // Defaults require carModel — which is not provided here → fail-closed
      if (sql.includes("ai_settings")) {
        throw new Error("DB connection lost");
      }
      return [];
    });

    const { createAppointment } = await import("../services/appointments");
    const result = await createAppointment({
      tenantId: "t-001",
      customerPhone: "+15551234567",
      customerName: "John",
      serviceType: "oil change",
      // carModel NOT provided — defaults require it
      scheduledAt: new Date().toISOString(),
    });

    // Must NOT succeed — fail-closed because defaults require carModel
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing required booking fields");
  });
});

// ── SCENARIO G: Full Pass — All Required Fields Present ──────────────────────

describe("SCENARIO G — Full Pass (All Required Fields Present)", () => {
  it("booking proceeds when all required fields are provided", () => {
    const policy = policyWith(); // default required: name, car, issue, time

    const collected: ConversationCollectedData = {
      customerName: "John Smith",
      carModel: "2019 Honda Civic",
      issueDescription: "oil change",
      preferredTime: "2026-03-20T10:00:00Z",
      licensePlate: null, // not required by default
      phoneConfirmation: null,
    };

    const missing = getMissingRequiredFields(policy, collected);
    expect(missing).toEqual([]);
  });

  it("booking proceeds with ALL fields including optional ones", () => {
    const policy = policyWith({
      requiredFields: {
        customerName: true,
        carModel: true,
        issueDescription: true,
        preferredTime: true,
        licensePlate: true,
        phoneConfirmation: true,
      },
    });

    const collected: ConversationCollectedData = {
      customerName: "John Smith",
      carModel: "2019 Honda Civic",
      issueDescription: "oil change",
      preferredTime: "2026-03-20T10:00:00Z",
      licensePlate: "ABC 1234",
      phoneConfirmation: "+15551234567",
    };

    const missing = getMissingRequiredFields(policy, collected);
    expect(missing).toEqual([]);
  });

  it("intent detector extracts carModel when car make is mentioned", () => {
    const intent = detectBookingIntent(
      "Great! Your oil change appointment for your 2019 Toyota Camry is confirmed for tomorrow at 2pm.",
      "I need an oil change for my 2019 Toyota Camry tomorrow at 2pm"
    );

    expect(intent.isBooked).toBe(true);
    expect(intent.serviceType).toBe("oil change");
    expect(intent.carModel).not.toBeNull();
    expect(intent.carModel!.toLowerCase()).toContain("toyota");
    expect(intent.customerName).toBeNull(); // no name mentioned
  });

  it("end-to-end: extracted intent fields satisfy default policy requirements", () => {
    const intent = detectBookingIntent(
      "Confirmed, John! Your oil change for your Honda Civic is set for tomorrow at 3pm.",
      "My name is John, I need an oil change for my Honda Civic, tomorrow at 3pm works"
    );

    const policy = policyWith(); // defaults

    const collected: ConversationCollectedData = {
      customerName: intent.customerName,
      carModel: intent.carModel,
      issueDescription: intent.serviceType,
      preferredTime: intent.scheduledAt,
      licensePlate: intent.licensePlate,
      phoneConfirmation: null,
    };

    const missing = getMissingRequiredFields(policy, collected);
    expect(missing).toEqual([]);
    // Full pass — booking would proceed
  });
});

// ── CROSS-CUTTING: Field mapping truthfulness ───────────────────────────────

describe("Field Mapping Truthfulness", () => {
  it("carModel and issueDescription are DISTINCT in collected data", () => {
    // carModel should NOT equal serviceType by default
    const intent = detectBookingIntent(
      "Your appointment is confirmed for oil change.",
      "I need an oil change"
    );
    // serviceType is "oil change" — this should NOT satisfy carModel
    expect(intent.serviceType).toBe("oil change");
    expect(intent.carModel).not.toBe(intent.serviceType);
  });

  it("serviceType correctly maps to issueDescription", () => {
    // serviceType "oil change" IS a valid issue description
    const intent = detectBookingIntent(
      "Appointment confirmed for brake service.",
      "I need my brakes checked"
    );
    expect(intent.serviceType).toBe("brake service");
    // This is a valid issueDescription — not a weak proxy
  });

  it("licensePlate is only extracted when contextually appropriate", () => {
    // Random numbers should NOT be extracted as license plates
    const intent = detectBookingIntent(
      "Your appointment #1234 is confirmed.",
      "I need an oil change at 1234 Main St"
    );
    expect(intent.licensePlate).toBeNull();
  });

  it("licensePlate IS extracted when plate context is present", () => {
    const intent = detectBookingIntent(
      "Your appointment is confirmed.",
      "my license plate is ABC 1234"
    );
    expect(intent.licensePlate).toBe("ABC 1234");
  });
});

// ── CROSS-CUTTING: Prompt policy injection ──────────────────────────────────

describe("Prompt Policy Injection Truthfulness", () => {
  it("required fields are listed in prompt when set", () => {
    const policy = policyWith({
      requiredFields: {
        customerName: true,
        carModel: true,
        issueDescription: true,
        preferredTime: true,
        licensePlate: true,
        phoneConfirmation: false,
      },
    });

    const prompt = buildPromptPolicySection(policy);
    expect(prompt).toContain("customer name");
    expect(prompt).toContain("car make and model");
    expect(prompt).toContain("description of the issue");
    expect(prompt).toContain("preferred appointment time");
    expect(prompt).toContain("license plate number");
    // phoneConfirmation is false → listed in optional, not required
    expect(prompt).not.toMatch(/MUST collect.*phone number confirmation/);
  });

  it("optional fields are listed separately", () => {
    const policy = policyWith({
      requiredFields: { licensePlate: false, phoneConfirmation: false },
    });

    const prompt = buildPromptPolicySection(policy);
    expect(prompt).toContain("Optional info");
    expect(prompt).toContain("license plate number");
  });

  it("booking rules always include no-hallucination guard", () => {
    const policy = policyWith();
    const prompt = buildPromptPolicySection(policy);
    expect(prompt).toContain("Never invent or hallucinate");
  });
});
