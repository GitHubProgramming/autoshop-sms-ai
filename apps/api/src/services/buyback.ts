import { query } from "../db/client";

export async function generateDailyFromTemplate(
  userId: string,
  date: string
): Promise<any[]> {
  const dow = new Date(date).getDay();
  const mondayBased = dow === 0 ? 6 : dow - 1;

  const existing = await query(
    `SELECT id FROM daily_schedule_entries WHERE user_id = $1 AND entry_date = $2 LIMIT 1`,
    [userId, date]
  );
  if ((existing as any[]).length > 0) {
    return query(
      `SELECT * FROM daily_schedule_entries WHERE user_id = $1 AND entry_date = $2 ORDER BY start_time`,
      [userId, date]
    ) as Promise<any[]>;
  }

  const blocks = await query(
    `SELECT * FROM perfect_week_blocks WHERE user_id = $1 AND day_of_week = $2 ORDER BY start_time`,
    [userId, mondayBased]
  ) as any[];

  if (blocks.length === 0) return [];

  for (const block of blocks) {
    await query(
      `INSERT INTO daily_schedule_entries
         (user_id, entry_date, start_time, end_time, category, label, source, pw_block_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'template', $7)`,
      [userId, date, block.start_time, block.end_time, block.category, block.label, block.id]
    );
  }

  return query(
    `SELECT * FROM daily_schedule_entries WHERE user_id = $1 AND entry_date = $2 ORDER BY start_time`,
    [userId, date]
  ) as Promise<any[]>;
}

export async function updateStreakForDate(
  userId: string,
  date: string
): Promise<void> {
  const rows = await query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE completed)::int AS done
     FROM daily_schedule_entries
     WHERE user_id = $1 AND entry_date = $2`,
    [userId, date]
  ) as any[];

  const { total, done } = rows[0];
  if (total === 0) return;

  const pct = Math.round((done / total) * 10000) / 100;

  await query(
    `INSERT INTO buyback_streaks (user_id, streak_date, total_blocks, completed_blocks, adherence_pct)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, streak_date)
     DO UPDATE SET total_blocks = $3, completed_blocks = $4, adherence_pct = $5`,
    [userId, date, total, done, pct]
  );
}

export async function calculateStreak(
  userId: string
): Promise<{ current: number; longest: number; totalDays: number }> {
  const rows = await query(
    `SELECT streak_date, adherence_pct
     FROM buyback_streaks
     WHERE user_id = $1
     ORDER BY streak_date DESC`,
    [userId]
  ) as any[];

  if (rows.length === 0) return { current: 0, longest: 0, totalDays: 0 };

  let current = 0;
  let longest = 0;
  let streak = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < rows.length; i++) {
    const pct = parseFloat(rows[i].adherence_pct);
    if (pct >= 80) {
      streak++;
      if (i === 0) {
        const dateStr = rows[i].streak_date instanceof Date
          ? rows[i].streak_date.toISOString().slice(0, 10)
          : String(rows[i].streak_date);
        const diffDays = Math.floor(
          (new Date(today).getTime() - new Date(dateStr).getTime()) / 86400000
        );
        if (diffDays <= 1) current = streak;
      }
    } else {
      if (streak > longest) longest = streak;
      streak = 0;
    }
  }
  if (streak > longest) longest = streak;
  if (current === 0 && streak > 0) {
    const firstDate = rows[0].streak_date instanceof Date
      ? rows[0].streak_date.toISOString().slice(0, 10)
      : String(rows[0].streak_date);
    const diffDays = Math.floor(
      (new Date(today).getTime() - new Date(firstDate).getTime()) / 86400000
    );
    if (diffDays <= 1) current = streak;
  }

  return { current, longest, totalDays: rows.length };
}

export async function getWeeklyAnalytics(
  userId: string,
  weekStart: string
): Promise<{
  byCategory: Record<string, number>;
  byQuadrant: Record<string, number>;
  adherence: number;
  totalBlocks: number;
  completedBlocks: number;
}> {
  const rows = await query(
    `SELECT category, completed,
            EXTRACT(EPOCH FROM (end_time - start_time)) / 3600.0 AS hours
     FROM daily_schedule_entries
     WHERE user_id = $1
       AND entry_date >= $2::date
       AND entry_date < $2::date + INTERVAL '7 days'
     ORDER BY entry_date, start_time`,
    [userId, weekStart]
  ) as any[];

  const byCategory: Record<string, number> = {
    deep_work: 0, people: 0, admin: 0, protected: 0,
  };
  let totalBlocks = 0;
  let completedBlocks = 0;

  for (const row of rows) {
    const hrs = parseFloat(row.hours) || 0;
    byCategory[row.category] = (byCategory[row.category] || 0) + hrs;
    totalBlocks++;
    if (row.completed) completedBlocks++;
  }

  const adherence = totalBlocks > 0
    ? Math.round((completedBlocks / totalBlocks) * 10000) / 100
    : 0;

  const dripRows = await query(
    `SELECT quadrant, SUM(est_hours_week) AS hours
     FROM drip_tasks
     WHERE user_id = $1
     GROUP BY quadrant`,
    [userId]
  ) as any[];

  const byQuadrant: Record<string, number> = {
    delegation: 0, replacement: 0, investment: 0, production: 0,
  };
  for (const row of dripRows) {
    byQuadrant[row.quadrant] = parseFloat(row.hours) || 0;
  }

  return { byCategory, byQuadrant, adherence, totalBlocks, completedBlocks };
}
