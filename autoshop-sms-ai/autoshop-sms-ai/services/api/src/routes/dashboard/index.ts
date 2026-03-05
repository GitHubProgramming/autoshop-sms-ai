import { FastifyInstance, FastifyRequest } from 'fastify';
import { tenantGuard } from '../../middleware/tenantGuard';
import { tenantQuery, query } from '../../db/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export async function dashboardRoutes(app: FastifyInstance) {
  // All dashboard routes require tenant auth
  app.addHook('preHandler', tenantGuard);

  // ── GET /api/dashboard/health ─────────────────────────────
  app.get('/health', async (req: FastifyRequest) => {
    const { tenantId } = req;

    const [tenantRows, twilioRows, gcalRows, usageRows] = await Promise.all([
      query<{
        billing_state: string; trial_ends_at: string;
        monthly_limit: number; plan_id: string | null;
      }>(
        'SELECT billing_state, trial_ends_at, monthly_limit, plan_id FROM tenants WHERE id = $1',
        [tenantId]
      ),
      query<{ status: string }>(
        `SELECT status FROM twilio_numbers WHERE tenant_id = $1`, [tenantId]
      ),
      query<{ sync_status: string; last_error: string | null }>(
        `SELECT sync_status, last_error FROM google_calendar_integrations WHERE tenant_id = $1`,
        [tenantId]
      ),
      query<{ conversations_count: number }>(
        `SELECT conversations_count FROM usage_records
         WHERE tenant_id = $1 AND period_start = date_trunc('month', NOW())`,
        [tenantId]
      ),
    ]);

    const tenant = tenantRows[0];
    const twilio = twilioRows[0];
    const gcal = gcalRows[0];
    const usage = usageRows[0];

    const used = usage?.conversations_count ?? 0;
    const limit = tenant.monthly_limit;

    let trialDaysLeft: number | null = null;
    if (tenant.billing_state === 'trial') {
      const diff = dayjs(tenant.trial_ends_at).diff(dayjs(), 'day');
      trialDaysLeft = Math.max(0, diff);
    }

    return {
      twilio_connected: twilio?.status === 'active',
      calendar_connected: gcal?.sync_status === 'connected',
      calendar_last_error: gcal?.last_error ?? null,
      billing_state: tenant.billing_state,
      conversations_used: used,
      conversations_limit: limit,
      conversations_remaining: Math.max(0, limit - used),
      trial_days_left: trialDaysLeft,
      plan: tenant.plan_id ?? 'trial',
    };
  });

  // ── GET /api/dashboard/kpis ───────────────────────────────
  app.get('/kpis', async (req: FastifyRequest) => {
    const { tenantId } = req;

    const [usageRows, apptRows, responseRows] = await Promise.all([
      tenantQuery<{ conversations_count: number; monthly_limit: number }>(
        tenantId,
        `SELECT ur.conversations_count, t.monthly_limit
         FROM usage_records ur
         JOIN tenants t ON t.id = ur.tenant_id
         WHERE ur.tenant_id = $1 AND ur.period_start = date_trunc('month', NOW())`,
        [tenantId]
      ),
      tenantQuery<{ count: string }>(
        tenantId,
        `SELECT COUNT(*) as count FROM appointments
         WHERE tenant_id = $1 AND created_at >= date_trunc('month', NOW())`,
        [tenantId]
      ),
      tenantQuery<{ avg_seconds: number | null }>(
        tenantId,
        `SELECT AVG(EXTRACT(EPOCH FROM (m.created_at - c.opened_at))) as avg_seconds
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE m.tenant_id = $1
           AND m.direction = 'outbound'
           AND c.trigger_type = 'missed_call'
           AND m.created_at >= date_trunc('month', NOW())`,
        [tenantId]
      ),
    ]);

    const usage = usageRows[0];
    const used = usage?.conversations_count ?? 0;
    const limit = usage?.monthly_limit ?? 50;

    return {
      conversations_this_month: used,
      limit,
      pct_used: limit > 0 ? Math.round((used / limit) * 100) : 0,
      appointments_booked: parseInt(apptRows[0]?.count ?? '0'),
      avg_response_time_s: responseRows[0]?.avg_seconds
        ? Math.round(responseRows[0].avg_seconds) : null,
    };
  });

  // ── GET /api/dashboard/conversations ─────────────────────
  app.get<{ Querystring: { status?: string; page?: string; limit?: string } }>(
    '/conversations',
    async (req: FastifyRequest<{ Querystring: { status?: string; page?: string; limit?: string } }>) => {
      const { tenantId } = req;
      const page = parseInt(req.query.page ?? '1');
      const limit = Math.min(parseInt(req.query.limit ?? '20'), 50);
      const offset = (page - 1) * limit;
      const status = req.query.status;

      const params: unknown[] = [tenantId, limit, offset];
      const statusClause = status ? `AND c.status = $${params.length + 1}` : '';
      if (status) params.push(status);

      const rows = await tenantQuery<{
        id: string; customer_phone: string; status: string;
        trigger_type: string; turn_count: number;
        opened_at: string; last_activity_at: string; last_message: string | null;
      }>(
        tenantId,
        `SELECT c.id, c.customer_phone, c.status, c.trigger_type,
                c.turn_count, c.opened_at, c.last_activity_at,
                (SELECT body FROM messages WHERE conversation_id = c.id
                 ORDER BY created_at DESC LIMIT 1) as last_message
         FROM conversations c
         WHERE c.tenant_id = $1 ${statusClause}
         ORDER BY c.last_activity_at DESC
         LIMIT $2 OFFSET $3`,
        params
      );

      return rows.map(r => ({
        id: r.id,
        customer_phone: r.customer_phone,
        status: r.status,
        trigger_type: r.trigger_type,
        turn_count: r.turn_count,
        opened_at: r.opened_at,
        last_activity_at: r.last_activity_at,
        last_message_preview: r.last_message
          ? r.last_message.slice(0, 80) : null,
      }));
    }
  );

  // ── GET /api/dashboard/conversations/:id ─────────────────
  app.get<{ Params: { id: string } }>(
    '/conversations/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>) => {
      const { tenantId } = req;
      const { id } = req.params;

      const convRows = await tenantQuery<{
        id: string; customer_phone: string; status: string;
        trigger_type: string; turn_count: number;
        opened_at: string; last_activity_at: string; appointment_id: string | null;
      }>(
        tenantId,
        `SELECT id, customer_phone, status, trigger_type, turn_count,
                opened_at, last_activity_at, appointment_id
         FROM conversations
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id]
      );

      if (!convRows.length) return { error: 'Not found' };

      const conv = convRows[0];

      const [messages, apptRows] = await Promise.all([
        tenantQuery<{ id: string; direction: string; body: string; created_at: string }>(
          tenantId,
          `SELECT id, direction, body, created_at FROM messages
           WHERE conversation_id = $1 ORDER BY created_at ASC`,
          [id]
        ),
        conv.appointment_id
          ? tenantQuery<{
              id: string; customer_name: string | null; customer_phone: string;
              service_type: string | null; scheduled_at: string; sync_status: string;
            }>(
              tenantId,
              `SELECT id, customer_name, customer_phone, service_type,
                      scheduled_at, sync_status
               FROM appointments WHERE id = $1`,
              [conv.appointment_id]
            )
          : Promise.resolve([]),
      ]);

      return { ...conv, messages, appointment: apptRows[0] ?? null };
    }
  );

  // ── GET /api/dashboard/appointments ──────────────────────
  app.get<{ Querystring: { upcoming?: string; from?: string; to?: string } }>(
    '/appointments',
    async (req: FastifyRequest<{ Querystring: { upcoming?: string; from?: string; to?: string } }>) => {
      const { tenantId } = req;
      const params: unknown[] = [tenantId];
      let dateClause = '';

      if (req.query.upcoming === 'true') {
        dateClause = `AND scheduled_at >= NOW()`;
      } else if (req.query.from && req.query.to) {
        params.push(req.query.from, req.query.to);
        dateClause = `AND scheduled_at BETWEEN $2 AND $3`;
      }

      return tenantQuery(
        tenantId,
        `SELECT id, customer_name, customer_phone, service_type,
                scheduled_at, duration_mins, sync_status, sync_error
         FROM appointments
         WHERE tenant_id = $1 ${dateClause}
         ORDER BY scheduled_at ASC
         LIMIT 100`,
        params
      );
    }
  );

  // ── GET /api/dashboard/usage ──────────────────────────────
  app.get('/usage', async (req: FastifyRequest) => {
    const { tenantId } = req;
    return tenantQuery(
      tenantId,
      `SELECT period_start, period_end, conversations_count,
              warning_80_sent, warning_100_sent
       FROM usage_records
       WHERE tenant_id = $1
       ORDER BY period_start DESC
       LIMIT 6`,
      [tenantId]
    );
  });
}
