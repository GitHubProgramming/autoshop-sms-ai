/**
 * Google Calendar Event Creation Service
 *
 * Creates events on a tenant's Google Calendar using stored OAuth tokens.
 * Handles token retrieval, event creation, and appointment status updates.
 *
 * Called by: POST /internal/calendar-event (n8n WF-004 or API-side booking flow)
 */

import { query } from "../db/client";
import { decryptToken } from "../routes/auth/google";

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export interface CalendarEventInput {
  tenantId: string;
  appointmentId: string;
  customerPhone: string;
  customerName?: string | null;
  serviceType: string;
  scheduledAt: string; // ISO 8601
  durationMinutes?: number;
  timeZone?: string;
}

export interface CalendarEventResult {
  success: boolean;
  googleEventId: string | null;
  error: string | null;
  calendarSynced: boolean;
}

/**
 * Fetches decrypted Google Calendar tokens for a tenant from the database.
 * Does NOT refresh tokens — callers should use the /internal/calendar-tokens
 * endpoint if they need auto-refresh (n8n does this). This service fetches
 * directly to avoid circular HTTP calls.
 */
export async function getCalendarTokens(
  tenantId: string
): Promise<{ accessToken: string; calendarId: string } | null> {
  const rows = await query<{
    access_token: string;
    calendar_id: string;
  }>(
    `SELECT access_token, calendar_id
     FROM tenant_calendar_tokens
     WHERE tenant_id = $1`,
    [tenantId]
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  const accessToken = decryptToken(row.access_token);
  return { accessToken, calendarId: row.calendar_id };
}

/**
 * Builds the Google Calendar event body from appointment data.
 */
export function buildEventBody(input: CalendarEventInput) {
  const duration = input.durationMinutes ?? 60;
  const tz = input.timeZone ?? "America/Chicago"; // Texas default
  const startDate = new Date(input.scheduledAt);
  const endDate = new Date(startDate.getTime() + duration * 60 * 1000);

  const namePart = input.customerName
    ? ` — ${input.customerName}`
    : "";

  return {
    summary: `${input.serviceType}${namePart} — ${input.customerPhone}`,
    description: `AutoShop AI booking.\nService: ${input.serviceType}\nPhone: ${input.customerPhone}${input.customerName ? `\nName: ${input.customerName}` : ""}`,
    start: {
      dateTime: startDate.toISOString(),
      timeZone: tz,
    },
    end: {
      dateTime: endDate.toISOString(),
      timeZone: tz,
    },
  };
}

/**
 * Creates a Google Calendar event and updates the appointment record.
 *
 * Flow:
 * 0. Check if appointment already has a google_event_id (idempotency)
 * 1. Fetch calendar tokens for tenant
 * 2. Build event body
 * 3. POST to Google Calendar API
 * 4. Update appointment with google_event_id + calendar_synced
 *
 * Returns a structured result (never throws).
 */
export async function createCalendarEvent(
  input: CalendarEventInput,
  fetchFn: typeof fetch = fetch
): Promise<CalendarEventResult> {
  // 0. Idempotency — skip if appointment already synced
  try {
    const existing = await query<{ google_event_id: string }>(
      `SELECT google_event_id FROM appointments
       WHERE id = $1 AND tenant_id = $2 AND google_event_id IS NOT NULL`,
      [input.appointmentId, input.tenantId]
    );
    if (existing.length > 0) {
      return {
        success: true,
        googleEventId: existing[0].google_event_id,
        error: null,
        calendarSynced: true,
      };
    }
  } catch {
    // If idempotency check fails, proceed anyway — worst case is a duplicate
    // which is better than blocking event creation entirely
  }

  // 1. Get tokens
  let tokens: { accessToken: string; calendarId: string } | null;
  try {
    tokens = await getCalendarTokens(input.tenantId);
  } catch (err) {
    const errorMsg = `Token retrieval failed: ${(err as Error).message}`;

    // Persist sync failure on the appointment
    await query(
      `UPDATE appointments
       SET sync_status = 'failed', sync_error = $1, sync_attempted_at = NOW()
       WHERE id = $2 AND tenant_id = $3`,
      [errorMsg, input.appointmentId, input.tenantId]
    ).catch(() => {}); // best-effort

    return {
      success: false,
      googleEventId: null,
      error: errorMsg,
      calendarSynced: false,
    };
  }

  if (!tokens) {
    // Persist sync failure on the appointment
    await query(
      `UPDATE appointments
       SET sync_status = 'failed', sync_error = 'No calendar tokens found for tenant',
           sync_attempted_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [input.appointmentId, input.tenantId]
    ).catch(() => {}); // best-effort

    return {
      success: false,
      googleEventId: null,
      error: "No calendar tokens found for tenant",
      calendarSynced: false,
    };
  }

  // 2. Build event
  const eventBody = buildEventBody(input);

  // 3. Create event via Google Calendar API
  let googleEventId: string | null = null;
  try {
    const url = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(tokens.calendarId)}/events`;
    const res = await fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventBody),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const errorMsg = `Google Calendar API error ${res.status}: ${body}`.slice(0, 500);

      // Persist sync failure on the appointment
      await query(
        `UPDATE appointments
         SET sync_status = 'failed', sync_error = $1, sync_attempted_at = NOW()
         WHERE id = $2 AND tenant_id = $3`,
        [errorMsg, input.appointmentId, input.tenantId]
      ).catch(() => {}); // best-effort

      return {
        success: false,
        googleEventId: null,
        error: errorMsg,
        calendarSynced: false,
      };
    }

    const data = (await res.json()) as { id: string };
    googleEventId = data.id;
  } catch (err) {
    const errorMsg = `Google Calendar API request failed: ${(err as Error).message}`;

    // Persist sync failure on the appointment
    await query(
      `UPDATE appointments
       SET sync_status = 'failed', sync_error = $1, sync_attempted_at = NOW()
       WHERE id = $2 AND tenant_id = $3`,
      [errorMsg, input.appointmentId, input.tenantId]
    ).catch(() => {}); // best-effort

    return {
      success: false,
      googleEventId: null,
      error: errorMsg,
      calendarSynced: false,
    };
  }

  // 4. Update appointment in DB
  try {
    await query(
      `UPDATE appointments
       SET google_event_id = $1, calendar_synced = TRUE,
           sync_status = 'synced', sync_error = NULL, sync_attempted_at = NOW()
       WHERE id = $2 AND tenant_id = $3`,
      [googleEventId, input.appointmentId, input.tenantId]
    );
  } catch (err) {
    // Event was created but DB update failed — return partial success
    return {
      success: true,
      googleEventId,
      error: `Event created but DB update failed: ${(err as Error).message}`,
      calendarSynced: false,
    };
  }

  return {
    success: true,
    googleEventId,
    error: null,
    calendarSynced: true,
  };
}
