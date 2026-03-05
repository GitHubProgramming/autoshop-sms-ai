// ============================================================
// AutoShop SMS AI — Twilio Service
// Number provisioning, SMS sending, webhook URL management.
// ============================================================

import twilio, { Twilio } from 'twilio';
import { query } from '../db/client';

let client: Twilio;

function getClient(): Twilio {
  if (!client) {
    client = twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!
    );
  }
  return client;
}

const WEBHOOK_BASE = process.env.WEBHOOK_BASE_URL!; // e.g. https://api.autoshopsms.com

// ──────────────────────────────────────────────────────────
// Provision a dedicated Twilio number for a tenant
// ──────────────────────────────────────────────────────────
export async function provisionNumber(
  tenantId: string,
  areaCode: string
): Promise<{ phone_number: string; twilio_sid: string }> {
  const twilio = getClient();

  // Search for available local numbers
  const available = await twilio.availablePhoneNumbers('US').local.list({
    areaCode: parseInt(areaCode, 10),
    smsEnabled: true,
    voiceEnabled: true,
    limit: 3,
  });

  if (!available.length) {
    throw new Error(`No available numbers for area code ${areaCode}`);
  }

  // Purchase the first available number
  const purchased = await twilio.incomingPhoneNumbers.create({
    phoneNumber: available[0].phoneNumber,
    smsUrl: `${WEBHOOK_BASE}/webhooks/twilio/sms`,
    smsMethod: 'POST',
    voiceUrl: `${WEBHOOK_BASE}/webhooks/twilio/call`,
    voiceMethod: 'POST',
    statusCallback: `${WEBHOOK_BASE}/webhooks/twilio/status`,
    friendlyName: `AutoShop SMS AI - ${tenantId.slice(0, 8)}`,
  });

  // Store in DB
  await query(
    `INSERT INTO twilio_numbers (tenant_id, phone_number, twilio_sid, area_code)
     VALUES ($1, $2, $3, $4)`,
    [tenantId, purchased.phoneNumber, purchased.sid, areaCode]
  );

  // Update onboarding steps
  await query(
    `UPDATE tenants
     SET onboarding_steps = onboarding_steps || '{"number_provisioned": true}',
         updated_at = NOW()
     WHERE id = $1`,
    [tenantId]
  );

  return { phone_number: purchased.phoneNumber, twilio_sid: purchased.sid };
}

// ──────────────────────────────────────────────────────────
// Release a number on cancellation
// ──────────────────────────────────────────────────────────
export async function releaseNumber(tenantId: string): Promise<void> {
  const { rows } = await query<{ twilio_sid: string }>(
    `SELECT twilio_sid FROM twilio_numbers WHERE tenant_id = $1 AND status = 'active'`,
    [tenantId]
  );

  if (!rows[0]) return;

  const twilio = getClient();
  await twilio.incomingPhoneNumbers(rows[0].twilio_sid).remove();

  await query(
    `UPDATE twilio_numbers
     SET status = 'released', released_at = NOW()
     WHERE tenant_id = $1`,
    [tenantId]
  );
}

// ──────────────────────────────────────────────────────────
// Send SMS
// ──────────────────────────────────────────────────────────
export async function sendSms(
  from: string,
  to: string,
  body: string
): Promise<string> {
  const twilio = getClient();
  const msg = await twilio.messages.create({ from, to, body });
  return msg.sid;
}

// ──────────────────────────────────────────────────────────
// Lookup tenant by Twilio number (used in webhook routing)
// ──────────────────────────────────────────────────────────
export async function getTenantByNumber(
  phoneNumber: string
): Promise<{ tenant_id: string } | null> {
  const { rows } = await query<{ tenant_id: string }>(
    `SELECT tenant_id FROM twilio_numbers
     WHERE phone_number = $1 AND status = 'active'`,
    [phoneNumber]
  );
  return rows[0] || null;
}

// ──────────────────────────────────────────────────────────
// Get tenant's Twilio number
// ──────────────────────────────────────────────────────────
export async function getTenantNumber(
  tenantId: string
): Promise<{ phone_number: string } | null> {
  const { rows } = await query<{ phone_number: string }>(
    `SELECT phone_number FROM twilio_numbers
     WHERE tenant_id = $1 AND status = 'active'`,
    [tenantId]
  );
  return rows[0] || null;
}

// ──────────────────────────────────────────────────────────
// Forwarding instructions per carrier
// ──────────────────────────────────────────────────────────
export function getForwardingInstructions(twilioNumber: string): {
  number: string;
  carriers: { name: string; code: string; instructions: string }[];
} {
  const num = twilioNumber.replace(/\D/g, '').slice(-10);
  const formatted = `(${num.slice(0, 3)}) ${num.slice(3, 6)}-${num.slice(6)}`;

  return {
    number: twilioNumber,
    carriers: [
      {
        name: 'AT&T',
        code: `*72${twilioNumber}`,
        instructions: `Dial *72${twilioNumber} from your shop phone. Wait for confirmation tone.`,
      },
      {
        name: 'Verizon',
        code: `*71${twilioNumber}`,
        instructions: `Dial *71${twilioNumber} from your shop phone. Press # when prompted.`,
      },
      {
        name: 'T-Mobile',
        code: `**21*${twilioNumber}#`,
        instructions: `Dial **21*${twilioNumber}# from your shop phone. Wait for confirmation.`,
      },
      {
        name: 'Generic / Other',
        code: twilioNumber,
        instructions: `Contact your carrier and ask to set up "conditional call forwarding" (on no-answer) to ${formatted}.`,
      },
    ],
  };
}
