import { FastifyInstance } from "fastify";
import * as bcrypt from "bcryptjs";
import { query } from "../../db/client";
import { adminGuard } from "../../middleware/admin-guard";

/**
 * Internal Admin API
 *
 * All routes protected by adminGuard:
 *   - Requires valid JWT (from POST /auth/login)
 *   - Email must be in ADMIN_EMAILS env var allowlist
 *
 * Routes:
 *   GET /internal/admin/overview
 *   GET /internal/admin/tenants
 *   GET /internal/admin/tenants/:id
 *   GET /internal/admin/conversations
 *   GET /internal/admin/conversations/:id
 *   GET /internal/admin/bookings
 *   GET /internal/admin/billing
 *   GET /internal/admin/integrations
 *   GET /internal/admin/errors
 *   GET /internal/admin/signup-attempts
 *   GET /internal/admin/audit
 *   GET /internal/admin/metrics/conversation-health
 */
export async function adminRoute(app: FastifyInstance) {
  // ── GET /internal/admin/metrics/signups ───────────────────────────────────
  app.get("/admin/metrics/signups", { preHandler: [adminGuard] }, async (_req, reply) => {
    const rows = await query(
      `SELECT d::date AS day, COALESCE(c.cnt, 0)::int AS count
       FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') d
       LEFT JOIN (
         SELECT created_at::date AS day, COUNT(*)::int AS cnt
         FROM tenants
         WHERE created_at >= CURRENT_DATE - INTERVAL '29 days'
         GROUP BY created_at::date
       ) c ON c.day = d::date
       ORDER BY d`
    );
    return reply.send({
      labels: (rows as any[]).map(r => r.day.toISOString().slice(0, 10)),
      data: (rows as any[]).map(r => r.count),
    });
  });

  // ── GET /internal/admin/metrics/conversations ──────────────────────────────
  app.get("/admin/metrics/conversations", { preHandler: [adminGuard] }, async (_req, reply) => {
    const rows = await query(
      `SELECT d::date AS day, COALESCE(c.cnt, 0)::int AS count
       FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') d
       LEFT JOIN (
         SELECT opened_at::date AS day, COUNT(*)::int AS cnt
         FROM conversations
         WHERE opened_at >= CURRENT_DATE - INTERVAL '29 days'
         GROUP BY opened_at::date
       ) c ON c.day = d::date
       ORDER BY d`
    );
    return reply.send({
      labels: (rows as any[]).map(r => r.day.toISOString().slice(0, 10)),
      data: (rows as any[]).map(r => r.count),
    });
  });

  // ── GET /internal/admin/metrics/bookings ───────────────────────────────────
  app.get("/admin/metrics/bookings", { preHandler: [adminGuard] }, async (_req, reply) => {
    const rows = await query(
      `SELECT d::date AS day, COALESCE(c.cnt, 0)::int AS count
       FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') d
       LEFT JOIN (
         SELECT created_at::date AS day, COUNT(*)::int AS cnt
         FROM appointments
         WHERE created_at >= CURRENT_DATE - INTERVAL '29 days'
         GROUP BY created_at::date
       ) c ON c.day = d::date
       ORDER BY d`
    );
    return reply.send({
      labels: (rows as any[]).map(r => r.day.toISOString().slice(0, 10)),
      data: (rows as any[]).map(r => r.count),
    });
  });

  // ── GET /internal/admin/overview ────────────────────────────────────────────
  app.get("/admin/overview", { preHandler: [adminGuard] }, async (_req, reply) => {
    const [
      statusCountsRows,
      newSignupsRows,
      signupAttemptsByStatusRows,
      convsTodayRows,
      bookingsTodayRows,
      failedCalendarSyncsRows,
      noTwilioRows,
      noCalendarRows,
      nearExpiryRows,
      highUsageRows,
      recentSignupsRows,
      needsAttentionRows,
      recentBillingEventsRows,
      recentConversationsRows,
    ] = await Promise.all([
      query(`SELECT billing_status, COUNT(*) as count FROM tenants GROUP BY billing_status`),
      query(`SELECT COUNT(*)::int FROM tenants WHERE created_at > NOW() - INTERVAL '7 days'`),
      query(`SELECT status, COUNT(*)::int as count FROM signup_attempts WHERE created_at > NOW() - INTERVAL '7 days' GROUP BY status`),
      query(`SELECT COUNT(*)::int FROM conversations WHERE opened_at >= CURRENT_DATE`),
      query(`SELECT COUNT(*)::int FROM appointments WHERE created_at >= CURRENT_DATE`),
      query(`SELECT COUNT(*)::int FROM appointments WHERE calendar_synced = false AND created_at < NOW() - INTERVAL '1 hour'`),
      query(`SELECT COUNT(*)::int FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM tenant_phone_numbers tpn WHERE tpn.tenant_id = t.id AND tpn.status = 'active')`),
      query(`SELECT COUNT(*)::int FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM tenant_calendar_tokens tct WHERE tct.tenant_id = t.id)`),
      query(`SELECT COUNT(*)::int FROM tenants WHERE billing_status = 'trial' AND trial_ends_at > NOW() AND trial_ends_at <= NOW() + INTERVAL '3 days'`),
      query(`SELECT COUNT(*)::int FROM tenants WHERE conv_limit_this_cycle > 0 AND conv_used_this_cycle::float / conv_limit_this_cycle >= 0.8`),
      query(`SELECT id, shop_name, owner_email, billing_status, plan_id, created_at FROM tenants ORDER BY created_at DESC LIMIT 10`),
      query(`SELECT t.id, t.shop_name, t.owner_email, t.billing_status, t.trial_ends_at,
           t.conv_used_this_cycle, t.conv_limit_this_cycle,
           EXISTS(SELECT 1 FROM tenant_phone_numbers tpn WHERE tpn.tenant_id=t.id AND tpn.status='active') as has_phone,
           EXISTS(SELECT 1 FROM tenant_calendar_tokens tct WHERE tct.tenant_id=t.id) as has_calendar
         FROM tenants t
         WHERE t.billing_status IN ('trial','past_due','past_due_blocked')
            OR (t.billing_status = 'trial' AND t.trial_ends_at <= NOW() + INTERVAL '3 days')
            OR (t.conv_limit_this_cycle > 0 AND t.conv_used_this_cycle::float / t.conv_limit_this_cycle >= 0.8)
         ORDER BY t.created_at DESC LIMIT 20`),
      query(`SELECT be.id, be.tenant_id, t.shop_name, be.event_type, be.processed_at
         FROM billing_events be LEFT JOIN tenants t ON t.id = be.tenant_id
         ORDER BY be.processed_at DESC LIMIT 5`),
      query(`SELECT c.id, c.tenant_id, t.shop_name, c.customer_phone, c.status, c.opened_at, c.turn_count
         FROM conversations c JOIN tenants t ON t.id = c.tenant_id
         ORDER BY c.opened_at DESC LIMIT 5`),
    ]);

    // Build status map
    const statusCounts: Record<string, number> = {};
    let totalAccounts = 0;
    for (const row of statusCountsRows as { billing_status: string; count: string }[]) {
      statusCounts[row.billing_status] = Number(row.count);
      totalAccounts += Number(row.count);
    }

    return reply.status(200).send({
      total_accounts: totalAccounts,
      status_counts: statusCounts,
      new_signups_7d: (newSignupsRows as any[])[0]?.count ?? 0,
      signup_attempts_7d: signupAttemptsByStatusRows,
      conversations_today: (convsTodayRows as any[])[0]?.count ?? 0,
      bookings_today: (bookingsTodayRows as any[])[0]?.count ?? 0,
      failed_calendar_syncs: (failedCalendarSyncsRows as any[])[0]?.count ?? 0,
      no_twilio: (noTwilioRows as any[])[0]?.count ?? 0,
      no_calendar: (noCalendarRows as any[])[0]?.count ?? 0,
      near_expiry: (nearExpiryRows as any[])[0]?.count ?? 0,
      high_usage: (highUsageRows as any[])[0]?.count ?? 0,
      recent_signups: recentSignupsRows,
      needs_attention: needsAttentionRows,
      recent_billing_events: recentBillingEventsRows,
      recent_conversations: recentConversationsRows,
    });
  });

  // ── GET /internal/admin/tenants ─────────────────────────────────────────────
  app.get("/admin/tenants", { preHandler: [adminGuard] }, async (request, reply) => {
    const q = request.query as { status?: string; search?: string; attention?: string };
    const statusFilter = q.status ?? null;
    const searchFilter = q.search ?? null;
    const attentionOnly = q.attention === "1";

    const tenants = await query(
      `SELECT
         t.id,
         t.shop_name,
         t.owner_email,
         t.owner_phone,
         t.billing_status,
         t.plan_id,
         t.trial_started_at,
         t.trial_ends_at,
         t.conv_used_this_cycle,
         t.conv_limit_this_cycle,
         t.created_at,
         EXISTS (
           SELECT 1 FROM tenant_phone_numbers tpn
           WHERE tpn.tenant_id = t.id AND tpn.status = 'active'
         ) AS has_phone,
         EXISTS (
           SELECT 1 FROM tenant_calendar_tokens tct
           WHERE tct.tenant_id = t.id
         ) AS has_calendar,
         COALESCE(
           (SELECT string_agg(DISTINCT u.auth_provider, ',')
            FROM users u WHERE u.tenant_id = t.id),
           'unknown'
         ) AS user_providers,
         (SELECT MAX(c.opened_at) FROM conversations c WHERE c.tenant_id = t.id) AS last_conversation_at,
         (SELECT COUNT(*)::int FROM conversations c WHERE c.tenant_id = t.id) AS total_conversations,
         (SELECT COUNT(*)::int FROM appointments a WHERE a.tenant_id = t.id) AS total_bookings,
         (SELECT COUNT(*)::int FROM appointments a WHERE a.tenant_id = t.id AND a.calendar_synced = false AND a.created_at < NOW() - INTERVAL '1 hour') AS failed_calendar_syncs
       FROM tenants t
       WHERE ($1::text IS NULL OR t.billing_status = $1)
         AND ($2::text IS NULL OR t.shop_name ILIKE '%' || $2 || '%' OR t.owner_email ILIKE '%' || $2 || '%')
         AND (NOT $3 OR (
           (t.billing_status = 'trial' AND t.trial_ends_at <= NOW() + INTERVAL '3 days')
           OR (t.conv_limit_this_cycle > 0 AND t.conv_used_this_cycle::float / t.conv_limit_this_cycle >= 0.8)
           OR t.billing_status IN ('past_due', 'past_due_blocked')
         ))
       ORDER BY t.created_at DESC`,
      [statusFilter, searchFilter, attentionOnly]
    );

    const enriched = tenants.map((t: any) => {
      const trialDaysLeft =
        t.billing_status === "trial"
          ? Math.max(0, Math.ceil((new Date(t.trial_ends_at).getTime() - Date.now()) / 86_400_000))
          : null;
      return {
        ...t,
        trial_days_left: trialDaysLeft,
        onboarding_complete: t.has_phone,
        auth_provider: t.user_providers,
      };
    });

    return reply.status(200).send({ count: enriched.length, tenants: enriched });
  });

  // ── GET /internal/admin/tenants/:id ─────────────────────────────────────────
  app.get("/admin/tenants/:id", { preHandler: [adminGuard] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [
      tenantRows,
      usersRows,
      phoneRows,
      calendarRows,
      conversationRows,
      bookingRows,
      billingEventRows,
      auditRows,
      usageRows,
    ] = await Promise.all([
      query(`SELECT * FROM tenants WHERE id = $1`, [id]),
      query(`SELECT id, email, auth_provider, google_sub, created_at FROM users WHERE tenant_id = $1 ORDER BY created_at DESC`, [id]),
      query(`SELECT * FROM tenant_phone_numbers WHERE tenant_id = $1 ORDER BY provisioned_at DESC`, [id]),
      query(`SELECT id, calendar_id, connected_at, last_refreshed, token_expiry FROM tenant_calendar_tokens WHERE tenant_id = $1`, [id]),
      query(`SELECT id, customer_phone, status, turn_count, opened_at, last_message_at, closed_at, close_reason
         FROM conversations WHERE tenant_id = $1 ORDER BY opened_at DESC LIMIT 20`, [id]),
      query(`SELECT id, customer_phone, customer_name, service_type, scheduled_at, calendar_synced, google_event_id, created_at
         FROM appointments WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 10`, [id]),
      query(`SELECT id, event_type, processed_at, payload FROM billing_events WHERE tenant_id = $1 ORDER BY processed_at DESC LIMIT 20`, [id]),
      query(`SELECT id, event_type, actor, metadata, created_at FROM audit_log WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 20`, [id]),
      query(`SELECT conv_used_this_cycle, conv_limit_this_cycle,
           ROUND(conv_used_this_cycle::numeric / NULLIF(conv_limit_this_cycle,0) * 100, 1) as usage_pct
         FROM tenants WHERE id = $1`, [id]),
    ]);

    if (!(tenantRows as any[]).length) {
      return reply.status(404).send({ error: "Tenant not found" });
    }

    return reply.status(200).send({
      tenant: (tenantRows as any[])[0],
      users: usersRows,
      phone_numbers: phoneRows,
      calendar: calendarRows,
      conversations: conversationRows,
      bookings: bookingRows,
      billing_events: billingEventRows,
      audit_log: auditRows,
      usage_pct: (usageRows as any[])[0]?.usage_pct ?? 0,
    });
  });

  // ── GET /internal/admin/conversations ───────────────────────────────────────
  app.get("/admin/conversations", { preHandler: [adminGuard] }, async (request, reply) => {
    const q = request.query as { status?: string; tenant_id?: string; page?: string };
    const statusFilter = q.status ?? null;
    const tenantIdFilter = q.tenant_id ?? null;
    const page = Math.max(0, parseInt(q.page ?? "0", 10));

    const conversations = await query(
      `SELECT c.id, c.tenant_id, t.shop_name, c.customer_phone, c.status, c.turn_count,
         c.opened_at, c.last_message_at, c.closed_at, c.close_reason,
         EXISTS(SELECT 1 FROM appointments a WHERE a.conversation_id = c.id) as has_booking,
         (SELECT calendar_synced FROM appointments a WHERE a.conversation_id = c.id LIMIT 1) as booking_synced,
         (SELECT COUNT(*)::int FROM messages m WHERE m.conversation_id = c.id) as message_count
       FROM conversations c
       JOIN tenants t ON t.id = c.tenant_id
       WHERE ($1::text IS NULL OR c.status = $1)
         AND ($2::uuid IS NULL OR c.tenant_id = $2)
       ORDER BY c.opened_at DESC
       LIMIT 100 OFFSET $3`,
      [statusFilter, tenantIdFilter, page * 100]
    );

    return reply.status(200).send({ count: (conversations as any[]).length, conversations, page });
  });

  // ── GET /internal/admin/conversations/:id ───────────────────────────────────
  app.get("/admin/conversations/:id", { preHandler: [adminGuard] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [convRows, messagesRows, appointmentRows] = await Promise.all([
      query(`SELECT c.*, t.shop_name FROM conversations c JOIN tenants t ON t.id = c.tenant_id WHERE c.id = $1`, [id]),
      query(`SELECT id, direction, body, sent_at, tokens_used, model_version FROM messages WHERE conversation_id = $1 ORDER BY sent_at ASC`, [id]),
      query(`SELECT * FROM appointments WHERE conversation_id = $1 LIMIT 1`, [id]),
    ]);

    if (!(convRows as any[]).length) {
      return reply.status(404).send({ error: "Conversation not found" });
    }

    return reply.status(200).send({
      conversation: (convRows as any[])[0],
      messages: messagesRows,
      appointment: (appointmentRows as any[])[0] ?? null,
    });
  });

  // ── GET /internal/admin/bookings ────────────────────────────────────────────
  app.get("/admin/bookings", { preHandler: [adminGuard] }, async (request, reply) => {
    const q = request.query as { filter?: string; tenant_id?: string; page?: string };
    const filter = q.filter ?? null;
    const tenantIdFilter = q.tenant_id ?? null;
    const page = Math.max(0, parseInt(q.page ?? "0", 10));

    const bookings = await query(
      `SELECT a.id, a.tenant_id, t.shop_name, a.customer_phone, a.customer_name,
         a.service_type, a.scheduled_at, a.calendar_synced, a.google_event_id, a.created_at,
         a.conversation_id,
         CASE WHEN NOT a.calendar_synced AND a.google_event_id IS NULL THEN 'sync_failed'
              WHEN NOT a.calendar_synced THEN 'pending'
              ELSE 'synced' END as sync_status
       FROM appointments a
       JOIN tenants t ON t.id = a.tenant_id
       WHERE ($1::text IS NULL OR
         CASE WHEN $1 = 'failed'    THEN NOT a.calendar_synced AND a.created_at < NOW() - INTERVAL '1 hour'
              WHEN $1 = 'pending'   THEN NOT a.calendar_synced AND a.created_at >= NOW() - INTERVAL '1 hour'
              WHEN $1 = 'synced'    THEN a.calendar_synced
              WHEN $1 = 'today'     THEN a.scheduled_at::date = CURRENT_DATE
              WHEN $1 = 'upcoming'  THEN a.scheduled_at > NOW()
              ELSE true END
       )
       AND ($2::uuid IS NULL OR a.tenant_id = $2)
       ORDER BY a.created_at DESC
       LIMIT 100 OFFSET $3`,
      [filter, tenantIdFilter, page * 100]
    );

    return reply.status(200).send({ count: (bookings as any[]).length, bookings, page });
  });

  // ── GET /internal/admin/billing ─────────────────────────────────────────────
  app.get("/admin/billing", { preHandler: [adminGuard] }, async (_req, reply) => {
    const billing = await query(
      `SELECT
         t.id, t.shop_name, t.owner_email, t.billing_status, t.plan_id,
         t.trial_started_at, t.trial_ends_at,
         CASE WHEN t.billing_status = 'trial'
           THEN GREATEST(0, CEIL(EXTRACT(EPOCH FROM (t.trial_ends_at - NOW())) / 86400))::int
           ELSE NULL
         END as trial_days_left,
         t.conv_used_this_cycle, t.conv_limit_this_cycle,
         CASE WHEN t.conv_limit_this_cycle > 0
           THEN ROUND(t.conv_used_this_cycle::numeric / t.conv_limit_this_cycle * 100, 1)
           ELSE 0
         END as usage_pct,
         t.stripe_customer_id IS NOT NULL as has_stripe,
         t.stripe_subscription_id IS NOT NULL as has_subscription,
         t.stripe_customer_id,
         t.stripe_subscription_id,
         t.created_at
       FROM tenants t
       ORDER BY
         CASE t.billing_status
           WHEN 'past_due_blocked' THEN 1
           WHEN 'past_due'         THEN 2
           WHEN 'trial_expired'    THEN 3
           WHEN 'trial'            THEN 4
           ELSE 5
         END,
         trial_days_left ASC NULLS LAST,
         usage_pct DESC`
    );

    return reply.status(200).send({ count: (billing as any[]).length, billing });
  });

  // ── GET /internal/admin/integrations ────────────────────────────────────────
  app.get("/admin/integrations", { preHandler: [adminGuard] }, async (_req, reply) => {
    const integrations = await query(
      `SELECT
         t.id, t.shop_name, t.owner_email, t.billing_status,
         tpn.phone_number as twilio_phone,
         tpn.status as twilio_status,
         tpn.provisioned_at as twilio_provisioned_at,
         tct.calendar_id,
         tct.connected_at as calendar_connected_at,
         tct.last_refreshed as calendar_last_refreshed,
         tct.token_expiry as calendar_token_expiry,
         (SELECT COUNT(*)::int FROM appointments a WHERE a.tenant_id = t.id AND NOT a.calendar_synced AND a.created_at < NOW() - INTERVAL '1 hour') as failed_sync_count,
         (SELECT COUNT(*)::int FROM appointments a WHERE a.tenant_id = t.id AND a.calendar_synced) as synced_count,
         (SELECT MAX(opened_at) FROM conversations c WHERE c.tenant_id = t.id) as last_conversation_at,
         (SELECT MAX(created_at) FROM appointments a WHERE a.tenant_id = t.id) as last_booking_at
       FROM tenants t
       LEFT JOIN tenant_phone_numbers tpn ON tpn.tenant_id = t.id AND tpn.status = 'active'
       LEFT JOIN tenant_calendar_tokens tct ON tct.tenant_id = t.id
       ORDER BY t.created_at DESC`
    );

    return reply.status(200).send({ count: (integrations as any[]).length, integrations });
  });

  // ── GET /internal/admin/errors ──────────────────────────────────────────────
  app.get("/admin/errors", { preHandler: [adminGuard] }, async (_req, reply) => {
    const errors = await query(
      `SELECT * FROM (
         SELECT
           'calendar_sync_failed' as error_type,
           'high' as severity,
           a.tenant_id,
           t.shop_name,
           a.created_at as event_time,
           'Booking not synced to Google Calendar after 1 hour: ' || COALESCE(a.service_type, 'unknown service') as summary,
           a.id as reference_id
         FROM appointments a
         JOIN tenants t ON t.id = a.tenant_id
         WHERE NOT a.calendar_synced AND a.created_at < NOW() - INTERVAL '1 hour'

         UNION ALL

         SELECT
           be.event_type as error_type,
           'high' as severity,
           be.tenant_id,
           t.shop_name,
           be.processed_at as event_time,
           be.event_type || ' for tenant ' || COALESCE(t.shop_name, 'unknown') as summary,
           be.id as reference_id
         FROM billing_events be
         LEFT JOIN tenants t ON t.id = be.tenant_id
         WHERE be.event_type ILIKE '%fail%' OR be.event_type ILIKE '%past_due%' OR be.event_type ILIKE '%delinquent%'

         UNION ALL

         SELECT
           'trial_expired' as error_type,
           'medium' as severity,
           t.id as tenant_id,
           t.shop_name,
           t.trial_ends_at as event_time,
           'Trial expired: ' || t.shop_name || ' (' || t.owner_email || ')' as summary,
           t.id as reference_id
         FROM tenants t
         WHERE t.billing_status = 'trial_expired'

         UNION ALL

         SELECT
           'signup_failed' as error_type,
           'low' as severity,
           sa.tenant_id,
           'N/A' as shop_name,
           sa.created_at as event_time,
           'Signup failed for ' || COALESCE(sa.email, 'unknown') || ': ' || COALESCE(sa.failure_reason, 'unknown reason') as summary,
           sa.id as reference_id
         FROM signup_attempts sa
         WHERE sa.status = 'failed'
           AND sa.created_at > NOW() - INTERVAL '7 days'
       ) errors
       ORDER BY event_time DESC
       LIMIT 200`
    );

    return reply.status(200).send({ count: (errors as any[]).length, errors });
  });

  // ── GET /internal/admin/signup-attempts ─────────────────────────────────────
  app.get("/admin/signup-attempts", { preHandler: [adminGuard] }, async (request, reply) => {
    const q = request.query as { status?: string; provider?: string };
    const statusFilter = q.status ?? null;
    const providerFilter = q.provider ?? null;

    const attempts = await query(
      `SELECT
         id, email, provider, status, failure_reason,
         tenant_id, ip_address, created_at, completed_at,
         CASE WHEN completed_at IS NOT NULL
           THEN ROUND(EXTRACT(EPOCH FROM (completed_at - created_at)))
           ELSE NULL
         END AS duration_seconds
       FROM signup_attempts
       WHERE ($1::text IS NULL OR status   = $1)
         AND ($2::text IS NULL OR provider = $2)
       ORDER BY created_at DESC
       LIMIT 500`,
      [statusFilter, providerFilter]
    );

    return reply.status(200).send({ count: (attempts as any[]).length, attempts });
  });

  // ── GET /internal/admin/audit ───────────────────────────────────────────────
  app.get("/admin/audit", { preHandler: [adminGuard] }, async (request, reply) => {
    const q = request.query as { tenant_id?: string; source?: string };
    const tenantIdFilter = q.tenant_id ?? null;
    const sourceFilter = q.source ?? null;

    const events = await query(
      `SELECT * FROM (
         SELECT
           'billing' as source,
           be.id::text,
           be.tenant_id,
           t.shop_name,
           be.event_type,
           'system' as actor,
           be.processed_at as created_at,
           NULL::text as summary
         FROM billing_events be
         LEFT JOIN tenants t ON t.id = be.tenant_id
         WHERE ($1::uuid IS NULL OR be.tenant_id = $1)

         UNION ALL

         SELECT
           'signup' as source,
           sa.id::text,
           sa.tenant_id,
           COALESCE(t.shop_name, 'N/A') as shop_name,
           'signup_' || sa.status as event_type,
           sa.provider as actor,
           sa.created_at,
           COALESCE(sa.email, 'unknown') as summary
         FROM signup_attempts sa
         LEFT JOIN tenants t ON t.id = sa.tenant_id
         WHERE ($1::uuid IS NULL OR sa.tenant_id = $1)

         UNION ALL

         SELECT
           'audit' as source,
           al.id::text,
           al.tenant_id,
           t.shop_name,
           al.event_type,
           al.actor,
           al.created_at,
           al.metadata::text as summary
         FROM audit_log al
         LEFT JOIN tenants t ON t.id = al.tenant_id
         WHERE ($1::uuid IS NULL OR al.tenant_id = $1)
       ) feed
       WHERE ($2::text IS NULL OR source = $2)
       ORDER BY created_at DESC
       LIMIT 200`,
      [tenantIdFilter, sourceFilter]
    );

    return reply.status(200).send({ count: (events as any[]).length, events });
  });

  // ── GET /internal/admin/metrics/conversation-health ────────────────────────
  app.get("/admin/metrics/conversation-health", { preHandler: [adminGuard] }, async (request, reply) => {
    const q = request.query as { days?: string; tenant_id?: string };
    const parsed = parseInt(q.days ?? "30", 10);
    const days = Math.min(Math.max(Number.isNaN(parsed) ? 30 : parsed, 1), 365);
    const tenantFilter = q.tenant_id ?? null;

    const [
      summaryRows,
      closeReasonRows,
      dailyRows,
      bookingConversionRows,
    ] = await Promise.all([
      // Overall metrics for the period
      query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status IN ('closed','booked','expired'))::int AS completed,
           COUNT(*) FILTER (WHERE status = 'open')::int AS still_open,
           ROUND(AVG(turn_count)::numeric, 1)::float AS avg_turns,
           ROUND(AVG(CASE WHEN closed_at IS NOT NULL
             THEN EXTRACT(EPOCH FROM (closed_at - opened_at)) / 60
             ELSE NULL END)::numeric, 1)::float AS avg_duration_minutes
         FROM conversations
         WHERE opened_at >= NOW() - ($1 || ' days')::interval
           AND ($2::uuid IS NULL OR tenant_id = $2)`,
        [days.toString(), tenantFilter]
      ),

      // Close reason breakdown
      query(
        `SELECT
           COALESCE(close_reason, 'still_open') AS reason,
           COUNT(*)::int AS count
         FROM conversations
         WHERE opened_at >= NOW() - ($1 || ' days')::interval
           AND ($2::uuid IS NULL OR tenant_id = $2)
         GROUP BY COALESCE(close_reason, 'still_open')
         ORDER BY count DESC`,
        [days.toString(), tenantFilter]
      ),

      // Daily conversation volume + booking rate
      query(
        `SELECT
           d::date AS day,
           COALESCE(c.opened, 0)::int AS opened,
           COALESCE(c.closed, 0)::int AS closed,
           COALESCE(c.booked, 0)::int AS booked
         FROM generate_series(
           CURRENT_DATE - ($1 || ' days')::interval,
           CURRENT_DATE,
           '1 day'
         ) d
         LEFT JOIN (
           SELECT
             opened_at::date AS day,
             COUNT(*)::int AS opened,
             COUNT(*) FILTER (WHERE status IN ('closed','booked','expired'))::int AS closed,
             COUNT(*) FILTER (WHERE status = 'booked')::int AS booked
           FROM conversations
           WHERE opened_at >= CURRENT_DATE - ($1 || ' days')::interval
             AND ($2::uuid IS NULL OR tenant_id = $2)
           GROUP BY opened_at::date
         ) c ON c.day = d::date
         ORDER BY d`,
        [days.toString(), tenantFilter]
      ),

      // Booking conversion: conversations that resulted in an appointment
      query(
        `SELECT
           COUNT(DISTINCT c.id)::int AS conversations_with_booking,
           COUNT(DISTINCT c.id) FILTER (WHERE a.calendar_synced)::int AS synced_to_calendar
         FROM conversations c
         JOIN appointments a ON a.conversation_id = c.id
         WHERE c.opened_at >= NOW() - ($1 || ' days')::interval
           AND ($2::uuid IS NULL OR c.tenant_id = $2)`,
        [days.toString(), tenantFilter]
      ),
    ]);

    const summary = (summaryRows as any[])[0] ?? {
      total: 0, completed: 0, still_open: 0, avg_turns: 0, avg_duration_minutes: null,
    };
    const conversion = (bookingConversionRows as any[])[0] ?? {
      conversations_with_booking: 0, synced_to_calendar: 0,
    };

    const completionRate = summary.total > 0
      ? Math.round((summary.completed / summary.total) * 1000) / 10
      : 0;
    const bookingRate = summary.total > 0
      ? Math.round((conversion.conversations_with_booking / summary.total) * 1000) / 10
      : 0;

    // Build close_reason_breakdown as an object
    const closeReasonBreakdown: Record<string, number> = {};
    for (const row of closeReasonRows as { reason: string; count: number }[]) {
      closeReasonBreakdown[row.reason] = row.count;
    }

    return reply.status(200).send({
      period_days: days,
      tenant_id: tenantFilter,
      summary: {
        total_conversations: summary.total,
        completed: summary.completed,
        still_open: summary.still_open,
        completion_rate_pct: completionRate,
        avg_turns: summary.avg_turns ?? 0,
        avg_duration_minutes: summary.avg_duration_minutes,
        booking_rate_pct: bookingRate,
        conversations_with_booking: conversion.conversations_with_booking,
        bookings_synced_to_calendar: conversion.synced_to_calendar,
      },
      close_reason_breakdown: closeReasonBreakdown,
      daily: (dailyRows as any[]).map((r: any) => ({
        day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : r.day,
        opened: r.opened,
        closed: r.closed,
        booked: r.booked,
      })),
    });
  });
}
