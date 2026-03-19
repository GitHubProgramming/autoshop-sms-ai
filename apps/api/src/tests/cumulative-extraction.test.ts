/**
 * Cumulative Booking Extraction Tests
 *
 * Validates that booking field extraction is cumulative across conversation turns,
 * not destructive. Earlier strong values must survive later non-issue messages.
 *
 * Bug fixed: extraction ran on current message only, causing:
 *   - issueDescription = "My license plate is ABC 1234" (overwrote real issue)
 *   - serviceType = "general service" (downgraded from brake service)
 */

import { describe, it, expect } from "vitest";
import {
  detectBookingIntent,
  extractFieldsFromMessage,
  isSubstantiveIssue,
  mergeBookingFields,
  type ExtractedFields,
} from "../services/booking-intent";

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1: Original live bug scenario
// ─────────────────────────────────────────────────────────────────────────────

describe("Cumulative extraction — live bug scenario", () => {
  // Conversation:
  //   1. "Need brakes checked. 2019 Honda Civic. Tomorrow morning works. My name is John."
  //   2. "9am works. Let's book it."
  //   3. "My license plate is ABC 1234"

  const msg1 = "Need brakes checked. 2019 Honda Civic. Tomorrow morning works. My name is John.";
  const ai1 = "I can help with that! Let me get your brake service scheduled for your 2019 Honda Civic. What time works best tomorrow?";

  const msg2 = "9am works. Let's book it.";
  const ai2 = "Great, 9am tomorrow it is! Before I finalize, I'll need your license plate number.";

  const msg3 = "My license plate is ABC 1234";
  const ai3 = "Your appointment is confirmed for brake service on your 2019 Honda Civic tomorrow at 9am, John!";

  it("raw extraction on message 3 alone produces degraded values", () => {
    const raw = detectBookingIntent(ai3, msg3);
    // This is the BUG: current message has no brake keywords in customer text
    expect(raw.issueDescription).toBe(msg3); // "My license plate is ABC 1234"
    // serviceType might be "general service" from customer message alone
    // (AI response might save it since it mentions "brake service")
  });

  it("cumulative extraction preserves strong values from earlier turns", () => {
    // Build prior extractions from conversation history
    const prior1 = extractFieldsFromMessage(msg1, ai1);
    const prior2 = extractFieldsFromMessage(msg2, ai2);

    // Current turn raw intent
    const rawIntent = detectBookingIntent(ai3, msg3);

    // Merge with history
    const merged = mergeBookingFields(rawIntent, [prior1, prior2]);

    // issueDescription must be from message 1, NOT "My license plate is ABC 1234"
    expect(merged.issueDescription).toBe(msg1);
    expect(merged.issueDescription).not.toContain("plate");

    // serviceType must remain brake-related, NOT "general service"
    expect(merged.serviceType).toBe("brake service");

    // customerName must survive from message 1
    expect(merged.customerName).toBe("John");

    // carModel must survive from message 1
    expect(merged.carModel).not.toBeNull();
    expect(merged.carModel!.toLowerCase()).toContain("honda");

    // licensePlate from message 3
    expect(merged.licensePlate).toBe("ABC 1234");

    // isBooked from current turn is preserved
    expect(merged.isBooked).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2: Time-refinement scenario
// ─────────────────────────────────────────────────────────────────────────────

describe("Cumulative extraction — time refinement does not degrade fields", () => {
  const msg1 = "I need an oil change for my 2020 Toyota Camry. My name is Sarah.";
  const ai1 = "Hi Sarah! I'd be happy to schedule an oil change for your 2020 Toyota Camry. When works best for you?";

  const msg2 = "9am works";
  const ai2 = "Your appointment is confirmed for an oil change tomorrow at 9am, Sarah!";

  it("time-only follow-up preserves issue and service type", () => {
    const prior1 = extractFieldsFromMessage(msg1, ai1);
    const rawIntent = detectBookingIntent(ai2, msg2);
    const merged = mergeBookingFields(rawIntent, [prior1]);

    expect(merged.issueDescription).toBe(msg1);
    expect(merged.serviceType).toBe("oil change");
    expect(merged.customerName).toBe("Sarah");
    expect(merged.carModel).not.toBeNull();
    expect(merged.carModel!.toLowerCase()).toContain("toyota");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3: Later correction scenario
// ─────────────────────────────────────────────────────────────────────────────

describe("Cumulative extraction — later correction wins", () => {
  it("explicit name correction in later turn is preserved (current turn wins if present)", () => {
    const msg1 = "Need tire rotation. My name is Jon.";
    const ai1 = "Sure Jon, when would you like to come in?";

    // Later, customer corrects name via AI acknowledgement
    const msg2 = "My name is Jonathan, not Jon. 2pm tomorrow please.";
    const ai2 = "Your appointment is confirmed for tire rotation tomorrow at 2pm, Jonathan!";

    const prior1 = extractFieldsFromMessage(msg1, ai1);
    const rawIntent = detectBookingIntent(ai2, msg2);
    const merged = mergeBookingFields(rawIntent, [prior1]);

    // The AI response for the current turn addresses "Jonathan" — current turn's name extraction
    // wins because it is non-null
    expect(merged.customerName).toBe("Jonathan");
    expect(merged.serviceType).toBe("tire rotation");
  });

  it("explicit car model correction in later turn wins if more specific", () => {
    const msg1 = "Need brakes checked on my Honda.";
    const ai1 = "I can help with brake service for your Honda. What's the year and model?";

    const msg2 = "It's a 2019 Honda Civic";
    const ai2 = "Your appointment is confirmed for brake service on your 2019 Honda Civic.";

    const prior1 = extractFieldsFromMessage(msg1, ai1);
    const rawIntent = detectBookingIntent(ai2, msg2);
    const merged = mergeBookingFields(rawIntent, [prior1]);

    // More specific model from later turn wins
    expect(merged.carModel!.toLowerCase()).toContain("civic");
    expect(merged.carModel!).toContain("2019");
    expect(merged.serviceType).toBe("brake service");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 4: isSubstantiveIssue classification
// ─────────────────────────────────────────────────────────────────────────────

describe("isSubstantiveIssue — classifies messages correctly", () => {
  it("brake-related message is substantive", () => {
    expect(isSubstantiveIssue("Need brakes checked. 2019 Honda Civic.")).toBe(true);
  });

  it("oil change message is substantive", () => {
    expect(isSubstantiveIssue("I need an oil change for my car")).toBe(true);
  });

  it("engine noise message is substantive", () => {
    expect(isSubstantiveIssue("My engine is making a weird noise")).toBe(true);
  });

  it("license plate message is NOT substantive", () => {
    expect(isSubstantiveIssue("My license plate is ABC 1234")).toBe(false);
  });

  it("plate number only is NOT substantive", () => {
    expect(isSubstantiveIssue("plate ABC 1234")).toBe(false);
  });

  it("time confirmation is NOT substantive", () => {
    expect(isSubstantiveIssue("9am works")).toBe(false);
  });

  it("short acknowledgement is NOT substantive", () => {
    expect(isSubstantiveIssue("Sounds good")).toBe(false);
    expect(isSubstantiveIssue("Yes")).toBe(false);
    expect(isSubstantiveIssue("Ok")).toBe(false);
    expect(isSubstantiveIssue("Perfect")).toBe(false);
    expect(isSubstantiveIssue("Let's book it")).toBe(false);
  });

  it("empty/short text is NOT substantive", () => {
    expect(isSubstantiveIssue("")).toBe(false);
    expect(isSubstantiveIssue("Hi")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 5: extractFieldsFromMessage unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe("extractFieldsFromMessage — extracts fields correctly", () => {
  it("extracts all fields from a rich first message", () => {
    const fields = extractFieldsFromMessage(
      "Need brakes checked. 2019 Honda Civic. My name is John.",
      "I can help with brake service on your 2019 Honda Civic, John."
    );

    expect(fields.serviceType).toBe("brake service");
    expect(fields.customerName).toBe("John");
    expect(fields.carModel).not.toBeNull();
    expect(fields.carModel!.toLowerCase()).toContain("honda");
    expect(fields.issueDescription).toContain("brakes checked");
    expect(fields.licensePlate).toBeNull();
  });

  it("extracts only license plate from a plate-only message", () => {
    const fields = extractFieldsFromMessage(
      "My license plate is ABC 1234",
      "Thanks, I've noted your plate."
    );

    expect(fields.licensePlate).toBe("ABC 1234");
    expect(fields.serviceType).toBe("general service");
  });

  it("extracts nothing meaningful from a short confirmation", () => {
    const fields = extractFieldsFromMessage(
      "9am works",
      "Great, 9am it is!"
    );

    expect(fields.serviceType).toBe("general service");
    expect(fields.customerName).toBeNull();
    expect(fields.carModel).toBeNull();
    expect(fields.licensePlate).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 6: mergeBookingFields edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("mergeBookingFields — merge rules", () => {
  const baseIntent = detectBookingIntent(
    "Your appointment is confirmed.",
    "My license plate is ABC 1234"
  );

  it("fills missing customerName from prior", () => {
    const prior: ExtractedFields = {
      customerName: "John",
      carModel: null,
      issueDescription: null,
      serviceType: "general service",
      licensePlate: null,
    };
    const merged = mergeBookingFields(baseIntent, [prior]);
    expect(merged.customerName).toBe("John");
  });

  it("does NOT downgrade serviceType from specific to general", () => {
    // Current turn has "general service", prior had "brake service"
    const prior: ExtractedFields = {
      customerName: null,
      carModel: null,
      issueDescription: "Need brakes checked",
      serviceType: "brake service",
      licensePlate: null,
    };
    const merged = mergeBookingFields(baseIntent, [prior]);
    expect(merged.serviceType).toBe("brake service");
  });

  it("does NOT overwrite substantive issueDescription with plate text", () => {
    const prior: ExtractedFields = {
      customerName: null,
      carModel: null,
      issueDescription: "Need brakes checked on my 2019 Honda Civic",
      serviceType: "brake service",
      licensePlate: null,
    };
    const merged = mergeBookingFields(baseIntent, [prior]);
    expect(merged.issueDescription).toContain("brakes checked");
    expect(merged.issueDescription).not.toContain("plate");
  });

  it("preserves current licensePlate when prior has none", () => {
    const prior: ExtractedFields = {
      customerName: "John",
      carModel: "2019 Honda Civic",
      issueDescription: "Need brakes checked",
      serviceType: "brake service",
      licensePlate: null,
    };
    const merged = mergeBookingFields(baseIntent, [prior]);
    expect(merged.licensePlate).toBe("ABC 1234");
  });

  it("prefers longer/more specific carModel from prior", () => {
    const currentWithShortCar = {
      ...baseIntent,
      carModel: "Honda",
    };
    const prior: ExtractedFields = {
      customerName: null,
      carModel: "2019 Honda Civic",
      issueDescription: null,
      serviceType: "general service",
      licensePlate: null,
    };
    const merged = mergeBookingFields(currentWithShortCar, [prior]);
    expect(merged.carModel).toBe("2019 Honda Civic");
  });

  it("keeps current carModel if it is longer than prior", () => {
    const currentWithLongCar = {
      ...baseIntent,
      carModel: "2020 Toyota Camry SE",
    };
    const prior: ExtractedFields = {
      customerName: null,
      carModel: "Toyota",
      issueDescription: null,
      serviceType: "general service",
      licensePlate: null,
    };
    const merged = mergeBookingFields(currentWithLongCar, [prior]);
    expect(merged.carModel).toBe("2020 Toyota Camry SE");
  });

  it("empty prior extractions produce unchanged intent", () => {
    const merged = mergeBookingFields(baseIntent, []);
    expect(merged).toEqual(baseIntent);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 7: No regression — detectBookingIntent still works standalone
// ─────────────────────────────────────────────────────────────────────────────

describe("No regression — detectBookingIntent standalone", () => {
  it("single rich message still extracts all fields correctly", () => {
    const intent = detectBookingIntent(
      "Your appointment is confirmed for brake service on your 2019 Honda Civic, John. See you tomorrow at 9am!",
      "Need brakes checked. 2019 Honda Civic. Tomorrow morning works. My name is John."
    );

    expect(intent.isBooked).toBe(true);
    expect(intent.serviceType).toBe("brake service");
    expect(intent.customerName).toBe("John");
    expect(intent.carModel).not.toBeNull();
    expect(intent.issueDescription).toContain("brakes checked");
    expect(intent.licensePlate).toBeNull();
  });

  it("close intent still works", () => {
    const intent = detectBookingIntent("I understand, goodbye!", "stop");
    expect(intent.userWantsClose).toBe(true);
  });
});
