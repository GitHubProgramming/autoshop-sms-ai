import { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../../db/client";
import { requireBbAuth } from "../../middleware/require-bb-auth";

const AuditEntrySchema = z.object({
  audit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time_slot: z.string().regex(/^\d{2}:\d{2}$/),
  activity: z.string().min(1),
  value_rating: z.number().int().min(1).max(4),
  energy_level: z.enum(["energizing", "neutral", "draining"]),
  quadrant: z.enum(["delegation", "replacement", "investment", "production"]).optional(),
});

export async function bbAuditRoute(app: FastifyInstance) {
  app.get("/audit", { preHandler: [requireBbAuth] }, async (request) => {
    const { userId } = request.user as { userId: string };
    const { date } = request.query as { date?: string };
    const targetDate = date || new Date().toISOString().slice(0, 10);

    const rows = await query(
      `SELECT * FROM time_audit_entries WHERE user_id = $1 AND audit_date = $2 ORDER BY time_slot`,
      [userId, targetDate]
    );
    return { date: targetDate, entries: rows };
  });

  app.post("/audit/entries", { preHandler: [requireBbAuth] }, async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const parsed = AuditEntrySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }

    const d = parsed.data;
    const rows = await query(
      `INSERT INTO time_audit_entries
         (user_id, audit_date, time_slot, activity, value_rating, energy_level, quadrant)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [userId, d.audit_date, d.time_slot, d.activity, d.value_rating, d.energy_level, d.quadrant || null]
    ) as any[];

    return reply.status(201).send(rows[0]);
  });

  app.put("/audit/entries/:id", { preHandler: [requireBbAuth] }, async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const { id } = request.params as { id: string };
    const parsed = AuditEntrySchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }

    const d = parsed.data;
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (d.activity !== undefined) { sets.push(`activity = $${idx++}`); vals.push(d.activity); }
    if (d.value_rating !== undefined) { sets.push(`value_rating = $${idx++}`); vals.push(d.value_rating); }
    if (d.energy_level !== undefined) { sets.push(`energy_level = $${idx++}`); vals.push(d.energy_level); }
    if (d.quadrant !== undefined) { sets.push(`quadrant = $${idx++}`); vals.push(d.quadrant); }

    if (sets.length === 0) return reply.status(400).send({ error: "No fields to update." });

    vals.push(id, userId);
    const rows = await query(
      `UPDATE time_audit_entries SET ${sets.join(", ")}
       WHERE id = $${idx} AND user_id = $${idx + 1}
       RETURNING *`,
      vals
    ) as any[];

    if (rows.length === 0) return reply.status(404).send({ error: "Entry not found." });
    return rows[0];
  });

  app.get("/audit/summary", { preHandler: [requireBbAuth] }, async (request) => {
    const { userId } = request.user as { userId: string };
    const { start, end } = request.query as { start?: string; end?: string };

    const startDate = start || new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const endDate = end || new Date().toISOString().slice(0, 10);

    const byValue = await query(
      `SELECT value_rating, COUNT(*)::int AS count,
              COUNT(*) * 0.25 AS hours
       FROM time_audit_entries
       WHERE user_id = $1 AND audit_date BETWEEN $2 AND $3
       GROUP BY value_rating ORDER BY value_rating`,
      [userId, startDate, endDate]
    );

    const byEnergy = await query(
      `SELECT energy_level, COUNT(*)::int AS count,
              COUNT(*) * 0.25 AS hours
       FROM time_audit_entries
       WHERE user_id = $1 AND audit_date BETWEEN $2 AND $3
       GROUP BY energy_level`,
      [userId, startDate, endDate]
    );

    const byQuadrant = await query(
      `SELECT COALESCE(quadrant, 'uncategorized') AS quadrant,
              COUNT(*)::int AS count,
              COUNT(*) * 0.25 AS hours
       FROM time_audit_entries
       WHERE user_id = $1 AND audit_date BETWEEN $2 AND $3
       GROUP BY quadrant`,
      [userId, startDate, endDate]
    );

    const totalRows = await query(
      `SELECT COUNT(*)::int AS total_entries,
              COUNT(DISTINCT audit_date)::int AS days_tracked
       FROM time_audit_entries
       WHERE user_id = $1 AND audit_date BETWEEN $2 AND $3`,
      [userId, startDate, endDate]
    ) as any[];

    return {
      period: { start: startDate, end: endDate },
      totalEntries: totalRows[0].total_entries,
      daysTracked: totalRows[0].days_tracked,
      totalHours: totalRows[0].total_entries * 0.25,
      byValue,
      byEnergy,
      byQuadrant,
    };
  });
}
