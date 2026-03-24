import { FastifyInstance } from "fastify";
import * as bcrypt from "bcryptjs";
import { z } from "zod";
import { query } from "../../db/client";
import { adminGuard } from "../../middleware/admin-guard";
import { fetchTwilioNumberConfig, verifyWebhookUrls } from "../../services/twilio-verify";
import { getConfig } from "../../db/app-config";
import { getRecentTraces, getTraceById } from "../../services/pipeline-trace";
import { getAlerts, acknowledgeAlert, countUnacknowledgedAlerts } from "../../services/pipeline-alerts";

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
 *   GET /internal/admin/tenants/:id/health
 *   GET /internal/admin/verification/webhook-events
 *   GET /internal/admin/verification/duplicate-evidence
 *   GET /internal/admin/verification/booking-dedup
 *   GET /internal/admin/verification/sms-dedup
 */
export async function adminRoute(app: FastifyInstance) {
  // ── No-cache headers for all admin responses ──────────────────────────────
  app.addHook("onSend", async (_request, reply) => {
    reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
    reply.header("Pragma", "no-cache");
    reply.header("Expires", "0");
  });

  // ── GET /internal/admin/check — lightweight admin probe (no DB queries) ───
  app.get("/admin/check", { preHandler: [adminGuard] }, async (_req, reply) => {
    return reply.status(200).send({ admin: true });
  });

  // ── GET /internal/admin/metrics/signups ───────────────────────────────────
  app.get("/admin/metrics/signups", { preHandler: [adminGuard] }, async (_req, reply) => {
    const rows = await query(
      `SELECT d::date AS day, COALESCE(c.cnt, 0)::int AS count
       FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') d
       LEFT JOIN (
         SELECT created_at::date AS day, COUNT(*)::int AS cnt
         FROM tenants
         WHERE created_at >= CURRENT_DATE - INTERVAL '29 days'
           AND is_test = FALSE
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
         FROM conversations c
         JOIN tenants t ON t.id = c.tenant_id AND t.is_test = FALSE
         WHERE c.opened_at >= CURRENT_DATE - INTERVAL '29 days'
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
         SELECT a.created_at::date AS day, COUNT(*)::int AS cnt
         FROM appointments a
         JOIN tenants t ON t.id = a.tenant_id AND t.is_test = FALSE
         WHERE a.created_at >= CURRENT_DATE - INTERVAL '29 days'
         GROUP BY a.created_at::date
       ) c ON c.day = d::date
       ORDER BY d`
    );
    return reply.send({
      labels: (rows as any[]).map(r => r.day.toISOString().slice(0, 10)),
      data: (rows as any[]).map(r => r.count),
    });
  });

  // ── Plan pricing for MRR calculation ──
  const PLAN_PRICES: Record<string, number> = {
    plan_starter: 149,
    plan_pro: 299,
    plan_enterprise: 499,
  };
  const DEFAULT_PLAN_PRICE = 149; // Fallback for unknown plans

  // Cost-per-unit estimates (USD)
  const OPENAI_COST_PER_1K_TOKENS = 0.003; // GPT-4o-mini avg input+output blend
  const TWILIO_SMS_COST_PER_SEGMENT = 0.0079;

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
      pendingManualRows,
      failedBookingsRows,
      unackedAlertsRows,
      // ── New KPI queries ──
      convs30dRows,
      bookings30dRows,
      syncedBookings30dRows,
      pipelineFailures24hRows,
      lastCriticalAlertRows,
      failedBookings24hRows,
      failedSyncs24hRows,
      revenueTenantsRows,
      tokenCost30dRows,
      smsCost30dRows,
      tokenCostTodayRows,
      smsCostTodayRows,
      missedCalls30dRows,
      revenueAtRiskRows,
    ] = await Promise.all([
      query(`SELECT billing_status, COUNT(*) as count FROM tenants WHERE is_test = FALSE AND billing_status != 'demo' GROUP BY billing_status`),
      query(`SELECT COUNT(*)::int FROM tenants WHERE created_at > NOW() - INTERVAL '7 days' AND is_test = FALSE AND billing_status != 'demo'`),
      query(`SELECT status, COUNT(*)::int as count FROM signup_attempts WHERE created_at > NOW() - INTERVAL '7 days' GROUP BY status`),
      query(`SELECT COUNT(*)::int FROM conversations c JOIN tenants t ON t.id = c.tenant_id AND t.is_test = FALSE WHERE c.opened_at >= CURRENT_DATE`),
      query(`SELECT COUNT(*)::int FROM appointments a JOIN tenants t ON t.id = a.tenant_id AND t.is_test = FALSE WHERE a.created_at >= CURRENT_DATE`),
      query(`SELECT COUNT(*)::int FROM appointments a JOIN tenants t ON t.id = a.tenant_id AND t.is_test = FALSE WHERE a.calendar_synced = false AND a.created_at < NOW() - INTERVAL '1 hour' AND a.booking_state NOT IN ('CONFIRMED_MANUAL', 'RESOLVED')`),
      query(`SELECT COUNT(*)::int FROM tenants t WHERE t.is_test = FALSE AND t.billing_status != 'demo' AND NOT EXISTS (SELECT 1 FROM tenant_phone_numbers tpn WHERE tpn.tenant_id = t.id AND tpn.status = 'active')`),
      query(`SELECT COUNT(*)::int FROM tenants t WHERE t.is_test = FALSE AND t.billing_status != 'demo' AND NOT EXISTS (SELECT 1 FROM tenant_calendar_tokens tct WHERE tct.tenant_id = t.id)`),
      query(`SELECT COUNT(*)::int FROM tenants WHERE is_test = FALSE AND billing_status = 'trial' AND trial_ends_at > NOW() AND trial_ends_at <= NOW() + INTERVAL '3 days'`),
      query(`SELECT COUNT(*)::int FROM tenants WHERE is_test = FALSE AND conv_limit_this_cycle > 0 AND conv_used_this_cycle::float / conv_limit_this_cycle >= 0.8`),
      query(`SELECT id, shop_name, owner_email, billing_status, plan_id, created_at FROM tenants WHERE is_test = FALSE ORDER BY created_at DESC LIMIT 10`),
      query(`SELECT t.id, t.shop_name, t.owner_email, t.billing_status, t.trial_ends_at,
           t.conv_used_this_cycle, t.conv_limit_this_cycle,
           EXISTS(SELECT 1 FROM tenant_phone_numbers tpn WHERE tpn.tenant_id=t.id AND tpn.status='active') as has_phone,
           EXISTS(SELECT 1 FROM tenant_calendar_tokens tct WHERE tct.tenant_id=t.id) as has_calendar
         FROM tenants t
         WHERE t.is_test = FALSE
           AND (t.billing_status IN ('trial','past_due','past_due_blocked')
            OR (t.billing_status = 'trial' AND t.trial_ends_at <= NOW() + INTERVAL '3 days')
            OR (t.conv_limit_this_cycle > 0 AND t.conv_used_this_cycle::float / t.conv_limit_this_cycle >= 0.8))
         ORDER BY t.created_at DESC LIMIT 20`),
      query(`SELECT be.id, be.tenant_id, t.shop_name, be.event_type, be.processed_at
         FROM billing_events be LEFT JOIN tenants t ON t.id = be.tenant_id
         WHERE t.is_test = FALSE OR t.id IS NULL
         ORDER BY be.processed_at DESC LIMIT 5`),
      query(`SELECT c.id, c.tenant_id, t.shop_name, c.customer_phone, c.status, c.opened_at, c.turn_count
         FROM conversations c JOIN tenants t ON t.id = c.tenant_id
         WHERE t.is_test = FALSE
         ORDER BY c.opened_at DESC LIMIT 5`),
      query(`SELECT COUNT(*)::int FROM appointments a JOIN tenants t ON t.id = a.tenant_id AND t.is_test = FALSE WHERE a.booking_state = 'PENDING_MANUAL_CONFIRMATION'`),
      query(`SELECT COUNT(*)::int FROM appointments a JOIN tenants t ON t.id = a.tenant_id AND t.is_test = FALSE WHERE a.booking_state = 'FAILED'`),
      query(`SELECT COUNT(*)::int FROM pipeline_alerts WHERE acknowledged = FALSE`),
      // ── Funnel: 30d conversations ──
      query(`SELECT COUNT(*)::int FROM conversations c
         JOIN tenants t ON t.id = c.tenant_id AND t.is_test = FALSE
         WHERE c.opened_at > NOW() - INTERVAL '30 days'`),
      // ── Funnel: 30d bookings ──
      query(`SELECT COUNT(*)::int FROM appointments a
         JOIN tenants t ON t.id = a.tenant_id AND t.is_test = FALSE
         WHERE a.created_at > NOW() - INTERVAL '30 days'`),
      // ── Funnel: 30d synced bookings ──
      query(`SELECT COUNT(*)::int FROM appointments a
         JOIN tenants t ON t.id = a.tenant_id AND t.is_test = FALSE
         WHERE a.created_at > NOW() - INTERVAL '30 days' AND a.calendar_synced = true`),
      // ── System health: pipeline failures 24h ──
      query(`SELECT COUNT(*)::int FROM pipeline_traces
         WHERE status = 'failed' AND started_at > NOW() - INTERVAL '24 hours'`),
      // ── System health: last critical alert ──
      query(`SELECT created_at, summary FROM pipeline_alerts
         ORDER BY created_at DESC LIMIT 1`),
      // ── System health: failed bookings 24h ──
      query(`SELECT COUNT(*)::int FROM appointments a
         JOIN tenants t ON t.id = a.tenant_id AND t.is_test = FALSE
         WHERE a.booking_state = 'FAILED' AND a.created_at > NOW() - INTERVAL '24 hours'`),
      // ── System health: failed calendar syncs 24h ──
      query(`SELECT COUNT(*)::int FROM appointments a
         JOIN tenants t ON t.id = a.tenant_id AND t.is_test = FALSE
         WHERE a.calendar_synced = false AND a.created_at > NOW() - INTERVAL '24 hours'
         AND a.booking_state NOT IN ('CONFIRMED_MANUAL', 'RESOLVED')`),
      // ── Revenue: active tenants with plan (includes scheduled_cancel — still paying) ──
      query(`SELECT plan_id, billing_status, COUNT(*)::int as count,
           COALESCE(SUM(subscription_amount_cents), 0)::bigint as total_amount_cents
         FROM tenants
         WHERE is_test = FALSE AND billing_status IN ('active', 'scheduled_cancel')
         GROUP BY plan_id, billing_status`),
      // ── Cost: AI tokens 30d ──
      query(`SELECT COALESCE(SUM(m.tokens_used), 0)::bigint as total_tokens
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         JOIN tenants t ON t.id = c.tenant_id AND t.is_test = FALSE
         WHERE m.sent_at > NOW() - INTERVAL '30 days'`),
      // ── Cost: SMS segments 30d (real segment counts where available) ──
      query(`SELECT
           COALESCE(SUM(m.sms_segments), COUNT(*))::int as total_segments,
           COUNT(*) FILTER (WHERE m.sms_segments IS NOT NULL AND m.sms_segments > 0)::int as exact_count,
           COUNT(*) FILTER (WHERE m.sms_segments IS NULL OR m.sms_segments = 0)::int as fallback_count
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         JOIN tenants t ON t.id = c.tenant_id AND t.is_test = FALSE
         WHERE m.sent_at > NOW() - INTERVAL '30 days'
           AND m.direction IN ('inbound', 'outbound')`),
      // ── Cost: AI tokens today ──
      query(`SELECT COALESCE(SUM(m.tokens_used), 0)::bigint as total_tokens
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         JOIN tenants t ON t.id = c.tenant_id AND t.is_test = FALSE
         WHERE m.sent_at >= CURRENT_DATE`),
      // ── Cost: SMS segments today (real segment counts where available) ──
      query(`SELECT
           COALESCE(SUM(m.sms_segments), COUNT(*))::int as total_segments,
           COUNT(*) FILTER (WHERE m.sms_segments IS NOT NULL AND m.sms_segments > 0)::int as exact_count,
           COUNT(*) FILTER (WHERE m.sms_segments IS NULL OR m.sms_segments = 0)::int as fallback_count
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         JOIN tenants t ON t.id = c.tenant_id AND t.is_test = FALSE
         WHERE m.sent_at >= CURRENT_DATE
           AND m.direction IN ('inbound', 'outbound')`),
      // ── Funnel: missed calls 30d (from pipeline_traces) ──
      query(`SELECT COUNT(*)::int FROM pipeline_traces
         WHERE trigger_type = 'missed_call' AND started_at > NOW() - INTERVAL '30 days'`),
      // ── Revenue at risk: real amounts for at-risk tenants ──
      query(`SELECT
         billing_status,
         COUNT(*)::int as tenant_count,
         COALESCE(SUM(subscription_amount_cents), 0)::bigint as total_amount_cents,
         COUNT(*) FILTER (WHERE subscription_amount_cents IS NOT NULL)::int as exact_count,
         COUNT(*) FILTER (WHERE subscription_amount_cents IS NULL)::int as fallback_count
       FROM tenants
       WHERE is_test = FALSE
         AND billing_status IN ('past_due', 'past_due_blocked', 'paused', 'scheduled_cancel')
       GROUP BY billing_status`),
    ]);

    // Build status map
    const statusCounts: Record<string, number> = {};
    let totalAccounts = 0;
    for (const row of statusCountsRows as { billing_status: string; count: string }[]) {
      statusCounts[row.billing_status] = Number(row.count);
      totalAccounts += Number(row.count);
    }

    // ── Funnel metrics ──
    const convs30d = (convs30dRows as any[])[0]?.count ?? 0;
    const bookings30d = (bookings30dRows as any[])[0]?.count ?? 0;
    const syncedBookings30d = (syncedBookings30dRows as any[])[0]?.count ?? 0;
    const missedCalls30d = (missedCalls30dRows as any[])[0]?.count ?? 0;
    const conversionRate = convs30d > 0 ? Math.round((bookings30d / convs30d) * 100) : 0;
    const calSyncRate = bookings30d > 0 ? Math.round((syncedBookings30d / bookings30d) * 100) : 0;

    // ── System health ──
    const pipelineFailures24h = (pipelineFailures24hRows as any[])[0]?.count ?? 0;
    const failedBookings24h = (failedBookings24hRows as any[])[0]?.count ?? 0;
    const failedSyncs24h = (failedSyncs24hRows as any[])[0]?.count ?? 0;
    const lastAlert = (lastCriticalAlertRows as any[])[0] ?? null;
    const totalFailures24h = pipelineFailures24h + failedBookings24h + failedSyncs24h;
    const systemStatus = totalFailures24h === 0 ? "GREEN" : totalFailures24h <= 3 ? "DEGRADED" : "FAILING";

    // ── Revenue ──
    const activePaid = statusCounts["active"] || 0;
    const scheduledCancelCount = statusCounts["scheduled_cancel"] || 0;
    const trialCount = statusCounts["trial"] || 0;
    const pastDueCount = (statusCounts["past_due"] || 0) + (statusCounts["past_due_blocked"] || 0);

    // MRR calculation: prefer real Stripe subscription_amount_cents.
    // Fall back to plan price map only for tenants without synced amounts.
    let mrr = 0;
    let mrrExactCents = 0; // from Stripe-synced amounts
    let mrrFallbackCents = 0; // from plan price map
    for (const row of revenueTenantsRows as {
      plan_id: string | null; billing_status: string;
      count: number; total_amount_cents: string;
    }[]) {
      const totalAmountCents = Number(row.total_amount_cents);
      const count = Number(row.count);
      if (totalAmountCents > 0) {
        mrrExactCents += totalAmountCents;
      }
      const planPrice = PLAN_PRICES[row.plan_id ?? ""] ?? DEFAULT_PLAN_PRICE;
      const expectedTotalCents = planPrice * 100 * count;
      const fallbackForGroup = Math.max(0, expectedTotalCents - totalAmountCents);
      mrrFallbackCents += fallbackForGroup;
    }
    mrr = Math.round((mrrExactCents + mrrFallbackCents) / 100);

    // Revenue at risk: sum real subscription amounts for at-risk tenants.
    const revenueAtRisk: {
      total_cents: number;
      exact_cents: number;
      fallback_cents: number;
      by_status: Record<string, { tenant_count: number; amount_cents: number; exact: number; fallback: number }>;
    } = { total_cents: 0, exact_cents: 0, fallback_cents: 0, by_status: {} };

    for (const row of revenueAtRiskRows as {
      billing_status: string; tenant_count: number;
      total_amount_cents: string; exact_count: number; fallback_count: number;
    }[]) {
      const exactCents = Number(row.total_amount_cents);
      const fallbackCents = Number(row.fallback_count) * DEFAULT_PLAN_PRICE * 100;
      const totalCents = exactCents + fallbackCents;

      revenueAtRisk.total_cents += totalCents;
      revenueAtRisk.exact_cents += exactCents;
      revenueAtRisk.fallback_cents += fallbackCents;
      revenueAtRisk.by_status[row.billing_status] = {
        tenant_count: Number(row.tenant_count),
        amount_cents: totalCents,
        exact: Number(row.exact_count),
        fallback: Number(row.fallback_count),
      };
    }

    // ── Cost (uses real segment counts where available) ──
    const totalTokens30d = Number((tokenCost30dRows as any[])[0]?.total_tokens ?? 0);
    const sms30dData = (smsCost30dRows as any[])[0] ?? {};
    const totalSegments30d = Number(sms30dData.total_segments ?? 0);
    const smsExactCount30d = Number(sms30dData.exact_count ?? 0);
    const smsFallbackCount30d = Number(sms30dData.fallback_count ?? 0);
    const aiCost30d = Math.round((totalTokens30d / 1000) * OPENAI_COST_PER_1K_TOKENS * 100) / 100;
    const smsCost30d = Math.round(totalSegments30d * TWILIO_SMS_COST_PER_SEGMENT * 100) / 100;
    const totalCost30d = Math.round((aiCost30d + smsCost30d) * 100) / 100;
    const avgCostPerConv = convs30d > 0 ? Math.round((totalCost30d / convs30d) * 100) / 100 : 0;

    const totalTokensToday = Number((tokenCostTodayRows as any[])[0]?.total_tokens ?? 0);
    const smsTodayData = (smsCostTodayRows as any[])[0] ?? {};
    const totalSegmentsToday = Number(smsTodayData.total_segments ?? 0);
    const aiCostToday = Math.round((totalTokensToday / 1000) * OPENAI_COST_PER_1K_TOKENS * 100) / 100;
    const smsCostToday = Math.round(totalSegmentsToday * TWILIO_SMS_COST_PER_SEGMENT * 100) / 100;
    const totalCostToday = Math.round((aiCostToday + smsCostToday) * 100) / 100;

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
      pending_manual_bookings: (pendingManualRows as any[])[0]?.count ?? 0,
      failed_bookings: (failedBookingsRows as any[])[0]?.count ?? 0,
      unacknowledged_alerts: (unackedAlertsRows as any[])[0]?.count ?? 0,
      // ── New KPIs ──
      system_health: {
        status: systemStatus,
        failed_bookings_24h: failedBookings24h,
        failed_syncs_24h: failedSyncs24h,
        pipeline_failures_24h: pipelineFailures24h,
        last_critical_error: lastAlert ? { timestamp: lastAlert.created_at, summary: lastAlert.summary } : null,
      },
      revenue: {
        mrr,
        mrr_exact_cents: mrrExactCents,
        mrr_fallback_cents: mrrFallbackCents,
        active_paid: activePaid,
        scheduled_cancel: scheduledCancelCount,
        trial: trialCount,
        past_due: pastDueCount,
        revenue_at_risk: {
          total: Math.round(revenueAtRisk.total_cents / 100),
          exact_cents: revenueAtRisk.exact_cents,
          fallback_cents: revenueAtRisk.fallback_cents,
          by_status: revenueAtRisk.by_status,
        },
      },
      funnel_30d: {
        missed_calls: missedCalls30d,
        conversations: convs30d,
        bookings: bookings30d,
        conversion_rate: conversionRate,
        calendar_sync_rate: calSyncRate,
      },
      cost: {
        today: { total: totalCostToday, ai: aiCostToday, sms: smsCostToday },
        month: {
          total: totalCost30d, ai: aiCost30d, sms: smsCost30d,
          sms_segments_exact: smsExactCount30d,
          sms_segments_fallback: smsFallbackCount30d,
        },
        avg_per_conversation: avgCostPerConv,
      },
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
       WHERE t.is_test = FALSE
         AND ($1::text IS NULL OR t.billing_status = $1)
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
      query(`SELECT id, customer_phone, customer_name, service_type, scheduled_at, calendar_synced, google_event_id, booking_state, created_at
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
         (SELECT booking_state FROM appointments a WHERE a.conversation_id = c.id LIMIT 1) as booking_state,
         (SELECT COUNT(*)::int FROM messages m WHERE m.conversation_id = c.id) as message_count
       FROM conversations c
       JOIN tenants t ON t.id = c.tenant_id
       WHERE t.is_test = FALSE
         AND ($1::text IS NULL OR c.status = $1)
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

    // Load parent conversation first to obtain tenant_id for child queries
    const convRows = await query(`SELECT c.*, t.shop_name FROM conversations c JOIN tenants t ON t.id = c.tenant_id WHERE c.id = $1`, [id]);

    if (!(convRows as any[]).length) {
      return reply.status(404).send({ error: "Conversation not found" });
    }

    const conv = (convRows as any[])[0];
    const convTenantId = conv.tenant_id;

    // Child queries scoped by tenant_id from parent record (prevents cross-tenant leakage)
    const [messagesRows, appointmentRows] = await Promise.all([
      query(`SELECT id, direction, body, sent_at, tokens_used, model_version FROM messages WHERE conversation_id = $1 AND tenant_id = $2 ORDER BY sent_at ASC`, [id, convTenantId]),
      query(`SELECT * FROM appointments WHERE conversation_id = $1 AND tenant_id = $2 LIMIT 1`, [id, convTenantId]),
    ]);

    return reply.status(200).send({
      conversation: conv,
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
         a.conversation_id, a.booking_state,
         CASE WHEN a.booking_state = 'CONFIRMED_MANUAL' THEN 'confirmed_manual'
              WHEN a.booking_state = 'RESOLVED' THEN 'resolved'
              WHEN NOT a.calendar_synced AND a.google_event_id IS NULL THEN 'sync_failed'
              WHEN NOT a.calendar_synced THEN 'pending'
              ELSE 'synced' END as sync_status
       FROM appointments a
       JOIN tenants t ON t.id = a.tenant_id
       WHERE t.is_test = FALSE
         AND ($1::text IS NULL OR
         CASE WHEN $1 = 'failed'    THEN a.booking_state = 'FAILED'
              WHEN $1 = 'pending'   THEN a.booking_state = 'PENDING_MANUAL_CONFIRMATION'
              WHEN $1 = 'synced'    THEN a.booking_state IN ('CONFIRMED_CALENDAR', 'CONFIRMED_MANUAL', 'RESOLVED')
              WHEN $1 = 'today'     THEN a.scheduled_at::date = CURRENT_DATE
              WHEN $1 = 'upcoming'  THEN a.scheduled_at > NOW()
              WHEN $1 = 'action_needed' THEN a.booking_state IN ('PENDING_MANUAL_CONFIRMATION', 'FAILED')
              ELSE true END
       )
       AND ($2::uuid IS NULL OR a.tenant_id = $2)
       ORDER BY a.created_at DESC
       LIMIT 100 OFFSET $3`,
      [filter, tenantIdFilter, page * 100]
    );

    return reply.status(200).send({ count: (bookings as any[]).length, bookings, page });
  });

  // ── GET /internal/admin/bookings/action-needed ─────────────────────────────
  app.get("/admin/bookings/action-needed", { preHandler: [adminGuard] }, async (_req, reply) => {
    const bookings = await query(
      `SELECT a.id, a.tenant_id, t.shop_name, a.customer_phone, a.customer_name,
         a.service_type, a.scheduled_at, a.calendar_synced, a.google_event_id, a.created_at,
         a.conversation_id, a.booking_state
       FROM appointments a
       JOIN tenants t ON t.id = a.tenant_id
       WHERE t.is_test = FALSE
         AND a.booking_state IN ('PENDING_MANUAL_CONFIRMATION', 'FAILED')
       ORDER BY a.created_at DESC
       LIMIT 100`
    );

    return reply.status(200).send({ count: (bookings as any[]).length, bookings });
  });

  // ── PATCH /internal/admin/bookings/:id/state ──────────────────────────────
  const BookingStateTransitionSchema = z.object({
    booking_state: z.enum(["CONFIRMED_MANUAL", "RESOLVED"]),
  });

  const ALLOWED_TRANSITIONS: Record<string, string[]> = {
    PENDING_MANUAL_CONFIRMATION: ["CONFIRMED_MANUAL"],
    FAILED: ["RESOLVED"],
  };

  app.patch("/admin/bookings/:id/state", { preHandler: [adminGuard] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = BookingStateTransitionSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`),
      });
    }

    const newState = parsed.data.booking_state;

    // Fetch current booking state
    const rows = await query<{ booking_state: string }>(
      `SELECT booking_state FROM appointments WHERE id = $1`,
      [id]
    );

    if ((rows as any[]).length === 0) {
      return reply.status(404).send({ error: "Booking not found" });
    }

    const currentState = (rows as any[])[0].booking_state;
    const allowed = ALLOWED_TRANSITIONS[currentState];

    if (!allowed || !allowed.includes(newState)) {
      return reply.status(409).send({
        error: "Invalid state transition",
        current_state: currentState,
        requested_state: newState,
        allowed_transitions: allowed || [],
      });
    }

    // Perform the transition
    await query(
      `UPDATE appointments SET booking_state = $1 WHERE id = $2`,
      [newState, id]
    );

    // Audit log entry if audit_log table exists
    try {
      const tenantRows = await query<{ tenant_id: string }>(
        `SELECT tenant_id FROM appointments WHERE id = $1`,
        [id]
      );
      const tenantId = (tenantRows as any[])[0]?.tenant_id;
      if (tenantId) {
        await query(
          `INSERT INTO audit_log (tenant_id, event_type, actor, metadata)
           VALUES ($1, $2, $3, $4)`,
          [
            tenantId,
            "booking_state_change",
            "admin",
            JSON.stringify({ booking_id: id, from: currentState, to: newState }),
          ]
        );
      }
    } catch (_) {
      // Non-critical — don't fail the transition if audit logging fails
    }

    return reply.status(200).send({
      success: true,
      booking_id: id,
      previous_state: currentState,
      booking_state: newState,
    });
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
       WHERE t.is_test = FALSE
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
       WHERE t.is_test = FALSE
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
         WHERE t.is_test = FALSE AND NOT a.calendar_synced AND a.created_at < NOW() - INTERVAL '1 hour'

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
         WHERE (t.is_test = FALSE OR t.id IS NULL)
           AND (be.event_type ILIKE '%fail%' OR be.event_type ILIKE '%past_due%' OR be.event_type ILIKE '%delinquent%')

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
         WHERE t.is_test = FALSE AND t.billing_status = 'trial_expired'

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
       FROM signup_attempts sa
       WHERE ($1::text IS NULL OR sa.status   = $1)
         AND ($2::text IS NULL OR sa.provider = $2)
         AND (sa.tenant_id IS NULL OR NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = sa.tenant_id AND t.is_test = TRUE))
       ORDER BY sa.created_at DESC
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
         WHERE (t.is_test = FALSE OR t.id IS NULL)
           AND ($1::uuid IS NULL OR be.tenant_id = $1)

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
         WHERE (t.is_test = FALSE OR t.id IS NULL)
           AND ($1::uuid IS NULL OR sa.tenant_id = $1)

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
         WHERE (t.is_test = FALSE OR t.id IS NULL)
           AND ($1::uuid IS NULL OR al.tenant_id = $1)
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
         FROM conversations cv
         JOIN tenants t ON t.id = cv.tenant_id AND t.is_test = FALSE
         WHERE cv.opened_at >= NOW() - ($1 || ' days')::interval
           AND ($2::uuid IS NULL OR cv.tenant_id = $2)`,
        [days.toString(), tenantFilter]
      ),

      // Close reason breakdown
      query(
        `SELECT
           COALESCE(cv.close_reason, 'still_open') AS reason,
           COUNT(*)::int AS count
         FROM conversations cv
         JOIN tenants t ON t.id = cv.tenant_id AND t.is_test = FALSE
         WHERE cv.opened_at >= NOW() - ($1 || ' days')::interval
           AND ($2::uuid IS NULL OR cv.tenant_id = $2)
         GROUP BY COALESCE(cv.close_reason, 'still_open')
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
             cv.opened_at::date AS day,
             COUNT(*)::int AS opened,
             COUNT(*) FILTER (WHERE cv.status IN ('closed','booked','expired'))::int AS closed,
             COUNT(*) FILTER (WHERE cv.status = 'booked')::int AS booked
           FROM conversations cv
           JOIN tenants t ON t.id = cv.tenant_id AND t.is_test = FALSE
           WHERE cv.opened_at >= CURRENT_DATE - ($1 || ' days')::interval
             AND ($2::uuid IS NULL OR cv.tenant_id = $2)
           GROUP BY cv.opened_at::date
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
         JOIN tenants t ON t.id = c.tenant_id AND t.is_test = FALSE
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

  // ── GET /internal/admin/tenants/:id/settings ────────────────────────────
  app.get("/admin/tenants/:id/settings", { preHandler: [adminGuard] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [tenantRows, promptRows, phoneRows] = await Promise.all([
      query<{
        shop_name: string | null;
        owner_phone: string | null;
        missed_call_sms_template: string | null;
        business_hours: string | null;
        services_description: string | null;
      }>(
        `SELECT shop_name, owner_phone, missed_call_sms_template, business_hours, services_description
         FROM tenants WHERE id = $1`,
        [id]
      ),
      query<{ prompt_text: string }>(
        `SELECT prompt_text FROM system_prompts
         WHERE tenant_id = $1 AND is_active = TRUE
         ORDER BY version DESC LIMIT 1`,
        [id]
      ),
      query<{ phone_number: string; forward_to: string | null; status: string }>(
        `SELECT phone_number, forward_to, status FROM tenant_phone_numbers
         WHERE tenant_id = $1 AND status = 'active'
         ORDER BY provisioned_at DESC LIMIT 1`,
        [id]
      ),
    ]);

    if ((tenantRows as any[]).length === 0) {
      return reply.status(404).send({ error: "Tenant not found" });
    }

    const tenant = (tenantRows as any[])[0];
    const phone = (phoneRows as any[])[0] ?? null;
    return reply.status(200).send({
      shop_name: tenant.shop_name,
      owner_phone: tenant.owner_phone,
      twilio_number: phone?.phone_number ?? null,
      forward_to: phone?.forward_to ?? null,
      missed_call_sms_template: tenant.missed_call_sms_template,
      ai_system_prompt: (promptRows as any[])[0]?.prompt_text ?? null,
      business_hours: tenant.business_hours,
      services_description: tenant.services_description,
    });
  });

  // ── GET /internal/admin/tenants/:id/pilot-readiness ─────────────────────
  app.get("/admin/tenants/:id/pilot-readiness", { preHandler: [adminGuard] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [tenantRows, phoneRows, calendarRows, promptRows] = await Promise.all([
      query<{
        shop_name: string | null;
        owner_phone: string | null;
        billing_status: string;
        trial_ends_at: string | null;
        missed_call_sms_template: string | null;
        business_hours: string | null;
        services_description: string | null;
      }>(
        `SELECT shop_name, owner_phone, billing_status, trial_ends_at,
                missed_call_sms_template, business_hours, services_description
         FROM tenants WHERE id = $1`,
        [id]
      ),
      query<{ phone_number: string; forward_to: string | null; status: string; twilio_sid: string }>(
        `SELECT phone_number, forward_to, status, twilio_sid FROM tenant_phone_numbers
         WHERE tenant_id = $1 AND status = 'active'
         ORDER BY provisioned_at DESC LIMIT 1`,
        [id]
      ),
      query<{ token_expiry: string | null; connected_at: string | null; integration_status: string | null }>(
        `SELECT token_expiry, connected_at, integration_status FROM tenant_calendar_tokens
         WHERE tenant_id = $1 LIMIT 1`,
        [id]
      ),
      query<{ prompt_text: string }>(
        `SELECT prompt_text FROM system_prompts
         WHERE tenant_id = $1 AND is_active = TRUE
         ORDER BY version DESC LIMIT 1`,
        [id]
      ),
    ]);

    if ((tenantRows as any[]).length === 0) {
      return reply.status(404).send({ error: "Tenant not found" });
    }

    const tenant = (tenantRows as any[])[0];
    const phone = (phoneRows as any[])[0] ?? null;
    const calendar = (calendarRows as any[])[0] ?? null;
    const prompt = (promptRows as any[])[0] ?? null;

    // Billing must be in a usable state
    const blockedBillingStatuses = ["trial_expired", "canceled", "past_due_blocked"];
    const billingOk = !blockedBillingStatuses.includes(tenant.billing_status);

    // ── Twilio webhook verification (live API check) ──────────────────────
    // If we have a phone with a twilio_sid, verify Twilio's actual webhook config
    let twilioWebhookResult: {
      sms: { pass: boolean; expected: string; actual: string | null } | null;
      voice: { pass: boolean; expected: string; actual: string | null } | null;
      error: string | null;
    } = { sms: null, voice: null, error: null };

    if (phone?.twilio_sid) {
      const expectedOrigin = process.env.PUBLIC_ORIGIN || process.env.API_BASE_URL || null;
      if (!expectedOrigin) {
        twilioWebhookResult.error = "PUBLIC_ORIGIN not configured — cannot verify webhook URLs";
      } else {
        const twilioResult = await fetchTwilioNumberConfig(phone.twilio_sid);
        if (twilioResult.success && twilioResult.config) {
          const verification = verifyWebhookUrls(twilioResult.config, expectedOrigin);
          twilioWebhookResult.sms = verification.sms_webhook;
          twilioWebhookResult.voice = verification.voice_webhook;
        } else {
          twilioWebhookResult.error = twilioResult.error || "Failed to fetch Twilio config";
        }
      }
    }

    // Build readiness checks — ordered by the live path:
    // Twilio number → webhooks configured → forward_to → missed-call trigger → AI reply → calendar
    const checks = [
      {
        id: "twilio_number",
        label: "Twilio number assigned",
        pass: !!phone,
        detail: phone ? phone.phone_number : "No active phone number provisioned",
        critical: true,
      },
      {
        id: "twilio_sms_webhook",
        label: "Twilio SMS webhook URL correct",
        pass: twilioWebhookResult.sms?.pass ?? false,
        detail: !phone
          ? "No phone number — skipped"
          : twilioWebhookResult.error
            ? `Cannot verify: ${twilioWebhookResult.error}`
            : twilioWebhookResult.sms?.pass
              ? `Configured: ${twilioWebhookResult.sms.actual}`
              : `MISMATCH — Expected: ${twilioWebhookResult.sms?.expected} | Actual: ${twilioWebhookResult.sms?.actual || "(empty)"}. Fix in Twilio Console > Phone Numbers > ${phone.phone_number} > Messaging > A MESSAGE COMES IN`,
        critical: true,
      },
      {
        id: "twilio_voice_webhook",
        label: "Twilio Voice webhook URL correct",
        pass: twilioWebhookResult.voice?.pass ?? false,
        detail: !phone
          ? "No phone number — skipped"
          : twilioWebhookResult.error
            ? `Cannot verify: ${twilioWebhookResult.error}`
            : twilioWebhookResult.voice?.pass
              ? `Configured: ${twilioWebhookResult.voice.actual}`
              : `MISMATCH — Expected: ${twilioWebhookResult.voice?.expected} | Actual: ${twilioWebhookResult.voice?.actual || "(empty)"}. Fix in Twilio Console > Phone Numbers > ${phone.phone_number} > Voice > A CALL COMES IN`,
        critical: true,
      },
      {
        id: "forward_to",
        label: "Call forwarding configured",
        pass: !!phone?.forward_to,
        detail: phone?.forward_to
          ? `Calls forward to ${phone.forward_to}`
          : "No forward_to number — incoming calls won't ring the shop",
        critical: true,
      },
      {
        id: "sms_template",
        label: "Missed-call SMS template set",
        pass: !!tenant.missed_call_sms_template?.trim(),
        detail: tenant.missed_call_sms_template
          ? `Template: "${tenant.missed_call_sms_template.substring(0, 80)}${tenant.missed_call_sms_template.length > 80 ? '...' : ''}"`
          : "No SMS template — missed calls won't trigger outbound SMS",
        critical: true,
      },
      {
        id: "ai_prompt",
        label: "AI system prompt configured",
        pass: !!prompt?.prompt_text?.trim(),
        detail: prompt
          ? `Active prompt: ${prompt.prompt_text.substring(0, 60)}...`
          : "No active AI prompt — conversations will use generic defaults",
        critical: false,
      },
      {
        id: "business_hours",
        label: "Business hours set",
        pass: !!tenant.business_hours?.trim(),
        detail: tenant.business_hours || "Not configured — AI won't know shop hours",
        critical: false,
      },
      {
        id: "services",
        label: "Services description set",
        pass: !!tenant.services_description?.trim(),
        detail: tenant.services_description
          ? `${tenant.services_description.substring(0, 80)}${tenant.services_description.length > 80 ? '...' : ''}`
          : "Not configured — AI won't know what services the shop offers",
        critical: false,
      },
      {
        id: "calendar_connected",
        label: "Google Calendar connected",
        pass: !!calendar?.connected_at,
        detail: calendar?.connected_at
          ? `Connected ${new Date(calendar.connected_at).toLocaleDateString()}`
          : "OAuth not completed — bookings won't sync to calendar",
        critical: true,
      },
      {
        id: "calendar_token_valid",
        label: "Calendar integration active",
        pass: calendar?.integration_status === "active",
        detail: !calendar
          ? "No token — complete OAuth flow first"
          : calendar.integration_status === "active"
            ? `Active (access token auto-refreshes)`
            : `Status: ${calendar.integration_status} — reconnect required`,
        critical: true,
      },
      {
        id: "billing_active",
        label: "Billing status allows operation",
        pass: billingOk,
        detail: `Status: ${tenant.billing_status}${!billingOk ? " — tenant is blocked from operating" : ""}`,
        critical: true,
      },
    ];

    const criticalPassed = checks.filter(c => c.critical && c.pass).length;
    const criticalTotal = checks.filter(c => c.critical).length;
    const allPassed = checks.every(c => c.pass);
    const criticalAllPassed = checks.filter(c => c.critical).every(c => c.pass);
    const blockers = checks.filter(c => c.critical && !c.pass);
    const warnings = checks.filter(c => !c.critical && !c.pass);

    let verdict: "ready" | "not_ready" | "ready_with_warnings";
    if (!criticalAllPassed) {
      verdict = "not_ready";
    } else if (!allPassed) {
      verdict = "ready_with_warnings";
    } else {
      verdict = "ready";
    }

    return reply.status(200).send({
      tenant_id: id,
      shop_name: tenant.shop_name,
      verdict,
      summary: `${criticalPassed}/${criticalTotal} critical checks passed`,
      checks,
      blockers: blockers.map(b => ({ id: b.id, label: b.label, detail: b.detail })),
      warnings: warnings.map(w => ({ id: w.id, label: w.label, detail: w.detail })),
    });
  });

  // ── PUT /internal/admin/tenants/:id/settings ────────────────────────────
  const E164_REGEX = /^\+[1-9]\d{1,14}$/;
  const SettingsSchema = z.object({
    shop_name: z.string().min(1).max(200).optional(),
    owner_phone: z.string().regex(E164_REGEX, "Must be E.164 format (e.g. +15125551234)").nullable().optional(),
    forward_to: z.string().regex(E164_REGEX, "Must be E.164 format (e.g. +15125551234)").nullable().optional(),
    missed_call_sms_template: z.string().max(500).nullable().optional(),
    ai_system_prompt: z.string().max(2000).nullable().optional(),
    business_hours: z.string().max(500).nullable().optional(),
    services_description: z.string().max(1000).nullable().optional(),
  });

  app.put("/admin/tenants/:id/settings", { preHandler: [adminGuard] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = SettingsSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`),
      });
    }

    // Check tenant exists
    const existing = await query(`SELECT id FROM tenants WHERE id = $1`, [id]);
    if ((existing as any[]).length === 0) {
      return reply.status(404).send({ error: "Tenant not found" });
    }

    const data = parsed.data;

    // Update tenant columns (shop_name, missed_call_sms_template, business_hours, services_description)
    const tenantUpdates: string[] = [];
    const tenantValues: (string | null)[] = [];
    let paramIdx = 1;

    if (data.shop_name !== undefined) {
      tenantUpdates.push(`shop_name = $${paramIdx++}`);
      tenantValues.push(data.shop_name);
    }
    if (data.owner_phone !== undefined) {
      tenantUpdates.push(`owner_phone = $${paramIdx++}`);
      tenantValues.push(data.owner_phone);
    }
    if (data.missed_call_sms_template !== undefined) {
      tenantUpdates.push(`missed_call_sms_template = $${paramIdx++}`);
      tenantValues.push(data.missed_call_sms_template);
    }
    if (data.business_hours !== undefined) {
      tenantUpdates.push(`business_hours = $${paramIdx++}`);
      tenantValues.push(data.business_hours);
    }
    if (data.services_description !== undefined) {
      tenantUpdates.push(`services_description = $${paramIdx++}`);
      tenantValues.push(data.services_description);
    }

    if (tenantUpdates.length > 0) {
      tenantUpdates.push(`updated_at = NOW()`);
      await query(
        `UPDATE tenants SET ${tenantUpdates.join(", ")} WHERE id = $${paramIdx}`,
        [...tenantValues, id]
      );
    }

    // Update forward_to in tenant_phone_numbers table
    if (data.forward_to !== undefined) {
      await query(
        `UPDATE tenant_phone_numbers SET forward_to = $1
         WHERE tenant_id = $2 AND status = 'active'`,
        [data.forward_to, id]
      );
    }

    // Update ai_system_prompt in system_prompts table
    if (data.ai_system_prompt !== undefined) {
      if (data.ai_system_prompt === null || data.ai_system_prompt.trim() === "") {
        // Deactivate existing prompts
        await query(
          `UPDATE system_prompts SET is_active = FALSE WHERE tenant_id = $1`,
          [id]
        );
      } else {
        // Deactivate old, insert new version
        await query(
          `UPDATE system_prompts SET is_active = FALSE WHERE tenant_id = $1`,
          [id]
        );
        await query(
          `INSERT INTO system_prompts (tenant_id, version, prompt_text, is_active)
           VALUES ($1, (SELECT COALESCE(MAX(version), 0) + 1 FROM system_prompts WHERE tenant_id = $1), $2, TRUE)`,
          [id, data.ai_system_prompt.trim()]
        );
      }
    }

    return reply.status(200).send({ success: true });
  });

  // ── GET /internal/admin/tenants/:id/health ───────────────────────────────
  app.get("/admin/tenants/:id/health", { preHandler: [adminGuard] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [
      tenantRows,
      convStatsRows,
      bookingStatsRows,
      pipelineStatsRows,
      lastActivityRows,
      calendarRows,
    ] = await Promise.all([
      query(`SELECT id, shop_name FROM tenants WHERE id = $1`, [id]),
      // Conversation stats (last 30 days)
      query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status IN ('closed','booked','expired'))::int AS completed,
           COUNT(*) FILTER (WHERE status = 'open')::int AS still_open,
           COUNT(*) FILTER (WHERE appointment_id IS NOT NULL)::int AS with_booking,
           ROUND(AVG(turn_count), 1) AS avg_turns,
           ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(closed_at, NOW()) - opened_at)) / 60), 1) AS avg_duration_min
         FROM conversations
         WHERE tenant_id = $1 AND opened_at >= NOW() - INTERVAL '30 days'`,
        [id]
      ),
      // Booking stats (all time)
      query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE calendar_synced = TRUE)::int AS synced,
           COUNT(*) FILTER (WHERE booking_state IN ('PENDING_MANUAL_CONFIRMATION','FAILED'))::int AS action_needed,
           COUNT(*) FILTER (WHERE booking_state = 'CONFIRMED_CALENDAR')::int AS confirmed_calendar,
           COUNT(*) FILTER (WHERE booking_state = 'CONFIRMED_MANUAL')::int AS confirmed_manual,
           COUNT(*) FILTER (WHERE booking_state = 'FAILED')::int AS failed
         FROM appointments
         WHERE tenant_id = $1`,
        [id]
      ),
      // Pipeline trace stats (last 30 days)
      query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
           COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
           MAX(completed_at) AS last_trace_at
         FROM pipeline_traces
         WHERE tenant_id = $1 AND started_at >= NOW() - INTERVAL '30 days'`,
        [id]
      ),
      // Last activity timestamps
      query(
        `SELECT
           (SELECT MAX(last_message_at) FROM conversations WHERE tenant_id = $1) AS last_conversation_at,
           (SELECT MAX(created_at) FROM appointments WHERE tenant_id = $1) AS last_booking_at,
           (SELECT MAX(sent_at) FROM messages WHERE tenant_id = $1 AND direction = 'inbound') AS last_inbound_sms_at,
           (SELECT MAX(sent_at) FROM messages WHERE tenant_id = $1 AND direction = 'outbound') AS last_outbound_sms_at`,
        [id]
      ),
      // Calendar integration health
      query(
        `SELECT integration_status, last_refreshed, last_error, connected_at, google_account_email
         FROM tenant_calendar_tokens WHERE tenant_id = $1 LIMIT 1`,
        [id]
      ),
    ]);

    if (!(tenantRows as any[]).length) {
      return reply.status(404).send({ error: "Tenant not found" });
    }

    const conv = (convStatsRows as any[])[0] || {};
    const booking = (bookingStatsRows as any[])[0] || {};
    const pipeline = (pipelineStatsRows as any[])[0] || {};
    const activity = (lastActivityRows as any[])[0] || {};
    const calendar = (calendarRows as any[])[0] || null;

    const completionRate = conv.total > 0
      ? Math.round((conv.completed / conv.total) * 100)
      : null;
    const bookingRate = conv.total > 0
      ? Math.round((conv.with_booking / conv.total) * 100)
      : null;
    const syncRate = booking.total > 0
      ? Math.round((booking.synced / booking.total) * 100)
      : null;
    const pipelineSuccessRate = pipeline.total > 0
      ? Math.round((pipeline.completed / pipeline.total) * 100)
      : null;

    return reply.status(200).send({
      tenant_id: id,
      shop_name: (tenantRows as any[])[0].shop_name,
      conversations: {
        total_30d: conv.total || 0,
        completed: conv.completed || 0,
        still_open: conv.still_open || 0,
        with_booking: conv.with_booking || 0,
        completion_rate_pct: completionRate,
        booking_rate_pct: bookingRate,
        avg_turns: parseFloat(conv.avg_turns) || null,
        avg_duration_min: parseFloat(conv.avg_duration_min) || null,
      },
      bookings: {
        total: booking.total || 0,
        synced: booking.synced || 0,
        action_needed: booking.action_needed || 0,
        confirmed_calendar: booking.confirmed_calendar || 0,
        confirmed_manual: booking.confirmed_manual || 0,
        failed: booking.failed || 0,
        sync_rate_pct: syncRate,
      },
      pipeline: {
        total_30d: pipeline.total || 0,
        completed: pipeline.completed || 0,
        failed: pipeline.failed || 0,
        success_rate_pct: pipelineSuccessRate,
        last_trace_at: pipeline.last_trace_at || null,
      },
      last_activity: {
        last_conversation_at: activity.last_conversation_at || null,
        last_booking_at: activity.last_booking_at || null,
        last_inbound_sms_at: activity.last_inbound_sms_at || null,
        last_outbound_sms_at: activity.last_outbound_sms_at || null,
      },
      calendar: calendar ? {
        status: calendar.integration_status,
        last_refreshed: calendar.last_refreshed,
        last_error: calendar.last_error,
        connected_at: calendar.connected_at,
        google_account_email: calendar.google_account_email,
      } : null,
    });
  });

  // ── GET /internal/admin/traces ────────────────────────────────────────────
  // Returns recent pipeline execution traces for pilot live-test visibility.
  app.get("/admin/traces", { preHandler: [adminGuard] }, async (_req, reply) => {
    const traces = await getRecentTraces(100);
    return reply.send(traces);
  });

  // ── GET /internal/admin/traces/:id ────────────────────────────────────────
  app.get("/admin/traces/:id", { preHandler: [adminGuard] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const trace = await getTraceById(id);
    if (!trace) return reply.status(404).send({ error: "Trace not found" });
    return reply.send(trace);
  });

  // ── GET /internal/admin/alerts ──────────────────────────────────────────────
  // Returns pipeline failure alerts. Default: unacknowledged only.
  app.get("/admin/alerts", { preHandler: [adminGuard] }, async (req, reply) => {
    const q = req.query as { acknowledged?: string };
    const acknowledged = q.acknowledged === "1";
    const alerts = await getAlerts({ acknowledged, limit: 50 });
    const unacknowledgedCount = acknowledged ? await countUnacknowledgedAlerts() : alerts.length;
    return reply.send({ alerts, unacknowledged_count: unacknowledgedCount });
  });

  // ── POST /internal/admin/alerts/:id/acknowledge ────────────────────────────
  app.post("/admin/alerts/:id/acknowledge", { preHandler: [adminGuard] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const adminEmail = (req as any).adminEmail ?? "unknown";
    const updated = await acknowledgeAlert(id, adminEmail);
    if (!updated) return reply.status(404).send({ error: "Alert not found or already acknowledged" });
    return reply.send({ acknowledged: true });
  });

  // ── GET /internal/admin/verification/webhook-events ──────────────────────
  // Readonly view of webhook_events table for duplicate-block verification.
  app.get("/admin/verification/webhook-events", { preHandler: [adminGuard] }, async (req, reply) => {
    const q = req.query as { source?: string; event_sid?: string; limit?: string };
    const limit = Math.min(parseInt(q.limit || "50", 10) || 50, 200);

    let sql = `SELECT id, source, event_sid, tenant_id, processed, received_at, processed_at
               FROM webhook_events`;
    const params: (string | number)[] = [];
    const conditions: string[] = [];

    if (q.source) {
      conditions.push(`source = $${params.length + 1}`);
      params.push(q.source);
    }
    if (q.event_sid) {
      conditions.push(`event_sid = $${params.length + 1}`);
      params.push(q.event_sid);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }
    sql += ` ORDER BY received_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const rows = await query(sql, params);
    return reply.send({ webhook_events: rows, count: (rows as any[]).length });
  });

  // ── GET /internal/admin/verification/duplicate-evidence ──────────────────
  // Summary: webhook event counts by source within a time window.
  app.get("/admin/verification/duplicate-evidence", { preHandler: [adminGuard] }, async (req, reply) => {
    const q = req.query as { hours?: string };
    const hours = Math.min(parseInt(q.hours || "24", 10) || 24, 168);

    const summary = await query(
      `SELECT source, COUNT(*)::int AS total_events,
              COUNT(DISTINCT event_sid)::int AS unique_sids
       FROM webhook_events
       WHERE received_at >= NOW() - ($1 || ' hours')::interval
       GROUP BY source
       ORDER BY source`,
      [hours.toString()]
    );

    const recentEvents = await query(
      `SELECT source, event_sid, tenant_id, received_at
       FROM webhook_events
       WHERE received_at >= NOW() - ($1 || ' hours')::interval
       ORDER BY received_at DESC
       LIMIT 100`,
      [hours.toString()]
    );

    return reply.send({
      window_hours: hours,
      by_source: summary,
      recent_events: recentEvents,
    });
  });

  // ── GET /internal/admin/verification/booking-dedup ────────────────────────
  // Check for booking dedup evidence via appointments table.
  app.get("/admin/verification/booking-dedup", { preHandler: [adminGuard] }, async (req, reply) => {
    const q = req.query as { tenant_id?: string; limit?: string };
    const limit = Math.min(parseInt(q.limit || "20", 10) || 20, 100);

    let sql = `SELECT a.id, a.tenant_id, a.conversation_id, a.customer_name,
                      a.service_type, a.booking_state, a.calendar_synced,
                      a.created_at, a.scheduled_at
               FROM appointments a`;
    const params: (string | number)[] = [];

    if (q.tenant_id) {
      sql += ` WHERE a.tenant_id = $1`;
      params.push(q.tenant_id);
    }

    sql += ` ORDER BY a.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const rows = await query(sql, params);
    return reply.send({ appointments: rows, count: (rows as any[]).length });
  });

  // ── GET /internal/admin/verification/sms-dedup ────────────────────────────
  // Check for SMS send dedup evidence via messages table.
  // conversation_id is required — tenant_id is resolved from the parent conversation to prevent cross-tenant leakage.
  app.get("/admin/verification/sms-dedup", { preHandler: [adminGuard] }, async (req, reply) => {
    const q = req.query as { conversation_id?: string; limit?: string };
    const limit = Math.min(parseInt(q.limit || "30", 10) || 30, 100);

    if (!q.conversation_id) {
      return reply.status(400).send({ error: "conversation_id is required" });
    }

    // Resolve tenant_id from the parent conversation (fail-closed)
    const convRows = await query<{ tenant_id: string }>(
      `SELECT tenant_id FROM conversations WHERE id = $1`,
      [q.conversation_id]
    );
    if (!(convRows as any[]).length) {
      return reply.status(404).send({ error: "Conversation not found" });
    }
    const tenantId = (convRows as any[])[0].tenant_id;

    const rows = await query(
      `SELECT m.id, m.conversation_id, m.direction, m.body,
              m.twilio_sid, m.sent_at
       FROM messages m
       WHERE m.conversation_id = $1 AND m.tenant_id = $2
       ORDER BY m.sent_at DESC LIMIT $3`,
      [q.conversation_id, tenantId, limit]
    );
    return reply.send({ messages: rows, count: (rows as any[]).length });
  });

  // ── GET /internal/admin/metrics/funnel-integrity ──────────────────────────
  // Exposes data integrity anomalies in the funnel chain:
  //   missed_call → conversation → booking → calendar_sync
  app.get("/admin/metrics/funnel-integrity", { preHandler: [adminGuard] }, async (_req, reply) => {
    const [
      orphanBookingsRows,
      bookedWithoutAppointmentRows,
      multipleBookingsPerConvRows,
      conversationsWithoutSourceRows,
      duplicateTraceRows,
      funnelCountsRows,
    ] = await Promise.all([
      // Orphan bookings: appointments with no conversation_id
      query(`SELECT COUNT(*)::int as count FROM appointments a
         JOIN tenants t ON t.id = a.tenant_id AND t.is_test = FALSE
         WHERE a.conversation_id IS NULL`),
      // Booked conversations with no matching appointment
      query(`SELECT COUNT(*)::int as count FROM conversations c
         JOIN tenants t ON t.id = c.tenant_id AND t.is_test = FALSE
         WHERE c.status = 'booked'
           AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.conversation_id = c.id)`),
      // Conversations with more than 1 appointment
      query(`SELECT conversation_id, COUNT(*)::int as booking_count
         FROM appointments a
         JOIN tenants t ON t.id = a.tenant_id AND t.is_test = FALSE
         WHERE a.conversation_id IS NOT NULL
         GROUP BY a.conversation_id
         HAVING COUNT(*) > 1`),
      // Conversations with no identifiable trigger source
      query(`SELECT COUNT(*)::int as count FROM conversations c
         JOIN tenants t ON t.id = c.tenant_id AND t.is_test = FALSE
         WHERE c.opened_at > NOW() - INTERVAL '30 days'
           AND NOT EXISTS (
             SELECT 1 FROM pipeline_traces pt
             WHERE pt.tenant_id = c.tenant_id
               AND pt.customer_phone = c.customer_phone
               AND pt.started_at BETWEEN c.opened_at - INTERVAL '5 minutes' AND c.opened_at + INTERVAL '5 minutes'
           )`),
      // Duplicate pipeline traces (same trigger_id appearing more than once)
      query(`SELECT trigger_id, COUNT(*)::int as trace_count
         FROM pipeline_traces
         WHERE started_at > NOW() - INTERVAL '30 days'
           AND trigger_id IS NOT NULL
         GROUP BY trigger_id
         HAVING COUNT(*) > 1`),
      // Clean funnel counts for last 30 days
      query(`SELECT
           (SELECT COUNT(*)::int FROM pipeline_traces
            WHERE trigger_type = 'missed_call' AND started_at > NOW() - INTERVAL '30 days') as missed_calls,
           (SELECT COUNT(*)::int FROM conversations c
            JOIN tenants t ON t.id = c.tenant_id AND t.is_test = FALSE
            WHERE c.opened_at > NOW() - INTERVAL '30 days') as conversations,
           (SELECT COUNT(DISTINCT a.conversation_id)::int FROM appointments a
            JOIN tenants t ON t.id = a.tenant_id AND t.is_test = FALSE
            WHERE a.created_at > NOW() - INTERVAL '30 days'
              AND a.conversation_id IS NOT NULL) as bookings_with_conversation,
           (SELECT COUNT(*)::int FROM appointments a
            JOIN tenants t ON t.id = a.tenant_id AND t.is_test = FALSE
            WHERE a.created_at > NOW() - INTERVAL '30 days'
              AND a.conversation_id IS NULL) as bookings_orphan,
           (SELECT COUNT(*)::int FROM appointments a
            JOIN tenants t ON t.id = a.tenant_id AND t.is_test = FALSE
            WHERE a.created_at > NOW() - INTERVAL '30 days'
              AND a.calendar_synced = true) as calendar_synced`),
    ]);

    const orphanBookings = (orphanBookingsRows as any[])[0]?.count ?? 0;
    const bookedWithoutAppointment = (bookedWithoutAppointmentRows as any[])[0]?.count ?? 0;
    const multipleBookingsPerConv = (multipleBookingsPerConvRows as any[]);
    const conversationsWithoutSource = (conversationsWithoutSourceRows as any[])[0]?.count ?? 0;
    const duplicateTraces = (duplicateTraceRows as any[]);
    const funnelCounts = (funnelCountsRows as any[])[0] ?? {};

    return reply.status(200).send({
      funnel_definitions: {
        missed_call: "pipeline_traces with trigger_type='missed_call'",
        conversation: "conversations table row (1 per customer+tenant, with cooldown)",
        booking: "appointments table row linked to conversation via conversation_id",
        calendar_synced: "appointments with calendar_synced=true AND google_event_id set",
      },
      funnel_30d: {
        missed_calls: funnelCounts.missed_calls ?? 0,
        conversations: funnelCounts.conversations ?? 0,
        bookings_with_conversation: funnelCounts.bookings_with_conversation ?? 0,
        bookings_orphan: funnelCounts.bookings_orphan ?? 0,
        calendar_synced: funnelCounts.calendar_synced ?? 0,
      },
      anomalies: {
        orphan_bookings: orphanBookings,
        booked_conversations_without_appointment: bookedWithoutAppointment,
        multiple_bookings_per_conversation: multipleBookingsPerConv.length,
        multiple_bookings_details: multipleBookingsPerConv.slice(0, 20),
        conversations_without_trigger_source: conversationsWithoutSource,
        duplicate_pipeline_traces: duplicateTraces.length,
        duplicate_traces_details: duplicateTraces.slice(0, 20),
      },
      integrity_score: (
        orphanBookings === 0 &&
        bookedWithoutAppointment === 0 &&
        multipleBookingsPerConv.length === 0
      ) ? "CLEAN" : "ANOMALIES_DETECTED",
    });
  });
}
