// ============================================================
// AutoShop SMS AI — Calendar Sync Job Handler
// Syncs appointments to Google Calendar.
// Handles token expiry, sets sync_status = 'failed' on error.
// ============================================================

import { Job } from 'bullmq';
import { Pool } from 'pg';
import { google } from 'googleapis';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { CalendarSyncJobPayload } from '@autoshop/shared';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY!;
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

function decrypt(text: string): string {
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const [ivHex, encryptedHex] = text.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString();
}

function encrypt(text: string): string {
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export async function handleCalendarSync(
  job: Job<CalendarSyncJobPayload>,
  pool: Pool
): Promise<void> {
  const { tenant_id, appointment_id } = job.data;

  // Load appointment
  const { rows: apptRows } = await pool.query(
    `SELECT a.*, t.shop_name, t.timezone
     FROM appointments a
     JOIN tenants t ON t.id = a.tenant_id
     WHERE a.id = $1 AND a.tenant_id = $2`,
    [appointment_id, tenant_id]
  );

  const appt = apptRows[0];
  if (!appt) {
    console.warn(`[CALENDAR] Appointment ${appointment_id} not found`);
    return;
  }

  // Load calendar integration
  const { rows: calRows } = await pool.query(
    `SELECT access_token_enc, refresh_token_enc, token_expiry, calendar_id
     FROM google_calendar_integrations
     WHERE tenant_id = $1 AND sync_status = 'connected'`,
    [tenant_id]
  );

  if (!calRows[0]) {
    // No calendar connected — mark as not_connected
    await pool.query(
      `UPDATE appointments SET sync_status = 'not_connected' WHERE id = $1`,
      [appointment_id]
    );
    return;
  }

  const cal = calRows[0];

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      access_token: decrypt(cal.access_token_enc),
      refresh_token: decrypt(cal.refresh_token_enc),
      expiry_date: new Date(cal.token_expiry).getTime(),
    });

    // Auto-refresh if needed
    if (new Date(cal.token_expiry).getTime() < Date.now() + 5 * 60 * 1000) {
      const { credentials } = await oauth2Client.refreshAccessToken();
      const newExpiry = credentials.expiry_date
        ? new Date(credentials.expiry_date)
        : new Date(Date.now() + 3600 * 1000);

      await pool.query(
        `UPDATE google_calendar_integrations
         SET access_token_enc = $2, token_expiry = $3, updated_at = NOW()
         WHERE tenant_id = $1`,
        [tenant_id, encrypt(credentials.access_token!), newExpiry]
      );

      oauth2Client.setCredentials(credentials);
    }

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const endTime = new Date(
      new Date(appt.scheduled_at).getTime() + appt.duration_mins * 60 * 1000
    );

    const event = await calendar.events.insert({
      calendarId: cal.calendar_id || 'primary',
      requestBody: {
        summary: `${appt.service_type || 'Auto Repair'} - ${appt.customer_name || appt.customer_phone}`,
        description: [
          `Customer: ${appt.customer_name || 'Unknown'}`,
          `Phone: ${appt.customer_phone}`,
          appt.service_type ? `Service: ${appt.service_type}` : null,
          appt.notes ? `Notes: ${appt.notes}` : null,
          '\nBooked via AutoShop SMS AI',
        ]
          .filter(Boolean)
          .join('\n'),
        start: { dateTime: appt.scheduled_at.toISOString(), timeZone: appt.timezone },
        end: { dateTime: endTime.toISOString(), timeZone: appt.timezone },
      },
    });

    // Update appointment
    await pool.query(
      `UPDATE appointments
       SET google_event_id = $2, sync_status = 'synced',
           last_sync_at = NOW(), sync_error = NULL, sync_attempts = sync_attempts + 1
       WHERE id = $1`,
      [appointment_id, event.data.id]
    );

    // Clear any previous calendar errors
    await pool.query(
      `UPDATE google_calendar_integrations
       SET sync_status = 'connected', last_error = NULL, updated_at = NOW()
       WHERE tenant_id = $1`,
      [tenant_id]
    );

    console.log(`[CALENDAR] Synced appointment ${appointment_id} → event ${event.data.id}`);
  } catch (err: any) {
    const isRevoked = err?.response?.status === 401 || err?.code === 401;

    if (isRevoked) {
      await pool.query(
        `UPDATE google_calendar_integrations
         SET sync_status = 'failed', last_error = $2, updated_at = NOW()
         WHERE tenant_id = $1`,
        [tenant_id, 'Token revoked — please reconnect Google Calendar in Settings']
      );
    }

    await pool.query(
      `UPDATE appointments
       SET sync_status = 'failed', sync_error = $2,
           sync_attempts = sync_attempts + 1, last_sync_at = NOW()
       WHERE id = $1`,
      [appointment_id, err.message || 'Unknown error']
    );

    throw err; // BullMQ will retry
  }
}
