/**
 * Missed Call SMS Service
 *
 * Handles the entry point of the core pipeline:
 *   missed call → initial outbound SMS → customer can reply → AI conversation begins
 *
 * When a call goes unanswered, this service:
 * 1. Validates the tenant and checks billing status
 * 2. Gets or creates a conversation for the customer
 * 3. Logs a synthetic "missed call" inbound event
 * 4. Sends the initial outbound SMS via Twilio
 * 5. Logs the outbound message
 *
 * Called by: the sms-inbound worker for "missed-call-trigger" jobs
 */

import { query } from "../db/client";
import { getConfig } from "../db/app-config";
import { getTenantAiPolicy } from "./ai-settings";

export interface MissedCallInput {
  tenantId: string;
  customerPhone: string;
  ourPhone: string;
  callSid: string;
  callStatus: string;
}

export interface MissedCallResult {
  success: boolean;
  conversationId: string | null;
  smsSent: boolean;
  twilioSid: string | null;
  error: string | null;
}

/**
 * Builds the initial SMS text for a missed call.
 * Uses the shop name if available for a personal touch.
 */
export function buildMissedCallSms(
  shopName: string | null,
  template: string | null = null
): string {
  const name = shopName || "our shop";

  if (template && template.trim()) {
    return template.replace(/\{shop_name\}/gi, name);
  }

  return (
    `Hi! We noticed you just called ${name} but we couldn't pick up. ` +
    `How can we help you today? Reply here and we'll get you taken care of.`
  );
}

/**
 * Sends an SMS via Twilio REST API.
 * Returns the Twilio message SID on success, or null on failure.
 */
export async function sendTwilioSms(
  to: string,
  body: string,
  fetchFn: typeof fetch = fetch
): Promise<{ sid: string | null; error: string | null }> {
  const accountSid = await getConfig("TWILIO_ACCOUNT_SID");
  const authToken = await getConfig("TWILIO_AUTH_TOKEN");
  const messagingServiceSid = await getConfig("TWILIO_MESSAGING_SERVICE_SID");

  if (!accountSid || !authToken || !messagingServiceSid) {
    return { sid: null, error: "Twilio credentials not configured" };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `MessagingServiceSid=${encodeURIComponent(messagingServiceSid)}&To=${encodeURIComponent(to)}&Body=${encodeURIComponent(body)}`,
    });

    const data = (await res.json()) as {
      sid?: string;
      code?: number;
      message?: string;
    };

    if (!res.ok || !data.sid) {
      return {
        sid: null,
        error: `Twilio API error ${res.status}: ${data.message || "unknown"}`,
      };
    }

    return { sid: data.sid, error: null };
  } catch (err) {
    return {
      sid: null,
      error: `Twilio request failed: ${(err as Error).message}`,
    };
  }
}

/**
 * Handles the full missed-call SMS flow.
 *
 * This is the entry point of the entire AutoShop AI pipeline.
 * After this runs, the customer has received an SMS and can reply
 * to start an AI conversation that leads to booking.
 */
export async function handleMissedCallSms(
  input: MissedCallInput,
  fetchFn: typeof fetch = fetch
): Promise<MissedCallResult> {
  // 1. Validate tenant and get shop info + messaging config
  let shopName: string | null = null;
  let billingStatus: string = "unknown";
  let missedCallTemplate: string | null = null;
  try {
    const rows = await query<{
      id: string;
      shop_name: string | null;
      billing_status: string;
      missed_call_sms_template: string | null;
    }>(
      `SELECT id, shop_name, billing_status, missed_call_sms_template FROM tenants WHERE id = $1`,
      [input.tenantId]
    );

    if (rows.length === 0) {
      return {
        success: false,
        conversationId: null,
        smsSent: false,
        twilioSid: null,
        error: "Tenant not found",
      };
    }

    shopName = rows[0].shop_name;
    billingStatus = rows[0].billing_status;
    missedCallTemplate = rows[0].missed_call_sms_template;
  } catch (err) {
    return {
      success: false,
      conversationId: null,
      smsSent: false,
      twilioSid: null,
      error: `Tenant lookup failed: ${(err as Error).message}`,
    };
  }

  // 2. Check billing — don't send SMS if tenant is blocked
  const BLOCKED_STATUSES = ["canceled", "paused", "past_due_blocked", "trial_expired"];
  if (BLOCKED_STATUSES.includes(billingStatus)) {
    return {
      success: false,
      conversationId: null,
      smsSent: false,
      twilioSid: null,
      error: "Tenant billing is blocked",
    };
  }

  // 2b. Check AI settings — if missed-call SMS is disabled, skip
  let aiPolicy;
  try {
    aiPolicy = await getTenantAiPolicy(input.tenantId);
  } catch {
    // Non-fatal: proceed with default behavior (SMS enabled)
  }

  if (aiPolicy && !aiPolicy.missedCallSmsEnabled) {
    return {
      success: true,
      conversationId: null,
      smsSent: false,
      twilioSid: null,
      error: null,
    };
  }

  // 3. Get or create conversation
  let conversationId: string | null = null;
  let isNew = false;
  try {
    const rows = await query<{ conversation_id: string | null; is_new: boolean }>(
      `SELECT * FROM get_or_create_conversation($1, $2)`,
      [input.tenantId, input.customerPhone]
    );

    if (rows.length === 0 || !rows[0].conversation_id) {
      return {
        success: false,
        conversationId: null,
        smsSent: false,
        twilioSid: null,
        error: "Conversation creation blocked (cooldown active)",
      };
    }

    conversationId = rows[0].conversation_id;
    isNew = rows[0].is_new;
  } catch (err) {
    return {
      success: false,
      conversationId: null,
      smsSent: false,
      twilioSid: null,
      error: `Conversation creation failed: ${(err as Error).message}`,
    };
  }

  // 4. Log the missed call as a synthetic inbound message
  try {
    await query(
      `INSERT INTO messages (tenant_id, conversation_id, direction, body)
       VALUES ($1, $2, 'inbound', $3)`,
      [
        input.tenantId,
        conversationId,
        `[Missed call: ${input.callStatus}] from ${input.customerPhone}`,
      ]
    );
  } catch {
    // Non-fatal — continue with SMS even if logging fails
  }

  // 5. Send the initial outbound SMS
  // Priority: tenant DB template (admin override) > AI settings template > default
  // The AI settings template is the dashboard-configured preset/custom message.
  // The DB column (missed_call_sms_template) allows admin override via API.
  let effectiveTemplate = missedCallTemplate; // DB column first (admin override)
  if (!effectiveTemplate && aiPolicy?.missedCallSmsTemplate) {
    effectiveTemplate = aiPolicy.missedCallSmsTemplate;
  }
  const smsBody = buildMissedCallSms(shopName, effectiveTemplate);
  const twilioResult = await sendTwilioSms(
    input.customerPhone,
    smsBody,
    fetchFn
  );

  // 6. Log the outbound message
  try {
    await query(
      `INSERT INTO messages (tenant_id, conversation_id, direction, body)
       VALUES ($1, $2, 'outbound', $3)`,
      [input.tenantId, conversationId, smsBody]
    );
    // Touch conversation to update last_message_at
    await query(
      `SELECT touch_conversation($1, $2)`,
      [conversationId, input.tenantId]
    );
  } catch {
    // Non-fatal — SMS was sent even if logging fails
  }

  if (!twilioResult.sid) {
    return {
      success: false,
      conversationId,
      smsSent: false,
      twilioSid: null,
      error: twilioResult.error,
    };
  }

  return {
    success: true,
    conversationId,
    smsSent: true,
    twilioSid: twilioResult.sid,
    error: null,
  };
}
