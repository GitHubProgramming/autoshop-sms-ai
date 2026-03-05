import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { initDb } from './db/client';
import { initRedis } from './plugins/redis';
import { twilioSmsRoute } from './routes/webhooks/twilio-sms';
import { twilioCallRoute } from './routes/webhooks/twilio-call';
import { stripeRoute } from './routes/webhooks/stripe';
import { dashboardRoutes } from './routes/dashboard';
import { onboardingRoutes } from './routes/onboarding';

const app = Fastify({ logger: true, bodyLimit: 1048576 });

async function start() {
  // Plugins
  await app.register(cors, { origin: process.env.ALLOWED_ORIGINS?.split(',') || true });
  await app.register(helmet);
  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      // Higher limit for Twilio IPs, lower for everything else
      return req.ip;
    },
  });

  // Init connections
  await initDb();
  await initRedis();

  // Webhook routes — no auth, signature-validated
  await app.register(twilioSmsRoute,  { prefix: '/webhooks/twilio' });
  await app.register(twilioCallRoute, { prefix: '/webhooks/twilio' });
  await app.register(stripeRoute,     { prefix: '/webhooks' });

  // API routes — Clerk JWT required (tenantGuard sets tenant_id)
  await app.register(dashboardRoutes,  { prefix: '/api/dashboard' });
  await app.register(onboardingRoutes, { prefix: '/api/onboarding' });

  // Health check
  app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));

  const port = parseInt(process.env.PORT || '3001');
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`API running on port ${port}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
