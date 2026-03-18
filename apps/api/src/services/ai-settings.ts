/**
 * AI Settings Service
 *
 * Converts tenant AI configuration toggles into runtime execution policy.
 * This is the bridge between the dashboard UI and actual AI behavior.
 *
 * Three responsibilities:
 * 1. Define the structured settings schema with safe defaults
 * 2. Build a runtime policy object from stored settings
 * 3. Validate booking eligibility against required fields
 */

import { query } from "../db/client";

// ── Stored settings shape (matches dashboard UI) ─────────────────────────────

export interface AiSettings {
  tone: "professional" | "friendly" | "direct";
  greetingStyle: "short" | "standard" | "none";

  requiredFields: {
    customerName: boolean;
    carModel: boolean;
    issueDescription: boolean;
    preferredTime: boolean;
    licensePlate: boolean;
    phoneConfirmation: boolean;
  };

  bookingStrategy: {
    offerEarliestSlot: boolean;
    limitedSlots: boolean;
    openScheduling: boolean;
    suggestAdditionalServices: boolean;
    escalateUncertainCases: boolean;
    afterHoursBehavior: "book_next" | "promise_callback" | "ask_urgent";
  };

  missedCallSms: {
    enabled: boolean;
    preset: "1" | "2" | "3" | "custom";
    template: string;
  };

  shopContext: {
    services: string;
    restrictions: string;
  };
}

// ── Defaults (match UI defaults exactly) ─────────────────────────────────────

export const AI_SETTINGS_DEFAULTS: AiSettings = {
  tone: "direct",
  greetingStyle: "short",

  requiredFields: {
    customerName: true,
    carModel: true,
    issueDescription: true,
    preferredTime: true,
    licensePlate: false,
    phoneConfirmation: false,
  },

  bookingStrategy: {
    offerEarliestSlot: true,
    limitedSlots: true,
    openScheduling: false,
    suggestAdditionalServices: false,
    escalateUncertainCases: true,
    afterHoursBehavior: "book_next",
  },

  missedCallSms: {
    enabled: true,
    preset: "1",
    template:
      "Hi, we missed your call. Reply with: issue + car model + preferred time.",
  },

  shopContext: {
    services: "",
    restrictions: "",
  },
};

// ── SMS presets (must match frontend) ────────────────────────────────────────

const SMS_PRESETS: Record<string, string> = {
  "1": "Hi, we missed your call. Reply with: issue + car model + preferred time.",
  "2": "AutoShop here. Text your issue, car model, and when you'd like to come in.",
  "3": "Missed your call. Send issue + car + time.",
};

// ── Runtime policy (flat object used by AI flow) ─────────────────────────────

export interface AiRuntimePolicy {
  requiredFields: string[];
  optionalFields: string[];
  tone: string;
  greetingStyle: string;
  offerEarliestSlot: boolean;
  limitedSlots: boolean;
  openScheduling: boolean;
  suggestAdditionalServices: boolean;
  escalateUncertainCases: boolean;
  afterHoursBehavior: string;
  services: string;
  restrictions: string;
  missedCallSmsEnabled: boolean;
  missedCallSmsTemplate: string;
}

// ── Field label mapping for AI prompt ────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  customerName: "customer name",
  carModel: "car make and model",
  issueDescription: "description of the issue or service needed",
  preferredTime: "preferred appointment time",
  licensePlate: "license plate number",
  phoneConfirmation: "phone number confirmation",
};

// ── Core functions ───────────────────────────────────────────────────────────

/**
 * Merge stored (possibly partial/legacy) settings with defaults.
 * Handles NULL, empty objects, and partial fields gracefully.
 */
export function mergeWithDefaults(stored: unknown): AiSettings {
  if (!stored || typeof stored !== "object") {
    return { ...AI_SETTINGS_DEFAULTS };
  }

  const s = stored as Record<string, unknown>;
  const d = AI_SETTINGS_DEFAULTS;

  // Legacy format migration: map flat keys to structured format
  // The frontend previously stored flat keys like reqName, reqCar, etc.
  const legacyReq = s as Record<string, unknown>;
  const hasLegacyKeys =
    "reqName" in legacyReq ||
    "reqCar" in legacyReq ||
    "reqIssue" in legacyReq;

  let requiredFields = d.requiredFields;
  if (hasLegacyKeys) {
    requiredFields = {
      customerName: legacyReq.reqName !== false,
      carModel: legacyReq.reqCar !== false,
      issueDescription: legacyReq.reqIssue !== false,
      preferredTime: legacyReq.reqTime !== false,
      licensePlate: legacyReq.reqPlate === true,
      phoneConfirmation: legacyReq.reqPhone === true,
    };
  } else if (
    s.requiredFields &&
    typeof s.requiredFields === "object"
  ) {
    const rf = s.requiredFields as Record<string, unknown>;
    requiredFields = {
      customerName: rf.customerName !== false,
      carModel: rf.carModel !== false,
      issueDescription: rf.issueDescription !== false,
      preferredTime: rf.preferredTime !== false,
      licensePlate: rf.licensePlate === true,
      phoneConfirmation: rf.phoneConfirmation === true,
    };
  }

  let bookingStrategy = d.bookingStrategy;
  if (s.bookingStrategy && typeof s.bookingStrategy === "object") {
    const bs = s.bookingStrategy as Record<string, unknown>;
    bookingStrategy = {
      offerEarliestSlot: bs.offerEarliestSlot !== false,
      limitedSlots: bs.limitedSlots !== false,
      openScheduling: bs.openScheduling === true,
      suggestAdditionalServices: bs.suggestAdditionalServices === true,
      escalateUncertainCases: bs.escalateUncertainCases !== false,
      afterHoursBehavior:
        (bs.afterHoursBehavior as string) || d.bookingStrategy.afterHoursBehavior,
    };
  } else if ("offerEarliest" in legacyReq || "limitedSlots" in legacyReq) {
    bookingStrategy = {
      offerEarliestSlot: legacyReq.offerEarliest !== false,
      limitedSlots: legacyReq.limitedSlots !== false,
      openScheduling: legacyReq.openScheduling === true,
      suggestAdditionalServices: legacyReq.upsellEnabled === true,
      escalateUncertainCases: legacyReq.escalationEnabled !== false,
      afterHoursBehavior:
        (legacyReq.afterHours as string) || d.bookingStrategy.afterHoursBehavior,
    };
  }

  let missedCallSms = d.missedCallSms;
  if (s.missedCallSms && typeof s.missedCallSms === "object") {
    const mc = s.missedCallSms as Record<string, unknown>;
    missedCallSms = {
      enabled: mc.enabled !== false,
      preset: (mc.preset as string) || d.missedCallSms.preset,
      template: (mc.template as string) || d.missedCallSms.template,
    };
  } else if ("missedSmsEnabled" in legacyReq) {
    missedCallSms = {
      enabled: legacyReq.missedSmsEnabled !== false,
      preset: (legacyReq.smsPreset as string) || d.missedCallSms.preset,
      template: (legacyReq.smsTemplate as string) || d.missedCallSms.template,
    };
  }

  let shopContext = d.shopContext;
  if (s.shopContext && typeof s.shopContext === "object") {
    const sc = s.shopContext as Record<string, unknown>;
    shopContext = {
      services: (sc.services as string) || "",
      restrictions: (sc.restrictions as string) || "",
    };
  }

  return {
    tone: (["professional", "friendly", "direct"].includes(s.tone as string)
      ? s.tone
      : d.tone) as AiSettings["tone"],
    greetingStyle: (["short", "standard", "none"].includes(s.greetingStyle as string)
      ? s.greetingStyle
      : d.greetingStyle) as AiSettings["greetingStyle"],
    requiredFields,
    bookingStrategy,
    missedCallSms,
    shopContext,
  };
}

/**
 * Build a flat runtime policy from structured settings.
 * This is the single object consumed by AI flow logic.
 */
export function buildRuntimePolicy(settings: AiSettings): AiRuntimePolicy {
  const required: string[] = [];
  const optional: string[] = [];

  for (const [key, enabled] of Object.entries(settings.requiredFields)) {
    if (enabled) {
      required.push(key);
    } else {
      optional.push(key);
    }
  }

  // Resolve SMS template from preset or custom
  let smsTemplate = settings.missedCallSms.template;
  if (settings.missedCallSms.preset !== "custom") {
    const presetText = SMS_PRESETS[settings.missedCallSms.preset];
    if (presetText) smsTemplate = presetText;
  }

  return {
    requiredFields: required,
    optionalFields: optional,
    tone: settings.tone,
    greetingStyle: settings.greetingStyle,
    offerEarliestSlot: settings.bookingStrategy.offerEarliestSlot,
    limitedSlots: settings.bookingStrategy.limitedSlots,
    openScheduling: settings.bookingStrategy.openScheduling,
    suggestAdditionalServices: settings.bookingStrategy.suggestAdditionalServices,
    escalateUncertainCases: settings.bookingStrategy.escalateUncertainCases,
    afterHoursBehavior: settings.bookingStrategy.afterHoursBehavior,
    services: settings.shopContext.services,
    restrictions: settings.shopContext.restrictions,
    missedCallSmsEnabled: settings.missedCallSms.enabled,
    missedCallSmsTemplate: smsTemplate,
  };
}

/**
 * Fetch tenant AI settings from DB and return runtime policy.
 * Returns defaults if no settings stored.
 */
export async function getTenantAiPolicy(
  tenantId: string
): Promise<AiRuntimePolicy> {
  try {
    const rows = await query<{ ai_settings: unknown }>(
      `SELECT ai_settings FROM tenants WHERE id = $1`,
      [tenantId]
    );
    const raw = rows.length > 0 ? rows[0].ai_settings : null;
    return buildRuntimePolicy(mergeWithDefaults(raw));
  } catch {
    // On any DB error, return safe defaults
    return buildRuntimePolicy(AI_SETTINGS_DEFAULTS);
  }
}

// ── Booking field validation ─────────────────────────────────────────────────

/**
 * Conversation state: what data has been collected so far.
 * Used to determine what's still missing before booking can proceed.
 */
export interface ConversationCollectedData {
  customerName?: string | null;
  carModel?: string | null;
  issueDescription?: string | null;
  preferredTime?: string | null;
  licensePlate?: string | null;
  phoneConfirmation?: string | null;
}

/**
 * Returns the list of required fields that are still missing.
 * Empty array = all requirements met, booking can proceed.
 */
export function getMissingRequiredFields(
  policy: AiRuntimePolicy,
  collected: ConversationCollectedData
): string[] {
  const missing: string[] = [];

  for (const field of policy.requiredFields) {
    const value = collected[field as keyof ConversationCollectedData];
    if (!value || !value.trim()) {
      missing.push(field);
    }
  }

  return missing;
}

/**
 * Returns human-readable labels for missing fields (for AI prompt injection).
 */
export function getMissingFieldLabels(missingFields: string[]): string[] {
  return missingFields.map((f) => FIELD_LABELS[f] || f);
}

/**
 * Build the AI system prompt policy section from runtime settings.
 * This gets injected into the system prompt to control AI behavior.
 */
export function buildPromptPolicySection(policy: AiRuntimePolicy): string {
  const lines: string[] = [];

  // Tone
  const toneMap: Record<string, string> = {
    professional: "Use a professional, businesslike tone.",
    friendly: "Use a warm, friendly tone.",
    direct: "Be direct and concise. No filler words.",
  };
  lines.push(toneMap[policy.tone] || toneMap.direct);

  // Greeting
  if (policy.greetingStyle === "none") {
    lines.push("Do not use a greeting. Get straight to the point.");
  } else if (policy.greetingStyle === "short") {
    lines.push("Use a very brief greeting (one short sentence max).");
  }

  // Required fields
  const reqLabels = policy.requiredFields.map((f) => FIELD_LABELS[f] || f);
  if (reqLabels.length > 0) {
    lines.push(
      `You MUST collect ALL of the following before confirming any booking: ${reqLabels.join(", ")}.`
    );
    lines.push(
      "Ask for only ONE missing field at a time. Never repeat a field already provided."
    );
    lines.push(
      "Do NOT confirm or create a booking until every required field is collected."
    );
  }

  // Optional fields
  if (policy.optionalFields.length > 0) {
    const optLabels = policy.optionalFields.map((f) => FIELD_LABELS[f] || f);
    lines.push(
      `Optional info (do NOT block booking for these): ${optLabels.join(", ")}.`
    );
  }

  // Booking strategy
  if (policy.offerEarliestSlot) {
    lines.push("Always suggest the earliest available time slot first.");
  }
  if (policy.limitedSlots) {
    lines.push("Show a maximum of 2-3 time slot options. Do not overwhelm with choices.");
  }
  if (!policy.openScheduling) {
    lines.push(
      'Do NOT ask vague questions like "What time works for you?" — instead offer specific available slots.'
    );
  }
  if (policy.suggestAdditionalServices) {
    lines.push("You may suggest related services if relevant to the customer's issue.");
  } else {
    lines.push("Do NOT suggest additional services unless the customer asks.");
  }
  if (policy.escalateUncertainCases) {
    lines.push(
      "If you cannot confidently handle a request, tell the customer a staff member will follow up shortly."
    );
  }

  // Restrictions
  if (policy.restrictions) {
    lines.push(`RESTRICTIONS: ${policy.restrictions}`);
  }

  // Core booking rules (always enforced)
  lines.push("Never invent or hallucinate appointment availability.");
  lines.push("Keep responses under 160 characters when possible (SMS length).");
  lines.push(
    "When all required data is collected and a time is confirmed, state the full booking details clearly."
  );

  return lines.join("\n");
}
