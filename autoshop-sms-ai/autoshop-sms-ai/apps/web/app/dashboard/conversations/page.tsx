'use client';
import { useState, useEffect } from 'react';
import { useApi } from '../../../lib/api';
import type { ConversationListItem } from '@autoshop/shared';

const C = { bg: '#0D1B2A', surface: '#0F2233', border: 'rgba(255,255,255,0.07)', text: '#F0EDE8', muted: '#8CA0B5', rust: '#C1440E', amber: '#D4820A', green: '#2A7A3B', mono: "'IBM Plex Mono', monospace", cond: "'Barlow Condensed', sans-serif", body: "'Barlow', sans-serif" };

export default function ConversationsPage() {
  const { apiFetch } = useApi();
  const [convs, setConvs] = useState<ConversationListItem[]>([]);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const qs = filter ? `?status=${filter}` : '';
    apiFetch<ConversationListItem[]>(`/api/dashboard/conversations${qs}&limit=50`).then(setConvs).catch(() => {});
  }, [apiFetch, filter]);

  const statusColor = (s: string) => ({ open: C.amber, completed: C.green, closed_inactive: C.muted, blocked: C.rust }[s] ?? C.muted);

  return (
    <div style={{ minHeight: '100vh', background: C.bg, padding: '2rem' }}>
      <a href="/dashboard" style={{ fontFamily: C.mono, fontSize: '0.7rem', color: C.muted, textDecoration: 'none' }}>← DASHBOARD</a>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '1rem 0 2rem' }}>
        <h1 style={{ fontFamily: C.cond, fontSize: '2rem', color: C.text, margin: 0 }}>Conversations</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {['', 'open', 'completed', 'closed_inactive'].map(s => (
            <button key={s} onClick={() => setFilter(s)}
              style={{ fontFamily: C.mono, fontSize: '0.65rem', padding: '0.4rem 0.75rem', border: `1px solid ${filter === s ? C.rust : C.border}`, background: filter === s ? 'rgba(193,68,14,0.15)' : 'transparent', color: filter === s ? C.rust : C.muted, cursor: 'pointer', textTransform: 'uppercase' }}>
              {s || 'ALL'}
            </button>
          ))}
        </div>
      </div>
      {convs.map(c => (
        <a key={c.id} href={`/dashboard/conversations/${c.id}`} style={{ textDecoration: 'none' }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: '1rem 1.5rem', marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontFamily: C.mono, fontSize: '0.85rem', color: C.text }}>{c.customer_phone}</div>
              <div style={{ fontFamily: C.body, fontSize: '0.8rem', color: C.muted, marginTop: '0.25rem' }}>{c.last_message_preview ?? '—'}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: C.mono, fontSize: '0.65rem', color: statusColor(c.status), textTransform: 'uppercase' }}>{c.status}</div>
              <div style={{ fontFamily: C.mono, fontSize: '0.65rem', color: C.muted, marginTop: '0.25rem' }}>{c.trigger_type === 'missed_call' ? 'MISSED CALL' : 'SMS IN'}</div>
              <div style={{ fontFamily: C.mono, fontSize: '0.65rem', color: C.muted }}>{new Date(c.opened_at).toLocaleDateString()}</div>
            </div>
          </div>
        </a>
      ))}
      {convs.length === 0 && <div style={{ fontFamily: C.body, color: C.muted, padding: '2rem', textAlign: 'center' }}>No conversations found.</div>}
    </div>
  );
}
