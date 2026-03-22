import { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../../db/client";
import { decryptToken } from "../auth/google";
import { createCalendarEvent } from "../../services/google-calendar";
import { randomUUID } from "crypto";
import { requireInternal } from "../../middleware/require-internal";

const ParamsSchema = z.object({
  tenantId: z.string().uuid(),
});

/**
 * POST /internal/appointment-sync-proof/:tenantId
 *
 * Diagnostic endpoint: exercises the FULL appointment → calendar sync path
 * through createCalendarEvent() and captures before/after state for both
 * tokens and the appointment row.
 *
 * This proves the complete production flow:
 *   appointment created → createCalendarEvent() → Google Calendar event →
 *   appointment row updated (google_event_id + calendar_synced)
 *
 * Internal only — NOT exposed externally.
 */
export async function appointmentSyncProofRoute(app: FastifyInstance) {
  app.post("/appointment-sync-proof/:tenantId", { preHandler: [requireInternal] }, async (request, reply) => {
    const parsed = ParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid tenantId" });
    }

    const { tenantId } = parsed.data;

    // 1. BEFORE token state
    const tokensBefore = await query<{
      access_token: string;
      token_expiry: string;
      last_refreshed: string | null;
      calendar_id: string;
    }>(
      `SELECT access_token, token_expiry, last_refreshed, calendar_id
       FROM tenant_calendar_tokens WHERE tenant_id = $1`,
      [tenantId]
    );

    if (tokensBefore.length === 0) {
      return reply.status(404).send({ error: "No calendar tokens for tenant" });
    }

    const beforeTokenRow = tokensBefore[0];
    const beforeAccessToken = decryptToken(beforeTokenRow.access_token);
    const beforeTokenState = {
      access_token_prefix: beforeAccessToken.substring(0, 30),
      access_token_length: beforeAccessToken.length,
      token_expiry: beforeTokenRow.token_expiry,
      last_refreshed: beforeTokenRow.last_refreshed,
      calendar_id: beforeTokenRow.calendar_id,
    };

    // 2. Insert a test appointment row
    const appointmentId = randomUUID();
    const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // tomorrow
    const customerPhone = "+15550000000";
    const serviceType = "Diagnostic Verification Test";

    await query(
      `INSERT INTO appointments (id, tenant_id, customer_phone, customer_name, service_type, scheduled_at, duration_minutes, booking_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [appointmentId, tenantId, customerPhone, "Sync Proof Test", serviceType, scheduledAt, 30, "PENDING_MANUAL_CONFIRMATION"]
    );

    // 2b. Read the appointment BEFORE sync
    const apptBefore = await query<{
      id: string;
      google_event_id: string | null;
      calendar_synced: boolean;
      booking_state: string;
    }>(
      `SELECT id, google_event_id, calendar_synced, booking_state FROM appointments WHERE id = $1`,
      [appointmentId]
    );

    const beforeAppointment = apptBefore[0];

    // 3. Call createCalendarEvent() — the REAL production path
    const calendarInput = {
      tenantId,
      appointmentId,
      customerPhone,
      customerName: "Sync Proof Test",
      serviceType,
      scheduledAt,
      durationMinutes: 30,
      timeZone: "America/Chicago",
    };

    const calendarResult = await createCalendarEvent(calendarInput);

    // 4. AFTER token state
    const tokensAfter = await query<{
      access_token: string;
      token_expiry: string;
      last_refreshed: string | null;
    }>(
      `SELECT access_token, token_expiry, last_refreshed
       FROM tenant_calendar_tokens WHERE tenant_id = $1`,
      [tenantId]
    );

    const afterTokenRow = tokensAfter[0];
    const afterAccessToken = decryptToken(afterTokenRow.access_token);
    const afterTokenState = {
      access_token_prefix: afterAccessToken.substring(0, 30),
      access_token_length: afterAccessToken.length,
      token_expiry: afterTokenRow.token_expiry,
      last_refreshed: afterTokenRow.last_refreshed,
    };

    // 5. AFTER appointment state
    const apptAfter = await query<{
      id: string;
      google_event_id: string | null;
      calendar_synced: boolean;
      booking_state: string;
    }>(
      `SELECT id, google_event_id, calendar_synced, booking_state FROM appointments WHERE id = $1`,
      [appointmentId]
    );

    const afterAppointment = apptAfter[0];

    // 6. Build proof summary
    const proof = {
      token_refreshed_or_valid: beforeAccessToken !== afterAccessToken
        ? "token_was_refreshed"
        : "existing_token_was_valid",
      google_event_created: calendarResult.googleEventId !== null,
      appointment_row_updated: afterAppointment.google_event_id !== null,
      sync_status: afterAppointment.calendar_synced ? "synced" : "not_synced",
      google_event_id_written: afterAppointment.google_event_id,
    };

    request.log.info(
      { tenantId, appointmentId, proof },
      "Appointment sync proof completed"
    );

    const status = calendarResult.success ? 200 : 502;
    return reply.status(status).send({
      tenantId,
      appointmentId,
      timestamp: new Date().toISOString(),
      before: {
        token: beforeTokenState,
        appointment: beforeAppointment,
      },
      calendarResult,
      after: {
        token: afterTokenState,
        appointment: afterAppointment,
      },
      proof,
    });
  });
}
