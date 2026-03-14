import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  decryptToken: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

vi.mock("../routes/auth/google", () => ({
  decryptToken: mocks.decryptToken,
}));

import { calendarEventRoute } from "../routes/internal/calendar-event";
import {
  createCalendarEvent,
  buildEventBody,
  getCalendarTokens,
} from "../services/google-calendar";

// ── Constants ────────────────────────────────────────────────────────────────

const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const APPT_ID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
const PHONE = "+15551234567";
const ACCESS_TOKEN = "ya29.real-access-token";
const CALENDAR_ID = "primary";
const GOOGLE_EVENT_ID = "abc123googleeventid";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT_ID,
    appointmentId: APPT_ID,
    customerPhone: PHONE,
    serviceType: "oil change",
    scheduledAt: "2026-03-15T10:00:00-05:00",
    ...overrides,
  };
}

function tokenRow() {
  return {
    access_token: "enc_access",
    calendar_id: CALENDAR_ID,
  };
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(calendarEventRoute, { prefix: "/internal" });
  return app;
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decryptToken.mockReturnValue(ACCESS_TOKEN);
  mocks.query.mockResolvedValue([]);
});

// ═══════════════════════════════════════════════════════════════════════════
// Service unit tests
// ═══════════════════════════════════════════════════════════════════════════

describe("buildEventBody", () => {
  it("builds correct event body with defaults", () => {
    const body = buildEventBody({
      tenantId: TENANT_ID,
      appointmentId: APPT_ID,
      customerPhone: PHONE,
      serviceType: "oil change",
      scheduledAt: "2026-03-15T10:00:00-05:00",
    });

    expect(body.summary).toBe(`oil change — ${PHONE}`);
    expect(body.description).toContain("oil change");
    expect(body.description).toContain(PHONE);
    expect(body.start.timeZone).toBe("America/Chicago");
    expect(body.end.timeZone).toBe("America/Chicago");
    // Default 60 min duration
    const start = new Date(body.start.dateTime);
    const end = new Date(body.end.dateTime);
    expect(end.getTime() - start.getTime()).toBe(60 * 60 * 1000);
  });

  it("includes customer name in summary and description", () => {
    const body = buildEventBody({
      tenantId: TENANT_ID,
      appointmentId: APPT_ID,
      customerPhone: PHONE,
      customerName: "John",
      serviceType: "brake service",
      scheduledAt: "2026-03-15T14:00:00Z",
    });

    expect(body.summary).toBe(`brake service — John — ${PHONE}`);
    expect(body.description).toContain("Name: John");
  });

  it("uses custom duration and timezone", () => {
    const body = buildEventBody({
      tenantId: TENANT_ID,
      appointmentId: APPT_ID,
      customerPhone: PHONE,
      serviceType: "state inspection",
      scheduledAt: "2026-03-15T09:00:00Z",
      durationMinutes: 30,
      timeZone: "America/New_York",
    });

    const start = new Date(body.start.dateTime);
    const end = new Date(body.end.dateTime);
    expect(end.getTime() - start.getTime()).toBe(30 * 60 * 1000);
    expect(body.start.timeZone).toBe("America/New_York");
  });
});

describe("getCalendarTokens", () => {
  it("returns null when no tokens exist", async () => {
    mocks.query.mockResolvedValueOnce([]);
    const result = await getCalendarTokens(TENANT_ID);
    expect(result).toBeNull();
  });

  it("returns decrypted access token and calendar ID", async () => {
    mocks.query.mockResolvedValueOnce([tokenRow()]);
    const result = await getCalendarTokens(TENANT_ID);
    expect(result).toEqual({
      accessToken: ACCESS_TOKEN,
      calendarId: CALENDAR_ID,
    });
    expect(mocks.decryptToken).toHaveBeenCalledWith("enc_access");
  });
});

describe("createCalendarEvent", () => {
  function mockFetch(status: number, body: unknown): typeof fetch {
    return vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    );
  }

  // ── Idempotency ────────────────────────────────────────────────────────

  it("returns existing event ID when appointment already synced", async () => {
    const existingEventId = "existing-google-event-123";
    mocks.query.mockResolvedValueOnce([{ google_event_id: existingEventId }]); // idempotency check

    const fetchFn = vi.fn();
    const result = await createCalendarEvent(validBody(), fetchFn);

    expect(result.success).toBe(true);
    expect(result.googleEventId).toBe(existingEventId);
    expect(result.calendarSynced).toBe(true);
    expect(result.error).toBeNull();
    // Should NOT call Google API
    expect(fetchFn).not.toHaveBeenCalled();
    // Only the idempotency check query
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("proceeds when idempotency check fails (DB error)", async () => {
    mocks.query.mockRejectedValueOnce(new Error("connection reset")); // idempotency check fails
    mocks.query.mockResolvedValueOnce([tokenRow()]); // getCalendarTokens
    mocks.query.mockResolvedValueOnce([]); // UPDATE appointment

    const fetchFn = mockFetch(200, { id: GOOGLE_EVENT_ID });
    const result = await createCalendarEvent(validBody(), fetchFn);

    expect(result.success).toBe(true);
    expect(result.googleEventId).toBe(GOOGLE_EVENT_ID);
    // Google API was still called
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  it("creates event and updates appointment on success", async () => {
    mocks.query.mockResolvedValueOnce([]); // idempotency check — no existing event
    mocks.query.mockResolvedValueOnce([tokenRow()]); // getCalendarTokens
    mocks.query.mockResolvedValueOnce([]); // UPDATE appointment

    const fetchFn = mockFetch(200, { id: GOOGLE_EVENT_ID });
    const result = await createCalendarEvent(validBody(), fetchFn);

    expect(result.success).toBe(true);
    expect(result.googleEventId).toBe(GOOGLE_EVENT_ID);
    expect(result.calendarSynced).toBe(true);
    expect(result.error).toBeNull();

    // Verify Google API was called correctly
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, opts] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/calendars/primary/events");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);

    // Verify DB update (3 calls: idempotency check + token fetch + update)
    expect(mocks.query).toHaveBeenCalledTimes(3);
    const updateCall = mocks.query.mock.calls[2];
    expect(updateCall[0]).toContain("UPDATE appointments");
    expect(updateCall[1]).toEqual([GOOGLE_EVENT_ID, APPT_ID, TENANT_ID]);
  });

  // ── No tokens ───────────────────────────────────────────────────────────

  it("returns error when no calendar tokens exist for tenant", async () => {
    mocks.query.mockResolvedValueOnce([]); // idempotency check — no existing event
    mocks.query.mockResolvedValueOnce([]); // no tokens

    const fetchFn = vi.fn();
    const result = await createCalendarEvent(validBody(), fetchFn);

    expect(result.success).toBe(false);
    expect(result.error).toBe("No calendar tokens found for tenant");
    expect(result.calendarSynced).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  // ── Token decryption failure ────────────────────────────────────────────

  it("returns error when token decryption fails", async () => {
    mocks.query.mockResolvedValueOnce([]); // idempotency check
    mocks.query.mockResolvedValueOnce([tokenRow()]);
    mocks.decryptToken.mockImplementation(() => {
      throw new Error("decryption failed");
    });

    const fetchFn = vi.fn();
    const result = await createCalendarEvent(validBody(), fetchFn);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Token retrieval failed");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  // ── Google API error ────────────────────────────────────────────────────

  it("returns error when Google Calendar API returns 401", async () => {
    mocks.query.mockResolvedValueOnce([]); // idempotency check
    mocks.query.mockResolvedValueOnce([tokenRow()]);

    const fetchFn = mockFetch(401, { error: "invalid_token" });
    const result = await createCalendarEvent(validBody(), fetchFn);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Google Calendar API error 401");
    expect(result.calendarSynced).toBe(false);
    // Should NOT update DB (2 calls: idempotency check + token fetch)
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it("returns error when Google Calendar API returns 403", async () => {
    mocks.query.mockResolvedValueOnce([]); // idempotency check
    mocks.query.mockResolvedValueOnce([tokenRow()]);

    const fetchFn = mockFetch(403, { error: "forbidden" });
    const result = await createCalendarEvent(validBody(), fetchFn);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Google Calendar API error 403");
  });

  it("returns error when Google Calendar API returns 500", async () => {
    mocks.query.mockResolvedValueOnce([]); // idempotency check
    mocks.query.mockResolvedValueOnce([tokenRow()]);

    const fetchFn = mockFetch(500, { error: "internal" });
    const result = await createCalendarEvent(validBody(), fetchFn);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Google Calendar API error 500");
  });

  // ── Network failure ─────────────────────────────────────────────────────

  it("returns error when fetch throws (network failure)", async () => {
    mocks.query.mockResolvedValueOnce([]); // idempotency check
    mocks.query.mockResolvedValueOnce([tokenRow()]);

    const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await createCalendarEvent(validBody(), fetchFn);

    expect(result.success).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
    expect(result.calendarSynced).toBe(false);
  });

  // ── DB update failure (partial success) ─────────────────────────────────

  it("returns partial success when event created but DB update fails", async () => {
    mocks.query.mockResolvedValueOnce([]); // idempotency check
    mocks.query.mockResolvedValueOnce([tokenRow()]); // token fetch
    mocks.query.mockRejectedValueOnce(new Error("connection lost")); // DB update fails

    const fetchFn = mockFetch(200, { id: GOOGLE_EVENT_ID });
    const result = await createCalendarEvent(validBody(), fetchFn);

    expect(result.success).toBe(true);
    expect(result.googleEventId).toBe(GOOGLE_EVENT_ID);
    expect(result.calendarSynced).toBe(false); // DB failed
    expect(result.error).toContain("DB update failed");
  });

  // ── Calendar ID encoding ────────────────────────────────────────────────

  it("encodes calendar ID in URL", async () => {
    mocks.query.mockResolvedValueOnce([]); // idempotency check
    mocks.query.mockResolvedValueOnce([
      { ...tokenRow(), calendar_id: "user@example.com" },
    ]);
    mocks.query.mockResolvedValueOnce([]);

    const fetchFn = mockFetch(200, { id: GOOGLE_EVENT_ID });
    await createCalendarEvent(validBody(), fetchFn);

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/calendars/user%40example.com/events");
  });

  // ── Customer name included ──────────────────────────────────────────────

  it("includes customer name in event when provided", async () => {
    mocks.query.mockResolvedValueOnce([]); // idempotency check
    mocks.query.mockResolvedValueOnce([tokenRow()]);
    mocks.query.mockResolvedValueOnce([]);

    const fetchFn = mockFetch(200, { id: GOOGLE_EVENT_ID });
    await createCalendarEvent(
      validBody({ customerName: "John Smith" }),
      fetchFn
    );

    const [, opts] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.summary).toContain("John Smith");
    expect(body.description).toContain("Name: John Smith");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Route integration tests
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /internal/calendar-event", () => {
  // ── Validation ──────────────────────────────────────────────────────────

  it("returns 400 for missing required fields", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/calendar-event",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Validation failed");
    await app.close();
  });

  it("returns 400 for invalid tenantId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/calendar-event",
      payload: validBody({ tenantId: "not-a-uuid" }),
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("returns 400 for invalid appointmentId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/calendar-event",
      payload: validBody({ appointmentId: "bad" }),
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("returns 400 for empty customerPhone", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/calendar-event",
      payload: validBody({ customerPhone: "" }),
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("returns 400 for empty serviceType", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/calendar-event",
      payload: validBody({ serviceType: "" }),
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  // ── Happy path via route ────────────────────────────────────────────────

  it("returns 200 with event ID on success", async () => {
    mocks.query.mockResolvedValueOnce([]); // idempotency check
    mocks.query.mockResolvedValueOnce([tokenRow()]); // tokens
    mocks.query.mockResolvedValueOnce([]); // DB update

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: GOOGLE_EVENT_ID }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/calendar-event",
      payload: validBody(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.googleEventId).toBe(GOOGLE_EVENT_ID);
    expect(body.calendarSynced).toBe(true);

    fetchSpy.mockRestore();
    await app.close();
  });

  // ── Error path via route ────────────────────────────────────────────────

  it("returns 502 when no calendar tokens exist", async () => {
    mocks.query.mockResolvedValueOnce([]); // idempotency check
    mocks.query.mockResolvedValueOnce([]); // no tokens

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/calendar-event",
      payload: validBody(),
    });

    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("No calendar tokens");

    await app.close();
  });

  it("returns 502 when Google API fails", async () => {
    mocks.query.mockResolvedValueOnce([]); // idempotency check
    mocks.query.mockResolvedValueOnce([tokenRow()]);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("Unauthorized", { status: 401 })
      );

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/calendar-event",
      payload: validBody(),
    });

    expect(res.statusCode).toBe(502);
    expect(res.json().success).toBe(false);

    fetchSpy.mockRestore();
    await app.close();
  });

  // ── Optional fields ─────────────────────────────────────────────────────

  it("accepts optional durationMinutes and timeZone", async () => {
    mocks.query.mockResolvedValueOnce([]); // idempotency check
    mocks.query.mockResolvedValueOnce([tokenRow()]);
    mocks.query.mockResolvedValueOnce([]);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: GOOGLE_EVENT_ID }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/calendar-event",
      payload: validBody({
        durationMinutes: 30,
        timeZone: "America/New_York",
        customerName: "Jane",
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);

    fetchSpy.mockRestore();
    await app.close();
  });
});
