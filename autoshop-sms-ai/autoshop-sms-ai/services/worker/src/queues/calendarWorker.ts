import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { Pool } from 'pg';
import { google } from 'googleapis';
import { QUEUE_NAMES } from '@autoshop/shared';
import crypto from 'crypto';

function decrypt(text: string): string {
  const [ivHex, encHex] = text.split(':');
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

async function syncToCalendar(pool: Pool, tenantId: string, appointmentId: string) {
  const client = await pool.connect();
  try {
    // Get appointment details
    const apptRes = await client.query<{
      customer_name: string | null; service_type: string | null;
      scheduled_at: Date; duration_mins: number; customer_phone: string;
    }>(
      'SELECT customer_name, service_type, scheduled_at, duration_mins, customer_phone FROM appointments WHERE id = $1 AND tenant_id = $2',
      [appointmentId, tenantId]
    );

    if (!apptRes.rows.length) throw new Error('Appointment not found');
    const appt = apptRes.rows[0];

    // Get calendar integration
    const calRes = await client.query<{
      access_token: string; refresh_token: string;
      token_expiry: Date; calendar_id: string; google_account: string;
    }>(
      `SELECT access_token, refresh_token, token_expiry, calendar_id, google_account
       FROM google_calendar_integrations
       WHERE tenant_id = $1 AND sync_status = 'connected'`,
      [tenantId]
    );

    if (!calRes.rows.length) {
      await client.query(
        `UPDATE appointments SET sync_status = 'not_connected' WHERE id = $1`,
        [appointmentId]
      );
      return;
    }

    const cal = calRes.rows[0];
    const accessToken = decrypt(cal.access_token);
    const refreshToken = decrypt(cal.refresh_token);

    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
      expiry_date: cal.token_expiry.getTime(),
    });

    // Auto-refresh token if needed
    oauth2.on('tokens', async (tokens) => {
      if (tokens.access_token) {
        const newEncrypted = encrypt(tokens.access_token);
        await client.query(
          `UPDATE google_calendar_integrations
           SET access_token = $1, token_expiry = to_timestamp($2), updated_at = NOW()
           WHERE tenant_id = $3`,
          [newEncrypted, (tokens.expiry_date ?? Date.now()) / 1000, tenantId]
        );
      }
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2 });

    const startTime = new Date(appt.scheduled_at);
    const endTime = new Date(startTime.getTime() + appt.duration_mins * 60000);

    const event = await calendar.events.insert({
      calendarId: cal.calendar_id,
      requestBody: {
        summary: `${appt.service_type ?? 'Auto Repair'} — ${appt.customer_name ?? appt.customer_phone}`,
        description: `Customer: ${appt.customer_name ?? 'Unknown'}\nPhone: ${appt.customer_phone}\nService: ${appt.service_type ?? 'TBD'}\n\nBooked via AutoShop SMS AI`,
        start: { dateTime: startTime.toISOString() },
        end:   { dateTime: endTime.toISOString() },
      },
    });

    await client.query(
      `UPDATE appointments SET
         sync_status = 'synced',
         google_event_id = $1,
         sync_error = NULL
       WHERE id = $2`,
      [event.data.id, appointmentId]
    );

    await client.query(
      `UPDATE google_calendar_integrations SET sync_status = 'connected', last_error = NULL, updated_at = NOW()
       WHERE tenant_id = $1`,
      [tenantId]
    );

  } catch (err: unknown) {
    const error = err as { code?: number; message?: string };
    const errorMsg = error.message ?? 'Unknown error';

    await client.query(
      `UPDATE appointments SET sync_status = 'failed', sync_error = $1 WHERE id = $2`,
      [errorMsg, appointmentId]
    );

    // If 401, mark integration as failed so dashboard shows warning
    if (error.code === 401 || errorMsg.includes('invalid_grant')) {
      await client.query(
        `UPDATE google_calendar_integrations
         SET sync_status = 'failed', last_error = $1, updated_at = NOW()
         WHERE tenant_id = $2`,
        ['Token expired or revoked. Please reconnect Google Calendar in Settings.', tenantId]
      );
    }

    throw err; // Let BullMQ retry
  } finally {
    client.release();
  }
}

export function startCalendarWorker(redis: IORedis, pool: Pool) {
  const worker = new Worker(
    QUEUE_NAMES.CALENDAR_SYNC,
    async (job: Job) => {
      const { tenant_id, appointment_id } = job.data;
      await syncToCalendar(pool, tenant_id, appointment_id);
    },
    {
      connection: redis,
      concurrency: 5,
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[Calendar Worker] Job ${job?.id} failed:`, err.message);
  });

  console.log('[Calendar Worker] Started on queue:', QUEUE_NAMES.CALENDAR_SYNC);
  return worker;
}
