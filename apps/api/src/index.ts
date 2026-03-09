import "dotenv/config";
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import formbody from "@fastify/formbody";
import fastifyJwt from "@fastify/jwt";

import { healthRoute } from "./routes/health";
import { twilioSmsRoute } from "./routes/webhooks/twilio-sms";
import { twilioVoiceStatusRoute } from "./routes/webhooks/twilio-voice-status";
import { stripeRoute } from "./routes/webhooks/stripe";
import { provisionNumberRoute } from "./routes/internal/provision-number";
import { googleAuthRoute } from "./routes/auth/google";
import { loginRoute } from "./routes/auth/login";
import { signupRoute } from "./routes/auth/signup";
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
  await app.register(helmet);
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  // ── JWT auth ──────────────────────────────────────────────
  if (!process.env.JWT_SECRET) {
    throw new Error(
      "JWT_SECRET env var is required. " +
      "Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  await app.register(fastifyJwt, { secret: process.env.JWT_SECRET });

  // ── Body parsers ──────────────────────────────────────────
  await app.register(formbody);

  // ── Routes ────────────────────────────────────────────────
  await app.register(healthRoute);
  await app.register(twilioSmsRoute, { prefix: "/webhooks/twilio" });
  await app.register(twilioVoiceStatusRoute, { prefix: "/webhooks/twilio" });
  await app.register(stripeRoute, { prefix: "/webhooks" });
  await app.register(provisionNumberRoute, { prefix: "/internal" });
  await app.register(googleAuthRoute, { prefix: "/auth/google" });
  await app.register(loginRoute, { prefix: "/auth" });
  await app.register(signupRoute, { prefix: "/auth" });
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
