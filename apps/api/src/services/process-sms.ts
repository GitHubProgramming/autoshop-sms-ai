/**
 * SMS Conversation Processing Service
 *
 * Handles the full AI conversation loop when a customer replies to an SMS:
 *   inbound SMS → get/create conversation → fetch history → OpenAI → booking detection
 *   → log messages → send reply → create appointment + calendar event if booked
 *
 * This replaces the n8n WF-001 + WF-002 dependency with a single API-native flow,
 * removing the requirement for n8n credentials to be configured.
 *
 * Called by: POST /internal/process-sms (sms-inbound worker)
 */

import { query } from "../db/client";
import { detectBookingIntent } from "./booking-intent";
import { createAppointment } from "./appointments";
import { createCalendarEvent } from "./google-calendar";
import { sendTwilioSms } from "./missed-call-sms";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProcessSmsInput {
  tenantId: string;
  customerPhone: string;
  ourPhone: string;
  body: string;
  messageSid: string;
  atSoftLimit: boolean;
}

export interface ProcessSmsResult {
  success: boolean;
  conversationId: string | null;
  aiResponse: string | null;
  smsSent: boolean;
  isBooked: boolean;
  appointmentId: string | null;
  calendarSynced: boolean;
  conversationClosed: boolean;
  error: string | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";
const OPENAI_MAX_TOKENS = 800;
const OPENAI_TEMPERATURE = 0.3;
const HISTORY_LIMIT = 8;

const DEFAULT_SYSTEM_PROMPT =
  "You are an auto shop scheduling assistant. Help customers book appointments for vehicle maintenance and repair. " +
  "Be friendly, professional, and concise. Keep responses under 160 characters when possible (SMS length). " +
  "When a customer confirms a time and service, clearly confirm the appointment details.";

const SOFT_LIMIT_RESPONSE =
  "We've reached our monthly messaging limit. " +
  "Please call us directly to schedule your appointment. Thank you!";

// ── Core processing function ─────────────────────────────────────────────────

export async function processSms(
  input: ProcessSmsInput,
  fetchFn: typeof fetch = fetch
): Promise<ProcessSmsResult> {
  const result: ProcessSmsResult = {
    success: false,
    conversationId: null,
    aiResponse: null,
    smsSent: false,
    isBooked: false,
    appointmentId: null,
    calendarSynced: false,
    conversationClosed: false,
    error: null,
  };

  // ── 1. Get or create conversation ────────────────────────────────────────
  try {
    const rows = await query<{ conversation_id: string | null; is_new: boolean }>(
      `SELECT * FROM get_or_create_conversation($1, $2)`,
      [input.tenantId, input.customerPhone]
    );

    if (rows.length === 0 || !rows[0].conversation_id) {
      result.error = "Conversation creation blocked (cooldown active)";
      return result;
    }

    result.conversationId = rows[0].conversation_id;
  } catch (err) {
    result.error = `Conversation creation failed: ${(err as Error).message}`;
    return result;
  }

  // ── 2. Fetch conversation history ────────────────────────────────────────
  // IMPORTANT: Fetch history BEFORE logging the inbound message to avoid
  // duplicating the current message in the OpenAI context. The current message
  // is appended separately when building the messages array.
  let history: Array<{ role: string; content: string }> = [];
  try {
    const rows = await query<{ direction: string; body: string }>(
      `SELECT direction, body FROM messages
       WHERE conversation_id = $1 AND tenant_id = $2
       ORDER BY sent_at DESC LIMIT $3`,
      [result.conversationId, input.tenantId, HISTORY_LIMIT]
    );

    // Reverse so oldest first, map to OpenAI format
    history = rows
      .reverse()
      .filter((r) => r.body && r.body.trim())
      .map((r) => ({
        role: r.direction === "inbound" ? "user" : "assistant",
        content: r.body,
      }));
  } catch {
    // Continue with no history — AI will still respond
  }

  // ── 3. Log inbound message ───────────────────────────────────────────────
  try {
    await query(
      `INSERT INTO messages (tenant_id, conversation_id, direction, body, twilio_sid)
       VALUES ($1, $2, 'inbound', $3, $4)`,
      [input.tenantId, result.conversationId, input.body, input.messageSid]
    );
  } catch {
    // Non-fatal: continue even if logging fails (twilio_sid unique constraint = already logged)
  }

  // Touch conversation to update last_message_at + turn_count
  try {
    await query(`SELECT touch_conversation($1, $2)`, [
      result.conversationId,
      input.tenantId,
    ]);
  } catch {
    // Non-fatal
  }

  // ── 4. Soft limit check ──────────────────────────────────────────────────
  if (input.atSoftLimit) {
    result.aiResponse = SOFT_LIMIT_RESPONSE;
    const smsResult = await sendTwilioSms(
      input.customerPhone,
      SOFT_LIMIT_RESPONSE,
      fetchFn
    );
    result.smsSent = !!smsResult.sid;

    // Log outbound
    try {
      await query(
        `INSERT INTO messages (tenant_id, conversation_id, direction, body)
         VALUES ($1, $2, 'outbound', $3)`,
        [input.tenantId, result.conversationId, SOFT_LIMIT_RESPONSE]
      );
    } catch {
      // Non-fatal
    }

    result.success = true;
    return result;
  }

  // ── 5. Fetch system prompt + tenant context ────────────────────────────
  let systemPrompt = DEFAULT_SYSTEM_PROMPT;
  try {
    const rows = await query<{ prompt_text: string }>(
      `SELECT prompt_text FROM system_prompts
       WHERE tenant_id = $1 AND is_active = TRUE
       ORDER BY version DESC LIMIT 1`,
      [input.tenantId]
    );
    if (rows.length > 0) {
      systemPrompt = rows[0].prompt_text;
    }
  } catch {
    // Use default prompt if lookup fails
  }

  // Inject tenant shop context (business_hours, services_description) into prompt
  try {
    const tenantRows = await query<{
      shop_name: string | null;
      business_hours: string | null;
      services_description: string | null;
    }>(
      `SELECT shop_name, business_hours, services_description FROM tenants WHERE id = $1`,
      [input.tenantId]
    );
    if (tenantRows.length > 0) {
      const t = tenantRows[0];
      const contextParts: string[] = [];
      if (t.shop_name) contextParts.push(`Shop name: ${t.shop_name}`);
      if (t.business_hours) contextParts.push(`Business hours: ${t.business_hours}`);
      if (t.services_description) contextParts.push(`Services offered: ${t.services_description}`);
      if (contextParts.length > 0) {
        systemPrompt += "\n\n" + contextParts.join("\n");
      }
    }
  } catch {
    // Non-fatal: continue with base prompt if tenant lookup fails
  }

  // ── 6. Call OpenAI ──────────────────────────────────────────────────────
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    result.error = "OPENAI_API_KEY not configured";
    return result;
  }

  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: input.body },
  ];

  let aiResponse: string;
  let tokensUsed: number | null = null;

  try {
    const res = await fetchFn(OPENAI_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        max_tokens: OPENAI_MAX_TOKENS,
        temperature: OPENAI_TEMPERATURE,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      result.error = `OpenAI API error ${res.status}: ${body}`;
      return result;
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { total_tokens: number };
    };

    aiResponse = data.choices?.[0]?.message?.content ?? "";
    tokensUsed = data.usage?.total_tokens ?? null;

    if (!aiResponse) {
      result.error = "OpenAI returned empty response";
      return result;
    }
  } catch (err) {
    result.error = `OpenAI request failed: ${(err as Error).message}`;
    return result;
  }

  result.aiResponse = aiResponse;

  // ── 7. Detect booking intent ─────────────────────────────────────────────
  const intent = detectBookingIntent(aiResponse, input.body);

  // ── 8. Log outbound AI message ───────────────────────────────────────────
  try {
    await query(
      `INSERT INTO messages (tenant_id, conversation_id, direction, body, tokens_used, model_version)
       VALUES ($1, $2, 'outbound', $3, $4, $5)`,
      [input.tenantId, result.conversationId, aiResponse, tokensUsed, OPENAI_MODEL]
    );
  } catch {
    // Non-fatal
  }

  // ── 9. Send SMS reply ────────────────────────────────────────────────────
  const smsResult = await sendTwilioSms(input.customerPhone, aiResponse, fetchFn);
  result.smsSent = !!smsResult.sid;

  if (!smsResult.sid) {
    // AI response was generated but SMS delivery failed
    result.error = `SMS send failed: ${smsResult.error}`;
    // Don't return — still process booking intent
  }

  // Touch conversation again after outbound
  try {
    await query(`SELECT touch_conversation($1, $2)`, [
      result.conversationId,
      input.tenantId,
    ]);
  } catch {
    // Non-fatal
  }

  // ── 10. Handle booking ───────────────────────────────────────────────────
  if (intent.isBooked) {
    result.isBooked = true;

    // Create appointment
    const apptResult = await createAppointment({
      tenantId: input.tenantId,
      conversationId: result.conversationId,
      customerPhone: input.customerPhone,
      customerName: intent.customerName,
      serviceType: intent.serviceType,
      scheduledAt: intent.scheduledAt,
    });

    if (apptResult.success && apptResult.appointment) {
      result.appointmentId = apptResult.appointment.id;

      // Create calendar event
      const calResult = await createCalendarEvent(
        {
          tenantId: input.tenantId,
          appointmentId: apptResult.appointment.id,
          customerPhone: input.customerPhone,
          customerName: intent.customerName,
          serviceType: intent.serviceType,
          scheduledAt: intent.scheduledAt,
        },
        fetchFn
      );

      result.calendarSynced = calResult.calendarSynced;
      if (!calResult.calendarSynced && calResult.error) {
        result.error = result.error
          ? `${result.error}; Calendar: ${calResult.error}`
          : `Calendar sync failed: ${calResult.error}`;
      }
    } else {
      result.error = result.error
        ? `${result.error}; Appointment: ${apptResult.error}`
        : `Appointment creation failed: ${apptResult.error}`;
    }

    // Close conversation as booked
    try {
      await query(`SELECT close_conversation($1, $2, $3, $4)`, [
        result.conversationId,
        input.tenantId,
        "booked",
        "booking_completed",
      ]);
      result.conversationClosed = true;
    } catch {
      // Non-fatal: appointment was created even if close fails
    }
  }

  // ── 11. Handle user close request ────────────────────────────────────────
  if (!intent.isBooked && intent.userWantsClose) {
    try {
      await query(`SELECT close_conversation($1, $2, $3, $4)`, [
        result.conversationId,
        input.tenantId,
        "closed",
        "user_closed",
      ]);
      result.conversationClosed = true;
    } catch {
      // Non-fatal
    }
  }

  result.success = true;
  return result;
}
