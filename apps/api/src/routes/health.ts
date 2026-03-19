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
