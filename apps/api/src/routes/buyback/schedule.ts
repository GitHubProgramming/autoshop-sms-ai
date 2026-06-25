import { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../../db/client";
import { requireBbAuth } from "../../middleware/require-bb-auth";
import { generateDailyFromTemplate, updateStreakForDate } from "../../services/buyback";

const EntrySchema = z.object({
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
  category: z.enum(["deep_work", "people", "admin", "protected"]),
  label: z.string().min(1),
  notes: z.string().optional(),
});

export async function bbScheduleRoute(app: FastifyInstance) {
  app.get("/schedule", { preHandler: [requireBbAuth] }, async (request) => {
    const { userId } = request.user as { userId: string };
    const { date } = request.query as { date?: string };

    const targetDate = date || new Date().toISOString().slice(0, 10);
    const entries = await generateDailyFromTemplate(userId, targetDate);
    return { date: targetDate, entries };
  });

  app.post("/schedule/entries", { preHandler: [requireBbAuth] }, async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const parsed = EntrySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }

    const { entry_date, start_time, end_time, category, label, notes } = parsed.data;
    const rows = await query(
      `INSERT INTO daily_schedule_entries
         (user_id, entry_date, start_time, end_time, category, label, source, notes)
       VALUES ($1, $2, $3, $4, $5, $6, 'manual', $7)
       RETURNING *`,
      [userId, entry_date, start_time, end_time, category, label, notes || null]
    ) as any[];

    return reply.status(201).send(rows[0]);
  });

  app.patch("/schedule/entries/:id/complete", { preHandler: [requireBbAuth] }, async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const { id } = request.params as { id: string };

    const rows = await query(
      `UPDATE daily_schedule_entries
       SET completed = NOT completed,
           completed_at = CASE WHEN NOT completed THEN NOW() ELSE NULL END
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, userId]
    ) as any[];

    if (rows.length === 0) return reply.status(404).send({ error: "Entry not found." });

    await updateStreakForDate(userId, rows[0].entry_date instanceof Date
      ? rows[0].entry_date.toISOString().slice(0, 10)
      : String(rows[0].entry_date));

    return rows[0];
  });

  app.delete("/schedule/entries/:id", { preHandler: [requireBbAuth] }, async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const { id } = request.params as { id: string };

    const rows = await query(
      `DELETE FROM daily_schedule_entries WHERE id = $1 AND user_id = $2 RETURNING id, entry_date`,
      [id, userId]
    ) as any[];

    if (rows.length === 0) return reply.status(404).send({ error: "Entry not found." });
    return { deleted: true };
  });
}
