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
import { detectBookingIntent, extractFieldsFromMessage, mergeBookingFields } from "./booking-intent";
import { createAppointment, type BookingState } from "./appointments";
import { createCalendarEvent } from "./google-calendar";
import { sendTwilioSms } from "./missed-call-sms";
import { calendarQueue } from "../queues/redis";
import {
  getTenantAiPolicy,
  buildPromptPolicySection,
  buildRuntimePolicy,
  AI_SETTINGS_DEFAULTS,
  getMissingRequiredFields,
  getMissingFieldLabels,
  type AiRuntimePolicy,
  type ConversationCollectedData,
} from "./ai-settings";

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
  bookingState: BookingState | null;
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
    bookingState: null,
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

  // ── 5. Fetch AI runtime policy + system prompt + tenant context ─────────
  // FAIL-CLOSED: aiPolicy must NEVER be null — use defaults on any failure
  let aiPolicy: AiRuntimePolicy;
  try {
    aiPolicy = await getTenantAiPolicy(input.tenantId);
  } catch {
    aiPolicy = buildRuntimePolicy(AI_SETTINGS_DEFAULTS);
  }

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

  // Inject AI policy rules into the system prompt (always — aiPolicy is never null)
  const policySection = buildPromptPolicySection(aiPolicy);
  systemPrompt += "\n\n--- BOOKING RULES ---\n" + policySection;

  // Inject tenant shop context (business_hours, services_description) into prompt
  // Also fetch owner_phone for calendar-sync failure alerts
  let ownerPhone: string | null = null;
  let shopName: string | null = null;
  try {
    const tenantRows = await query<{
      shop_name: string | null;
      business_hours: string | null;
      services_description: string | null;
      owner_phone: string | null;
    }>(
      `SELECT shop_name, business_hours, services_description, owner_phone FROM tenants WHERE id = $1`,
      [input.tenantId]
    );
    if (tenantRows.length > 0) {
      const t = tenantRows[0];
      ownerPhone = t.owner_phone;
      shopName = t.shop_name;
      const contextParts: string[] = [];
      if (t.shop_name) contextParts.push(`Shop name: ${t.shop_name}`);
      if (t.business_hours) contextParts.push(`Business hours: ${t.business_hours}`);
      if (t.services_description) contextParts.push(`Services offered: ${t.services_description}`);
      // Inject services from AI settings if tenant-level is empty
      if (!t.services_description && aiPolicy.services) {
        contextParts.push(`Services offered: ${aiPolicy.services}`);
      }
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

  // ── 7. Detect booking intent ─────────────────────────────────────────────
  const rawIntent = detectBookingIntent(aiResponse, input.body);

  // ── 7b. Cumulative field extraction from conversation history ───────────
  // Extract fields from each prior turn, then merge with current intent
  // so that earlier strong values (issue, service type, name, car) survive
  // when the latest message is just a plate number or time confirmation.
  const priorExtractions = [];
  for (let i = 0; i < history.length; i++) {
    if (history[i].role === "user") {
      const aiReply =
        i + 1 < history.length && history[i + 1].role === "assistant"
          ? history[i + 1].content
          : "";
      priorExtractions.push(extractFieldsFromMessage(history[i].content, aiReply));
    }
  }
  const intent = mergeBookingFields(rawIntent, priorExtractions);

  // ── 8. If booking detected, attempt calendar sync BEFORE sending SMS ────
  // This prevents false confirmations: the customer must not receive
  // "appointment confirmed" unless the calendar write actually succeeded.
  let smsBody = aiResponse; // default: send AI response as-is

  if (intent.isBooked) {
    // ── Validate required fields before allowing booking ──────────────────
    // FAIL-CLOSED: aiPolicy is always set (defaults on failure).
    // Field mapping is strict — do NOT use weak proxies (e.g. serviceType as carModel).
    const collected: ConversationCollectedData = {
      customerName: intent.customerName,
      carModel: intent.carModel ?? null,
      issueDescription: intent.serviceType, // serviceType = "oil change" etc. is a valid issue description
      preferredTime: intent.scheduledAt,
      // licensePlate and phoneConfirmation: only set if explicitly extracted
      licensePlate: intent.licensePlate ?? null,
      phoneConfirmation: null,
    };
    const missing = getMissingRequiredFields(aiPolicy, collected);
    if (missing.length > 0) {
      // Required fields missing — do NOT create booking.
      // TRUTHFULNESS: Do NOT send AI's false confirmation to the customer.
      // Replace with a safe message listing what's still needed.
      const missingLabels = getMissingFieldLabels(missing);
      const safeBody =
        `Almost there! I still need: ${missingLabels.join(", ")}. ` +
        `Please provide so I can finalize your booking.`;
      result.success = true;
      result.aiResponse = safeBody;

      // Log outbound and send corrected SMS (not the AI's false confirmation)
      try {
        await query(
          `INSERT INTO messages (tenant_id, conversation_id, direction, body, tokens_used, model_version)
           VALUES ($1, $2, 'outbound', $3, $4, $5)`,
          [input.tenantId, result.conversationId, safeBody, tokensUsed, OPENAI_MODEL]
        );
      } catch { /* Non-fatal */ }

      const smsResult = await sendTwilioSms(input.customerPhone, safeBody, fetchFn);
      result.smsSent = !!smsResult.sid;

      try {
        await query(`SELECT touch_conversation($1, $2)`, [result.conversationId, input.tenantId]);
      } catch { /* Non-fatal */ }

      return result;
    }

    result.isBooked = true;

    // Create appointment (initially as PENDING until calendar confirms)
    const apptResult = await createAppointment({
      tenantId: input.tenantId,
      conversationId: result.conversationId,
      customerPhone: input.customerPhone,
      customerName: intent.customerName,
      serviceType: intent.serviceType,
      carModel: intent.carModel,
      licensePlate: intent.licensePlate,
      issueDescription: intent.issueDescription,
      scheduledAt: intent.scheduledAt,
      bookingState: "PENDING_MANUAL_CONFIRMATION",
    });

    if (apptResult.success && apptResult.appointment) {
      result.appointmentId = apptResult.appointment.id;

      // Attempt calendar sync
      const calResult = await createCalendarEvent(
        {
          tenantId: input.tenantId,
          appointmentId: apptResult.appointment.id,
          customerPhone: input.customerPhone,
          customerName: intent.customerName,
          serviceType: intent.serviceType,
          carModel: intent.carModel,
          licensePlate: intent.licensePlate,
          issueDescription: intent.issueDescription,
          scheduledAt: intent.scheduledAt,
        },
        fetchFn
      );

      result.calendarSynced = calResult.calendarSynced;

      if (calResult.calendarSynced) {
        // Calendar write succeeded — upgrade booking state to CONFIRMED
        result.bookingState = "CONFIRMED_CALENDAR";
        try {
          await query(
            `UPDATE appointments SET booking_state = $1 WHERE id = $2 AND tenant_id = $3`,
            ["CONFIRMED_CALENDAR", apptResult.appointment.id, input.tenantId]
          );
        } catch {
          // Non-fatal: appointment exists, state is best-effort update
        }
        // smsBody stays as AI response (contains confirmation language)
      } else {
        // Calendar sync failed — do NOT confirm to customer
        result.bookingState = "PENDING_MANUAL_CONFIRMATION";
        const shopLabel = shopName ?? "the shop";
        const timeLabel = intent.scheduledAt
          ? ` for ${new Date(intent.scheduledAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
          : "";
        smsBody =
          `Thanks — we've received your booking request${timeLabel}. ` +
          `${shopLabel} will confirm shortly.`;

        if (calResult.error) {
          result.error = `Calendar sync failed: ${calResult.error}`;

          // Operator alert (existing mechanism)
          if (ownerPhone && !calResult.error.includes("No calendar tokens")) {
            const alertBody =
              `AutoShop AI Alert: New booking from ${input.customerPhone}` +
              ` for ${intent.serviceType}` +
              (intent.scheduledAt ? ` on ${intent.scheduledAt}` : "") +
              ` could NOT be synced to Google Calendar. Please add it manually.`;
            try {
              await sendTwilioSms(ownerPhone, alertBody, fetchFn);
            } catch {
              // Non-fatal: best-effort alert
            }
          }

          // Enqueue automatic retry (exponential backoff: 30s, 60s, 120s, 240s)
          // Skip retry if no tokens configured — retry won't help until OAuth is done
          if (!calResult.error.includes("No calendar tokens")) {
            try {
              await calendarQueue.add(
                "calendar-sync-retry",
                {
                  tenantId: input.tenantId,
                  appointmentId: apptResult.appointment.id,
                  customerPhone: input.customerPhone,
                  customerName: intent.customerName,
                  serviceType: intent.serviceType,
                  carModel: intent.carModel,
                  licensePlate: intent.licensePlate,
                  issueDescription: intent.issueDescription,
                  scheduledAt: intent.scheduledAt,
                },
                {
                  attempts: 4,
                  backoff: { type: "exponential", delay: 30_000 },
                  removeOnComplete: 50,
                  removeOnFail: 200,
                }
              );
            } catch {
              // Non-fatal: retry enqueue failure doesn't break the flow
            }
          }
        }
      }
    } else {
      // Appointment creation itself failed
      result.bookingState = "FAILED";
      result.error = `Appointment creation failed: ${apptResult.error}`;
      // Replace confirmation with a safe fallback
      const shopLabel = shopName ?? "the shop";
      smsBody =
        `Thanks for your interest! Something went wrong on our end. ` +
        `Please call ${shopLabel} directly to confirm your appointment.`;
    }
  }

  // ── 9. Log outbound message ────────────────────────────────────────────
  // Log the actual message being sent (may differ from AI response if
  // calendar sync failed and we replaced the confirmation)
  try {
    await query(
      `INSERT INTO messages (tenant_id, conversation_id, direction, body, tokens_used, model_version)
       VALUES ($1, $2, 'outbound', $3, $4, $5)`,
      [input.tenantId, result.conversationId, smsBody, tokensUsed, OPENAI_MODEL]
    );
  } catch {
    // Non-fatal
  }

  // ── 10. Send SMS reply ─────────────────────────────────────────────────
  const smsResult = await sendTwilioSms(input.customerPhone, smsBody, fetchFn);
  result.smsSent = !!smsResult.sid;
  result.aiResponse = smsBody;

  if (!smsResult.sid) {
    result.error = result.error
      ? `${result.error}; SMS send failed: ${smsResult.error}`
      : `SMS send failed: ${smsResult.error}`;
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

  // ── 11. Close conversation if booked ───────────────────────────────────
  if (intent.isBooked) {
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

  // ── 12. Handle user close request ────────────────────────────────────────
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
