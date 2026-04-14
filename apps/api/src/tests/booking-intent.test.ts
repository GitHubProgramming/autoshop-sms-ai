import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import {
  detectBookingIntent,
  BookingIntentResult,
} from "../services/booking-intent";
import { bookingIntentRoute } from "../routes/internal/booking-intent";

// ── Unit tests for detectBookingIntent() ────────────────────────────────────

describe("detectBookingIntent — booking confirmation", () => {
  it("detects high-confidence booking from 'appointment is confirmed'", () => {
    const r = detectBookingIntent(
      "Great! Your appointment is confirmed for tomorrow at 2 PM.",
      "yes please book it"
    );
    expect(r.isBooked).toBe(true);
    expect(r.confidence).toBe("high");
    expect(r.matchedPatterns).toContain("appointment is confirmed");
  });

  it("detects high-confidence booking from 'you're all set for'", () => {
    const r = detectBookingIntent(
      "You're all set for your oil change on Monday!",
      "Monday works"
    );
    expect(r.isBooked).toBe(true);
    expect(r.confidence).toBe("high");
  });

  it("detects high-confidence booking from 'we've booked you'", () => {
    const r = detectBookingIntent(
      "We've booked you for a brake inspection.",
      "that works"
    );
    expect(r.isBooked).toBe(true);
    expect(r.confidence).toBe("high");
  });

  it("detects high-confidence booking from 'i've scheduled you'", () => {
    const r = detectBookingIntent(
      "I've scheduled you for March 20th at 10 AM.",
      "great"
    );
    expect(r.isBooked).toBe(true);
    expect(r.confidence).toBe("high");
  });

  it("detects medium-confidence booking from 'booked for'", () => {
    const r = detectBookingIntent(
      "Booked for 3 PM tomorrow.",
      "tomorrow at 3"
    );
    expect(r.isBooked).toBe(true);
    expect(r.confidence).toBe("medium");
  });

  it("detects medium-confidence booking from 'see you on'", () => {
    const r = detectBookingIntent(
      "See you on Tuesday at 9 AM!",
      "Tuesday 9am"
    );
    expect(r.isBooked).toBe(true);
    expect(r.confidence).toBe("medium");
  });

  it("detects medium-confidence from 'we'll see you'", () => {
    const r = detectBookingIntent(
      "We'll see you Thursday at noon.",
      "Thursday"
    );
    expect(r.isBooked).toBe(true);
    expect(r.confidence).toBe("medium");
  });

  it("returns none confidence for non-booking AI response", () => {
    const r = detectBookingIntent(
      "What service do you need?",
      "I need an oil change"
    );
    expect(r.isBooked).toBe(false);
    expect(r.confidence).toBe("none");
    expect(r.matchedPatterns).toHaveLength(0);
  });

  it("returns none for a question about confirmation", () => {
    const r = detectBookingIntent(
      "Would you like me to confirm this appointment?",
      "yes"
    );
    expect(r.isBooked).toBe(false);
    expect(r.confidence).toBe("none");
  });
});

describe("detectBookingIntent — service type extraction", () => {
  it("extracts 'oil change' from customer message", () => {
    const r = detectBookingIntent("Sure!", "I need an oil change");
    expect(r.serviceType).toBe("oil change");
  });

  it("extracts 'brake service' from 'brakes'", () => {
    const r = detectBookingIntent("Sure!", "my brakes are squeaking");
    expect(r.serviceType).toBe("brake service");
  });

  it("extracts 'diagnostics' from 'check engine'", () => {
    const r = detectBookingIntent("Sure!", "my check engine light is on");
    expect(r.serviceType).toBe("diagnostics");
  });

  it("extracts 'tune up' from 'tune-up' (hyphenated)", () => {
    const r = detectBookingIntent("Sure!", "I want a tune-up");
    expect(r.serviceType).toBe("tune up");
  });

  it("extracts 'AC repair' from 'air conditioning'", () => {
    const r = detectBookingIntent("Sure!", "air conditioning not working");
    expect(r.serviceType).toBe("AC repair");
  });

  it("extracts 'state inspection' over generic 'inspection'", () => {
    const r = detectBookingIntent("Sure!", "I need a state inspection");
    expect(r.serviceType).toBe("state inspection");
  });

  it("extracts service type from AI response if not in customer message", () => {
    const r = detectBookingIntent(
      "Your appointment is confirmed for an oil change.",
      "sounds good"
    );
    expect(r.serviceType).toBe("oil change");
  });

  it("defaults to 'general service' when no service detected", () => {
    const r = detectBookingIntent("Sure!", "I need help with my car");
    expect(r.serviceType).toBe("general service");
  });
});

describe("detectBookingIntent — user close detection", () => {
  it("detects 'stop'", () => {
    const r = detectBookingIntent("Ok!", "stop");
    expect(r.userWantsClose).toBe(true);
  });

  it("detects 'no thanks'", () => {
    const r = detectBookingIntent("Ok!", "no thanks");
    expect(r.userWantsClose).toBe(true);
  });

  it("detects 'not interested'", () => {
    const r = detectBookingIntent("Ok!", "not interested");
    expect(r.userWantsClose).toBe(true);
  });

  it("detects 'never mind'", () => {
    const r = detectBookingIntent("Ok!", "never mind");
    expect(r.userWantsClose).toBe(true);
  });

  it("detects 'unsubscribe'", () => {
    const r = detectBookingIntent("Ok!", "unsubscribe");
    expect(r.userWantsClose).toBe(true);
  });

  it("detects 'don't text me'", () => {
    const r = detectBookingIntent("Ok!", "don't text me anymore");
    expect(r.userWantsClose).toBe(true);
  });

  it("does not false-positive on normal messages", () => {
    const r = detectBookingIntent("Ok!", "yes please book it");
    expect(r.userWantsClose).toBe(false);
  });
});

describe("detectBookingIntent — date extraction", () => {
  it("extracts ISO 8601 date from customer message", () => {
    const r = detectBookingIntent(
      "Confirmed!",
      "Book me for 2026-03-20T14:00:00-05:00"
    );
    expect(r.scheduledAtExtracted).toBe(true);
    expect(r.scheduledAt).toBe("2026-03-20T14:00:00-05:00");
  });

  it("extracts ISO 8601 date from AI response", () => {
    const r = detectBookingIntent(
      "Your appointment is confirmed for 2026-03-20T14:00:00-05:00.",
      "sounds good"
    );
    expect(r.scheduledAtExtracted).toBe(true);
    expect(r.scheduledAt).toBe("2026-03-20T14:00:00-05:00");
  });

  it("extracts natural date 'March 15 at 2:00 PM' as ISO 8601", () => {
    const r = detectBookingIntent(
      "Your appointment is confirmed for March 15 at 2:00 PM.",
      "ok"
    );
    expect(r.scheduledAtExtracted).toBe(true);
    // Should be a valid ISO date string, not raw natural language
    expect(() => new Date(r.scheduledAt).toISOString()).not.toThrow();
    const d = new Date(r.scheduledAt);
    expect(d.getMonth()).toBe(2); // March = 2
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(14); // 2 PM
  });

  it("extracts 'tomorrow at 3pm' as ISO 8601", () => {
    const r = detectBookingIntent(
      "You're all set for tomorrow at 3pm.",
      "ok"
    );
    expect(r.scheduledAtExtracted).toBe(true);
    // Should be a valid ISO date string, not raw natural language
    expect(() => new Date(r.scheduledAt).toISOString()).not.toThrow();
    const d = new Date(r.scheduledAt);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(d.getDate()).toBe(tomorrow.getDate());
    expect(d.getHours()).toBe(15); // 3 PM
  });

  it("falls back to +24h ISO when no date found", () => {
    const before = Date.now();
    const r = detectBookingIntent("Confirmed!", "ok");
    const after = Date.now();
    expect(r.scheduledAtExtracted).toBe(false);
    const scheduled = new Date(r.scheduledAt).getTime();
    expect(scheduled).toBeGreaterThanOrEqual(before + 86_400_000 - 100);
    expect(scheduled).toBeLessThanOrEqual(after + 86_400_000 + 100);
  });

  it("prefers customer ISO date over AI natural date", () => {
    const r = detectBookingIntent(
      "See you on March 15 at 2:00 PM.",
      "2026-03-15T14:00:00-05:00"
    );
    expect(r.scheduledAt).toBe("2026-03-15T14:00:00-05:00");
  });
});

describe("detectBookingIntent — customer name extraction", () => {
  it("extracts name from 'confirmed, John'", () => {
    const r = detectBookingIntent(
      "Your appointment is confirmed, John. See you tomorrow!",
      "yes"
    );
    expect(r.customerName).toBe("John");
  });

  it("extracts name from 'Thank you, Maria'", () => {
    const r = detectBookingIntent(
      "Thank you, Maria. Your oil change is scheduled.",
      "thanks"
    );
    expect(r.customerName).toBe("Maria");
  });

  it("extracts name from 'appointment confirmed for John Smith'", () => {
    const r = detectBookingIntent(
      "Your appointment confirmed for John Smith at 2 PM.",
      "ok"
    );
    expect(r.customerName).toBe("John Smith");
  });

  it("returns null when no name detected", () => {
    const r = detectBookingIntent(
      "Your appointment is confirmed for tomorrow.",
      "ok"
    );
    expect(r.customerName).toBeNull();
  });
});

describe("detectBookingIntent — edge cases", () => {
  it("handles empty strings", () => {
    const r = detectBookingIntent("", "");
    expect(r.isBooked).toBe(false);
    expect(r.userWantsClose).toBe(false);
    expect(r.serviceType).toBe("general service");
    expect(r.customerName).toBeNull();
  });

  it("is case-insensitive for booking detection", () => {
    const r = detectBookingIntent(
      "YOUR APPOINTMENT IS CONFIRMED!",
      "great"
    );
    expect(r.isBooked).toBe(true);
    expect(r.confidence).toBe("high");
  });

  it("does not detect booking when AI asks for confirmation", () => {
    const r = detectBookingIntent(
      "I can schedule you for Tuesday. Should I go ahead and book it?",
      "Tuesday at 2pm"
    );
    expect(r.isBooked).toBe(false);
  });

  it("detects both booking and service type in one call", () => {
    const r = detectBookingIntent(
      "Your appointment is confirmed for an oil change tomorrow at 10 AM.",
      "yes book it"
    );
    expect(r.isBooked).toBe(true);
    expect(r.serviceType).toBe("oil change");
  });
});

// ── HTTP endpoint tests ─────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(bookingIntentRoute, { prefix: "/internal" });
  return app;
}

describe("POST /internal/booking-intent", () => {
  it("returns 200 with booking intent result", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/booking-intent",
      payload: {
        aiResponse: "Your appointment is confirmed for tomorrow at 2 PM.",
        customerMessage: "I need an oil change",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BookingIntentResult;
    expect(body.isBooked).toBe(true);
    expect(body.confidence).toBe("high");
    expect(body.serviceType).toBe("oil change");
  });

  it("returns 400 when aiResponse is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/booking-intent",
      payload: { customerMessage: "hello" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when customerMessage is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/booking-intent",
      payload: { aiResponse: "hello" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when body is empty", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/booking-intent",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns isBooked=false for non-booking response", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/booking-intent",
      payload: {
        aiResponse: "What time works for you?",
        customerMessage: "I need an oil change",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().isBooked).toBe(false);
  });

  it("detects user wants to close", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/booking-intent",
      payload: {
        aiResponse: "I understand. Have a great day!",
        customerMessage: "no thanks not interested",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().userWantsClose).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Lithuanian (LT pilot) booking detection tests
// ═══════════════════════════════════════════════════════════════════════════

describe("detectBookingIntent — Lithuanian patterns", () => {
  it("detects high-confidence 'vizitas patvirtintas' (appointment confirmed)", () => {
    const r = detectBookingIntent(
      "Vizitas patvirtintas! Jūsų Toyota Corolla bus apžiūrėta šiandien 10:00. Lauksime jūsų Proteros Servise!",
      "Tinka"
    );
    expect(r.isBooked).toBe(true);
    expect(r.confidence).toBe("high");
    expect(r.matchedPatterns).toContain("vizitas patvirtintas");
  });

  it("detects high-confidence 'rezervacija patvirtinta' (reservation confirmed)", () => {
    const r = detectBookingIntent(
      "Rezervacija patvirtinta rytoj 14:00.",
      "Gerai"
    );
    expect(r.isBooked).toBe(true);
    expect(r.confidence).toBe("high");
    expect(r.matchedPatterns).toContain("rezervacija patvirtinta");
  });

  it("detects medium-confidence 'lauksime jūsų' (we'll be waiting for you)", () => {
    const r = detectBookingIntent(
      "Lauksime jūsų rytoj 9:00!",
      "Ačiū"
    );
    expect(r.isBooked).toBe(true);
    expect(r.confidence).toBe("medium");
    expect(r.matchedPatterns).toContain("lauksime jūsų");
  });

  it("does NOT detect booking from 'ačiū' alone (false positive guard)", () => {
    const r = detectBookingIntent(
      "Nėra už ką! Jei turėsite daugiau klausimų, drąsiai rašykite.",
      "Ačiū"
    );
    expect(r.isBooked).toBe(false);
    expect(r.confidence).toBe("none");
  });

  it("does NOT detect booking from general info response", () => {
    const r = detectBookingIntent(
      "Dirbame nuo 8:00 iki 18:00, pirmadienį–penktadienį.",
      "Kokios darbo valandos?"
    );
    expect(r.isBooked).toBe(false);
    expect(r.confidence).toBe("none");
  });

  it("extracts car model from Lithuanian conversation", () => {
    const r = detectBookingIntent(
      "Vizitas patvirtintas! Jūsų Toyota Corolla bus apžiūrėta šiandien 10:00.",
      "Sveiki, mano Toyota Corolla nesikuria"
    );
    expect(r.isBooked).toBe(true);
    expect(r.carModel).toContain("Toyota");
    expect(r.carModel).toContain("Corolla");
  });

  it("extracts name from Lithuanian 'Ačiū, Manta' pattern", () => {
    const r = detectBookingIntent(
      "Ačiū, Manta. Ar galite nurodyti automobilio registracijos numerį?",
      "Mantas šiandien 10 h ryto"
    );
    expect(r.customerName).toBe("Manta");
  });

  it("detects LT close keyword 'atšaukti'", () => {
    const r = detectBookingIntent(
      "Supratau, vizitas atšauktas.",
      "atšaukti"
    );
    expect(r.userWantsClose).toBe(true);
  });

  it("extracts license plate when 'numeris' precedes plate (LT context)", () => {
    const r = detectBookingIntent(
      "Ačiū, registruoju jūsų vizitą.",
      "Mano automobilio numeris ABC123, atvyksiu rytoj."
    );
    expect(r.licensePlate).toBe("ABC123");
  });

  it("does NOT extract plate from 'telefono numeris' (phone context, false positive guard)", () => {
    const r = detectBookingIntent(
      "Ačiū už informaciją.",
      "Mano telefono numeris yra +37067577829, skambinkit."
    );
    expect(r.licensePlate).toBeNull();
  });
});
