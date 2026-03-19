/**
 * Appointment Creation Service
 *
 * Creates appointment records in the database after booking intent is detected.
 * Bridges the gap between booking-intent detection and calendar-event creation.
 *
 * Called by: POST /internal/appointments (n8n WF-002 or API-side booking flow)
 */

import { query } from "../db/client";
import {
  getTenantAiPolicy,
  getMissingRequiredFields,
  getMissingFieldLabels,
  type ConversationCollectedData,
} from "./ai-settings";

export type BookingState = "CONFIRMED_CALENDAR" | "PENDING_MANUAL_CONFIRMATION" | "FAILED" | "CONFIRMED_MANUAL" | "RESOLVED";

export interface CreateAppointmentInput {
  tenantId: string;
  conversationId?: string | null;
  customerPhone: string;
  customerName?: string | null;
  serviceType?: string | null;
  carModel?: string | null;
  licensePlate?: string | null;
  issueDescription?: string | null;
  scheduledAt: string; // ISO 8601
  durationMinutes?: number;
  notes?: string | null;
  bookingState?: BookingState;
}

export interface AppointmentRecord {
  id: string;
  tenantId: string;
  conversationId: string | null;
  customerPhone: string;
  customerName: string | null;
  serviceType: string | null;
  carModel: string | null;
  licensePlate: string | null;
  issueDescription: string | null;
  scheduledAt: string;
  durationMinutes: number;
  notes: string | null;
  googleEventId: string | null;
  calendarSynced: boolean;
  bookingState: BookingState;
  createdAt: string;
}

export interface CreateAppointmentResult {
  success: boolean;
  appointment: AppointmentRecord | null;
  upserted: boolean;
  error: string | null;
}

/**
 * Creates or upserts an appointment record.
 *
 * When a conversationId is provided, uses ON CONFLICT to upsert — ensuring
 * one appointment per conversation (matches WF-002 semantics).
 *
 * Flow:
 * 1. Validate tenant exists
 * 2. INSERT appointment (with upsert on conversation_id if provided)
 * 3. Return created/updated record
 */
export async function createAppointment(
  input: CreateAppointmentInput
): Promise<CreateAppointmentResult> {
  // 1. Validate tenant exists
  try {
    const tenants = await query<{ id: string }>(
      `SELECT id FROM tenants WHERE id = $1`,
      [input.tenantId]
    );
    if (tenants.length === 0) {
      return {
        success: false,
        appointment: null,
        upserted: false,
        error: "Tenant not found",
      };
    }
  } catch (err) {
    return {
      success: false,
      appointment: null,
      upserted: false,
      error: `Tenant lookup failed: ${(err as Error).message}`,
    };
  }

  // 2. Validate required booking fields against tenant AI policy
  // FAIL-CLOSED: if policy lookup fails, block booking — never allow unvalidated inserts
  try {
    const policy = await getTenantAiPolicy(input.tenantId);
    const collected: ConversationCollectedData = {
      customerName: input.customerName,
      carModel: input.carModel ?? null,
      issueDescription: input.serviceType,
      preferredTime: input.scheduledAt,
      licensePlate: input.licensePlate ?? null,
      phoneConfirmation: null,
    };
    const missing = getMissingRequiredFields(policy, collected);
    if (missing.length > 0) {
      const labels = getMissingFieldLabels(missing);
      return {
        success: false,
        appointment: null,
        upserted: false,
        error: `Missing required booking fields: ${labels.join(", ")}`,
      };
    }
  } catch (err) {
    return {
      success: false,
      appointment: null,
      upserted: false,
      error: `Policy validation failed — booking blocked for safety: ${(err as Error).message}`,
    };
  }

  // 3. Insert or upsert appointment
  const duration = input.durationMinutes ?? 60;
  const bookingState = input.bookingState ?? "CONFIRMED_CALENDAR";

  try {
    let rows: Array<{
      id: string;
      tenant_id: string;
      conversation_id: string | null;
      customer_phone: string;
      customer_name: string | null;
      service_type: string | null;
      car_model: string | null;
      license_plate: string | null;
      issue_description: string | null;
      scheduled_at: string;
      duration_minutes: number;
      notes: string | null;
      google_event_id: string | null;
      calendar_synced: boolean;
      booking_state: string;
      created_at: string;
      xmax: string;
    }>;

    if (input.conversationId) {
      // Upsert: one appointment per conversation
      rows = await query(
        `INSERT INTO appointments
           (tenant_id, conversation_id, customer_phone, customer_name,
            service_type, car_model, license_plate, issue_description,
            scheduled_at, duration_minutes, notes, booking_state)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (conversation_id) DO UPDATE SET
           customer_phone = EXCLUDED.customer_phone,
           customer_name = EXCLUDED.customer_name,
           service_type = EXCLUDED.service_type,
           car_model = EXCLUDED.car_model,
           license_plate = EXCLUDED.license_plate,
           issue_description = EXCLUDED.issue_description,
           scheduled_at = EXCLUDED.scheduled_at,
           duration_minutes = EXCLUDED.duration_minutes,
           notes = EXCLUDED.notes,
           booking_state = EXCLUDED.booking_state
         RETURNING *, xmax`,
        [
          input.tenantId,
          input.conversationId,
          input.customerPhone,
          input.customerName ?? null,
          input.serviceType ?? null,
          input.carModel ?? null,
          input.licensePlate ?? null,
          input.issueDescription ?? null,
          input.scheduledAt,
          duration,
          input.notes ?? null,
          bookingState,
        ]
      );
    } else {
      // No conversation — always insert new
      rows = await query(
        `INSERT INTO appointments
           (tenant_id, customer_phone, customer_name,
            service_type, car_model, license_plate, issue_description,
            scheduled_at, duration_minutes, notes, booking_state)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *, 0::text AS xmax`,
        [
          input.tenantId,
          input.customerPhone,
          input.customerName ?? null,
          input.serviceType ?? null,
          input.carModel ?? null,
          input.licensePlate ?? null,
          input.issueDescription ?? null,
          input.scheduledAt,
          duration,
          input.notes ?? null,
          bookingState,
        ]
      );
    }

    if (rows.length === 0) {
      return {
        success: false,
        appointment: null,
        upserted: false,
        error: "Insert returned no rows",
      };
    }

    const row = rows[0];
    // xmax > 0 means the row was updated (upsert), not inserted
    const upserted = row.xmax !== "0";

    if (upserted) {
      console.info(
        JSON.stringify({
          event: "booking_duplicate_blocked",
          tenant_id: input.tenantId,
          conversation_id: input.conversationId,
          appointment_id: row.id,
        })
      );
    }

    return {
      success: true,
      appointment: {
        id: row.id,
        tenantId: row.tenant_id,
        conversationId: row.conversation_id,
        customerPhone: row.customer_phone,
        customerName: row.customer_name,
        serviceType: row.service_type,
        carModel: row.car_model,
        licensePlate: row.license_plate,
        issueDescription: row.issue_description,
        scheduledAt: row.scheduled_at,
        durationMinutes: row.duration_minutes,
        notes: row.notes,
        googleEventId: row.google_event_id,
        calendarSynced: row.calendar_synced,
        bookingState: row.booking_state as BookingState,
        createdAt: row.created_at,
      },
      upserted,
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      appointment: null,
      upserted: false,
      error: `Appointment creation failed: ${(err as Error).message}`,
    };
  }
}
