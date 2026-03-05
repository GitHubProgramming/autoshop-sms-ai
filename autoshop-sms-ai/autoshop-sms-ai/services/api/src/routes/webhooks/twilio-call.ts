import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { validateTwilioSignature } from '../../middleware/twilioSignature';
import { getPool, query } from '../../db/client';
import { checkAndSetIdempotency } from '../../plugins/redis';
import { enqueueJob, QUEUE_NAMES } from '../../plugins/queue';

interface TwilioCallBody {
  CallSid: string;
  From: string;
  To: string;
  CallStatus: string;
  Direction?: string;
}

export async function twilioCallRoute(app: FastifyInstance) {
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (req, body, done) => {
      try {
        const parsed = Object.fromEntries(new URLSearchParams(body as string));
        done(null, parsed);
      } catch (e) {
        done(e as Error, undefined);
      }
    }
  );

  app.post<{ Body: TwilioCallBody }>(
    '/call',
    { preHandler: validateTwilioSignature },
    async (req: FastifyRequest<{ Body: TwilioCallBody }>, reply: FastifyReply) => {
      const { CallSid, From, To, CallStatus } = req.body;

      // Only handle missed calls
      const missedStatuses = ['no-answer', 'busy', 'failed'];
      if (!missedStatuses.includes(CallStatus)) {
        // Return TwiML immediately for non-missed calls
        reply.header('Content-Type', 'text/xml');
        return reply.send('<?xml version="1.0"?><Response></Response>');
      }

      // Idempotency check
      const isNew = await checkAndSetIdempotency(CallSid);
      if (!isNew) {
        reply.header('Content-Type', 'text/xml');
        return reply.send('<?xml version="1.0"?><Response></Response>');
      }

      // Lookup tenant
      const pool = getPool();
      const client = await pool.connect();
      let tenantId: string | null = null;

      try {
        const tnRows = await client.query<{ tenant_id: string }>(
          `SELECT tenant_id FROM twilio_numbers
           WHERE phone_number = $1 AND status = 'active'`,
          [To]
        );

        if (!tnRows.rows.length) {
          req.log.warn({ To }, 'No tenant found for call Twilio number');
          reply.header('Content-Type', 'text/xml');
          return reply.send('<?xml version="1.0"?><Response></Response>');
        }

        tenantId = tnRows.rows[0].tenant_id;

        await client.query(
          `INSERT INTO webhook_events (source, event_sid, tenant_id, event_type, payload)
           VALUES ('twilio', $1, $2, 'missed_call', $3)
           ON CONFLICT (source, event_sid) DO NOTHING`,
          [CallSid, tenantId, JSON.stringify(req.body)]
        );
      } finally {
        client.release();
      }

      // Randomize delay: 5–20 seconds (feels human)
      const delayMs = Math.floor(Math.random() * 15000) + 5000;

      await enqueueJob(
        QUEUE_NAMES.AI_PROCESS,
        {
          type: 'missed_call',
          tenant_id: tenantId!,
          caller_phone: From,
          twilio_number: To,
          call_sid: CallSid,
          delay_ms: delayMs,
        },
        { delay: delayMs }
      );

      await query(
        `UPDATE webhook_events SET processed = TRUE, processed_at = NOW()
         WHERE source = 'twilio' AND event_sid = $1`,
        [CallSid]
      );

      // Return TwiML
      reply.header('Content-Type', 'text/xml');
      return reply.send(
        '<?xml version="1.0"?><Response>' +
        '<Say voice="alice">Thank you for calling. We\'ll text you right back.</Say>' +
        '</Response>'
      );
    }
  );
}
