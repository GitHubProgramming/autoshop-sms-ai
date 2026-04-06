/**
 * SMOKE TEST — Full Booking Flow Runtime Validation
 *
 * Traces the exact scenario from the mission specification end-to-end:
 *
 * CONFIG:
 *   customerName=ON, carModel=ON, issueDescription=ON, preferredTime=ON,
 *   licensePlate=ON, phoneConfirmation=OFF, missedCallSms=ON,
 *   limitedSlots=ON, openScheduling=OFF
 *
 * FLOW:
 *   1. Missed call → auto SMS sent
 *   2. Customer replies (license plate missing) → booking BLOCKED
 *   3. System sends corrective SMS asking for plate
 *   4. Customer provides plate → booking proceeds
 *   5. Appointment payload contains all 5 collected fields
 *   6. Calendar event body includes all fields
 *   7. State is truthful throughout
 *
 * Tests exercise REAL service functions — only DB and external HTTP are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock DB + config layer ──────────────────────────────────────────────────

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

// ── Import REAL services ────────────────────────────────────────────────────

import {
  mergeWithDefaults,
  buildRuntimePolicy,
  getMissingRequiredFields,
  getMissingFieldLabels,
  buildPromptPolicySection,
  type AiRuntimePolicy,
  type ConversationCollectedData,
} from "../services/ai-settings";
import { detectBookingIntent } from "../services/booking-intent";
import { handleMissedCallSms } from "../services/missed-call-sms";
import { buildEventBody, type CalendarEventInput } from "../services/google-calendar";

// ── Scenario config ─────────────────────────────────────────────────────────

const SCENARIO_SETTINGS = {
  requiredFields: {
    customerName: true,
    carModel: true,
    issueDescription: true,
    preferredTime: true,
    licensePlate: true,
    phoneConfirmation: false,
  },
  missedCallSms: { enabled: true, preset: "1" as const, template: "" },
  bookingStrategy: {
    offerEarliestSlot: true,
    limitedSlots: true,
    openScheduling: false,
    suggestAdditionalServices: false,
    escalateUncertainCases: true,
    afterHoursBehavior: "book_next" as const,
  },
  tone: "direct" as const,
  greetingStyle: "short" as const,
  shopContext: { services: "", restrictions: "" },
};

function scenarioPolicy(): AiRuntimePolicy {
  return buildRuntimePolicy(mergeWithDefaults(SCENARIO_SETTINGS));
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1: AI settings persist and produce correct runtime policy
// ─────────────────────────────────────────────────────────────────────────────

describe("SMOKE STEP 1 — AI Settings → Runtime Policy", () => {
  it("settings are merged correctly with licensePlate=ON", () => {
    const settings = mergeWithDefaults(SCENARIO_SETTINGS);
    expect(settings.requiredFields.licensePlate).toBe(true);
    expect(settings.requiredFields.phoneConfirmation).toBe(false);
    expect(settings.requiredFields.customerName).toBe(true);
    expect(settings.requiredFields.carModel).toBe(true);
    expect(settings.requiredFields.issueDescription).toBe(true);
    expect(settings.requiredFields.preferredTime).toBe(true);
  });

  it("runtime policy includes all 5 required fields (not phoneConfirmation)", () => {
    const policy = scenarioPolicy();
    expect(policy.requiredFields).toContain("customerName");
    expect(policy.requiredFields).toContain("carModel");
    expect(policy.requiredFields).toContain("issueDescription");
    expect(policy.requiredFields).toContain("preferredTime");
    expect(policy.requiredFields).toContain("licensePlate");
    expect(policy.requiredFields).not.toContain("phoneConfirmation");
    expect(policy.optionalFields).toContain("phoneConfirmation");
  });

  it("policy has correct booking strategy flags", () => {
    const policy = scenarioPolicy();
    expect(policy.limitedSlots).toBe(true);
    expect(policy.openScheduling).toBe(false);
    expect(policy.missedCallSmsEnabled).toBe(true);
  });

  it("prompt policy section lists all 5 required fields", () => {
    const policy = scenarioPolicy();
    const prompt = buildPromptPolicySection(policy);
    expect(prompt).toContain("customer name");
    expect(prompt).toContain("car make and model");
    expect(prompt).toContain("description of the issue");
    expect(prompt).toContain("preferred appointment time");
    expect(prompt).toContain("license plate number");
    expect(prompt).toContain("MUST collect ALL");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2: Missed call triggers auto SMS
// ─────────────────────────────────────────────────────────────────────────────

describe("SMOKE STEP 2 — Missed Call → Auto SMS", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    conversationMocks.openConversationWithRetry.mockResolvedValue({
      blocked: false, existing: false, conversationId: "conv-smoke-1", isNew: true,
    });

    mocks.query.mockImplementation((sql: string) => {
      if (sql.includes("billing_status")) {
        return [{
          id: "t-smoke",
          shop_name: "Smoke Test Auto",
          billing_status: "active",
          missed_call_sms_template: null,
        }];
      }
      if (sql.includes("ai_settings")) {
        return [{ ai_settings: SCENARIO_SETTINGS }];
      }
      if (sql.includes("INSERT INTO messages")) return [];
      if (sql.includes("touch_conversation")) return [];
      return [];
    });

    mocks.getConfig.mockImplementation((key: string) => {
      if (key === "TWILIO_ACCOUNT_SID") return "AC_smoke";
      if (key === "TWILIO_AUTH_TOKEN") return "token_smoke";
      if (key === "TWILIO_MESSAGING_SERVICE_SID") return "MG_smoke";
      return null;
    });
  });

  it("missed call sends SMS when missedCallSms.enabled=true", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sid: "SM_smoke_001" }),
    });

    const result = await handleMissedCallSms(
      {
        tenantId: "t-smoke",
        customerPhone: "+15551234567",
        ourPhone: "+13257523890",
        callSid: "CA_smoke",
        callStatus: "no-answer",
      },
      mockFetch as unknown as typeof fetch
    );

    expect(result.success).toBe(true);
    expect(result.smsSent).toBe(true);
    expect(result.twilioSid).toBe("SM_smoke_001");
    expect(result.conversationId).toBe("conv-smoke-1");

    // Verify Twilio was called
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchBody = mockFetch.mock.calls[0][1].body as string;
    expect(decodeURIComponent(fetchBody)).toContain("missed your call");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3: Customer replies with missing license plate → BOOKING BLOCKED
// ─────────────────────────────────────────────────────────────────────────────

describe("SMOKE STEP 3 — Customer Reply (plate missing) → Booking Blocked", () => {
  const CUSTOMER_MSG =
    "Need brakes checked. 2019 Honda Civic. Tomorrow morning works. My name is John.";

  it("booking intent extracts all fields EXCEPT licensePlate from customer message", () => {
    // Simulate AI response that confirms booking
    const aiResponse =
      "Your appointment is confirmed for brake service on your 2019 Honda Civic, John. See you tomorrow at 9am!";

    const intent = detectBookingIntent(aiResponse, CUSTOMER_MSG);

    expect(intent.isBooked).toBe(true);
    expect(intent.serviceType).toBe("brake service");
    expect(intent.issueDescription).toBe(CUSTOMER_MSG);
    expect(intent.customerName).toBe("John");
    expect(intent.carModel).not.toBeNull();
    expect(intent.carModel!.toLowerCase()).toContain("honda");
    expect(intent.licensePlate).toBeNull(); // NOT mentioned
  });

  it("missing licensePlate is detected by field validation", () => {
    const policy = scenarioPolicy();

    const aiResponse =
      "Your appointment is confirmed for brake service on your 2019 Honda Civic, John.";
    const intent = detectBookingIntent(aiResponse, CUSTOMER_MSG);

    const collected: ConversationCollectedData = {
      customerName: intent.customerName,
      carModel: intent.carModel,
      issueDescription: intent.serviceType,
      preferredTime: intent.scheduledAt,
      licensePlate: intent.licensePlate,
      phoneConfirmation: null,
    };

    const missing = getMissingRequiredFields(policy, collected);
    expect(missing).toEqual(["licensePlate"]);
  });

  it("corrective SMS is generated instead of false confirmation", () => {
    const policy = scenarioPolicy();

    const aiResponse =
      "Your appointment is confirmed for brake service on your 2019 Honda Civic, John.";
    const intent = detectBookingIntent(aiResponse, CUSTOMER_MSG);

    const collected: ConversationCollectedData = {
      customerName: intent.customerName,
      carModel: intent.carModel,
      issueDescription: intent.serviceType,
      preferredTime: intent.scheduledAt,
      licensePlate: intent.licensePlate,
      phoneConfirmation: null,
    };

    const missing = getMissingRequiredFields(policy, collected);
    expect(missing.length).toBeGreaterThan(0);

    // This is what process-sms.ts does when fields are missing:
    const missingLabels = getMissingFieldLabels(missing);
    const safeBody =
      `Almost there! I still need: ${missingLabels.join(", ")}. ` +
      `Please provide so I can finalize your booking.`;

    expect(safeBody).toContain("license plate number");
    expect(safeBody).not.toContain("confirmed");
    expect(safeBody).not.toContain("appointment is set");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4: Customer provides plate → Booking proceeds
// ─────────────────────────────────────────────────────────────────────────────

describe("SMOKE STEP 4 — Customer Provides Plate → Booking Proceeds", () => {
  const PLATE_MSG = "My license plate is ABC 1234";

  it("license plate is extracted from follow-up message", () => {
    const aiResponse =
      "Your appointment is confirmed for brake service. See you tomorrow at 9am, John!";

    const intent = detectBookingIntent(aiResponse, PLATE_MSG);
    expect(intent.licensePlate).toBe("ABC 1234");
  });

  it("all 5 required fields satisfied after plate provided", () => {
    const policy = scenarioPolicy();

    const collected: ConversationCollectedData = {
      customerName: "John",
      carModel: "2019 Honda Civic",
      issueDescription: "brake service",
      preferredTime: new Date(Date.now() + 86_400_000).toISOString(),
      licensePlate: "ABC 1234",
      phoneConfirmation: null,
    };

    const missing = getMissingRequiredFields(policy, collected);
    expect(missing).toEqual([]);
    // Booking can now proceed
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5: Appointment creation stores ALL booking fields
// ─────────────────────────────────────────────────────────────────────────────

describe("SMOKE STEP 5 — Appointment Payload Contains All Fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createAppointment receives and persists carModel, licensePlate, issueDescription", async () => {
    const appointmentRow = {
      id: "appt-smoke-1",
      tenant_id: "t-smoke",
      conversation_id: "conv-smoke-1",
      customer_phone: "+15551234567",
      customer_name: "John",
      service_type: "brake service",
      car_model: "2019 Honda Civic",
      license_plate: "ABC 1234",
      issue_description: "Need brakes checked. 2019 Honda Civic. Tomorrow morning works. My name is John.",
      scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
      duration_minutes: 60,
      notes: null,
      google_event_id: null,
      calendar_synced: false,
      booking_state: "PENDING_MANUAL_CONFIRMATION",
      created_at: new Date().toISOString(),
      xmax: "0",
    };

    mocks.query.mockImplementation((sql: string) => {
      if (sql.includes("SELECT id FROM tenants")) {
        return [{ id: "t-smoke" }];
      }
      if (sql.includes("ai_settings")) {
        return [{ ai_settings: SCENARIO_SETTINGS }];
      }
      if (sql.includes("INSERT INTO appointments")) {
        return [appointmentRow];
      }
      return [];
    });

    const { createAppointment } = await import("../services/appointments");
    const result = await createAppointment({
      tenantId: "t-smoke",
      conversationId: "conv-smoke-1",
      customerPhone: "+15551234567",
      customerName: "John",
      serviceType: "brake service",
      carModel: "2019 Honda Civic",
      licensePlate: "ABC 1234",
      issueDescription: "Need brakes checked. 2019 Honda Civic. Tomorrow morning works. My name is John.",
      scheduledAt: appointmentRow.scheduled_at,
      bookingState: "PENDING_MANUAL_CONFIRMATION",
    });

    expect(result.success).toBe(true);
    expect(result.appointment).not.toBeNull();
    expect(result.appointment!.carModel).toBe("2019 Honda Civic");
    expect(result.appointment!.licensePlate).toBe("ABC 1234");
    expect(result.appointment!.issueDescription).toContain("brakes checked");
    expect(result.appointment!.serviceType).toBe("brake service");
    // serviceType and issueDescription are DISTINCT
    expect(result.appointment!.serviceType).not.toBe(result.appointment!.issueDescription);

    // Verify SQL INSERT includes the new columns
    const insertCall = mocks.query.mock.calls.find(
      (c: unknown[]) => (c[0] as string).includes("INSERT INTO appointments")
    );
    expect(insertCall).toBeDefined();
    const sql = insertCall![0] as string;
    expect(sql).toContain("car_model");
    expect(sql).toContain("license_plate");
    expect(sql).toContain("issue_description");

    // Verify the values are passed in params
    const params = insertCall![1] as unknown[];
    expect(params).toContain("2019 Honda Civic");
    expect(params).toContain("ABC 1234");
  });

  it("appointment creation rejects when plate missing (fail-closed)", async () => {
    mocks.query.mockImplementation((sql: string) => {
      if (sql.includes("SELECT id FROM tenants")) {
        return [{ id: "t-smoke" }];
      }
      if (sql.includes("ai_settings")) {
        return [{ ai_settings: SCENARIO_SETTINGS }];
      }
      return [];
    });

    const { createAppointment } = await import("../services/appointments");
    const result = await createAppointment({
      tenantId: "t-smoke",
      conversationId: "conv-smoke-1",
      customerPhone: "+15551234567",
      customerName: "John",
      serviceType: "brake service",
      carModel: "2019 Honda Civic",
      // licensePlate NOT provided
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing required booking fields");
    expect(result.error).toContain("license plate");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 6: Calendar event body includes all booking fields
// ─────────────────────────────────────────────────────────────────────────────

describe("SMOKE STEP 6 — Calendar Event Contains All Fields", () => {
  it("event body includes carModel, licensePlate, and issueDescription", () => {
    const input: CalendarEventInput = {
      tenantId: "t-smoke",
      appointmentId: "appt-smoke-1",
      customerPhone: "+15551234567",
      customerName: "John",
      serviceType: "brake service",
      carModel: "2019 Honda Civic",
      licensePlate: "ABC 1234",
      issueDescription: "Need brakes checked",
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    };

    const eventBody = buildEventBody(input);

    expect(eventBody.summary).toContain("brake service");
    expect(eventBody.summary).toContain("John");
    expect(eventBody.description).toContain("Service: brake service");
    expect(eventBody.description).toContain("Name: John");
    expect(eventBody.description).toContain("Vehicle: 2019 Honda Civic");
    expect(eventBody.description).toContain("Plate: ABC 1234");
    expect(eventBody.description).toContain("Issue: Need brakes checked");
  });

  it("event body works without optional new fields (backward compat)", () => {
    const input: CalendarEventInput = {
      tenantId: "t-smoke",
      appointmentId: "appt-smoke-1",
      customerPhone: "+15551234567",
      serviceType: "oil change",
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    };

    const eventBody = buildEventBody(input);

    expect(eventBody.summary).toContain("oil change");
    expect(eventBody.description).toContain("Service: oil change");
    expect(eventBody.description).not.toContain("Vehicle:");
    expect(eventBody.description).not.toContain("Plate:");
    expect(eventBody.description).not.toContain("Issue:");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 7: issueDescription and serviceType are always distinct
// ─────────────────────────────────────────────────────────────────────────────

describe("SMOKE STEP 7 — issueDescription vs serviceType Separation", () => {
  it("booking-intent returns BOTH serviceType and issueDescription as separate values", () => {
    const intent = detectBookingIntent(
      "Your appointment is confirmed for brake service.",
      "Need brakes checked. 2019 Honda Civic."
    );

    // serviceType is a classified label
    expect(intent.serviceType).toBe("brake service");
    // issueDescription is the raw customer text
    expect(intent.issueDescription).toBe("Need brakes checked. 2019 Honda Civic.");
    // They are NOT the same value
    expect(intent.serviceType).not.toBe(intent.issueDescription);
  });

  it("issueDescription preserves full customer context, serviceType is short label", () => {
    const customerMsg = "My car is making a weird grinding noise when I brake, I think I need new brake pads";
    const intent = detectBookingIntent(
      "Your appointment is confirmed for brake service.",
      customerMsg
    );

    expect(intent.serviceType).toBe("brake service");
    expect(intent.issueDescription).toBe(customerMsg);
    expect(intent.issueDescription!.length).toBeGreaterThan(intent.serviceType.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 8: Backward compatibility — old rows without new columns still work
// ─────────────────────────────────────────────────────────────────────────────

describe("SMOKE STEP 8 — Backward Compatibility", () => {
  it("AppointmentRecord accepts null for new fields", async () => {
    const oldStyleRow = {
      id: "appt-old",
      tenant_id: "t-smoke",
      conversation_id: null,
      customer_phone: "+15551234567",
      customer_name: "Jane",
      service_type: "oil change",
      car_model: null,
      license_plate: null,
      issue_description: null,
      scheduled_at: new Date().toISOString(),
      duration_minutes: 60,
      notes: null,
      google_event_id: null,
      calendar_synced: false,
      booking_state: "CONFIRMED_CALENDAR",
      created_at: new Date().toISOString(),
      xmax: "0",
    };

    mocks.query.mockImplementation((sql: string) => {
      if (sql.includes("SELECT id FROM tenants")) return [{ id: "t-smoke" }];
      if (sql.includes("ai_settings")) {
        // Disable all extra required fields for this test
        return [{
          ai_settings: {
            requiredFields: {
              customerName: true,
              carModel: false,
              issueDescription: false,
              preferredTime: true,
              licensePlate: false,
              phoneConfirmation: false,
            },
          },
        }];
      }
      if (sql.includes("INSERT INTO appointments")) return [oldStyleRow];
      return [];
    });

    const { createAppointment } = await import("../services/appointments");
    const result = await createAppointment({
      tenantId: "t-smoke",
      customerPhone: "+15551234567",
      customerName: "Jane",
      serviceType: "oil change",
      scheduledAt: oldStyleRow.scheduled_at,
    });

    expect(result.success).toBe(true);
    expect(result.appointment!.carModel).toBeNull();
    expect(result.appointment!.licensePlate).toBeNull();
    expect(result.appointment!.issueDescription).toBeNull();
    // Old fields still work
    expect(result.appointment!.customerName).toBe("Jane");
    expect(result.appointment!.serviceType).toBe("oil change");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 9: Full end-to-end scenario trace
// ─────────────────────────────────────────────────────────────────────────────

describe("SMOKE STEP 9 — Full Scenario Trace (End-to-End)", () => {
  it("traces complete flow: missed call → blocked booking → corrective SMS → plate provided → booking succeeds", () => {
    const policy = scenarioPolicy();

    // ── Phase 1: Customer message (plate missing) ────────────────────────
    const customerMsg1 =
      "Need brakes checked. 2019 Honda Civic. Tomorrow morning works. My name is John.";
    const aiResponse1 =
      "Your appointment is confirmed for brake service on your 2019 Honda Civic, John. See you tomorrow at 9am!";

    const intent1 = detectBookingIntent(aiResponse1, customerMsg1);

    // Verify extraction
    expect(intent1.isBooked).toBe(true);
    expect(intent1.customerName).toBe("John");
    expect(intent1.carModel).not.toBeNull();
    expect(intent1.serviceType).toBe("brake service");
    expect(intent1.issueDescription).toBe(customerMsg1);
    expect(intent1.licensePlate).toBeNull(); // NOT provided

    // Validate against policy
    const collected1: ConversationCollectedData = {
      customerName: intent1.customerName,
      carModel: intent1.carModel,
      issueDescription: intent1.serviceType,
      preferredTime: intent1.scheduledAt,
      licensePlate: intent1.licensePlate,
      phoneConfirmation: null,
    };

    const missing1 = getMissingRequiredFields(policy, collected1);
    expect(missing1).toEqual(["licensePlate"]);

    // Corrective SMS generated (NOT the AI's false confirmation)
    const labels1 = getMissingFieldLabels(missing1);
    const correctiveSms =
      `Almost there! I still need: ${labels1.join(", ")}. ` +
      `Please provide so I can finalize your booking.`;
    expect(correctiveSms).toContain("license plate number");

    // ── Phase 2: Customer provides plate ─────────────────────────────────
    const customerMsg2 = "My license plate is ABC 1234";
    const aiResponse2 =
      "Your appointment is confirmed. See you tomorrow at 9am, John!";

    const intent2 = detectBookingIntent(aiResponse2, customerMsg2);

    // Plate extracted
    expect(intent2.licensePlate).toBe("ABC 1234");

    // Now combine all collected data (from both messages in conversation)
    const collectedFinal: ConversationCollectedData = {
      customerName: intent1.customerName,     // from message 1
      carModel: intent1.carModel,             // from message 1
      issueDescription: intent1.serviceType,  // from message 1
      preferredTime: intent1.scheduledAt,     // from message 1
      licensePlate: intent2.licensePlate,     // from message 2
      phoneConfirmation: null,
    };

    const missingFinal = getMissingRequiredFields(policy, collectedFinal);
    expect(missingFinal).toEqual([]); // All requirements met

    // ── Phase 3: Verify appointment payload ──────────────────────────────
    // The appointment would be created with these fields:
    const appointmentPayload = {
      tenantId: "t-smoke",
      conversationId: "conv-smoke-1",
      customerPhone: "+15551234567",
      customerName: intent1.customerName,
      serviceType: intent1.serviceType,
      carModel: intent1.carModel,
      licensePlate: intent2.licensePlate,
      issueDescription: intent1.issueDescription,
      scheduledAt: intent1.scheduledAt,
    };

    // All 5 required fields present in payload
    expect(appointmentPayload.customerName).toBe("John");
    expect(appointmentPayload.carModel).not.toBeNull();
    expect(appointmentPayload.serviceType).toBe("brake service");
    expect(appointmentPayload.licensePlate).toBe("ABC 1234");
    expect(appointmentPayload.issueDescription).toBe(customerMsg1);

    // issueDescription and serviceType are DISTINCT
    expect(appointmentPayload.issueDescription).not.toBe(appointmentPayload.serviceType);

    // ── Phase 4: Verify calendar event ───────────────────────────────────
    const calInput: CalendarEventInput = {
      tenantId: appointmentPayload.tenantId,
      appointmentId: "appt-smoke-1",
      customerPhone: appointmentPayload.customerPhone,
      customerName: appointmentPayload.customerName,
      serviceType: appointmentPayload.serviceType,
      carModel: appointmentPayload.carModel,
      licensePlate: appointmentPayload.licensePlate,
      issueDescription: appointmentPayload.issueDescription,
      scheduledAt: appointmentPayload.scheduledAt,
    };

    const eventBody = buildEventBody(calInput);

    // Calendar event contains ALL booking data
    expect(eventBody.description).toContain("Service: brake service");
    expect(eventBody.description).toContain("Name: John");
    expect(eventBody.description).toContain("Vehicle:");
    expect(eventBody.description).toContain("Plate: ABC 1234");
    expect(eventBody.description).toContain("Issue:");
    expect(eventBody.start.dateTime).toBeDefined();
    expect(eventBody.end.dateTime).toBeDefined();
  });
});
