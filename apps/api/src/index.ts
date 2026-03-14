import "dotenv/config";
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import formbody from "@fastify/formbody";
import fastifyJwt from "@fastify/jwt";
import fastifyStatic from "@fastify/static";
import { join } from "path";

import { healthRoute } from "./routes/health";
import { twilioSmsRoute } from "./routes/webhooks/twilio-sms";
import { twilioVoiceStatusRoute } from "./routes/webhooks/twilio-voice-status";
import { stripeRoute } from "./routes/webhooks/stripe";
import { provisionNumberRoute } from "./routes/internal/provision-number";
import { adminRoute } from "./routes/internal/admin";
import { projectStatusRoute } from "./routes/internal/project-status";
import { googleAuthRoute } from "./routes/auth/google";
import { loginRoute } from "./routes/auth/login";
import { signupRoute } from "./routes/auth/signup";
import { billingCheckoutRoute } from "./routes/billing/checkout";
import { billingPortalRoute } from "./routes/billing/portal";
import { tenantDashboardRoute } from "./routes/tenant/dashboard";
import { calendarTokensRoute } from "./routes/internal/calendar-tokens";
import { bookingIntentRoute } from "./routes/internal/booking-intent";
import { calendarEventRoute } from "./routes/internal/calendar-event";
import { appointmentsRoute } from "./routes/internal/appointments";
import { missedCallSmsRoute } from "./routes/internal/missed-call-sms";
import { processSmsRoute } from "./routes/internal/process-sms";
import { db } from "./db/client";
import { redis } from "./queues/redis";
import { startSmsInboundWorker } from "./workers/sms-inbound.worker";
import { startProvisionNumberWorker } from "./workers/provision-number.worker";
import { startBillingEventsWorker } from "./workers/billing-events.worker";

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
  const provisionWorker = startProvisionNumberWorker();
  const billingWorker = startBillingEventsWorker();

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
  await app.register(adminRoute, { prefix: "/internal" });
  await app.register(projectStatusRoute, { prefix: "/internal" });
  await app.register(calendarTokensRoute, { prefix: "/internal" });
  await app.register(bookingIntentRoute, { prefix: "/internal" });
  await app.register(calendarEventRoute, { prefix: "/internal" });
  await app.register(appointmentsRoute, { prefix: "/internal" });
  await app.register(missedCallSmsRoute, { prefix: "/internal" });
  await app.register(processSmsRoute, { prefix: "/internal" });
  await app.register(googleAuthRoute, { prefix: "/auth/google" });
  await app.register(loginRoute, { prefix: "/auth" });
  await app.register(signupRoute, { prefix: "/auth" });
  await app.register(billingCheckoutRoute, { prefix: "/billing" });
  await app.register(billingPortalRoute, { prefix: "/billing" });
  await app.register(tenantDashboardRoute, { prefix: "/tenant" });

  // ── Static frontend (login.html, signup.html, etc.) ───────
  // Served AFTER API routes so API paths are never shadowed.
  // STATIC_DIR is set in the Docker image (Dockerfile copies apps/web/ → /app/public/).
  // Falls back to ../public relative to dist/index.js, which also resolves
  // to /app/public inside the container.
  const staticDir = process.env.STATIC_DIR ?? join(__dirname, "../public");
  await app.register(fastifyStatic, {
    root: staticDir,
    prefix: "/",
    decorateReply: false,
  });

  // ── Graceful shutdown ─────────────────────────────────────
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, shutting down...`);
      await app.close();
      await smsWorker.close();
      await provisionWorker.close();
      await billingWorker.close();
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
