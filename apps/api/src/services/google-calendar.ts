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
import { isTokenExpired, refreshAccessToken } from "./google-token-refresh";

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export interface CalendarEventInput {
  tenantId: string;
  appointmentId: string;
  customerPhone: string;
  customerName?: string | null;
  serviceType: string;
  carModel?: string | null;
  licensePlate?: string | null;
  issueDescription?: string | null;
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
 * Auto-refreshes the access token if it is expired or will expire within
 * 5 minutes, using the stored refresh_token.
 */
export async function getCalendarTokens(
  tenantId: string
): Promise<{ accessToken: string; calendarId: string } | null> {
  const rows = await query<{
    access_token: string;
    refresh_token: string;
    token_expiry: string;
    calendar_id: string;
  }>(
    `SELECT access_token, refresh_token, token_expiry, calendar_id
     FROM tenant_calendar_tokens
     WHERE tenant_id = $1`,
    [tenantId]
  );

  if (rows.length === 0) return null;

  const row = rows[0];

  // Auto-refresh if token is expired or about to expire
  if (row.token_expiry && isTokenExpired(row.token_expiry)) {
    const refreshed = await refreshAccessToken(tenantId, row.refresh_token);
    if (refreshed) {
      return { accessToken: refreshed.accessToken, calendarId: row.calendar_id };
    }
    // Refresh failed — fall through to return the stale token.
    // The caller will get a 401 from Google and can surface the error.
  }

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

  const descParts = [`AutoShop AI booking.`, `Service: ${input.serviceType}`, `Phone: ${input.customerPhone}`];
  if (input.customerName) descParts.push(`Name: ${input.customerName}`);
  if (input.carModel) descParts.push(`Vehicle: ${input.carModel}`);
  if (input.licensePlate) descParts.push(`Plate: ${input.licensePlate}`);
  if (input.issueDescription) descParts.push(`Issue: ${input.issueDescription}`);

  return {
    summary: `${input.serviceType}${namePart} — ${input.customerPhone}`,
    description: descParts.join("\n"),
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
 * Force-refreshes the access token for a tenant, bypassing expiry check.
 * Used as a fallback when Google returns 401 despite the token appearing valid.
 * Returns the new plaintext access token, or null if refresh failed.
 */
async function forceRefreshToken(tenantId: string): Promise<string | null> {
  const rows = await query<{ refresh_token: string }>(
    `SELECT refresh_token FROM tenant_calendar_tokens WHERE tenant_id = $1`,
    [tenantId]
  );
  if (rows.length === 0) return null;

  const refreshed = await refreshAccessToken(tenantId, rows[0].refresh_token);
  return refreshed ? refreshed.accessToken : null;
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

  // 1. Get tokens (mutable — may be refreshed on 401 retry)
  let tokens: { accessToken: string; calendarId: string } | null;
  try {
    tokens = await getCalendarTokens(input.tenantId);
  } catch (err) {
    return {
      success: false,
      googleEventId: null,
      error: `Token retrieval failed: ${(err as Error).message}`,
      calendarSynced: false,
    };
  }

  if (!tokens) {
    return {
      success: false,
      googleEventId: null,
      error: "No calendar tokens found for tenant",
      calendarSynced: false,
    };
  }

  // 2. Build event
  const eventBody = buildEventBody(input);

  // 3. Create event via Google Calendar API (with 401 retry after token refresh)
  let googleEventId: string | null = null;
  try {
    const url = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(tokens.calendarId)}/events`;
    let res = await fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventBody),
      signal: AbortSignal.timeout(10_000),
    });

    // 401 → token may have expired mid-flight; force-refresh and retry once
    if (res.status === 401) {
      const refreshed = await forceRefreshToken(input.tenantId);
      if (refreshed) {
        tokens = { accessToken: refreshed, calendarId: tokens.calendarId };
        res = await fetchFn(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(eventBody),
          signal: AbortSignal.timeout(10_000),
        });
      }
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // If still getting 401 after retry, the refresh_token is likely revoked
      if (res.status === 401) {
        try {
          await query(
            `UPDATE tenant_calendar_tokens
             SET integration_status = 'refresh_failed',
                 last_error = 'Google Calendar API returned 401 after token refresh retry',
                 updated_at = NOW()
             WHERE tenant_id = $1`,
            [input.tenantId]
          );
        } catch {
          // Best-effort
        }
      }
      return {
        success: false,
        googleEventId: null,
        error: `Google Calendar API error ${res.status}: ${body}`,
        calendarSynced: false,
      };
    }

    const data = (await res.json()) as { id: string };
    googleEventId = data.id;
  } catch (err) {
    return {
      success: false,
      googleEventId: null,
      error: `Google Calendar API request failed: ${(err as Error).message}`,
      calendarSynced: false,
    };
  }

  // 4. Update appointment in DB
  try {
    await query(
      `UPDATE appointments
       SET google_event_id = $1, calendar_synced = TRUE
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

// ── Calendar Event Deletion (for cancellation) ────────────────────────────

export interface DeleteCalendarEventResult {
  success: boolean;
  error: string | null;
}

/**
 * Deletes a Google Calendar event for a cancelled appointment.
 *
 * Flow:
 * 1. Fetch calendar tokens for tenant
 * 2. DELETE the event via Google Calendar API
 * 3. Clear google_event_id + calendar_synced on the appointment
 *
 * Returns a structured result (never throws).
 */
export async function deleteCalendarEvent(
  tenantId: string,
  appointmentId: string,
  googleEventId: string,
  fetchFn: typeof fetch = fetch
): Promise<DeleteCalendarEventResult> {
  // 1. Get tokens
  let tokens: { accessToken: string; calendarId: string } | null;
  try {
    tokens = await getCalendarTokens(tenantId);
  } catch (err) {
    return {
      success: false,
      error: `Token retrieval failed: ${(err as Error).message}`,
    };
  }

  if (!tokens) {
    return {
      success: false,
      error: "No calendar tokens found for tenant",
    };
  }

  // 2. DELETE event via Google Calendar API (with 401 retry)
  try {
    const url = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(tokens.calendarId)}/events/${encodeURIComponent(googleEventId)}`;
    let res = await fetchFn(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      signal: AbortSignal.timeout(10_000),
    });

    // 401 → token may have expired; force-refresh and retry once
    if (res.status === 401) {
      const refreshed = await forceRefreshToken(tenantId);
      if (refreshed) {
        res = await fetchFn(url, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${refreshed}`,
          },
          signal: AbortSignal.timeout(10_000),
        });
      }
    }

    // 204 = deleted, 410 = already deleted (gone) — both are success
    if (res.status !== 204 && res.status !== 410 && !res.ok) {
      const body = await res.text().catch(() => "");
      return {
        success: false,
        error: `Google Calendar API error ${res.status}: ${body}`,
      };
    }
  } catch (err) {
    return {
      success: false,
      error: `Google Calendar API request failed: ${(err as Error).message}`,
    };
  }

  // 3. Clear google_event_id on appointment (event is gone from calendar)
  try {
    await query(
      `UPDATE appointments
       SET google_event_id = NULL, calendar_synced = FALSE
       WHERE id = $1 AND tenant_id = $2`,
      [appointmentId, tenantId]
    );
  } catch {
    // Event was deleted but DB update failed — still a success
    // The event is gone from Google Calendar which is what matters
  }

  return { success: true, error: null };
}
