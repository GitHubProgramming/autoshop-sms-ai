import { FastifyInstance } from "fastify";
import { query } from "../../db/client";
import { requireAuth } from "../../middleware/require-auth";
import { deleteCalendarEvent } from "../../services/google-calendar";

/**
 * Tenant KPI endpoints — all values come from real data only.
 * No hardcoded values, no demo fallbacks, no fake percentages.
 * If no data exists, returns 0.
 *
 * STABILIZATION NOTE (020): All queries now read from `appointments` table,
 * which is the actual live write path (SMS → AI → booking → appointment).
 * The `bookings` table (019) exists but is not populated by any write path.
 *
 * AI-sourced appointments are identified by conversation_id IS NOT NULL
 * (every AI-created appointment has a conversation link).
 * Revenue comes from appointments.final_price (set via PATCH complete).
 */
export async function tenantKpiRoute(app: FastifyInstance) {
  /**
   * GET /tenant/kpi/recovered-revenue
   *
   * Revenue from AI-sourced appointments completed in the last 30 days.
   * Uses final_price from completed appointments that have a conversation_id.
   */
  app.get("/kpi/recovered-revenue", { preHandler: [requireAuth] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string; email: string };

    const rows = await query<{ total: string; count: string }>(
      `SELECT
         COALESCE(SUM(final_price), 0)::text AS total,
         COUNT(*)::text AS count
       FROM appointments
       WHERE tenant_id = $1
         AND completed_at IS NOT NULL
         AND conversation_id IS NOT NULL
         AND completed_at >= NOW() - INTERVAL '30 days'`,
      [tenantId]
    );

    // Previous 30-day window for comparison
    const prevRows = await query<{ total: string }>(
      `SELECT COALESCE(SUM(final_price), 0)::text AS total
       FROM appointments
       WHERE tenant_id = $1
         AND completed_at IS NOT NULL
         AND conversation_id IS NOT NULL
         AND completed_at >= NOW() - INTERVAL '60 days'
         AND completed_at < NOW() - INTERVAL '30 days'`,
      [tenantId]
    );

    const current = parseFloat(rows[0]?.total ?? "0");
    const previous = parseFloat(prevRows[0]?.total ?? "0");
    const changePct = previous > 0 ? ((current - previous) / previous) * 100 : 0;

    return reply.status(200).send({
      recovered_revenue: current,
      booking_count: parseInt(rows[0]?.count ?? "0", 10),
      previous_period: previous,
      change_pct: Math.round(changePct * 10) / 10,
    });
  });

  /**
   * GET /tenant/kpi/total-revenue
   *
   * Total revenue from ALL completed appointments in the last 30 days.
   * Uses final_price from completed appointments (all sources).
   */
  app.get("/kpi/total-revenue", { preHandler: [requireAuth] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string; email: string };

    const rows = await query<{ total: string; count: string }>(
      `SELECT
         COALESCE(SUM(final_price), 0)::text AS total,
         COUNT(*)::text AS count
       FROM appointments
       WHERE tenant_id = $1
         AND completed_at IS NOT NULL
         AND completed_at >= NOW() - INTERVAL '30 days'`,
      [tenantId]
    );

    const prevRows = await query<{ total: string }>(
      `SELECT COALESCE(SUM(final_price), 0)::text AS total
       FROM appointments
       WHERE tenant_id = $1
         AND completed_at IS NOT NULL
         AND completed_at >= NOW() - INTERVAL '60 days'
         AND completed_at < NOW() - INTERVAL '30 days'`,
      [tenantId]
    );

    const current = parseFloat(rows[0]?.total ?? "0");
    const previous = parseFloat(prevRows[0]?.total ?? "0");
    const changePct = previous > 0 ? ((current - previous) / previous) * 100 : 0;

    return reply.status(200).send({
      total_revenue: current,
      booking_count: parseInt(rows[0]?.count ?? "0", 10),
      previous_period: previous,
      change_pct: Math.round(changePct * 10) / 10,
    });
  });

  /**
   * GET /tenant/kpi/summary
   *
   * Combined KPI summary for the dashboard — single request for all cards.
   * All values from real data. Zero if no data.
   */
  app.get("/kpi/summary", { preHandler: [requireAuth] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string; email: string };

    const [
      recoveredRows,
      totalRevRows,
      apptMonthRows,
      apptTodayRows,
      activeConvRows,
      convsMonthRows,
      bookingConvRows,
      pendingCompletionRows,
    ] = await Promise.all([
      // Recovered revenue (AI-sourced completed appointments, last 30d)
      query<{ total: string; count: string }>(
        `SELECT COALESCE(SUM(final_price), 0)::text AS total, COUNT(*)::text AS count
         FROM appointments
         WHERE tenant_id = $1
           AND completed_at IS NOT NULL
           AND conversation_id IS NOT NULL
           AND completed_at >= NOW() - INTERVAL '30 days'`,
        [tenantId]
      ),
      // Total revenue (all completed appointments, last 30d)
      query<{ total: string; count: string }>(
        `SELECT COALESCE(SUM(final_price), 0)::text AS total,
                COUNT(*)::text AS count
         FROM appointments
         WHERE tenant_id = $1
           AND completed_at IS NOT NULL
           AND completed_at >= NOW() - INTERVAL '30 days'`,
        [tenantId]
      ),
      // AI-booked appointments this month (have conversation_id, exclude FAILED + CANCELLED)
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM appointments
         WHERE tenant_id = $1
           AND conversation_id IS NOT NULL
           AND booking_state NOT IN ('FAILED', 'CANCELLED')
           AND created_at >= date_trunc('month', CURRENT_DATE)`,
        [tenantId]
      ),
      // Appointments today (exclude cancelled/failed)
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM appointments
         WHERE tenant_id = $1
           AND scheduled_at >= CURRENT_DATE
           AND scheduled_at < CURRENT_DATE + INTERVAL '1 day'
           AND booking_state NOT IN ('CANCELLED', 'FAILED')`,
        [tenantId]
      ),
      // Active conversations
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM conversations
         WHERE tenant_id = $1 AND status = 'open'`,
        [tenantId]
      ),
      // Conversations this month
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM conversations
         WHERE tenant_id = $1
           AND opened_at >= date_trunc('month', CURRENT_DATE)`,
        [tenantId]
      ),
      // Conversations that led to bookings this month
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM conversations
         WHERE tenant_id = $1
           AND status = 'booked'
           AND opened_at >= date_trunc('month', CURRENT_DATE)`,
        [tenantId]
      ),
      // Past appointments not yet marked complete (revenue loss risk)
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM appointments
         WHERE tenant_id = $1
           AND scheduled_at < NOW()
           AND completed_at IS NULL
           AND booking_state IN ('CONFIRMED_CALENDAR', 'CONFIRMED_MANUAL')`,
        [tenantId]
      ),
    ]);

    const convsMonth = parseInt(convsMonthRows[0]?.count ?? "0", 10);
    const bookedConvs = parseInt(bookingConvRows[0]?.count ?? "0", 10);
    const bookingRate = convsMonth > 0 ? Math.round((bookedConvs / convsMonth) * 1000) / 10 : 0;

    return reply.status(200).send({
      recovered_revenue: parseFloat(recoveredRows[0]?.total ?? "0"),
      recovered_bookings: parseInt(recoveredRows[0]?.count ?? "0", 10),
      total_revenue: parseFloat(totalRevRows[0]?.total ?? "0"),
      total_completed_bookings: parseInt(totalRevRows[0]?.count ?? "0", 10),
      ai_booked_this_month: parseInt(apptMonthRows[0]?.count ?? "0", 10),
      appointments_today: parseInt(apptTodayRows[0]?.count ?? "0", 10),
      active_conversations: parseInt(activeConvRows[0]?.count ?? "0", 10),
      conversations_this_month: convsMonth,
      conversations_booked: bookedConvs,
      booking_rate_pct: bookingRate,
      pending_completion_count: parseInt(pendingCompletionRows[0]?.count ?? "0", 10),
    });
  });

  /**
   * GET /tenant/kpi/daily-revenue?days=30
   *
   * Daily revenue for the last N days from completed appointments.
   * Accepts ?days=7|30|90 (default 30).
   * Returns an array of { date, total } entries, one per day.
   * Days with no completions return total: 0.
   */
  app.get("/kpi/daily-revenue", { preHandler: [requireAuth] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string; email: string };
    const rawDays = (request.query as Record<string, string>).days;
    const allowed = [7, 30, 90];
    const numDays = allowed.includes(Number(rawDays)) ? Number(rawDays) : 30;

    const rows = await query<{ day: string; total: string }>(
      `SELECT d.day::date::text AS day,
              COALESCE(SUM(a.final_price), 0)::text AS total
       FROM generate_series(
              CURRENT_DATE - INTERVAL '${numDays - 1} days',
              CURRENT_DATE,
              '1 day'
            ) AS d(day)
       LEFT JOIN appointments a
         ON a.tenant_id = $1
         AND a.completed_at IS NOT NULL
         AND a.completed_at::date = d.day::date
       GROUP BY d.day
       ORDER BY d.day`,
      [tenantId]
    );

    return reply.status(200).send({
      days: rows.map((r) => ({
        date: r.day,
        total: parseFloat(r.total),
      })),
    });
  });

  /**
   * GET /tenant/kpi/daily-conversations?days=30
   *
   * Daily conversation count for the last N days.
   * Accepts ?days=7|30|90 (default 30).
   * Returns an array of { date, total } entries, one per day.
   * Days with no conversations return total: 0.
   */
  app.get("/kpi/daily-conversations", { preHandler: [requireAuth] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string; email: string };
    const rawDays = (request.query as Record<string, string>).days;
    const allowed = [7, 30, 90];
    const numDays = allowed.includes(Number(rawDays)) ? Number(rawDays) : 30;

    const rows = await query<{ day: string; total: string }>(
      `SELECT d.day::date::text AS day,
              COUNT(c.id)::text AS total
       FROM generate_series(
              CURRENT_DATE - INTERVAL '${numDays - 1} days',
              CURRENT_DATE,
              '1 day'
            ) AS d(day)
       LEFT JOIN conversations c
         ON c.tenant_id = $1
         AND c.opened_at::date = d.day::date
       GROUP BY d.day
       ORDER BY d.day`,
      [tenantId]
    );

    return reply.status(200).send({
      days: rows.map((r) => ({
        date: r.day,
        total: parseInt(r.total, 10),
      })),
    });
  });

  /**
   * GET /tenant/customers/list
   *
   * Customer list derived from appointments table.
   * Groups by customer_phone to build a virtual customer view
   * from the actual populated data.
   */
  app.get("/customers/list", { preHandler: [requireAuth] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string; email: string };

    const rows = await query<{
      id: string;
      name: string | null;
      phone: string;
      email: string | null;
      last_visit: string | null;
      appointments_count: string;
      total_spent: string | null;
      created_at: string;
      car_model: string | null;
      issue_description: string | null;
    }>(
      `WITH customer_agg AS (
         SELECT
           customer_phone AS phone,
           COUNT(id) AS appointments_count,
           SUM(final_price) FILTER (WHERE completed_at IS NOT NULL) AS total_spent,
           MAX(completed_at) AS last_visit,
           MIN(id::text) AS first_id,
           MIN(created_at) AS first_created
         FROM appointments
         WHERE tenant_id = $1
         GROUP BY customer_phone
       ),
       latest_appt AS (
         SELECT DISTINCT ON (customer_phone)
           customer_phone,
           customer_name,
           car_model,
           issue_description
         FROM appointments
         WHERE tenant_id = $1
         ORDER BY customer_phone, created_at DESC
       )
       SELECT
         ca.first_id::text AS id,
         la.customer_name AS name,
         ca.phone,
         NULL::text AS email,
         ca.last_visit::text AS last_visit,
         ca.appointments_count::text AS appointments_count,
         ca.total_spent::text AS total_spent,
         ca.first_created::text AS created_at,
         la.car_model,
         la.issue_description
       FROM customer_agg ca
       LEFT JOIN latest_appt la ON la.customer_phone = ca.phone
       ORDER BY ca.last_visit DESC NULLS LAST, ca.first_created DESC
       LIMIT 100`,
      [tenantId]
    );

    return reply.status(200).send({
      customers: rows.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        email: r.email,
        last_visit: r.last_visit,
        appointments_count: parseInt(r.appointments_count, 10),
        total_spent: r.total_spent != null ? parseFloat(r.total_spent) : null,
        created_at: r.created_at,
        car_model: r.car_model,
        issue_description: r.issue_description,
      })),
    });
  });

  /**
   * PATCH /tenant/appointments/:id/complete
   *
   * Mark an appointment as completed with final_price.
   * This is how revenue enters the system.
   */
  app.patch("/appointments/:id/complete", { preHandler: [requireAuth] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string; email: string };
    const { id } = request.params as { id: string };
    const { final_price } = request.body as { final_price: number };

    if (typeof final_price !== "number" || !Number.isFinite(final_price) || final_price < 0) {
      return reply.status(400).send({ error: "final_price must be a non-negative finite number" });
    }

    // Round to 2 decimal places for NUMERIC(10,2) column
    const rounded_price = Math.round(final_price * 100) / 100;

    const rows = await query<{ id: string; final_price: number }>(
      `UPDATE appointments
       SET final_price = $1,
           completed_at = COALESCE(completed_at, NOW())
       WHERE id = $2 AND tenant_id = $3
         AND booking_state NOT IN ('CANCELLED')
       RETURNING id, final_price`,
      [rounded_price, id, tenantId]
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: "Appointment not found or is cancelled" });
    }

    return reply.status(200).send({ id: rows[0].id, status: "completed", final_price: rows[0].final_price });
  });

  /**
   * PATCH /tenant/appointments/:id/cancel
   *
   * Cancel an appointment. Sets booking_state to CANCELLED.
   * If a Google Calendar event exists and the tenant has calendar tokens,
   * attempts to delete the event from Google Calendar.
   *
   * Only allowed on appointments that are not already completed or cancelled.
   */
  app.patch("/appointments/:id/cancel", { preHandler: [requireAuth] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string; email: string };
    const { id } = request.params as { id: string };

    // 1. Cancel in DB and return the google_event_id for calendar cleanup
    const rows = await query<{ id: string; google_event_id: string | null }>(
      `UPDATE appointments
       SET booking_state = 'CANCELLED'
       WHERE id = $1 AND tenant_id = $2
         AND completed_at IS NULL
         AND booking_state NOT IN ('CANCELLED')
       RETURNING id, google_event_id`,
      [id, tenantId]
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: "Appointment not found or already completed/cancelled" });
    }

    const googleEventId = rows[0].google_event_id;
    let calendar_event_deleted = false;
    let calendar_error: string | null = null;

    // 2. If there's a Google Calendar event, attempt to delete it
    if (googleEventId) {
      const result = await deleteCalendarEvent(tenantId, id, googleEventId);
      calendar_event_deleted = result.success;
      calendar_error = result.error;
    }

    return reply.status(200).send({
      id: rows[0].id,
      status: "cancelled",
      calendar_event_deleted,
      calendar_error,
    });
  });

  /**
   * GET /tenant/appointments-summary
   *
   * Single source of truth for the /app/appointments page KPIs.
   * All calculations done server-side using a consistent timezone (DB server).
   * Frontend must render these values directly — no recomputation.
   */
  app.get("/appointments-summary", { preHandler: [requireAuth] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string; email: string };

    const appointmentFields = `id, conversation_id, customer_phone, customer_name,
                service_type, scheduled_at, calendar_synced,
                google_event_id, booking_state, created_at,
                completed_at, final_price, car_model, is_test,
                CASE WHEN conversation_id IS NOT NULL THEN 'AI' ELSE 'Manual' END AS source`;

    const [
      todayRows,
      weekRows,
      aiBookedRows,
      totalRows,
      upcomingRows,
      aiBookedMonthRows,
      totalMonthRows,
      todayApptRows,
      upcomingApptRows,
    ] = await Promise.all([
      // Today's appointments count (exclude cancelled/failed)
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM appointments
         WHERE tenant_id = $1
           AND scheduled_at >= CURRENT_DATE
           AND scheduled_at < CURRENT_DATE + INTERVAL '1 day'
           AND booking_state NOT IN ('CANCELLED', 'FAILED')`,
        [tenantId]
      ),
      // This week (Monday-relative for consistency)
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM appointments
         WHERE tenant_id = $1
           AND scheduled_at >= date_trunc('week', CURRENT_DATE)
           AND scheduled_at < date_trunc('week', CURRENT_DATE) + INTERVAL '7 days'
           AND booking_state NOT IN ('CANCELLED', 'FAILED')`,
        [tenantId]
      ),
      // AI-booked (have conversation_id, exclude failed/cancelled)
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM appointments
         WHERE tenant_id = $1
           AND conversation_id IS NOT NULL
           AND booking_state NOT IN ('FAILED', 'CANCELLED')`,
        [tenantId]
      ),
      // Total appointments (for AI %)
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM appointments
         WHERE tenant_id = $1
           AND booking_state NOT IN ('FAILED', 'CANCELLED')`,
        [tenantId]
      ),
      // Upcoming count (future, not today, exclude cancelled/failed)
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM appointments
         WHERE tenant_id = $1
           AND scheduled_at >= CURRENT_DATE + INTERVAL '1 day'
           AND booking_state NOT IN ('CANCELLED', 'FAILED')`,
        [tenantId]
      ),
      // AI-booked this month (same filters as all-time, scoped to current month)
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM appointments
         WHERE tenant_id = $1
           AND conversation_id IS NOT NULL
           AND booking_state NOT IN ('FAILED', 'CANCELLED')
           AND created_at >= date_trunc('month', CURRENT_DATE)`,
        [tenantId]
      ),
      // Total valid appointments this month (AI + Manual — same filters, no conversation_id filter)
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM appointments
         WHERE tenant_id = $1
           AND booking_state NOT IN ('FAILED', 'CANCELLED')
           AND created_at >= date_trunc('month', CURRENT_DATE)`,
        [tenantId]
      ),
      // Today's appointment rows for card rendering
      query(
        `SELECT ${appointmentFields}
         FROM appointments
         WHERE tenant_id = $1
           AND scheduled_at >= CURRENT_DATE
           AND scheduled_at < CURRENT_DATE + INTERVAL '1 day'
           AND booking_state NOT IN ('CANCELLED', 'FAILED')
         ORDER BY scheduled_at ASC
         LIMIT 20`,
        [tenantId]
      ),
      // Upcoming appointment rows for card rendering (next 7 days, not today)
      query(
        `SELECT ${appointmentFields}
         FROM appointments
         WHERE tenant_id = $1
           AND scheduled_at >= CURRENT_DATE + INTERVAL '1 day'
           AND booking_state NOT IN ('CANCELLED', 'FAILED')
         ORDER BY scheduled_at ASC
         LIMIT 8`,
        [tenantId]
      ),
    ]);

    const aiBooked = parseInt(aiBookedRows[0]?.count ?? "0", 10);
    const total = parseInt(totalRows[0]?.count ?? "0", 10);
    const aiPct = total > 0 ? Math.round((aiBooked / total) * 100) : 0;

    const aiBookedMonth = parseInt(aiBookedMonthRows[0]?.count ?? "0", 10);
    const totalMonth = parseInt(totalMonthRows[0]?.count ?? "0", 10);
    const manualMonth = totalMonth - aiBookedMonth;
    const aiBookedMonthPct = totalMonth > 0 ? Math.round((aiBookedMonth / totalMonth) * 100) : 0;

    return reply.status(200).send({
      total_today: parseInt(todayRows[0]?.count ?? "0", 10),
      total_week: parseInt(weekRows[0]?.count ?? "0", 10),
      ai_booked_count: aiBooked,
      ai_booked_pct: aiPct,
      ai_booked_this_month: aiBookedMonth,
      manual_booked_this_month: manualMonth,
      total_this_month: totalMonth,
      ai_booked_this_month_pct: aiBookedMonthPct,
      upcoming_count: parseInt(upcomingRows[0]?.count ?? "0", 10),
      total_non_test: total,
      today_appointments: todayApptRows,
      upcoming_appointments: upcomingApptRows,
    });
  });
}
