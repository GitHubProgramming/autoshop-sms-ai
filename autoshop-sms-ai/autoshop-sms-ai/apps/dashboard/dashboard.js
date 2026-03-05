/**
 * AutoShop SMS AI — Dashboard API Integration
 * Wires existing HTML elements to live API data.
 * Preserves all existing styling/classes unchanged.
 */

const API_BASE = window.ENV?.API_BASE_URL || 'http://localhost:3001';

async function getToken() {
  // Clerk JWT — works if Clerk SDK is loaded on the page
  if (window.Clerk?.session) {
    return window.Clerk.session.getToken();
  }
  return localStorage.getItem('__auth_token');
}

async function apiFetch(path) {
  const token = await getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
  return res.json();
}

function setText(selector, value) {
  const el = document.querySelector(selector);
  if (el) el.textContent = value;
}

function setAttr(selector, attr, value) {
  const el = document.querySelector(selector);
  if (el) el.setAttribute(attr, value);
}

// ── KPIs ──────────────────────────────────────────────────────
async function loadKpis() {
  try {
    const kpis = await apiFetch('/api/dashboard/kpis');
    setText('[data-kpi="conversations"]', kpis.conversations_this_month);
    setText('[data-kpi="limit"]', kpis.limit);
    setText('[data-kpi="pct"]', `${Math.round(kpis.pct_used)}%`);
    setText('[data-kpi="appointments"]', kpis.appointments_booked);
    setText('[data-kpi="response-time"]', kpis.avg_response_time_s ? `${kpis.avg_response_time_s}s` : '—');

    // Update usage progress bar
    const bar = document.querySelector('[data-usage-bar]');
    if (bar) bar.style.width = `${Math.min(kpis.pct_used, 100)}%`;
  } catch (e) {
    console.error('KPI load failed:', e);
  }
}

// ── Health ────────────────────────────────────────────────────
async function loadHealth() {
  try {
    const h = await apiFetch('/api/dashboard/health');

    // SMS status indicator
    const smsStatus = document.querySelector('[data-status="sms"]');
    if (smsStatus) {
      smsStatus.textContent = h.twilio_connected ? 'LIVE' : 'OFFLINE';
      smsStatus.classList.toggle('status-active', h.twilio_connected);
      smsStatus.classList.toggle('status-error', !h.twilio_connected);
    }

    // Calendar status
    const calStatus = document.querySelector('[data-status="calendar"]');
    if (calStatus) {
      calStatus.textContent = h.calendar_connected ? 'CONNECTED' : 'NOT CONNECTED';
      calStatus.classList.toggle('status-active', h.calendar_connected);
      calStatus.classList.toggle('status-warn', !h.calendar_connected);
    }

    // Billing state
    setText('[data-billing="state"]', h.billing_state.toUpperCase());
    setText('[data-billing="plan"]', (h.plan || 'trial').toUpperCase());
    setText('[data-billing="remaining"]', h.conversations_remaining);

    // Trial countdown
    if (h.trial_days_left !== null) {
      setText('[data-trial="days"]', h.trial_days_left);
      const trialBanner = document.querySelector('[data-banner="trial"]');
      if (trialBanner && h.trial_days_left <= 3) {
        trialBanner.style.display = 'block';
        trialBanner.textContent = `⚠ Trial expires in ${h.trial_days_left} day(s). Upgrade to keep your SMS active.`;
      }
    }

    // Billing banners
    if (h.billing_state === 'trial_expired' || h.billing_state === 'suspended' || h.billing_state === 'canceled') {
      const banner = document.querySelector('[data-banner="billing"]');
      if (banner) {
        banner.style.display = 'block';
        banner.textContent = `Service suspended — billing state: ${h.billing_state}. Please update your subscription.`;
      }
    }

    // Past due
    if (h.billing_state === 'past_due') {
      const banner = document.querySelector('[data-banner="billing"]');
      if (banner) {
        banner.style.display = 'block';
        banner.textContent = `Payment failed. Update your payment method to avoid suspension.`;
      }
    }

  } catch (e) {
    console.error('Health load failed:', e);
  }
}

// ── Recent Conversations ──────────────────────────────────────
async function loadConversations() {
  try {
    const convs = await apiFetch('/api/dashboard/conversations?limit=5');
    const container = document.querySelector('[data-section="conversations"]');
    if (!container) return;

    container.innerHTML = convs.length === 0
      ? '<div class="empty-state">No conversations yet.</div>'
      : convs.map(c => `
          <div class="conv-row" data-id="${c.id}">
            <div class="conv-phone">${c.customer_phone}</div>
            <div class="conv-preview">${c.last_message_preview || '—'}</div>
            <div class="conv-meta">
              <span class="conv-status status-${c.status}">${c.status.toUpperCase()}</span>
              <span class="conv-date">${new Date(c.opened_at).toLocaleDateString()}</span>
            </div>
          </div>
        `).join('');

    // Make rows clickable
    container.querySelectorAll('[data-id]').forEach(row => {
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => {
        window.location.href = `/dashboard/conversations/${row.dataset.id}`;
      });
    });
  } catch (e) {
    console.error('Conversations load failed:', e);
  }
}

// ── Upcoming Appointments ─────────────────────────────────────
async function loadAppointments() {
  try {
    const appts = await apiFetch('/api/dashboard/appointments?upcoming=true');
    const container = document.querySelector('[data-section="appointments"]');
    if (!container) return;

    container.innerHTML = appts.length === 0
      ? '<div class="empty-state">No upcoming appointments.</div>'
      : appts.map(a => `
          <div class="appt-row">
            <div class="appt-name">${a.customer_name || a.customer_phone}</div>
            <div class="appt-service">${a.service_type || 'Auto Repair'}</div>
            <div class="appt-time">${new Date(a.scheduled_at).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
            <div class="appt-sync sync-${a.sync_status}">${a.sync_status.toUpperCase()}</div>
          </div>
        `).join('');
  } catch (e) {
    console.error('Appointments load failed:', e);
  }
}

// ── Usage Chart (simple bar) ──────────────────────────────────
async function loadUsageHistory() {
  try {
    const usage = await apiFetch('/api/dashboard/usage');
    const container = document.querySelector('[data-section="usage-chart"]');
    if (!container || !usage.length) return;

    container.innerHTML = usage.reverse().map(u => {
      const pct = u.conversations_count / Math.max(u.conversations_limit || 50, 1) * 100;
      const month = new Date(u.period_start).toLocaleString('en-US', { month: 'short', year: '2-digit' });
      return `
        <div class="usage-bar-item">
          <div class="usage-bar-label">${month}</div>
          <div class="usage-bar-track">
            <div class="usage-bar-fill" style="width:${Math.min(pct,100)}%; background: ${pct >= 100 ? '#C1440E' : pct >= 80 ? '#D4820A' : '#2A7A3B'}"></div>
          </div>
          <div class="usage-bar-count">${u.conversations_count}</div>
        </div>
      `;
    }).join('');
  } catch (e) {
    console.error('Usage history load failed:', e);
  }
}

// ── Init ──────────────────────────────────────────────────────
async function init() {
  // Parallel load all sections
  await Promise.allSettled([
    loadKpis(),
    loadHealth(),
    loadConversations(),
    loadAppointments(),
    loadUsageHistory(),
  ]);

  // Auto-refresh every 30 seconds
  setInterval(() => {
    loadKpis();
    loadHealth();
    loadConversations();
    loadAppointments();
  }, 30000);
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
