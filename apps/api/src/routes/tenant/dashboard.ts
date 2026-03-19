import { FastifyInstance } from "fastify";
import { query } from "../../db/client";
import { requireAuth } from "../../middleware/require-auth";

/**
 * GET /tenant/dashboard
 *
 * Returns real tenant identity, usage, integration status, KPIs,
 * recent conversations, and recent bookings for the signed-in tenant.
 * Protected by JWT auth — tenantId comes from the verified token.
 */
export async function tenantDashboardRoute(app: FastifyInstance) {
  app.get("/dashboard", { preHandler: [requireAuth] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string; email: string };

    const [
      tenantRows,
      calendarRows,
      phoneRows,
      convsTodayRows,
      appointmentsTodayRows,
      activeConvsRows,
      convsThisMonthRows,
      appointmentsThisMonthRows,
      totalConvsRows,
      totalAppointmentsRows,
      recentConvRows,
      recentBookingRows,
    ] = await Promise.all([
      // Tenant identity + billing + business hours (for onboarding check)
      query(
        `SELECT id, shop_name, owner_email, billing_status, plan_id,
                conv_used_this_cycle, conv_limit_this_cycle,
                trial_started_at, trial_ends_at,
                warned_80pct, warned_100pct, created_at,
                business_hours
         FROM tenants WHERE id = $1`,
        [tenantId]
      ),
      // Google Calendar integration
      query(
        `SELECT calendar_id, connected_at, last_refreshed, token_expiry,
                integration_status, google_account_email
         FROM tenant_calendar_tokens WHERE tenant_id = $1`,
        [tenantId]
      ),
      // Twilio phone
      query(
        `SELECT phone_number, status, provisioned_at
         FROM tenant_phone_numbers WHERE tenant_id = $1
         ORDER BY provisioned_at DESC LIMIT 1`,
        [tenantId]
      ),
      // Conversations today
      query(
        `SELECT COUNT(*)::int AS count FROM conversations
         WHERE tenant_id = $1 AND opened_at >= CURRENT_DATE`,
        [tenantId]
      ),
      // Appointments scheduled for today
      query(
        `SELECT COUNT(*)::int AS count FROM appointments
         WHERE tenant_id = $1
           AND scheduled_at >= CURRENT_DATE
           AND scheduled_at < CURRENT_DATE + INTERVAL '1 day'`,
        [tenantId]
      ),
      // Active conversations
      query(
        `SELECT COUNT(*)::int AS count FROM conversations
         WHERE tenant_id = $1 AND status = 'open'`,
        [tenantId]
      ),
      // Conversations this month
      query(
        `SELECT COUNT(*)::int AS count FROM conversations
         WHERE tenant_id = $1
           AND opened_at >= date_trunc('month', CURRENT_DATE)`,
        [tenantId]
      ),
      // Appointments this month
      query(
        `SELECT COUNT(*)::int AS count FROM appointments
         WHERE tenant_id = $1
           AND created_at >= date_trunc('month', CURRENT_DATE)`,
        [tenantId]
      ),
      // Total conversations (all time)
      query(
        `SELECT COUNT(*)::int AS count FROM conversations WHERE tenant_id = $1`,
        [tenantId]
      ),
      // Total appointments (all time)
      query(
        `SELECT COUNT(*)::int AS count FROM appointments WHERE tenant_id = $1`,
        [tenantId]
      ),
      // Recent conversations (last 20)
      query(
        `SELECT id, customer_phone, status, turn_count,
                opened_at, last_message_at, closed_at, close_reason
         FROM conversations
         WHERE tenant_id = $1
         ORDER BY opened_at DESC LIMIT 20`,
        [tenantId]
      ),
      // Recent bookings (last 20)
      query(
        `SELECT id, conversation_id, customer_phone, customer_name,
                service_type, scheduled_at, calendar_synced,
                google_event_id, booking_state, created_at,
                completed_at, final_price
         FROM appointments
         WHERE tenant_id = $1
         ORDER BY created_at DESC LIMIT 20`,
        [tenantId]
      ),
    ]);

    const tenant = (tenantRows as any[])[0];
    if (!tenant) {
      return reply.status(404).send({ error: "Tenant not found" });
    }

    const calendar = (calendarRows as any[])[0] || null;
    const phone = (phoneRows as any[])[0] || null;

    // Determine calendar integration status from integration_status column.
    // Do NOT derive status from token_expiry — access tokens expire every hour,
    // which is normal and does not mean the user needs to reconnect.
    // integration_status is set to 'active' on successful OAuth connect/reconnect,
    // and updated to 'refresh_failed' only when the refresh_token actually fails.
    let calendarStatus: string = "not_connected";
    if (calendar) {
      const status = calendar.integration_status;
      if (status === "active") {
        calendarStatus = "connected";
      } else if (status === "refresh_failed") {
        calendarStatus = "token_expired"; // UI maps this to "Needs Reconnect"
      } else {
        // 'pending' or unknown — treat as not connected
        calendarStatus = "not_connected";
      }
    }

    // ── Compute server-side onboarding state ──
    const phoneConnected = phone?.status === "active";
    // business_hours is free-form TEXT; consider "configured" if non-empty/non-null
    const hoursConfigured = !!(tenant.business_hours && tenant.business_hours.trim().length > 0);
    const calendarConnected = calendarStatus === "connected";
    const totalConvs = (totalConvsRows as any[])[0]?.count ?? 0;
    const totalAppts = (totalAppointmentsRows as any[])[0]?.count ?? 0;
    const hasActivity = totalConvs > 0 || totalAppts > 0;
    // Onboarding complete when phone is active AND system has received real activity.
    // Calendar and hours are important but not blocking — a shop can operate
    // with default hours and manual calendar. Phone + activity = system is live.
    const onboardingComplete = phoneConnected && hasActivity;

    return reply.status(200).send({
      tenant: {
        id: tenant.id,
        shop_name: tenant.shop_name,
        owner_email: tenant.owner_email,
        billing_status: tenant.billing_status,
        plan_id: tenant.plan_id,
        conv_used_this_cycle: tenant.conv_used_this_cycle,
        conv_limit_this_cycle: tenant.conv_limit_this_cycle,
        trial_ends_at: tenant.trial_ends_at,
        warned_80pct: tenant.warned_80pct,
        warned_100pct: tenant.warned_100pct,
        created_at: tenant.created_at,
      },
      integrations: {
        google_calendar: {
          status: calendarStatus,
          calendar_id: calendar?.calendar_id ?? null,
          connected_at: calendar?.connected_at ?? null,
          token_expiry: calendar?.token_expiry ?? null,
          google_account_email: calendar?.google_account_email ?? null,
        },
        twilio: {
          phone_number: phone?.phone_number ?? null,
          status: phone?.status ?? "not_provisioned",
        },
      },
      stats: {
        conversations_today: (convsTodayRows as any[])[0]?.count ?? 0,
        appointments_today: (appointmentsTodayRows as any[])[0]?.count ?? 0,
        active_conversations: (activeConvsRows as any[])[0]?.count ?? 0,
        conversations_this_month: (convsThisMonthRows as any[])[0]?.count ?? 0,
        appointments_this_month: (appointmentsThisMonthRows as any[])[0]?.count ?? 0,
        total_conversations: (totalConvsRows as any[])[0]?.count ?? 0,
        total_appointments: (totalAppointmentsRows as any[])[0]?.count ?? 0,
      },
      onboarding: {
        phone_connected: phoneConnected,
        hours_configured: hoursConfigured,
        calendar_connected: calendarConnected,
        has_activity: hasActivity,
        onboarding_complete: onboardingComplete,
      },
      recent_conversations: recentConvRows,
      recent_bookings: recentBookingRows,
    });
  });
}
