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
  issueDescription: string | null;
  scheduledAt: string;
  scheduledAtExtracted: boolean;
  customerName: string | null;
  carModel: string | null;
  licensePlate: string | null;
  userWantsClose: boolean;
  matchedPatterns: string[];
}

// ── Booking confirmation patterns (checked against AI response) ─────────────

const HIGH_CONFIDENCE_PATTERNS = [
  // English
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
  // Lithuanian (LT pilot)
  "vizitas patvirtintas",       // appointment confirmed
  "vizitas rezervuotas",        // appointment reserved
  "vizitas užregistruotas",     // appointment registered
  "rezervacija patvirtinta",    // reservation confirmed
  "užregistravau jus",          // I registered you (informal)
  "užregistravau jūs",          // I registered you (formal)
  "jūs užregistruotas",         // you are registered (masc)
  "jūs užregistruota",          // you are registered (fem)
];

const MEDIUM_CONFIDENCE_PATTERNS = [
  // English
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
  // Lithuanian (LT pilot)
  "patvirtinu vizitą",          // I confirm the appointment
  "patvirtinu rezervaciją",     // I confirm the reservation
  "lauksime jūsų",             // we'll be waiting for you
  "iki susitikimo",            // see you (until we meet)
  "jūsų vizitas",              // your appointment (+ context)
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
  // Lithuanian
  "atšaukti",                   // cancel
  "nebenoriu",                  // I don't want anymore
  "nerašykite",                 // don't text me
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
// Also Lithuanian: "Ačiū, Manta" or "Patvirtinta, Manta"
const NAME_AFTER_COMMA = /(?:[Cc]onfirmed|[Tt]hank [Yy]ou|[Tt]hanks|[Ss]ee [Yy]ou|[Aa]čiū|[Pp]atvirtint[ao]|[Ss]veiki),\s+([A-ZĄČĘĖĮŠŲŪŽa-ząčęėįšųūž][a-ząčęėįšųūž]+)/;
// Match "for John" or "for John Smith"
const NAME_AFTER_FOR =
  /(?:[Aa]ppointment|[Bb]ooking|[Ss]cheduled)\s+(?:is\s+)?(?:confirmed\s+)?for\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/;
// Match "Hi John" or "Hi John Smith" at start of AI response
const NAME_AFTER_HI =
  /^(?:Hi|Hello|Hey|Dear)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)[!,.]/;
// Match customer saying "my name is John" or "I'm John Smith" or "this is John"
const NAME_SELF_INTRO =
  /(?:my name is|i'm|i am|this is|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i;

// ── Car make/model extraction ────────────────────────────────────────────────

const CAR_MAKES = [
  "acura", "alfa romeo", "audi", "bmw", "buick", "cadillac", "chevrolet", "chevy",
  "chrysler", "dodge", "fiat", "ford", "gmc", "honda", "hyundai", "infiniti",
  "jaguar", "jeep", "kia", "land rover", "lexus", "lincoln", "mazda",
  "mercedes", "mercedes-benz", "mini", "mitsubishi", "nissan", "pontiac",
  "porsche", "ram", "saturn", "scion", "subaru", "suzuki", "tesla", "toyota",
  "volkswagen", "vw", "volvo",
];

// Match patterns like "2019 Honda Civic", "Honda Civic", "my Civic", "'19 Accord"
// Searches both customer message and AI response
function extractCarModel(customerMessage: string, aiResponse: string): string | null {
  const combined = customerMessage + " " + aiResponse;

  // Check against known makes (case-insensitive)
  const lower = combined.toLowerCase();
  for (const make of CAR_MAKES) {
    const idx = lower.indexOf(make);
    if (idx === -1) continue;

    // Extract from the original text starting a bit before the make
    const start = Math.max(0, idx - 6);
    const snippet = combined.substring(start, idx + make.length + 30);

    // Try "year make model" — e.g., "2019 Honda Civic"
    const full = snippet.match(
      /(?:(?:19|20)\d{2}|'\d{2})\s+\w+(?:\s+\w+)?/i
    );
    if (full) return full[0].trim();

    // Try "make model" — e.g., "Honda Civic" (grab next word after make)
    const makeModel = snippet.match(
      new RegExp(`(${make})\\s+([a-z]\\w+)`, "i")
    );
    if (makeModel) return makeModel[0].trim();

    // Just the make alone
    return combined.substring(idx, idx + make.length).trim();
  }

  return null;
}

// ── License plate extraction ────────────────────────────────────────────────

// Common US plate formats: ABC 1234, ABC-1234, ABC1234, 123 ABC, 123-ABC
const PLATE_PATTERNS = [
  /\b([A-Z]{2,3}[\s-]?\d{3,4})\b/,       // ABC 1234, AB-123
  /\b(\d{3,4}[\s-]?[A-Z]{2,3})\b/,       // 1234 ABC
  /\b([A-Z]{1,3}\d{1,2}[\s-]?[A-Z]{1,3})\b/, // vanity-style
];

/**
 * Lithuanian context check for "numeris" (number) — must be plate context,
 * not phone context. "telefono numeris" → phone, skip. Bare "numeris ABC123" → plate.
 */
function hasPlateContextLt(lower: string): boolean {
  if (!lower.includes("numeris")) return false;
  // Exclude phone-number context
  if (/telefono\s+numeris|tel\.?\s*numeris|tel\s+nr/i.test(lower)) return false;
  return true;
}

function extractLicensePlate(customerMessage: string, aiResponse: string): string | null {
  const combined = customerMessage + " " + aiResponse;
  // Only look for plates if contextual keywords are nearby
  const lower = combined.toLowerCase();
  if (
    !lower.includes("plate") &&
    !lower.includes("tag") &&
    !lower.includes("license") &&
    !lower.includes("registration") &&
    !lower.includes("numerį") &&         // LT: registracijos numerį (registration number)
    !lower.includes("registracij") &&
    !hasPlateContextLt(lower)
  ) {
    return null;
  }

  for (const regex of PLATE_PATTERNS) {
    const match = combined.match(regex);
    if (match) return match[1].trim();
  }
  return null;
}

// ── Natural date parsing ────────────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

const DAY_OFFSETS: Record<string, number> = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0,
};

/**
 * Converts natural language date strings to ISO 8601.
 * Returns null if parsing fails (caller should fall back to default).
 */
export function parseNaturalDate(dateStr: string): string | null {
  const lower = dateStr.toLowerCase().trim();

  // "tomorrow at 2pm" / "tomorrow at 2:00 PM"
  const tomorrowMatch = lower.match(
    /tomorrow\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i
  );
  if (tomorrowMatch) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    let hours = parseInt(tomorrowMatch[1], 10);
    const minutes = parseInt(tomorrowMatch[2] || "0", 10);
    const ampm = tomorrowMatch[3].toLowerCase();
    if (ampm === "pm" && hours < 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;
    tomorrow.setHours(hours, minutes, 0, 0);
    return tomorrow.toISOString();
  }

  // "March 15 at 2:00 PM" or "Monday, March 15 at 2pm"
  const monthDayMatch = lower.match(
    /(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i
  );
  if (monthDayMatch) {
    const month = MONTH_MAP[monthDayMatch[1].toLowerCase()];
    const day = parseInt(monthDayMatch[2], 10);
    let hours = parseInt(monthDayMatch[3], 10);
    const minutes = parseInt(monthDayMatch[4] || "0", 10);
    const ampm = monthDayMatch[5].toLowerCase();
    if (ampm === "pm" && hours < 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;
    const now = new Date();
    const year = now.getFullYear();
    const result = new Date(year, month, day, hours, minutes, 0, 0);
    // If the date is in the past, assume next year
    if (result < now) result.setFullYear(year + 1);
    return result.toISOString();
  }

  // "3/15 at 2:00 PM" or "03/15/2026 at 2pm"
  const slashMatch = lower.match(
    /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i
  );
  if (slashMatch) {
    const month = parseInt(slashMatch[1], 10) - 1;
    const day = parseInt(slashMatch[2], 10);
    let year = slashMatch[3]
      ? parseInt(slashMatch[3], 10)
      : new Date().getFullYear();
    if (year < 100) year += 2000;
    let hours = parseInt(slashMatch[4], 10);
    const minutes = parseInt(slashMatch[5] || "0", 10);
    const ampm = slashMatch[6].toLowerCase();
    if (ampm === "pm" && hours < 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;
    return new Date(year, month, day, hours, minutes, 0, 0).toISOString();
  }

  return null;
}

// ── Core detection function ─────────────────────────────────────────────────

// ── Cumulative extraction helpers ─────────────────────────────────────────

/**
 * Fields extracted from a single message turn (no booking detection logic).
 */
export interface ExtractedFields {
  customerName: string | null;
  carModel: string | null;
  issueDescription: string | null;
  serviceType: string;
  licensePlate: string | null;
}

/**
 * Extract booking-relevant fields from a single customer message + AI response pair.
 * Does NOT detect booking intent — just extracts field values.
 */
export function extractFieldsFromMessage(
  customerMessage: string,
  aiResponse: string
): ExtractedFields {
  const lowerCustomer = customerMessage.toLowerCase();
  const lowerAi = aiResponse.toLowerCase();
  const combined = lowerCustomer + " " + lowerAi;

  // serviceType
  let serviceType = "general service";
  for (const { pattern, label } of SERVICE_KEYWORDS) {
    if (combined.includes(pattern)) {
      serviceType = label;
      break;
    }
  }

  // customerName (same logic as detectBookingIntent)
  let customerName: string | null = null;
  const nameComma = aiResponse.match(NAME_AFTER_COMMA);
  if (nameComma) {
    customerName = nameComma[1];
  } else {
    const nameFor = aiResponse.match(NAME_AFTER_FOR);
    if (nameFor) {
      customerName = nameFor[1];
    } else {
      const nameHi = aiResponse.match(NAME_AFTER_HI);
      if (nameHi) {
        customerName = nameHi[1];
      } else {
        const nameSelf = customerMessage.match(NAME_SELF_INTRO);
        if (nameSelf) {
          customerName = nameSelf[1];
        }
      }
    }
  }

  const carModel = extractCarModel(customerMessage, aiResponse);
  const licensePlate = extractLicensePlate(customerMessage, aiResponse);
  const issueDescription = customerMessage.trim() || null;

  return { customerName, carModel, issueDescription, serviceType, licensePlate };
}

/**
 * Determines whether a customer message is a substantive issue description
 * (i.e., describes a vehicle problem or service request) vs. a non-issue
 * message like a license plate number, time confirmation, or short acknowledgement.
 */
export function isSubstantiveIssue(text: string): boolean {
  if (!text || text.trim().length < 5) return false;
  const lower = text.toLowerCase().trim();
  // License plate messages are NOT issue descriptions
  if (/^(my )?(license )?plate/i.test(lower)) return false;
  // Time-only confirmations
  if (/^\d{1,2}\s*(am|pm)\b/i.test(lower)) return false;
  // Short acknowledgements
  if (/^(yes|yeah|yep|ok|okay|sure|sounds good|that works|perfect|great|let'?s? (do|book)|book it)/i.test(lower) && lower.length < 40) return false;
  // Must contain a service/problem keyword to count as issue description
  const issueKeywords = [
    "brake", "oil", "tire", "engine", "check", "repair", "service", "fix",
    "noise", "problem", "issue", "inspect", "replace", "change", "tune",
    "align", "transmission", "ac ", "a/c", "battery", "coolant", "radiator",
    "diagnostic", "light", "leak", "squeak", "vibrat", "pull", "stall",
    "overheat", "smoke", "smell", "need", "broken", "damage", "grind",
    "worn", "fluid", "steering", "suspen", "exhaust", "muffler", "belt",
    "hose", "filter", "spark", "starter", "alternator", "window", "door",
    "lock", "heat", "cool", "air", "conditioning",
  ];
  return issueKeywords.some((k) => lower.includes(k));
}

/**
 * Merge cumulative fields from conversation history into the current booking intent.
 *
 * Rules:
 * - customerName: keep first credible name; current wins only if prior is absent
 * - carModel: keep longest/most specific; prior wins if current is null or shorter
 * - issueDescription: keep first substantive issue; NEVER overwrite with non-issue text
 * - serviceType: never downgrade from specific to "general service"
 * - licensePlate: keep first captured plate; later fills if absent
 * - preferredTime/scheduledAt: NOT merged here (current turn's time is authoritative)
 */
export function mergeBookingFields(
  currentIntent: BookingIntentResult,
  priorExtractions: ExtractedFields[]
): BookingIntentResult {
  const merged = { ...currentIntent };

  // Accumulate best values from prior turns (oldest first)
  let bestName: string | null = null;
  let bestCarModel: string | null = null;
  let bestIssue: string | null = null;
  let bestService: string = "general service";
  let bestPlate: string | null = null;

  for (const prior of priorExtractions) {
    // Name: first credible name wins
    if (prior.customerName && !bestName) bestName = prior.customerName;
    // Car model: longest (most specific) wins
    if (prior.carModel && (!bestCarModel || prior.carModel.length > bestCarModel.length)) {
      bestCarModel = prior.carModel;
    }
    // Issue: first substantive issue wins
    if (prior.issueDescription && !bestIssue && isSubstantiveIssue(prior.issueDescription)) {
      bestIssue = prior.issueDescription;
    }
    // Service type: first specific classification wins
    if (prior.serviceType !== "general service" && bestService === "general service") {
      bestService = prior.serviceType;
    }
    // Plate: first captured plate wins
    if (prior.licensePlate && !bestPlate) bestPlate = prior.licensePlate;
  }

  // customerName: prefer prior if current is absent
  if (!merged.customerName && bestName) merged.customerName = bestName;

  // carModel: prefer prior if current is absent or shorter
  if (!merged.carModel && bestCarModel) {
    merged.carModel = bestCarModel;
  } else if (merged.carModel && bestCarModel && bestCarModel.length > merged.carModel.length) {
    merged.carModel = bestCarModel;
  }

  // issueDescription: NEVER overwrite substantive prior issue with non-issue text
  if (bestIssue) {
    if (!merged.issueDescription || !isSubstantiveIssue(merged.issueDescription)) {
      merged.issueDescription = bestIssue;
    }
  }

  // serviceType: never downgrade from specific to "general service"
  if (merged.serviceType === "general service" && bestService !== "general service") {
    merged.serviceType = bestService;
  }

  // licensePlate: fill if missing
  if (!merged.licensePlate && bestPlate) merged.licensePlate = bestPlate;

  return merged;
}

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
  // Only trigger on short messages where the close keyword IS the message intent.
  // "stop" alone = opt-out; "brakes grind when I stop" = describing a problem.
  const trimmed = lowerCustomer.trim();
  const userWantsClose =
    trimmed.split(/\s+/).length <= 5 &&
    CLOSE_KEYWORDS.some((k) => {
      const re = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      return re.test(trimmed);
    });

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
    // Try natural language date from AI response or customer message
    const textToSearch = [aiResponse, customerMessage];
    for (const text of textToSearch) {
      let found = false;
      for (const regex of NATURAL_DATE_PATTERNS) {
        const match = text.match(regex);
        if (match) {
          const parsed = parseNaturalDate(match[0]);
          if (parsed) {
            scheduledAt = parsed;
            scheduledAtExtracted = true;
            found = true;
            break;
          }
        }
      }
      if (found) break;
    }
    // scheduledAt already defaults to +24h from initialization
  }

  // Extract customer name from AI response, then fall back to customer message
  let customerName: string | null = null;
  const nameComma = aiResponse.match(NAME_AFTER_COMMA);
  if (nameComma) {
    customerName = nameComma[1];
  } else {
    const nameFor = aiResponse.match(NAME_AFTER_FOR);
    if (nameFor) {
      customerName = nameFor[1];
    } else {
      const nameHi = aiResponse.match(NAME_AFTER_HI);
      if (nameHi) {
        customerName = nameHi[1];
      } else {
        // Try customer self-introduction: "my name is X", "I'm X"
        const nameSelf = customerMessage.match(NAME_SELF_INTRO);
        if (nameSelf) {
          customerName = nameSelf[1];
        }
      }
    }
  }

  // Extract car model and license plate
  const carModel = extractCarModel(customerMessage, aiResponse);
  const licensePlate = extractLicensePlate(customerMessage, aiResponse);

  // issueDescription = the raw customer text about the problem.
  // serviceType = the classified label (e.g. "brake service").
  // They must remain separate: one is what the customer said, the other is system classification.
  const issueDescription = customerMessage.trim() || null;

  return {
    isBooked,
    confidence,
    serviceType,
    issueDescription,
    scheduledAt,
    scheduledAtExtracted,
    customerName,
    carModel,
    licensePlate,
    userWantsClose,
    matchedPatterns,
  };
}
