import { FastifyInstance } from "fastify";
import { query } from "../../db/client";
import { requireAuth } from "../../middleware/require-auth";

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
      missedCallRows,
      capturedCallRows,
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
      // AI-booked appointments this month (have conversation_id, exclude FAILED)
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM appointments
         WHERE tenant_id = $1
           AND conversation_id IS NOT NULL
           AND booking_state NOT IN ('FAILED')
           AND created_at >= date_trunc('month', CURRENT_DATE)`,
        [tenantId]
      ),
      // Appointments today
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM appointments
         WHERE tenant_id = $1
           AND scheduled_at >= CURRENT_DATE
           AND scheduled_at < CURRENT_DATE + INTERVAL '1 day'`,
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
      // Total missed calls this month (conversations originated from missed calls)
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM conversations
         WHERE tenant_id = $1
           AND opened_at >= date_trunc('month', CURRENT_DATE)`,
        [tenantId]
      ),
      // Captured missed calls (conversations that led to bookings)
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

    const missedTotal = parseInt(missedCallRows[0]?.count ?? "0", 10);
    const captured = parseInt(capturedCallRows[0]?.count ?? "0", 10);
    const captureRate = missedTotal > 0 ? Math.round((captured / missedTotal) * 1000) / 10 : 0;

    return reply.status(200).send({
      recovered_revenue: parseFloat(recoveredRows[0]?.total ?? "0"),
      recovered_bookings: parseInt(recoveredRows[0]?.count ?? "0", 10),
      total_revenue: parseFloat(totalRevRows[0]?.total ?? "0"),
      total_completed_bookings: parseInt(totalRevRows[0]?.count ?? "0", 10),
      ai_booked_this_month: parseInt(apptMonthRows[0]?.count ?? "0", 10),
      appointments_today: parseInt(apptTodayRows[0]?.count ?? "0", 10),
      active_conversations: parseInt(activeConvRows[0]?.count ?? "0", 10),
      conversations_this_month: parseInt(convsMonthRows[0]?.count ?? "0", 10),
      missed_calls_total: missedTotal,
      missed_calls_captured: captured,
      capture_rate_pct: captureRate,
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
      total_spent: string;
      created_at: string;
    }>(
      `SELECT
         MIN(a.id)::text AS id,
         MAX(a.customer_name) AS name,
         a.customer_phone AS phone,
         NULL::text AS email,
         MAX(a.completed_at)::text AS last_visit,
         COUNT(a.id)::text AS appointments_count,
         COALESCE(SUM(a.final_price) FILTER (WHERE a.completed_at IS NOT NULL), 0)::text AS total_spent,
         MIN(a.created_at)::text AS created_at
       FROM appointments a
       WHERE a.tenant_id = $1
       GROUP BY a.customer_phone
       ORDER BY MAX(a.completed_at) DESC NULLS LAST, MIN(a.created_at) DESC
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
        total_spent: parseFloat(r.total_spent),
        created_at: r.created_at,
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

    if (typeof final_price !== "number" || final_price < 0) {
      return reply.status(400).send({ error: "final_price must be a non-negative number" });
    }

    const rows = await query<{ id: string }>(
      `UPDATE appointments
       SET final_price = $1,
           completed_at = NOW()
       WHERE id = $2 AND tenant_id = $3
       RETURNING id`,
      [final_price, id, tenantId]
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: "Appointment not found" });
    }

    return reply.status(200).send({ id: rows[0].id, status: "completed", final_price });
  });
}
