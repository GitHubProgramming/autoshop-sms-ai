import { FastifyInstance } from "fastify";
import { requireBbAuth } from "../../middleware/require-bb-auth";
import { calculateStreak, getWeeklyAnalytics } from "../../services/buyback";
import { query } from "../../db/client";

export async function bbAnalyticsRoute(app: FastifyInstance) {
  app.get("/analytics/weekly", { preHandler: [requireBbAuth] }, async (request) => {
    const { userId } = request.user as { userId: string };
    const { date } = request.query as { date?: string };

    const d = date ? new Date(date) : new Date();
    const day = d.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(d);
    monday.setDate(d.getDate() + mondayOffset);
    const weekStart = monday.toISOString().slice(0, 10);

    return getWeeklyAnalytics(userId, weekStart);
  });

  app.get("/analytics/streak", { preHandler: [requireBbAuth] }, async (request) => {
    const { userId } = request.user as { userId: string };
    return calculateStreak(userId);
  });

  app.get("/analytics/adherence", { preHandler: [requireBbAuth] }, async (request) => {
    const { userId } = request.user as { userId: string };
    const { days } = request.query as { days?: string };
    const numDays = parseInt(days || "30", 10);

    const rows = await query(
      `SELECT streak_date, adherence_pct, total_blocks, completed_blocks
       FROM buyback_streaks
       WHERE user_id = $1
         AND streak_date >= CURRENT_DATE - $2::int
       ORDER BY streak_date`,
      [userId, numDays]
    );
    return rows;
  });

  app.get("/analytics/drip-distribution", { preHandler: [requireBbAuth] }, async (request) => {
    const { userId } = request.user as { userId: string };

    const rows = await query(
      `SELECT quadrant,
              COUNT(*)::int AS task_count,
              COALESCE(SUM(est_hours_week), 0)::float AS total_hours,
              COUNT(*) FILTER (WHERE is_delegated)::int AS delegated_count
       FROM drip_tasks
       WHERE user_id = $1
       GROUP BY quadrant`,
      [userId]
    );
    return rows;
  });
}
