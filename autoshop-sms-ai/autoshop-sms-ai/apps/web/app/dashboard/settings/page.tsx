'use client';
import { useState, useEffect } from 'react';
import { useApi } from '../../../lib/api';
import type { HealthResponse } from '@autoshop/shared';

const C = { bg: '#0D1B2A', surface: '#0F2233', border: 'rgba(255,255,255,0.07)', text: '#F0EDE8', muted: '#8CA0B5', rust: '#C1440E', amber: '#D4820A', green: '#2A7A3B', mono: "'IBM Plex Mono', monospace", cond: "'Barlow Condensed', sans-serif", body: "'Barlow', sans-serif" };
const card = { background: C.surface, border: `1px solid ${C.border}`, padding: '1.5rem', marginBottom: '1rem' };
const btn = { background: C.rust, color: C.text, fontFamily: C.cond, fontWeight: 700, fontSize: '0.9rem', letterSpacing: '0.1em', textTransform: 'uppercase' as const, padding: '0.6rem 1.5rem', border: 'none', cursor: 'pointer' };

export default function SettingsPage() {
  const { apiFetch } = useApi();
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    apiFetch<HealthResponse>('/api/dashboard/health').then(setHealth).catch(() => {});
  }, [apiFetch]);

  return (
    <div style={{ minHeight: '100vh', background: C.bg, padding: '2rem', maxWidth: '700px', margin: '0 auto' }}>
      <a href="/dashboard" style={{ fontFamily: C.mono, fontSize: '0.7rem', color: C.muted, textDecoration: 'none' }}>← DASHBOARD</a>
      <h1 style={{ fontFamily: C.cond, fontSize: '2rem', color: C.text, margin: '1rem 0 2rem' }}>Settings</h1>
      <div style={card}>
        <div style={{ fontFamily: C.mono, fontSize: '0.7rem', color: C.muted, marginBottom: '0.75rem' }}>GOOGLE CALENDAR</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: C.mono, color: health?.calendar_connected ? C.green : C.amber, fontSize: '0.85rem' }}>
            {health?.calendar_connected ? '● CONNECTED' : '○ NOT CONNECTED'}
          </span>
          <button style={btn} onClick={async () => {
            const res = await apiFetch<{ url: string }>('/api/onboarding/google/oauth-url');
            window.location.href = res.url;
          }}>
            {health?.calendar_connected ? 'RECONNECT' : 'CONNECT CALENDAR'}
          </button>
        </div>
        {health?.calendar_last_error && <div style={{ fontFamily: C.mono, fontSize: '0.7rem', color: C.rust, marginTop: '0.5rem' }}>{health.calendar_last_error}</div>}
      </div>
      <div style={card}>
        <div style={{ fontFamily: C.mono, fontSize: '0.7rem', color: C.muted, marginBottom: '0.75rem' }}>BILLING — {(health?.plan ?? 'trial').toUpperCase()}</div>
        <div style={{ fontFamily: C.body, color: C.muted, marginBottom: '1rem' }}>State: {health?.billing_state}</div>
        <a href="https://billing.stripe.com" target="_blank" rel="noreferrer" style={{ ...btn, textDecoration: 'none', display: 'inline-block' }}>MANAGE BILLING →</a>
      </div>
      <div style={card}>
        <div style={{ fontFamily: C.mono, fontSize: '0.7rem', color: C.muted, marginBottom: '0.75rem' }}>SMS NUMBER</div>
        <div style={{ fontFamily: C.mono, color: health?.twilio_connected ? C.green : C.rust, fontSize: '0.85rem' }}>
          {health?.twilio_connected ? '● ACTIVE' : '○ NOT PROVISIONED'}
        </div>
      </div>
    </div>
  );
}
