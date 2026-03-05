import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { tenantGuard } from '../../middleware/tenantGuard';
import { query, getPool } from '../../db/client';
import twilio from 'twilio';
import { google } from 'googleapis';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// Simple AES-256 encryption for tokens (use a proper KMS in production)
import crypto from 'crypto';

function encrypt(text: string): string {
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text: string): string {
  const [ivHex, encHex] = text.split(':');
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

export async function onboardingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', tenantGuard);

  // ── POST /api/onboarding/shop ─────────────────────────────
  app.post<{
    Body: {
      shop_name: string; phone: string; timezone: string;
      services?: string[]; business_hours?: Record<string, unknown>;
    }
  }>(
    '/shop',
    async (req: FastifyRequest<{
      Body: {
        shop_name: string; phone: string; timezone: string;
        services?: string[]; business_hours?: Record<string, unknown>;
      }
    }>, reply: FastifyReply) => {
      const { tenantId } = req;
      const { shop_name, phone, timezone, services, business_hours } = req.body;

      const validTimezones = ['America/Chicago', 'America/Denver'];
      if (!validTimezones.includes(timezone)) {
        return reply.code(400).send({ error: 'Invalid timezone' });
      }

      await query(
        `UPDATE tenants SET
           shop_name = $1, phone = $2, timezone = $3,
           onboarding_steps = onboarding_steps || $4::jsonb,
           updated_at = NOW()
         WHERE id = $5`,
        [
          shop_name, phone, timezone,
          JSON.stringify({
            shop_profile: true,
            services: services ?? [],
            business_hours: business_hours ?? {},
          }),
          tenantId,
        ]
      );

      // Create Stripe customer if doesn't exist
      const existing = await query<{ stripe_customer_id: string }>(
        'SELECT stripe_customer_id FROM subscriptions WHERE tenant_id = $1',
        [tenantId]
      );

      if (!existing.length) {
        const customer = await stripe.customers.create({
          name: shop_name,
          phone,
          metadata: { tenant_id: tenantId },
        });

        await query(
          `INSERT INTO subscriptions (tenant_id, stripe_customer_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [tenantId, customer.id]
        );
      }

      return { success: true };
    }
  );

  // ── POST /api/onboarding/provision-number ─────────────────
  app.post<{ Body: { area_code: string } }>(
    '/provision-number',
    async (req: FastifyRequest<{ Body: { area_code: string } }>, reply: FastifyReply) => {
      const { tenantId } = req;
      const { area_code } = req.body;

      // Check if already provisioned
      const existing = await query(
        'SELECT id FROM twilio_numbers WHERE tenant_id = $1 AND status = $2',
        [tenantId, 'active']
      );

      if (existing.length) {
        return reply.code(409).send({ error: 'Number already provisioned' });
      }

      try {
        // Search for available numbers
        const available = await twilioClient.availablePhoneNumbers('US')
          .local.list({ areaCode: parseInt(area_code), smsEnabled: true, voiceEnabled: true, limit: 3 });

        if (!available.length) {
          return reply.code(404).send({ error: 'No numbers available for this area code. Try a different area code.' });
        }

        // Purchase the first available number
        const purchased = await twilioClient.incomingPhoneNumbers.create({
          phoneNumber: available[0].phoneNumber,
          smsUrl: `${process.env.TWILIO_WEBHOOK_BASE_URL}/webhooks/twilio/sms`,
          smsMethod: 'POST',
          voiceUrl: `${process.env.TWILIO_WEBHOOK_BASE_URL}/webhooks/twilio/call`,
          voiceMethod: 'POST',
        });

        await query(
          `INSERT INTO twilio_numbers (tenant_id, phone_number, twilio_sid, area_code)
           VALUES ($1, $2, $3, $4)`,
          [tenantId, purchased.phoneNumber, purchased.sid, area_code]
        );

        await query(
          `UPDATE tenants SET
             onboarding_steps = onboarding_steps || '{"number_provisioned": true}'::jsonb,
             updated_at = NOW()
           WHERE id = $1`,
          [tenantId]
        );

        return {
          success: true,
          phone_number: purchased.phoneNumber,
          friendly_number: purchased.friendlyName,
        };
      } catch (err: unknown) {
        const error = err as { message?: string };
        app.log.error(err, 'Twilio number provision failed');
        return reply.code(500).send({
          error: 'Failed to provision number',
          detail: error.message,
        });
      }
    }
  );

  // ── GET /api/onboarding/forwarding-instructions ───────────
  app.get('/forwarding-instructions', async (req: FastifyRequest) => {
    const { tenantId } = req;

    const rows = await query<{ phone_number: string }>(
      `SELECT phone_number FROM twilio_numbers WHERE tenant_id = $1 AND status = 'active'`,
      [tenantId]
    );

    if (!rows.length) {
      return { error: 'No Twilio number provisioned yet' };
    }

    const number = rows[0].phone_number;
    const digits = number.replace('+1', '');

    return {
      your_sms_number: number,
      instructions: {
        att:      `Dial *72${digits} from your business phone, wait for confirmation tone.`,
        verizon:  `Dial *71${digits} from your business phone, wait for confirmation tone.`,
        tmobile:  `Dial **21*${digits}# from your business phone.`,
        generic:  `Contact your carrier to set up conditional call forwarding to ${number} for missed/busy/unanswered calls.`,
      },
      note: 'Set forwarding for: No Answer, Busy, and Unavailable. Do NOT forward all calls.',
    };
  });

  // ── POST /api/onboarding/test-sms ─────────────────────────
  app.post<{ Body: { to_phone: string } }>(
    '/test-sms',
    async (req: FastifyRequest<{ Body: { to_phone: string } }>, reply: FastifyReply) => {
      const { tenantId } = req;

      const [numRows, tenantRows] = await Promise.all([
        query<{ phone_number: string }>(
          `SELECT phone_number FROM twilio_numbers WHERE tenant_id = $1 AND status = 'active'`,
          [tenantId]
        ),
        query<{ shop_name: string }>(
          'SELECT shop_name FROM tenants WHERE id = $1',
          [tenantId]
        ),
      ]);

      if (!numRows.length) {
        return reply.code(400).send({ error: 'No Twilio number provisioned' });
      }

      const shopName = tenantRows[0]?.shop_name ?? 'Your Shop';

      try {
        await twilioClient.messages.create({
          from: numRows[0].phone_number,
          to: req.body.to_phone,
          body: `Test from ${shopName}: Your AutoShop SMS AI system is live! Reply STOP to opt out.`,
        });

        await query(
          `UPDATE tenants SET
             onboarding_steps = onboarding_steps || '{"forwarding_verified": true}'::jsonb,
             updated_at = NOW()
           WHERE id = $1`,
          [tenantId]
        );

        return { success: true };
      } catch (err) {
        app.log.error(err, 'Test SMS failed');
        return reply.code(500).send({ error: 'Failed to send test SMS' });
      }
    }
  );

  // ── GET /api/onboarding/google/oauth-url ──────────────────
  app.get('/google/oauth-url', async (req: FastifyRequest) => {
    const { tenantId } = req;
    const oauth2 = getOAuth2Client();

    const url = oauth2.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar.events'],
      state: tenantId,
      prompt: 'consent',
    });

    return { url };
  });

  // ── GET /api/onboarding/google/callback ───────────────────
  app.get<{ Querystring: { code: string; state: string } }>(
    '/google/callback',
    async (req: FastifyRequest<{ Querystring: { code: string; state: string } }>, reply: FastifyReply) => {
      const { code, state: tenantId } = req.query;

      if (!code || !tenantId) {
        return reply.code(400).send({ error: 'Missing code or state' });
      }

      const oauth2 = getOAuth2Client();

      try {
        const { tokens } = await oauth2.getToken(code);
        oauth2.setCredentials(tokens);

        // Get connected account info
        const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2 });
        const { data } = await oauth2Api.userinfo.get();

        await query(
          `INSERT INTO google_calendar_integrations
             (tenant_id, google_account, access_token, refresh_token, token_expiry)
           VALUES ($1, $2, $3, $4, to_timestamp($5))
           ON CONFLICT (tenant_id) DO UPDATE SET
             google_account = $2,
             access_token = $3,
             refresh_token = $4,
             token_expiry = to_timestamp($5),
             sync_status = 'connected',
             last_error = NULL,
             updated_at = NOW()`,
          [
            tenantId,
            data.email,
            encrypt(tokens.access_token!),
            encrypt(tokens.refresh_token!),
            tokens.expiry_date! / 1000,
          ]
        );

        await query(
          `UPDATE tenants SET
             onboarding_steps = onboarding_steps || '{"calendar_connected": true}'::jsonb,
             updated_at = NOW()
           WHERE id = $1`,
          [tenantId]
        );

        // Redirect to dashboard onboarding complete
        return reply.redirect(
          `${process.env.NEXT_PUBLIC_API_BASE_URL?.replace('3001', '3000')}/onboarding?step=4&calendar=connected`
        );
      } catch (err) {
        app.log.error(err, 'Google OAuth callback failed');
        return reply.redirect(
          `${process.env.NEXT_PUBLIC_API_BASE_URL?.replace('3001', '3000')}/onboarding?step=3&error=oauth_failed`
        );
      }
    }
  );

  // ── GET /api/onboarding/status ────────────────────────────
  app.get('/status', async (req: FastifyRequest) => {
    const { tenantId } = req;

    const rows = await query<{
      onboarding_steps: Record<string, boolean>;
    }>(
      'SELECT onboarding_steps FROM tenants WHERE id = $1',
      [tenantId]
    );

    const steps = rows[0]?.onboarding_steps ?? {};

    const [twilio, gcal] = await Promise.all([
      query('SELECT id FROM twilio_numbers WHERE tenant_id = $1 AND status = $2', [tenantId, 'active']),
      query('SELECT id FROM google_calendar_integrations WHERE tenant_id = $1 AND sync_status = $2', [tenantId, 'connected']),
    ]);

    return {
      shop_profile:       steps.shop_profile === true,
      number_provisioned: twilio.length > 0,
      calendar_connected: gcal.length > 0,
      forwarding_verified: steps.forwarding_verified === true,
    };
  });
}
