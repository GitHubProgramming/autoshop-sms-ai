/**
 * Booking Intent Detection Service
 *
 * Extracts booking signals from AI responses and customer messages.
 * Designed to replace fragile inline keyword matching in n8n WF-002.
 */

export interface BookingIntentResult {
  isBooked: boolean;
  confidence: "high" | "medium" | "low" | "none";
  serviceType: string;
  scheduledAt: string;
  scheduledAtExtracted: boolean;
  customerName: string | null;
  userWantsClose: boolean;
  matchedPatterns: string[];
}

// ── Booking confirmation patterns (checked against AI response) ─────────────

const HIGH_CONFIDENCE_PATTERNS = [
  "appointment is confirmed",
  "appointment confirmed",
  "your appointment is set",
  "your appointment has been set",
  "booking confirmed",
  "booking is confirmed",
  "you're all set for",
  "you are all set for",
  "you're booked for",
  "you are booked for",
  "we've booked you",
  "we have booked you",
  "i've scheduled you",
  "i have scheduled you",
  "appointment has been booked",
  "appointment has been scheduled",
];

const MEDIUM_CONFIDENCE_PATTERNS = [
  "booked for",
  "scheduled for",
  "confirmed for",
  "see you on",
  "see you at",
  "appointment set",
  "is confirmed",
  "we'll see you",
  "we will see you",
  "look forward to seeing you",
];

// ── Close/cancel patterns (checked against customer message) ────────────────

const CLOSE_KEYWORDS = [
  "stop",
  "cancel",
  "nevermind",
  "never mind",
  "no thanks",
  "no thank you",
  "not interested",
  "unsubscribe",
  "quit",
  "go away",
  "leave me alone",
  "don't text me",
  "do not text me",
  "don't contact me",
  "do not contact me",
];

// ── Service types ───────────────────────────────────────────────────────────

const SERVICE_KEYWORDS: Array<{ pattern: string; label: string }> = [
  { pattern: "oil change", label: "oil change" },
  { pattern: "tire rotation", label: "tire rotation" },
  { pattern: "tire replacement", label: "tire replacement" },
  { pattern: "new tire", label: "tire replacement" },
  { pattern: "brake pad", label: "brake service" },
  { pattern: "brake service", label: "brake service" },
  { pattern: "brake repair", label: "brake service" },
  { pattern: "brake inspection", label: "brake service" },
  { pattern: "brakes", label: "brake service" },
  { pattern: "state inspection", label: "state inspection" },
  { pattern: "inspection", label: "inspection" },
  { pattern: "tune up", label: "tune up" },
  { pattern: "tune-up", label: "tune up" },
  { pattern: "tuneup", label: "tune up" },
  { pattern: "alignment", label: "alignment" },
  { pattern: "wheel alignment", label: "alignment" },
  { pattern: "transmission", label: "transmission" },
  { pattern: "check engine", label: "diagnostics" },
  { pattern: "diagnostic", label: "diagnostics" },
  { pattern: "ac repair", label: "AC repair" },
  { pattern: "air conditioning", label: "AC repair" },
  { pattern: "a/c", label: "AC repair" },
  { pattern: "battery", label: "battery" },
  { pattern: "coolant", label: "coolant flush" },
  { pattern: "radiator", label: "coolant flush" },
  { pattern: "engine light", label: "diagnostics" },
];

// ── Date/time extraction ────────────────────────────────────────────────────

// ISO 8601 with timezone offset
const ISO_DATE_REGEX =
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)/i;

// Common natural-language date patterns in AI responses
const NATURAL_DATE_PATTERNS = [
  // "Monday, March 15 at 2:00 PM" or "Monday March 15 at 2pm"
  /(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)/i,
  // "March 15 at 2:00 PM" or "March 15th at 2pm"
  /(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)/i,
  // "3/15 at 2:00 PM" or "03/15/2026 at 2pm"
  /\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)/i,
  // "tomorrow at 2pm", "tomorrow at 2:00 PM"
  /tomorrow\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)/i,
];

// ── Name extraction ─────────────────────────────────────────────────────────

// Match patterns like "confirmed, John" or "Thank you, John" or "See you, John"
const NAME_AFTER_COMMA = /(?:[Cc]onfirmed|[Tt]hank [Yy]ou|[Tt]hanks|[Ss]ee [Yy]ou),\s+([A-Z][a-z]+)/;
// Match "for John" or "for John Smith"
const NAME_AFTER_FOR =
  /(?:[Aa]ppointment|[Bb]ooking|[Ss]cheduled)\s+(?:is\s+)?(?:confirmed\s+)?for\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/;

// ── Core detection function ─────────────────────────────────────────────────

export function detectBookingIntent(
  aiResponse: string,
  customerMessage: string
): BookingIntentResult {
  const lowerAi = aiResponse.toLowerCase();
  const lowerCustomer = customerMessage.toLowerCase();
  const matchedPatterns: string[] = [];

  // Check booking confirmation patterns
  let confidence: "high" | "medium" | "low" | "none" = "none";

  for (const pattern of HIGH_CONFIDENCE_PATTERNS) {
    if (lowerAi.includes(pattern)) {
      confidence = "high";
      matchedPatterns.push(pattern);
    }
  }

  if (confidence !== "high") {
    for (const pattern of MEDIUM_CONFIDENCE_PATTERNS) {
      if (lowerAi.includes(pattern)) {
        confidence = "medium";
        matchedPatterns.push(pattern);
      }
    }
  }

  const isBooked = confidence === "high" || confidence === "medium";

  // Check if user wants to close
  const userWantsClose = CLOSE_KEYWORDS.some((k) => lowerCustomer.includes(k));

  // Extract service type (check both AI response and customer message)
  const combined = lowerCustomer + " " + lowerAi;
  let serviceType = "general service";
  for (const { pattern, label } of SERVICE_KEYWORDS) {
    if (combined.includes(pattern)) {
      serviceType = label;
      break;
    }
  }

  // Extract date/time
  let scheduledAt = new Date(Date.now() + 86_400_000).toISOString();
  let scheduledAtExtracted = false;

  // Try ISO date first (from customer message or AI response)
  const isoMatch =
    customerMessage.match(ISO_DATE_REGEX) || aiResponse.match(ISO_DATE_REGEX);
  if (isoMatch) {
    scheduledAt = isoMatch[0];
    scheduledAtExtracted = true;
  } else {
    // Try natural language date from AI response
    for (const regex of NATURAL_DATE_PATTERNS) {
      const match = aiResponse.match(regex);
      if (match) {
        scheduledAt = match[0];
        scheduledAtExtracted = true;
        break;
      }
    }
    // scheduledAt already defaults to +24h from initialization
  }

  // Extract customer name from AI response
  let customerName: string | null = null;
  const nameComma = aiResponse.match(NAME_AFTER_COMMA);
  if (nameComma) {
    customerName = nameComma[1];
  } else {
    const nameFor = aiResponse.match(NAME_AFTER_FOR);
    if (nameFor) {
      customerName = nameFor[1];
    }
  }

  return {
    isBooked,
    confidence,
    serviceType,
    scheduledAt,
    scheduledAtExtracted,
    customerName,
    userWantsClose,
    matchedPatterns,
  };
}
