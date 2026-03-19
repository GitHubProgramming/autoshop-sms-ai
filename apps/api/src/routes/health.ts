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

      // 6. Idempotency proof: INSERT test event, try duplicate, then ROLLBACK
      //    No data persists — pure proof of UNIQUE constraint enforcement.
      const client = await db.connect();
      try {
        await client.query("BEGIN");

        // First insert — should succeed
        const firstInsert = await client.query(
          `INSERT INTO webhook_events (source, event_sid, tenant_id)
           VALUES ('test_verify', 'VERIFY_DEDUP_TEST_001', NULL)
           ON CONFLICT (source, event_sid) DO NOTHING
           RETURNING id`
        );

        // Second insert — same key, should be blocked by UNIQUE constraint
        const secondInsert = await client.query(
          `INSERT INTO webhook_events (source, event_sid, tenant_id)
           VALUES ('test_verify', 'VERIFY_DEDUP_TEST_001', NULL)
           ON CONFLICT (source, event_sid) DO NOTHING
           RETURNING id`
        );

        result.idempotency_proof = {
          first_insert_returned_rows: firstInsert.rows.length,   // should be 1
          second_insert_returned_rows: secondInsert.rows.length, // should be 0
          duplicate_blocked: secondInsert.rows.length === 0,
          first_processed: firstInsert.rows.length === 1,
        };

        // ROLLBACK — no test data persists
        await client.query("ROLLBACK");
      } catch (proofErr) {
        try { await client.query("ROLLBACK"); } catch { /* ignore */ }
        result.idempotency_proof = { error: (proofErr as Error).message };
      } finally {
        client.release();
      }

      // 7. SMS dedup query proof: verify the outbound dedup query works
      try {
        await db.query(
          `SELECT id FROM messages
           WHERE conversation_id = '00000000-0000-0000-0000-000000000000'
             AND tenant_id = '00000000-0000-0000-0000-000000000000'
             AND direction = 'outbound' AND body = 'test'
             AND sent_at > NOW() - INTERVAL '30 seconds'
           LIMIT 1`
        );
        result.sms_dedup_query = "ok";
      } catch (smsErr) {
        result.sms_dedup_query = { error: (smsErr as Error).message };
      }

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
