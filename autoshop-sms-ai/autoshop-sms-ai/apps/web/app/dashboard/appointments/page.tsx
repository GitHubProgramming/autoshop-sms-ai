'use client';
import { useState, useEffect } from 'react';
import { useApi } from '../../../lib/api';

const C = { bg: '#0D1B2A', surface: '#0F2233', border: 'rgba(255,255,255,0.07)', text: '#F0EDE8', muted: '#8CA0B5', rust: '#C1440E', amber: '#D4820A', green: '#2A7A3B', mono: "'IBM Plex Mono', monospace", cond: "'Barlow Condensed', sans-serif", body: "'Barlow', sans-serif" };

interface Appointment {
  id: string; customer_name: string | null; customer_phone: string;
  service_type: string | null; scheduled_at: string;
  duration_mins: number; sync_status: string; sync_error: string | null;
}

export default function AppointmentsPage() {
  const { apiFetch } = useApi();
  const [appts, setAppts] = useState<Appointment[]>([]);

  useEffect(() => {
    apiFetch<Appointment[]>('/api/dashboard/appointments').then(setAppts).catch(() => {});
  }, [apiFetch]);

  const syncColor = (s: string) => ({ synced: C.green, pending: C.amber, failed: C.rust, not_connected: C.muted }[s] ?? C.muted);

  return (
    <div style={{ minHeight: '100vh', background: C.bg, padding: '2rem' }}>
      <a href="/dashboard" style={{ fontFamily: C.mono, fontSize: '0.7rem', color: C.muted, textDecoration: 'none' }}>← DASHBOARD</a>
      <h1 style={{ fontFamily: C.cond, fontSize: '2rem', color: C.text, margin: '1rem 0 2rem' }}>Appointments</h1>
      {appts.map(a => (
        <div key={a.id} style={{ background: C.surface, border: `1px solid ${C.border}`, padding: '1.25rem 1.5rem', marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: C.cond, fontSize: '1.1rem', color: C.text, fontWeight: 700 }}>{a.customer_name ?? a.customer_phone}</div>
            <div style={{ fontFamily: C.body, fontSize: '0.85rem', color: C.muted }}>{a.service_type ?? 'Auto Repair'} · {a.duration_mins}min</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: C.mono, fontSize: '0.8rem', color: C.text }}>{new Date(a.scheduled_at).toLocaleString('en-US', { timeZone: 'America/Chicago' })}</div>
            <div style={{ fontFamily: C.mono, fontSize: '0.65rem', color: syncColor(a.sync_status), textTransform: 'uppercase', marginTop: '0.25rem' }}>
              CAL: {a.sync_status}
            </div>
            {a.sync_error && <div style={{ fontFamily: C.mono, fontSize: '0.6rem', color: C.rust, marginTop: '0.25rem' }}>{a.sync_error}</div>}
          </div>
        </div>
      ))}
      {appts.length === 0 && <div style={{ fontFamily: C.body, color: C.muted, padding: '2rem', textAlign: 'center' }}>No appointments yet.</div>}
    </div>
  );
}
