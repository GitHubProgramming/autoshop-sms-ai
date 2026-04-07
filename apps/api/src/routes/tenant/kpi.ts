import { FastifyInstance } from "fastify";
import { query } from "../../db/client";
import { requireAuth } from "../../middleware/require-auth";
import { deleteCalendarEvent } from "../../services/google-calendar";
import { getTenantTimezone } from "../../db/tenants";

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
    const tz = await getTenantTimezone(tenantId);

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
      // AI-booked appointments this month (tenant-local month)
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM appointments
         WHERE tenant_id = $1
           AND conversation_id IS NOT NULL
           AND booking_state NOT IN ('FAILED', 'CANCELLED')
           AND (created_at AT TIME ZONE $2) >= date_trunc('month', (now() AT TIME ZONE $2))`,
        [tenantId, tz]
      ),
      // Appointments today (tenant-local day, exclude cancelled/failed)
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM appointments
         WHERE tenant_id = $1
           AND (scheduled_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date
           AND booking_state NOT IN ('CANCELLED', 'FAILED')`,
        [tenantId, tz]
      ),
      // Active conversations
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM conversations
         WHERE tenant_id = $1 AND status = 'open'`,
        [tenantId]
      ),
      // Conversations this month (tenant-local month)
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM conversations
         WHERE tenant_id = $1
           AND (opened_at AT TIME ZONE $2) >= date_trunc('month', (now() AT TIME ZONE $2))`,
        [tenantId, tz]
      ),
      // Conversations that led to bookings this month (tenant-local month)
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM conversations
         WHERE tenant_id = $1
           AND status = 'booked'
           AND (opened_at AT TIME ZONE $2) >= date_trunc('month', (now() AT TIME ZONE $2))`,
        [tenantId, tz]
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
    const tz = await getTenantTimezone(tenantId);
    const rawDays = (request.query as Record<string, string>).days;
    const allowed = [7, 30, 90];
    // Safe: numDays is validated against a fixed allowlist — not user-controlled
    const numDays = allowed.includes(Number(rawDays)) ? Number(rawDays) : 30;

    const rows = await query<{ day: string; total: string }>(
      `SELECT d.day::date::text AS day,
              COALESCE(SUM(a.final_price), 0)::text AS total
       FROM generate_series(
              (now() AT TIME ZONE $2)::date - INTERVAL '${numDays - 1} days',
              (now() AT TIME ZONE $2)::date,
              '1 day'
            ) AS d(day)
       LEFT JOIN appointments a
         ON a.tenant_id = $1
         AND a.completed_at IS NOT NULL
         AND (a.completed_at AT TIME ZONE $2)::date = d.day::date
       GROUP BY d.day
       ORDER BY d.day`,
      [tenantId, tz]
    );

    return reply.status(200).send({
      days: rows.map((r) => ({
        date: r.day,
        total: parseFloat(r.total),
      })),
    });
  });

  /**
   * GET /tenant/kpi/missed-call-recovery
   *
   * Missed call recovery funnel: missed → replied → booked.
   *
   * recovered_conversations = missed calls where the linked conversation
   * received at least one inbound (customer) message after the missed call
   * was recorded. This proves real customer engagement, not just that a
   * conversation record exists.
   *
   * recovered_bookings = subset of recovered_conversations that also led
   * to a non-failed appointment. Requires BOTH inbound reply AND booking.
   * Guarantees: booked <= replied <= missed.
   *
   * Scoped to current calendar month.
   */
  app.get("/kpi/missed-call-recovery", { preHandler: [requireAuth] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string; email: string };
    const tz = await getTenantTimezone(tenantId);

    const rows = await query<{
      missed_total: string;
      recovered_conversations: string;
      recovered_bookings: string;
    }>(
      `SELECT
         COUNT(mc.id)::text AS missed_total,
         COUNT(DISTINCT CASE
           WHEN m.id IS NOT NULL THEN mc.id
         END)::text AS recovered_conversations,
         COUNT(DISTINCT CASE
           WHEN m.id IS NOT NULL AND a.id IS NOT NULL THEN mc.id
         END)::text AS recovered_bookings
       FROM missed_calls mc
       LEFT JOIN messages m
         ON m.conversation_id = mc.conversation_id
         AND m.direction = 'inbound'
         AND m.sent_at >= mc.created_at
       LEFT JOIN appointments a
         ON a.conversation_id = mc.conversation_id
         AND a.booking_state NOT IN ('FAILED', 'CANCELLED')
       WHERE mc.tenant_id = $1
         AND (mc.created_at AT TIME ZONE $2) >= date_trunc('month', (now() AT TIME ZONE $2))`,
      [tenantId, tz]
    );

    const missed = parseInt(rows[0]?.missed_total ?? "0", 10);
    const convs = parseInt(rows[0]?.recovered_conversations ?? "0", 10);
    const bookings = parseInt(rows[0]?.recovered_bookings ?? "0", 10);

    return reply.status(200).send({
      missed_calls_total: missed,
      recovered_conversations: convs,
      recovered_bookings: bookings,
      recovery_rate_pct: missed > 0 ? Math.round((convs / missed) * 100) : 0,
      booking_rate_pct: missed > 0 ? Math.round((bookings / missed) * 100) : 0,
    });
  });

  /**
   * GET /tenant/kpi/response-time
   *
   * Average, median, and p95 AI response time in seconds.
   *
   * One sample per AI reply event. For each AI outbound message this month,
   * finds the earliest real customer inbound message that preceded it
   * (since the previous outbound in that conversation). This ensures a
   * burst of customer messages before one AI reply produces exactly one
   * sample, not one per inbound.
   *
   * AI replies identified by: model_version IS NOT NULL (set only by
   * OpenAI-powered process-sms; NULL for manual sends and system templates).
   *
   * Synthetic inbound messages excluded: body NOT LIKE '[%' (catches
   * [Missed call: ...] log entries — the only synthetic inbound pattern).
   *
   * Scoped to current calendar month.
   */
  app.get("/kpi/response-time", { preHandler: [requireAuth] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string; email: string };
    const tz = await getTenantTimezone(tenantId);

    // For each AI outbound message this month:
    // 1. Find the previous outbound in the same conversation (if any)
    // 2. Find the earliest real inbound after that previous outbound
    // 3. Delta = outbound.sent_at - first_inbound.sent_at
    // One sample per AI reply, not per inbound message.
    const rows = await query<{
      avg_seconds: string | null;
      median_seconds: string | null;
      p95_seconds: string | null;
      sample_size: string;
    }>(
      `WITH pairs AS (
         SELECT EXTRACT(EPOCH FROM (ob.sent_at - first_inb.sent_at)) AS delta
         FROM messages ob
         CROSS JOIN LATERAL (
           SELECT MAX(sent_at) AS sent_at
           FROM messages
           WHERE conversation_id = ob.conversation_id
             AND direction = 'outbound'
             AND sent_at < ob.sent_at
         ) prev_ob
         CROSS JOIN LATERAL (
           SELECT MIN(sent_at) AS sent_at
           FROM messages
           WHERE conversation_id = ob.conversation_id
             AND direction = 'inbound'
             AND body NOT LIKE '[%'
             AND sent_at < ob.sent_at
             AND sent_at > COALESCE(prev_ob.sent_at, '1970-01-01'::timestamptz)
         ) first_inb
         WHERE ob.tenant_id = $1
           AND ob.direction = 'outbound'
           AND ob.model_version IS NOT NULL
           AND (ob.sent_at AT TIME ZONE $2) >= date_trunc('month', (now() AT TIME ZONE $2))
           AND first_inb.sent_at IS NOT NULL
       )
       SELECT
         ROUND(AVG(delta))::text AS avg_seconds,
         ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY delta))::text AS median_seconds,
         ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY delta))::text AS p95_seconds,
         COUNT(*)::text AS sample_size
       FROM pairs
       WHERE delta > 0`,
      [tenantId, tz]
    );

    const avg = rows[0]?.avg_seconds != null ? parseInt(rows[0].avg_seconds, 10) : null;
    const median = rows[0]?.median_seconds != null ? parseInt(rows[0].median_seconds, 10) : null;
    const p95 = rows[0]?.p95_seconds != null ? parseInt(rows[0].p95_seconds, 10) : null;
    const sampleSize = parseInt(rows[0]?.sample_size ?? "0", 10);

    return reply.status(200).send({
      avg_seconds: sampleSize > 0 ? avg : null,
      median_seconds: sampleSize > 0 ? median : null,
      p95_seconds: sampleSize > 0 ? p95 : null,
      sample_size: sampleSize,
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
    const tz = await getTenantTimezone(tenantId);
    const rawDays = (request.query as Record<string, string>).days;
    const allowed = [7, 30, 90];
    // Safe: numDays is validated against a fixed allowlist — not user-controlled
    const numDays = allowed.includes(Number(rawDays)) ? Number(rawDays) : 30;

    const rows = await query<{ day: string; total: string }>(
      `SELECT d.day::date::text AS day,
              COUNT(c.id)::text AS total
       FROM generate_series(
              (now() AT TIME ZONE $2)::date - INTERVAL '${numDays - 1} days',
              (now() AT TIME ZONE $2)::date,
              '1 day'
            ) AS d(day)
       LEFT JOIN conversations c
         ON c.tenant_id = $1
         AND (c.opened_at AT TIME ZONE $2)::date = d.day::date
       GROUP BY d.day
       ORDER BY d.day`,
      [tenantId, tz]
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
    const tz = await getTenantTimezone(tenantId);

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
      // Today's appointments count (tenant-local day, exclude cancelled/failed)
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM appointments
         WHERE tenant_id = $1
           AND (scheduled_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date
           AND booking_state NOT IN ('CANCELLED', 'FAILED')`,
        [tenantId, tz]
      ),
      // This week (tenant-local Monday-relative)
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM appointments
         WHERE tenant_id = $1
           AND (scheduled_at AT TIME ZONE $2) >= date_trunc('week', (now() AT TIME ZONE $2))
           AND (scheduled_at AT TIME ZONE $2) <  date_trunc('week', (now() AT TIME ZONE $2)) + INTERVAL '7 days'
           AND booking_state NOT IN ('CANCELLED', 'FAILED')`,
        [tenantId, tz]
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
      // Upcoming count (tenant-local: future days only)
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM appointments
         WHERE tenant_id = $1
           AND (scheduled_at AT TIME ZONE $2)::date > (now() AT TIME ZONE $2)::date
           AND booking_state NOT IN ('CANCELLED', 'FAILED')`,
        [tenantId, tz]
      ),
      // AI-booked this month (tenant-local month)
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM appointments
         WHERE tenant_id = $1
           AND conversation_id IS NOT NULL
           AND booking_state NOT IN ('FAILED', 'CANCELLED')
           AND (created_at AT TIME ZONE $2) >= date_trunc('month', (now() AT TIME ZONE $2))`,
        [tenantId, tz]
      ),
      // Total valid appointments this month (tenant-local month)
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM appointments
         WHERE tenant_id = $1
           AND booking_state NOT IN ('FAILED', 'CANCELLED')
           AND (created_at AT TIME ZONE $2) >= date_trunc('month', (now() AT TIME ZONE $2))`,
        [tenantId, tz]
      ),
      // Today's appointment rows for card rendering (tenant-local day)
      query(
        `SELECT ${appointmentFields}
         FROM appointments
         WHERE tenant_id = $1
           AND (scheduled_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date
           AND booking_state NOT IN ('CANCELLED', 'FAILED')
         ORDER BY scheduled_at ASC
         LIMIT 20`,
        [tenantId, tz]
      ),
      // Upcoming appointment rows for card rendering (tenant-local: future days)
      query(
        `SELECT ${appointmentFields}
         FROM appointments
         WHERE tenant_id = $1
           AND (scheduled_at AT TIME ZONE $2)::date > (now() AT TIME ZONE $2)::date
           AND booking_state NOT IN ('CANCELLED', 'FAILED')
         ORDER BY scheduled_at ASC
         LIMIT 8`,
        [tenantId, tz]
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
      timezone: tz,
    });
  });
}
