import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { validateTwilioSignature } from '../../middleware/twilioSignature';
import { query, getPool } from '../../db/client';
import {
  checkAndSetIdempotency,
  incrMsgCounter,
  isQuarantined,
  quarantinePhone,
} from '../../plugins/redis';
import { enqueueJob, QUEUE_NAMES } from '../../plugins/queue';
import {
  CIRCUIT_BREAKER_MSG_COUNT,
} from '@autoshop/shared';

interface TwilioSmsBody {
  MessageSid: string;
  From: string;
  To: string;
  Body: string;
  NumMedia?: string;
}

export async function twilioSmsRoute(app: FastifyInstance) {
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

  app.post<{ Body: TwilioSmsBody }>(
    '/sms',
    { preHandler: validateTwilioSignature },
    async (req: FastifyRequest<{ Body: TwilioSmsBody }>, reply: FastifyReply) => {
      const { MessageSid, From, To, Body } = req.body;

      // 1. Redis idempotency fast-check
      const isNew = await checkAndSetIdempotency(MessageSid);
      if (!isNew) {
        req.log.info({ MessageSid }, 'Duplicate SMS webhook ignored (Redis)');
        return reply.code(204).send();
      }

      // 2. DB idempotency — insert webhook event
      const pool = getPool();
      const client = await pool.connect();
      let alreadyProcessed = false;
      let tenantId: string | null = null;

      try {
        // Lookup tenant by To number
        const tnRows = await client.query<{ tenant_id: string }>(
          `SELECT tenant_id FROM twilio_numbers
           WHERE phone_number = $1 AND status = 'active'`,
          [To]
        );

        if (!tnRows.rows.length) {
          req.log.warn({ To }, 'No tenant found for Twilio number');
          return reply.code(204).send();
        }

        tenantId = tnRows.rows[0].tenant_id;

        // Insert webhook event (idempotency constraint)
        const insertRes = await client.query(
          `INSERT INTO webhook_events (source, event_sid, tenant_id, event_type, payload)
           VALUES ('twilio', $1, $2, 'sms_inbound', $3)
           ON CONFLICT (source, event_sid) DO NOTHING`,
          [MessageSid, tenantId, JSON.stringify(req.body)]
        );

        if (insertRes.rowCount === 0) {
          alreadyProcessed = true;
        }
      } finally {
        client.release();
      }

      if (alreadyProcessed) {
        req.log.info({ MessageSid }, 'Duplicate SMS webhook ignored (DB)');
        return reply.code(204).send();
      }

      // 3. Circuit breaker check
      if (await isQuarantined(tenantId!, From)) {
        req.log.warn({ tenantId, From }, 'Message from quarantined phone ignored');
        return reply.code(204).send();
      }

      const msgCount = await incrMsgCounter(tenantId!, From);
      if (msgCount > CIRCUIT_BREAKER_MSG_COUNT) {
        await quarantinePhone(tenantId!, From);
        req.log.warn({ tenantId, From, msgCount }, 'Phone quarantined: circuit breaker');
        // Insert quarantine record in DB
        await query(
          `INSERT INTO quarantined_phones (tenant_id, phone, reason)
           VALUES ($1, $2, 'circuit_breaker')
           ON CONFLICT (tenant_id, phone) DO UPDATE
             SET quarantined_at = NOW(), expires_at = NOW() + INTERVAL '1 hour'`,
          [tenantId, From]
        );
        return reply.code(204).send();
      }

      // 4. Enqueue for async processing
      await enqueueJob(QUEUE_NAMES.AI_PROCESS, {
        type: 'sms_inbound',
        tenant_id: tenantId!,
        customer_phone: From,
        twilio_number: To,
        message_body: Body,
        message_sid: MessageSid,
      });

      // 5. Mark webhook processed
      await query(
        `UPDATE webhook_events SET processed = TRUE, processed_at = NOW()
         WHERE source = 'twilio' AND event_sid = $1`,
        [MessageSid]
      );

      return reply.code(204).send();
    }
  );
}
