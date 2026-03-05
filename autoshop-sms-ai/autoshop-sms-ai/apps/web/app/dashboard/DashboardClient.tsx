'use client';
import { useEffect, useState, useCallback } from 'react';
import { useApi } from '../../lib/api';
import type { KpiResponse, HealthResponse, ConversationListItem, AppointmentRecord } from '@autoshop/shared';

// ─── Design tokens (match existing dashboard CSS) ─────────────
const C = {
  bg:      '#0D1B2A',
  surface: '#0F2233',
  border:  'rgba(255,255,255,0.07)',
  text:    '#F0EDE8',
  muted:   '#8CA0B5',
  rust:    '#C1440E',
  amber:   '#D4820A',
  green:   '#2A7A3B',
  mono:    "'IBM Plex Mono', monospace",
  cond:    "'Barlow Condensed', sans-serif",
  body:    "'Barlow', sans-serif",
};

const card = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  padding: '1.5rem',
  marginBottom: '1rem',
};

function KpiCard({ label, value, sub, warn }: { label: string; value: string | number; sub?: string; warn?: boolean }) {
  return (
    <div style={{ ...card, flex: 1, minWidth: '180px' }}>
      <div style={{ fontFamily: C.mono, fontSize: '0.7rem', color: warn ? C.amber : C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>{label}</div>
      <div style={{ fontFamily: C.cond, fontSize: '2.5rem', fontWeight: 800, color: warn ? C.amber : C.text }}>{value}</div>
      {sub && <div style={{ fontFamily: C.body, fontSize: '0.8rem', color: C.muted, marginTop: '0.25rem' }}>{sub}</div>}
    </div>
  );
}

function Banner({ type, message }: { type: 'warn' | 'error' | 'info'; message: string }) {
  const colors = { warn: C.amber, error: C.rust, info: '#2A7A3B' };
  return (
    <div style={{ padding: '0.75rem 1.5rem', borderLeft: `4px solid ${colors[type]}`, background: `rgba(255,255,255,0.03)`, marginBottom: '1rem', fontFamily: C.body, color: C.text, fontSize: '0.9rem' }}>
      {message}
    </div>
  );
}

export default function DashboardClient() {
  const { apiFetch } = useApi();
  const [kpis, setKpis] = useState<KpiResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [k, h, c, a] = await Promise.all([
        apiFetch<KpiResponse>('/api/dashboard/kpis'),
        apiFetch<HealthResponse>('/api/dashboard/health'),
        apiFetch<ConversationListItem[]>('/api/dashboard/conversations?limit=5'),
        apiFetch<AppointmentRecord[]>('/api/dashboard/appointments?upcoming=true'),
      ]);
      setKpis(k); setHealth(h);
      setConversations(c); setAppointments(a);
    } catch (e) {
      console.error('Dashboard load failed:', e);
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontFamily: C.mono }}>
        LOADING...
      </div>
    );
  }

  const pctUsed = kpis?.pct_used ?? 0;

  return (
    <div style={{ minHeight: '100vh', background: C.bg, padding: '2rem' }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontFamily: C.cond, fontWeight: 800, fontSize: '1.75rem', color: C.text }}>
            AUTO<span style={{ color: C.rust }}>SHOP</span> SMS AI
          </div>
          <div style={{ fontFamily: C.mono, fontSize: '0.7rem', color: C.muted, letterSpacing: '0.1em' }}>DASHBOARD</div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: health?.twilio_connected ? '#2A7A3B' : C.rust }} />
          <span style={{ fontFamily: C.mono, fontSize: '0.7rem', color: health?.twilio_connected ? '#2A7A3B' : C.rust }}>
            {health?.twilio_connected ? 'SMS LIVE' : 'SMS OFFLINE'}
          </span>
          <div style={{ marginLeft: '1rem', width: 8, height: 8, borderRadius: '50%', background: health?.calendar_connected ? '#2A7A3B' : C.amber }} />
          <span style={{ fontFamily: C.mono, fontSize: '0.7rem', color: health?.calendar_connected ? '#2A7A3B' : C.amber }}>
            {health?.calendar_connected ? 'CAL SYNCED' : 'CAL OFFLINE'}
          </span>
        </div>
      </div>

      {/* Banners */}
      {health?.billing_state === 'trial' && health.trial_days_left !== null && health.trial_days_left <= 3 && (
        <Banner type="warn" message={`⚠ Trial expires in ${health.trial_days_left} day${health.trial_days_left !== 1 ? 's' : ''}. Upgrade to keep your SMS number active.`} />
      )}
      {health?.billing_state === 'trial_expired' && (
        <Banner type="error" message="✕ Trial expired. Upgrade to resume service and recover missed calls." />
      )}
      {health?.billing_state === 'past_due' && (
        <Banner type="error" message="⚠ Payment failed. Update your payment method to avoid service suspension." />
      )}
      {pctUsed >= 100 && (
        <Banner type="warn" message="⚠ You've reached your monthly conversation limit. Upgrade to Pro for more capacity." />
      )}
      {pctUsed >= 80 && pctUsed < 100 && (
        <Banner type="warn" message={`Usage at ${Math.round(pctUsed)}%. Consider upgrading before your limit is reached.`} />
      )}
      {!health?.calendar_connected && (
        <Banner type="info" message="Calendar not connected — appointments won't sync. Connect in Settings." />
      )}

      {/* KPIs */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
        <KpiCard label="Conversations This Month" value={kpis?.conversations_this_month ?? 0} sub={`of ${kpis?.limit ?? 0} limit`} warn={pctUsed >= 80} />
        <KpiCard label="Appointments Booked" value={kpis?.appointments_booked ?? 0} />
        <KpiCard label="Avg Response Time" value={kpis?.avg_response_time_s ? `${kpis.avg_response_time_s}s` : '—'} />
        <KpiCard label="Plan" value={(health?.plan ?? 'trial').toUpperCase()} />
      </div>

      {/* Usage bar */}
      <div style={{ ...card, marginBottom: '2rem' }}>
        <div style={{ fontFamily: C.mono, fontSize: '0.7rem', color: C.muted, letterSpacing: '0.1em', marginBottom: '0.75rem' }}>MONTHLY USAGE</div>
        <div style={{ background: 'rgba(255,255,255,0.07)', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(pctUsed, 100)}%`, background: pctUsed >= 100 ? C.rust : pctUsed >= 80 ? C.amber : '#2A7A3B', transition: 'width 0.3s ease' }} />
        </div>
        <div style={{ fontFamily: C.mono, fontSize: '0.7rem', color: C.muted, marginTop: '0.5rem' }}>
          {kpis?.conversations_this_month ?? 0} / {kpis?.limit ?? 0} conversations · {Math.round(pctUsed)}%
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        {/* Recent Conversations */}
        <div style={card}>
          <div style={{ fontFamily: C.mono, fontSize: '0.7rem', color: C.muted, letterSpacing: '0.1em', marginBottom: '1rem' }}>RECENT CONVERSATIONS</div>
          {conversations.length === 0 ? (
            <div style={{ color: C.muted, fontFamily: C.body, fontSize: '0.875rem' }}>No conversations yet. Once your first missed call comes in, it'll appear here.</div>
          ) : (
            conversations.map(conv => (
              <div key={conv.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 0', borderBottom: `1px solid ${C.border}` }}>
                <div>
                  <div style={{ fontFamily: C.mono, fontSize: '0.8rem', color: C.text }}>{conv.customer_phone}</div>
                  <div style={{ fontFamily: C.body, fontSize: '0.75rem', color: C.muted, marginTop: '0.25rem' }}>{conv.last_message_preview ?? '...'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: C.mono, fontSize: '0.65rem', color: conv.status === 'completed' ? '#2A7A3B' : conv.status === 'open' ? C.amber : C.muted, textTransform: 'uppercase' }}>{conv.status}</div>
                  <div style={{ fontFamily: C.mono, fontSize: '0.65rem', color: C.muted, marginTop: '0.25rem' }}>{new Date(conv.opened_at).toLocaleDateString()}</div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Upcoming Appointments */}
        <div style={card}>
          <div style={{ fontFamily: C.mono, fontSize: '0.7rem', color: C.muted, letterSpacing: '0.1em', marginBottom: '1rem' }}>UPCOMING APPOINTMENTS</div>
          {appointments.length === 0 ? (
            <div style={{ color: C.muted, fontFamily: C.body, fontSize: '0.875rem' }}>No upcoming appointments. They'll appear here once the AI books one.</div>
          ) : (
            appointments.map(appt => (
              <div key={appt.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 0', borderBottom: `1px solid ${C.border}` }}>
                <div>
                  <div style={{ fontFamily: C.mono, fontSize: '0.8rem', color: C.text }}>{appt.customer_name ?? appt.customer_phone}</div>
                  <div style={{ fontFamily: C.body, fontSize: '0.75rem', color: C.muted }}>{appt.service_type ?? 'Auto Repair'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: C.mono, fontSize: '0.7rem', color: C.text }}>{new Date(appt.scheduled_at).toLocaleDateString()}</div>
                  <div style={{ fontFamily: C.mono, fontSize: '0.65rem', color: appt.sync_status === 'synced' ? '#2A7A3B' : C.amber, textTransform: 'uppercase', marginTop: '0.25rem' }}>{appt.sync_status}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Nav links */}
      <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem' }}>
        {[
          { href: '/dashboard/conversations', label: 'All Conversations' },
          { href: '/dashboard/appointments', label: 'Appointments' },
          { href: '/dashboard/settings', label: 'Settings' },
        ].map(({ href, label }) => (
          <a key={href} href={href} style={{ fontFamily: C.mono, fontSize: '0.75rem', color: C.muted, letterSpacing: '0.1em', textDecoration: 'none', padding: '0.5rem 1rem', border: `1px solid ${C.border}` }}>
            {label.toUpperCase()} →
          </a>
        ))}
      </div>
    </div>
  );
}
