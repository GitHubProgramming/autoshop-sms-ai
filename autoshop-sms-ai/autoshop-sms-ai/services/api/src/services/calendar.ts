// ============================================================
// AutoShop SMS AI — Google Calendar Service
// Per-tenant OAuth 2.0 tokens stored encrypted at rest.
// Detects 401/revocation and updates sync_status = 'failed'.
// ============================================================

import { google, calendar_v3 } from 'googleapis';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { query } from '../db/client';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY!; // 32-byte hex string
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

// ──────────────────────────────────────────────────────────
// Encryption helpers
// ──────────────────────────────────────────────────────────
function encrypt(text: string): string {
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text: string): string {
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const [ivHex, encryptedHex] = text.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString();
}

// ──────────────────────────────────────────────────────────
// OAuth URL generation
// ──────────────────────────────────────────────────────────
export function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    process.env.GOOGLE_REDIRECT_URI! // e.g. https://api.autoshopsms.com/api/onboarding/google/callback
  );
}

export function generateAuthUrl(tenantId: string): string {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    state: tenantId, // passed back in callback for tenant lookup
  });
}

// ──────────────────────────────────────────────────────────
// Exchange code for tokens and store
// ──────────────────────────────────────────────────────────
export async function exchangeCodeAndStore(
  tenantId: string,
  code: string
): Promise<string> {
  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Missing tokens from Google OAuth');
  }

  // Get Google account email
  oauth2Client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const { data: userInfo } = await oauth2.userinfo.get();

  const expiry = tokens.expiry_date
    ? new Date(tokens.expiry_date)
    : new Date(Date.now() + 3600 * 1000);

  await query(
    `INSERT INTO google_calendar_integrations
       (tenant_id, google_account, access_token_enc, refresh_token_enc, token_expiry, sync_status)
     VALUES ($1, $2, $3, $4, $5, 'connected')
     ON CONFLICT (tenant_id) DO UPDATE SET
       google_account = EXCLUDED.google_account,
       access_token_enc = EXCLUDED.access_token_enc,
       refresh_token_enc = EXCLUDED.refresh_token_enc,
       token_expiry = EXCLUDED.token_expiry,
       sync_status = 'connected',
       last_error = NULL,
       updated_at = NOW()`,
    [
      tenantId,
      userInfo.email || 'unknown',
      encrypt(tokens.access_token),
      encrypt(tokens.refresh_token!),
      expiry,
    ]
  );

  // Update onboarding steps
  await query(
    `UPDATE tenants
     SET onboarding_steps = onboarding_steps || '{"calendar_connected": true}',
         updated_at = NOW()
     WHERE id = $1`,
    [tenantId]
  );

  return userInfo.email || 'unknown';
}

// ──────────────────────────────────────────────────────────
// Get auth client for a tenant (refreshes token if needed)
// ──────────────────────────────────────────────────────────
async function getTenantOAuthClient(tenantId: string) {
  const { rows } = await query<{
    access_token_enc: string;
    refresh_token_enc: string;
    token_expiry: Date;
    calendar_id: string;
  }>(
    `SELECT access_token_enc, refresh_token_enc, token_expiry, calendar_id
     FROM google_calendar_integrations
     WHERE tenant_id = $1 AND sync_status = 'connected'`,
    [tenantId]
  );

  if (!rows[0]) throw new Error('no_calendar_integration');

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: decrypt(rows[0].access_token_enc),
    refresh_token: decrypt(rows[0].refresh_token_enc),
    expiry_date: rows[0].token_expiry.getTime(),
  });

  // Auto-refresh if token expires within 5 minutes
  if (rows[0].token_expiry.getTime() < Date.now() + 5 * 60 * 1000) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    const newExpiry = credentials.expiry_date
      ? new Date(credentials.expiry_date)
      : new Date(Date.now() + 3600 * 1000);

    await query(
      `UPDATE google_calendar_integrations
       SET access_token_enc = $2, token_expiry = $3, updated_at = NOW()
       WHERE tenant_id = $1`,
      [tenantId, encrypt(credentials.access_token!), newExpiry]
    );

    oauth2Client.setCredentials(credentials);
  }

  return { oauth2Client, calendar_id: rows[0].calendar_id };
}

// ──────────────────────────────────────────────────────────
// Create calendar event
// ──────────────────────────────────────────────────────────
export async function createCalendarEvent(
  tenantId: string,
  appointmentId: string,
  details: {
    customer_name: string | null;
    service_type: string | null;
    scheduled_at: Date;
    duration_mins: number;
    customer_phone: string;
    notes: string | null;
    shop_name: string;
    shop_timezone: string;
  }
): Promise<void> {
  try {
    const { oauth2Client, calendar_id } = await getTenantOAuthClient(tenantId);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const endTime = new Date(
      details.scheduled_at.getTime() + details.duration_mins * 60 * 1000
    );

    const event: calendar_v3.Schema$Event = {
      summary: `${details.service_type || 'Auto Repair'} - ${details.customer_name || details.customer_phone}`,
      description: [
        `Customer: ${details.customer_name || 'Unknown'}`,
        `Phone: ${details.customer_phone}`,
        details.service_type ? `Service: ${details.service_type}` : null,
        details.notes ? `Notes: ${details.notes}` : null,
        `\nBooked via AutoShop SMS AI`,
      ]
        .filter(Boolean)
        .join('\n'),
      start: {
        dateTime: details.scheduled_at.toISOString(),
        timeZone: details.shop_timezone,
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: details.shop_timezone,
      },
    };

    const created = await calendar.events.insert({
      calendarId: calendar_id,
      requestBody: event,
    });

    // Update appointment with event ID
    await query(
      `UPDATE appointments
       SET google_event_id = $2, sync_status = 'synced',
           last_sync_at = NOW(), sync_error = NULL
       WHERE id = $1`,
      [appointmentId, created.data.id]
    );

    await query(
      `UPDATE google_calendar_integrations
       SET sync_status = 'connected', last_error = NULL, updated_at = NOW()
       WHERE tenant_id = $1`,
      [tenantId]
    );
  } catch (err: any) {
    const isRevoked =
      err.message === 'no_calendar_integration' ||
      err?.response?.status === 401 ||
      err?.code === 401;

    if (isRevoked) {
      // Mark integration as failed — surface in dashboard
      await query(
        `UPDATE google_calendar_integrations
         SET sync_status = 'failed', last_error = $2, updated_at = NOW()
         WHERE tenant_id = $1`,
        [tenantId, err.message || 'Token revoked or expired']
      );
    }

    await query(
      `UPDATE appointments
       SET sync_status = 'failed', sync_error = $2,
           sync_attempts = sync_attempts + 1, last_sync_at = NOW()
       WHERE id = $1`,
      [appointmentId, err.message || 'Unknown error']
    );

    throw err;
  }
}
