import { FastifyInstance } from "fastify";
import { db } from "../db/client";
import { redis } from "../queues/redis";

/** Env vars required for the SMS pipeline to function */
const PIPELINE_ENV_VARS = [
  "OPENAI_API_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
] as const;

export async function healthRoute(app: FastifyInstance) {
  // ── Temporary diagnostic endpoint for production verification ──────────
  // Proves migration 024 was applied and webhook_events table is active.
  // Safe: read-only, no auth bypass, no side effects.
  app.get("/health/db-verify", async (_request, reply) => {
    const result: Record<string, unknown> = {};
    try {
      // 1. Check _migrations for 024
      const migrations = await db.query(
        "SELECT name, applied_at FROM _migrations WHERE name LIKE '%024%' ORDER BY name"
      );
      result.migration_024 = migrations.rows;

      // 2. Check webhook_events table exists and has the unique constraint
      const tableCheck = await db.query(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_name = 'webhook_events' ORDER BY ordinal_position`
      );
      result.webhook_events_columns = tableCheck.rows;

      // 3. Check unique constraint
      const constraintCheck = await db.query(
        `SELECT constraint_name, constraint_type FROM information_schema.table_constraints
         WHERE table_name = 'webhook_events' AND constraint_type IN ('UNIQUE', 'PRIMARY KEY')`
      );
      result.webhook_events_constraints = constraintCheck.rows;

      // 4. Row count (how many webhook events have been recorded)
      const countCheck = await db.query(
        "SELECT source, COUNT(*)::int as count FROM webhook_events GROUP BY source"
      );
      result.webhook_events_counts = countCheck.rows;

      // 5. Total migrations applied
      const totalMigrations = await db.query("SELECT COUNT(*)::int as total FROM _migrations");
      result.total_migrations = totalMigrations.rows[0]?.total;

      result.status = "verified";
    } catch (err) {
      result.status = "error";
      result.error = (err as Error).message;
    }
    return reply.send(result);
  });

  app.get("/health", async (_request, reply) => {
    const checks: Record<string, string> = {};

    // Postgres
    try {
      await db.query("SELECT 1");
      checks.postgres = "ok";
    } catch {
      checks.postgres = "error";
    }

    // Redis
    try {
      await redis.ping();
      checks.redis = "ok";
    } catch {
      checks.redis = "error";
    }

    // Pipeline env vars — degraded if missing (service runs but pipeline fails)
    const missingPipeline = PIPELINE_ENV_VARS.filter((k) => !process.env[k]);
    checks.pipeline_env = missingPipeline.length === 0 ? "ok" : "missing";

    const coreOk = checks.postgres === "ok" && checks.redis === "ok";
    const allOk = coreOk && checks.pipeline_env === "ok";

    return reply.status(coreOk ? 200 : 503).send({
      status: allOk ? "ok" : coreOk ? "degraded" : "unhealthy",
      checks,
      ...(missingPipeline.length > 0 && { missing_pipeline_env: missingPipeline }),
      version: process.env.npm_package_version ?? "0.1.0",
      env: process.env.NODE_ENV,
      commit: process.env.RENDER_GIT_COMMIT ?? "unknown",
    });
  });
}
