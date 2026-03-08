import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import formbody from "@fastify/formbody";

import { healthRoute } from "./routes/health";
import { twilioSmsRoute } from "./routes/webhooks/twilio-sms";
import { twilioVoiceStatusRoute } from "./routes/webhooks/twilio-voice-status";
import { stripeRoute } from "./routes/webhooks/stripe";
import { provisionNumberRoute } from "./routes/internal/provision-number";
import { googleAuthRoute } from "./routes/auth/google";
import { billingCheckoutRoute } from "./routes/billing/checkout";
import { db } from "./db/client";
import { redis } from "./queues/redis";
import { startSmsInboundWorker } from "./workers/sms-inbound.worker";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    transport:
      process.env.NODE_ENV === "development"
        ? { target: "pino-pretty" }
        : undefined,
  },
});

async function bootstrap() {
  // ── BullMQ workers ────────────────────────────────────────
  const smsWorker = startSmsInboundWorker();

  // ── Security ──────────────────────────────────────────────
  // CORS: restrict to explicit allowlist; set CORS_ORIGINS=https://yourdomain.com in production
  const allowedOrigins = (process.env.CORS_ORIGINS ?? "").split(",").filter(Boolean);
  await app.register(cors, {
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Internal-Key"],
    credentials: true,
  });
  await app.register(helmet);
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    // TODO: per-tenant rate limiting via Redis
  });

  // ── Body parsers ──────────────────────────────────────────
  // formbody: needed for Twilio webhooks (application/x-www-form-urlencoded)
  await app.register(formbody);

  // ── Routes ────────────────────────────────────────────────
  await app.register(healthRoute);
  await app.register(twilioSmsRoute, { prefix: "/webhooks/twilio" });
  await app.register(twilioVoiceStatusRoute, { prefix: "/webhooks/twilio" });
  await app.register(stripeRoute, { prefix: "/webhooks" });
  await app.register(provisionNumberRoute, { prefix: "/internal" });
  await app.register(googleAuthRoute, { prefix: "/auth/google" });
  await app.register(billingCheckoutRoute, { prefix: "/billing" });

  // ── Graceful shutdown ─────────────────────────────────────
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, shutting down...`);
      await app.close();
      await smsWorker.close();
      await db.end();
      redis.disconnect();
      process.exit(0);
    });
  }

  // ── Start ─────────────────────────────────────────────────
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`AutoShop API running on port ${port}`);
}

bootstrap().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
