import { FastifyInstance } from "fastify";
import { db } from "../db/client";
import { redis } from "../queues/redis";

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

    const allOk = Object.values(checks).every((v) => v === "ok");

    return reply.status(allOk ? 200 : 503).send({
      status: allOk ? "ok" : "degraded",
      checks,
      version: process.env.npm_package_version ?? "0.1.0",
      env: process.env.NODE_ENV,
    });
  });
}
