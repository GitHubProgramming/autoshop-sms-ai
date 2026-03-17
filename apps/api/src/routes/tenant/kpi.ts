import { FastifyInstance } from "fastify";
import { query } from "../../db/client";
import { requireAuth } from "../../middleware/require-auth";

/**
 * Tenant KPI endpoints — all values come from real data only.
 * No hardcoded values, no demo fallbacks, no fake percentages.
 * If no data exists, returns 0.
 */
export async function tenantKpiRoute(app: FastifyInstance) {
  /**
   * GET /tenant/kpi/recovered-revenue
   *
   * Revenue from AI/SMS-recovery bookings completed in the last 30 days.
   * Uses ONLY final_price from completed bookings.
   */
  app.get("/kpi/recovered-revenue", { preHandler: [requireAuth] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string; email: string };

    const rows = await query<{ total: string; count: string }>(
      `SELECT
         COALESCE(SUM(final_price), 0)::text AS total,
         COUNT(*)::text AS count
       FROM bookings
       WHERE tenant_id = $1
         AND booking_status = 'completed'
         AND booking_source IN ('ai', 'sms_recovery')
         AND completed_at >= NOW() - INTERVAL '30 days'`,
      [tenantId]
    );

    // Previous 30-day window for comparison
    const prevRows = await query<{ total: string }>(
      `SELECT COALESCE(SUM(final_price), 0)::text AS total
       FROM bookings
       WHERE tenant_id = $1
         AND booking_status = 'completed'
         AND booking_source IN ('ai', 'sms_recovery')
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
   * Total revenue from ALL completed bookings in the last 30 days.
   * Uses ONLY final_price from completed bookings.
   */
  app.get("/kpi/total-revenue", { preHandler: [requireAuth] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string; email: string };

    const rows = await query<{ total: string; count: string }>(
      `SELECT
         COALESCE(SUM(final_price), 0)::text AS total,
         COUNT(*)::text AS count
       FROM bookings
       WHERE tenant_id = $1
         AND booking_status = 'completed'
         AND completed_at >= NOW() - INTERVAL '30 days'`,
      [tenantId]
    );

    const prevRows = await query<{ total: string }>(
      `SELECT COALESCE(SUM(final_price), 0)::text AS total
       FROM bookings
       WHERE tenant_id = $1
         AND booking_status = 'completed'
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
    ] = await Promise.all([
      // Recovered revenue (AI + SMS recovery, last 30d)
      query<{ total: string; count: string }>(
        `SELECT COALESCE(SUM(final_price), 0)::text AS total, COUNT(*)::text AS count
         FROM bookings
         WHERE tenant_id = $1
           AND booking_status = 'completed'
           AND booking_source IN ('ai', 'sms_recovery')
           AND completed_at >= NOW() - INTERVAL '30 days'`,
        [tenantId]
      ),
      // Total revenue (all sources, last 30d)
      query<{ total: string }>(
        `SELECT COALESCE(SUM(final_price), 0)::text AS total
         FROM bookings
         WHERE tenant_id = $1
           AND booking_status = 'completed'
           AND completed_at >= NOW() - INTERVAL '30 days'`,
        [tenantId]
      ),
      // AI-booked appointments this month
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM bookings
         WHERE tenant_id = $1
           AND booking_source IN ('ai', 'sms_recovery')
           AND created_at >= date_trunc('month', CURRENT_DATE)`,
        [tenantId]
      ),
      // Appointments today
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM bookings
         WHERE tenant_id = $1
           AND created_at >= CURRENT_DATE`,
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
    ]);

    const missedTotal = parseInt(missedCallRows[0]?.count ?? "0", 10);
    const captured = parseInt(capturedCallRows[0]?.count ?? "0", 10);
    const captureRate = missedTotal > 0 ? Math.round((captured / missedTotal) * 1000) / 10 : 0;

    return reply.status(200).send({
      recovered_revenue: parseFloat(recoveredRows[0]?.total ?? "0"),
      recovered_bookings: parseInt(recoveredRows[0]?.count ?? "0", 10),
      total_revenue: parseFloat(totalRevRows[0]?.total ?? "0"),
      ai_booked_this_month: parseInt(apptMonthRows[0]?.count ?? "0", 10),
      appointments_today: parseInt(apptTodayRows[0]?.count ?? "0", 10),
      active_conversations: parseInt(activeConvRows[0]?.count ?? "0", 10),
      conversations_this_month: parseInt(convsMonthRows[0]?.count ?? "0", 10),
      missed_calls_total: missedTotal,
      missed_calls_captured: captured,
      capture_rate_pct: captureRate,
    });
  });

  /**
   * GET /tenant/customers/list
   *
   * Real customer list with aggregated stats from bookings.
   * No fake data. Empty array if no customers.
   */
  app.get("/customers/list", { preHandler: [requireAuth] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string; email: string };

    const rows = await query<{
      id: string;
      name: string;
      phone: string;
      email: string | null;
      last_visit: string | null;
      appointments_count: string;
      total_spent: string;
      created_at: string;
    }>(
      `SELECT
         c.id,
         c.name,
         c.phone,
         c.email,
         MAX(b.completed_at)::text AS last_visit,
         COUNT(b.id)::text AS appointments_count,
         COALESCE(SUM(b.final_price) FILTER (WHERE b.booking_status = 'completed'), 0)::text AS total_spent,
         c.created_at::text
       FROM customers c
       LEFT JOIN bookings b ON b.customer_id = c.id AND b.tenant_id = c.tenant_id
       WHERE c.tenant_id = $1
       GROUP BY c.id, c.name, c.phone, c.email, c.created_at
       ORDER BY MAX(b.completed_at) DESC NULLS LAST, c.created_at DESC
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
   * PATCH /tenant/bookings/:id/complete
   *
   * Mark a booking as completed with final_price.
   * This is how revenue enters the system.
   */
  app.patch("/bookings/:id/complete", { preHandler: [requireAuth] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string; email: string };
    const { id } = request.params as { id: string };
    const { final_price } = request.body as { final_price: number };

    if (typeof final_price !== "number" || final_price < 0) {
      return reply.status(400).send({ error: "final_price must be a non-negative number" });
    }

    const rows = await query<{ id: string }>(
      `UPDATE bookings
       SET booking_status = 'completed',
           final_price = $1,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3
       RETURNING id`,
      [final_price, id, tenantId]
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: "Booking not found" });
    }

    return reply.status(200).send({ id: rows[0].id, status: "completed", final_price });
  });
}
