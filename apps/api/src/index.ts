import "dotenv/config";
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import formbody from "@fastify/formbody";
import fastifyJwt from "@fastify/jwt";
import fastifyStatic from "@fastify/static";
import { join } from "path";
import { existsSync } from "fs";

import { healthRoute } from "./routes/health";
import { twilioSmsRoute } from "./routes/webhooks/twilio-sms";
import { twilioVoiceRoute } from "./routes/webhooks/twilio-voice";
import { twilioVoiceStatusRoute } from "./routes/webhooks/twilio-voice-status";
import { stripeRoute } from "./routes/webhooks/stripe";
import { provisionNumberRoute } from "./routes/internal/provision-number";
import { adminRoute } from "./routes/internal/admin";
import { projectStatusRoute } from "./routes/internal/project-status";
import { googleAuthRoute } from "./routes/auth/google";
import { loginRoute } from "./routes/auth/login";
import { signupRoute } from "./routes/auth/signup";
import { adminBootstrapRoute } from "./routes/auth/admin-bootstrap";
import { billingCheckoutRoute } from "./routes/billing/checkout";
import { billingPortalRoute } from "./routes/billing/portal";
import { tenantDashboardRoute } from "./routes/tenant/dashboard";
import { tenantKpiRoute } from "./routes/tenant/kpi";
import { tenantSettingsRoute } from "./routes/tenant/settings";
import { calendarTokensRoute } from "./routes/internal/calendar-tokens";
import { bookingIntentRoute } from "./routes/internal/booking-intent";
import { calendarEventRoute } from "./routes/internal/calendar-event";
import { appointmentsRoute } from "./routes/internal/appointments";
import { missedCallSmsRoute } from "./routes/internal/missed-call-sms";
import { processSmsRoute } from "./routes/internal/process-sms";
import { configRoute } from "./routes/internal/config";
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
  // ── Validate required env vars at startup ───────────────────
  // Fail fast: detect missing config before accepting any traffic.
  const requiredEnv: Record<string, string> = {
    JWT_SECRET: "Auth tokens (generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\")",
    DATABASE_URL: "Postgres connection string",
    REDIS_URL: "Redis/BullMQ connection string",
  };
  // Pipeline vars: required in production, warned in development
  const pipelineEnv: Record<string, string> = {
    OPENAI_API_KEY: "AI conversation replies",
    TWILIO_ACCOUNT_SID: "Twilio webhook validation + SMS sending",
    TWILIO_AUTH_TOKEN: "Twilio webhook signature validation",
  };

  const missing: string[] = [];
  for (const [key, desc] of Object.entries(requiredEnv)) {
    if (!process.env[key]) missing.push(`  ${key} — ${desc}`);
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n${missing.join("\n")}`
    );
  }

  const missingPipeline: string[] = [];
  for (const [key, desc] of Object.entries(pipelineEnv)) {
    if (!process.env[key]) missingPipeline.push(`  ${key} — ${desc}`);
  }
  if (missingPipeline.length > 0) {
    const msg = `Missing pipeline environment variables (SMS flow will fail):\n${missingPipeline.join("\n")}`;
    if (process.env.NODE_ENV === "production") {
      throw new Error(msg);
    }
    app.log.warn(msg);
  }

  // ── BullMQ workers ────────────────────────────────────────
  const smsWorker = startSmsInboundWorker();
  const provisionWorker = startProvisionNumberWorker();
  const billingWorker = startBillingEventsWorker();

  // ── Security ──────────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "https:", "'unsafe-inline'"],
        fontSrc: ["'self'", "https:", "data:"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
      },
    },
  });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  // ── JWT auth ──────────────────────────────────────────────
  // JWT_SECRET is validated in the requiredEnv block above — safe to assert.
  await app.register(fastifyJwt, { secret: process.env.JWT_SECRET! });

  // ── Body parsers ──────────────────────────────────────────
  await app.register(formbody);

  // ── Routes ────────────────────────────────────────────────
  await app.register(healthRoute);
  await app.register(twilioSmsRoute, { prefix: "/webhooks/twilio" });
  await app.register(twilioVoiceRoute, { prefix: "/webhooks/twilio" });
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
  await app.register(configRoute, { prefix: "/internal" });
  await app.register(googleAuthRoute, { prefix: "/auth/google" });
  await app.register(loginRoute, { prefix: "/auth" });
  await app.register(signupRoute, { prefix: "/auth" });
  await app.register(adminBootstrapRoute, { prefix: "/auth" });
  await app.register(billingCheckoutRoute, { prefix: "/billing" });
  await app.register(billingPortalRoute, { prefix: "/billing" });
  await app.register(tenantDashboardRoute, { prefix: "/tenant" });
  await app.register(tenantKpiRoute, { prefix: "/tenant" });
  await app.register(tenantSettingsRoute, { prefix: "/tenant" });

  // ── Static frontend (login.html, signup.html, etc.) ───────
  // Served AFTER API routes so API paths are never shadowed.
  // Resolution order:
  //   1. STATIC_DIR env var (explicit override)
  //   2. ../public  — works in Docker (/app/public) and after `npm run build`
  //   3. ../../web  — works during local `tsx watch src/index.ts` (monorepo layout)
  const staticDir = process.env.STATIC_DIR
    ?? (existsSync(join(__dirname, "../public"))
        ? join(__dirname, "../public")
        : join(__dirname, "../../web"));
  await app.register(fastifyStatic, {
    root: staticDir,
    prefix: "/",
    decorateReply: false,
    setHeaders: (res, filePath) => {
      // Prevent caching of all HTML pages so users always see fresh content
      if (typeof filePath === "string" && filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      }
    },
  });

  // ── Graceful shutdown ─────────────────────────────────────
  const SHUTDOWN_TIMEOUT_MS = 30_000;
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, shutting down...`);

      // Force-exit if graceful shutdown hangs
      const forceTimer = setTimeout(() => {
        app.log.error("Graceful shutdown timed out — forcing exit");
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      forceTimer.unref(); // Don't keep process alive just for the timer

      try {
        await app.close();
        await smsWorker.close();
        await provisionWorker.close();
        await billingWorker.close();
        await db.end();
        redis.disconnect();
      } catch (err) {
        app.log.error({ err }, "Error during shutdown");
      }
      clearTimeout(forceTimer);
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
