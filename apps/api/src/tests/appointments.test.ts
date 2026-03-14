import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

import { appointmentsRoute } from "../routes/internal/appointments";
import { createAppointment } from "../services/appointments";

// ── Constants ────────────────────────────────────────────────────────────────

const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const CONVERSATION_ID = "c3d4e5f6-a7b8-9012-cdef-123456789012";
const PHONE = "+15551234567";
const APPT_ID = "d4e5f6a7-b8c9-0123-defa-234567890123";
const NOW_ISO = "2026-03-15T10:00:00.000Z";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT_ID,
    conversationId: CONVERSATION_ID,
    customerPhone: PHONE,
    customerName: "John Smith",
    serviceType: "oil change",
    scheduledAt: "2026-03-16T10:00:00-05:00",
    durationMinutes: 60,
    notes: "Customer prefers morning",
    ...overrides,
  };
}

function dbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: APPT_ID,
    tenant_id: TENANT_ID,
    conversation_id: CONVERSATION_ID,
    customer_phone: PHONE,
    customer_name: "John Smith",
    service_type: "oil change",
    scheduled_at: "2026-03-16T15:00:00.000Z",
    duration_minutes: 60,
    notes: "Customer prefers morning",
    google_event_id: null,
    calendar_synced: false,
    created_at: NOW_ISO,
    xmax: "0",
    ...overrides,
  };
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(appointmentsRoute, { prefix: "/internal" });
  return app;
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// Service unit tests
// ═══════════════════════════════════════════════════════════════════════════

describe("createAppointment — service", () => {
  it("creates appointment successfully", async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: TENANT_ID }]) // tenant lookup
      .mockResolvedValueOnce([dbRow()]); // insert

    const result = await createAppointment({
      tenantId: TENANT_ID,
      conversationId: CONVERSATION_ID,
      customerPhone: PHONE,
      customerName: "John Smith",
      serviceType: "oil change",
      scheduledAt: "2026-03-16T10:00:00-05:00",
    });

    expect(result.success).toBe(true);
    expect(result.appointment).not.toBeNull();
    expect(result.appointment!.id).toBe(APPT_ID);
    expect(result.appointment!.customerName).toBe("John Smith");
    expect(result.appointment!.serviceType).toBe("oil change");
    expect(result.upserted).toBe(false);
    expect(result.error).toBeNull();
  });

  it("returns upserted=true when conversation already has appointment", async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: TENANT_ID }])
      .mockResolvedValueOnce([dbRow({ xmax: "12345" })]);

    const result = await createAppointment({
      tenantId: TENANT_ID,
      conversationId: CONVERSATION_ID,
      customerPhone: PHONE,
      scheduledAt: "2026-03-16T10:00:00-05:00",
    });

    expect(result.success).toBe(true);
    expect(result.upserted).toBe(true);
  });

  it("creates appointment without conversationId (no upsert)", async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: TENANT_ID }])
      .mockResolvedValueOnce([dbRow({ conversation_id: null, xmax: "0" })]);

    const result = await createAppointment({
      tenantId: TENANT_ID,
      customerPhone: PHONE,
      scheduledAt: "2026-03-16T10:00:00-05:00",
    });

    expect(result.success).toBe(true);
    expect(result.upserted).toBe(false);
    // Verify the INSERT query was used (no ON CONFLICT)
    const insertCall = mocks.query.mock.calls[1];
    expect(insertCall[0]).not.toContain("ON CONFLICT");
  });

  it("returns error when tenant not found", async () => {
    mocks.query.mockResolvedValueOnce([]);

    const result = await createAppointment({
      tenantId: TENANT_ID,
      customerPhone: PHONE,
      scheduledAt: "2026-03-16T10:00:00-05:00",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Tenant not found");
    expect(result.appointment).toBeNull();
  });

  it("returns error when tenant lookup fails", async () => {
    mocks.query.mockRejectedValueOnce(new Error("connection refused"));

    const result = await createAppointment({
      tenantId: TENANT_ID,
      customerPhone: PHONE,
      scheduledAt: "2026-03-16T10:00:00-05:00",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Tenant lookup failed");
    expect(result.error).toContain("connection refused");
  });

  it("returns error when insert fails", async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: TENANT_ID }])
      .mockRejectedValueOnce(new Error("unique violation"));

    const result = await createAppointment({
      tenantId: TENANT_ID,
      customerPhone: PHONE,
      scheduledAt: "2026-03-16T10:00:00-05:00",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Appointment creation failed");
    expect(result.error).toContain("unique violation");
  });

  it("returns error when insert returns no rows", async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: TENANT_ID }])
      .mockResolvedValueOnce([]);

    const result = await createAppointment({
      tenantId: TENANT_ID,
      customerPhone: PHONE,
      scheduledAt: "2026-03-16T10:00:00-05:00",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Insert returned no rows");
  });

  it("defaults durationMinutes to 60", async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: TENANT_ID }])
      .mockResolvedValueOnce([dbRow()]);

    await createAppointment({
      tenantId: TENANT_ID,
      customerPhone: PHONE,
      scheduledAt: "2026-03-16T10:00:00-05:00",
    });

    const insertCall = mocks.query.mock.calls[1];
    // duration_minutes is the 7th param in the upsert-less insert
    // or param index varies — check that 60 appears in params
    expect(insertCall[1]).toContain(60);
  });

  it("passes custom durationMinutes", async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: TENANT_ID }])
      .mockResolvedValueOnce([dbRow({ duration_minutes: 90 })]);

    const result = await createAppointment({
      tenantId: TENANT_ID,
      customerPhone: PHONE,
      scheduledAt: "2026-03-16T10:00:00-05:00",
      durationMinutes: 90,
    });

    expect(result.success).toBe(true);
    const insertCall = mocks.query.mock.calls[1];
    expect(insertCall[1]).toContain(90);
  });

  it("handles null customerName and serviceType", async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: TENANT_ID }])
      .mockResolvedValueOnce([
        dbRow({ customer_name: null, service_type: null }),
      ]);

    const result = await createAppointment({
      tenantId: TENANT_ID,
      customerPhone: PHONE,
      scheduledAt: "2026-03-16T10:00:00-05:00",
    });

    expect(result.success).toBe(true);
    expect(result.appointment!.customerName).toBeNull();
    expect(result.appointment!.serviceType).toBeNull();
  });

  it("uses ON CONFLICT query when conversationId provided", async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: TENANT_ID }])
      .mockResolvedValueOnce([dbRow()]);

    await createAppointment({
      tenantId: TENANT_ID,
      conversationId: CONVERSATION_ID,
      customerPhone: PHONE,
      scheduledAt: "2026-03-16T10:00:00-05:00",
    });

    const insertCall = mocks.query.mock.calls[1];
    expect(insertCall[0]).toContain("ON CONFLICT");
    expect(insertCall[0]).toContain("conversation_id");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Route integration tests
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /internal/appointments — route", () => {
  it("returns 201 on successful creation", async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: TENANT_ID }])
      .mockResolvedValueOnce([dbRow()]);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/appointments",
      payload: validBody(),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.appointment.id).toBe(APPT_ID);
    expect(body.upserted).toBe(false);
  });

  it("returns 200 on upsert (existing conversation appointment)", async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: TENANT_ID }])
      .mockResolvedValueOnce([dbRow({ xmax: "999" })]);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/appointments",
      payload: validBody(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.upserted).toBe(true);
  });

  it("returns 404 when tenant not found", async () => {
    mocks.query.mockResolvedValueOnce([]);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/appointments",
      payload: validBody(),
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Tenant not found");
  });

  it("returns 500 on database error", async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: TENANT_ID }])
      .mockRejectedValueOnce(new Error("disk full"));

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/appointments",
      payload: validBody(),
    });

    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("disk full");
  });

  it("returns 400 on missing tenantId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/appointments",
      payload: { customerPhone: PHONE, scheduledAt: "2026-03-16T10:00:00-05:00" },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("Validation failed");
  });

  it("returns 400 on invalid tenantId format", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/appointments",
      payload: validBody({ tenantId: "not-a-uuid" }),
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("Validation failed");
    expect(body.details[0]).toContain("tenantId");
  });

  it("returns 400 on missing customerPhone", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/appointments",
      payload: validBody({ customerPhone: undefined }),
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 on missing scheduledAt", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/appointments",
      payload: validBody({ scheduledAt: undefined }),
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 on empty customerPhone", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/appointments",
      payload: validBody({ customerPhone: "" }),
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 on invalid conversationId format", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/appointments",
      payload: validBody({ conversationId: "bad" }),
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.details[0]).toContain("conversationId");
  });

  it("returns 400 on negative durationMinutes", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/appointments",
      payload: validBody({ durationMinutes: -30 }),
    });

    expect(res.statusCode).toBe(400);
  });

  it("accepts null conversationId", async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: TENANT_ID }])
      .mockResolvedValueOnce([dbRow({ conversation_id: null, xmax: "0" })]);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/appointments",
      payload: validBody({ conversationId: null }),
    });

    expect(res.statusCode).toBe(201);
  });

  it("accepts minimal valid payload", async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: TENANT_ID }])
      .mockResolvedValueOnce([
        dbRow({
          conversation_id: null,
          customer_name: null,
          service_type: null,
          notes: null,
          xmax: "0",
        }),
      ]);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/appointments",
      payload: {
        tenantId: TENANT_ID,
        customerPhone: PHONE,
        scheduledAt: "2026-03-16T10:00:00-05:00",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.appointment.customerName).toBeNull();
  });
});
