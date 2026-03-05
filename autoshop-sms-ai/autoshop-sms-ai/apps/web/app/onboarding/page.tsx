'use client';
import { useState, useEffect } from 'react';
import { useApi } from '../../lib/api';
import type { OnboardingStatus } from '@autoshop/shared';

const C = {
  bg: '#0D1B2A', surface: '#0F2233', border: 'rgba(255,255,255,0.07)',
  text: '#F0EDE8', muted: '#8CA0B5', rust: '#C1440E', amber: '#D4820A',
  mono: "'IBM Plex Mono', monospace", cond: "'Barlow Condensed', sans-serif", body: "'Barlow', sans-serif",
};

const input = {
  width: '100%', background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`,
  color: C.text, padding: '0.75rem 1rem', fontFamily: C.body, fontSize: '1rem',
  outline: 'none', boxSizing: 'border-box' as const,
};

const btn = {
  background: C.rust, color: C.text, fontFamily: C.cond, fontWeight: 700,
  fontSize: '1rem', letterSpacing: '0.1em', textTransform: 'uppercase' as const,
  padding: '0.75rem 2rem', border: 'none', cursor: 'pointer',
};

const btnSecondary = {
  ...btn, background: 'transparent', border: `1px solid ${C.border}`,
};

export default function OnboardingPage() {
  const { apiFetch } = useApi();
  const [step, setStep] = useState(1);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Step 1 state
  const [shopName, setShopName] = useState('');
  const [phone, setPhone] = useState('');
  const [timezone, setTimezone] = useState('America/Chicago');
  const [services, setServices] = useState<string[]>([]);

  // Step 2 state
  const [areaCode, setAreaCode] = useState('');
  const [provisionedNumber, setProvisionedNumber] = useState('');

  // Step 4 state
  const [testPhone, setTestPhone] = useState('');
  const [fwdInstructions, setFwdInstructions] = useState<Record<string, string> | null>(null);

  const serviceOptions = ['Oil Change', 'Brakes', 'Tires', 'AC/Heating', 'Transmission', 'Engine', 'Electrical', 'General Repair'];

  useEffect(() => {
    apiFetch<OnboardingStatus>('/api/onboarding/status')
      .then(s => {
        setStatus(s);
        // Resume at correct step
        if (!s.shop_profile) setStep(1);
        else if (!s.number_provisioned) setStep(2);
        else if (!s.calendar_connected) setStep(3);
        else if (!s.forwarding_verified) setStep(4);
        else window.location.href = '/dashboard';
      })
      .catch(() => {});
  }, [apiFetch]);

  const submitStep1 = async () => {
    if (!shopName || !phone) { setError('Shop name and phone are required.'); return; }
    setLoading(true); setError('');
    try {
      await apiFetch('/api/onboarding/shop', {
        method: 'POST',
        body: JSON.stringify({ shop_name: shopName, phone, timezone, services }),
      });
      setStep(2);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  const submitStep2 = async () => {
    if (!areaCode || areaCode.length !== 3) { setError('Enter a valid 3-digit area code.'); return; }
    setLoading(true); setError('');
    try {
      const res = await apiFetch<{ phone_number: string }>('/api/onboarding/provision-number', {
        method: 'POST',
        body: JSON.stringify({ area_code: areaCode }),
      });
      setProvisionedNumber(res.phone_number);
      setStep(3);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  const loadFwdInstructions = async () => {
    const res = await apiFetch<{ instructions: Record<string, string>; your_sms_number: string }>(
      '/api/onboarding/forwarding-instructions'
    );
    setFwdInstructions(res.instructions);
    setProvisionedNumber(res.your_sms_number);
  };

  const sendTestSms = async () => {
    if (!testPhone) { setError('Enter a phone number to test.'); return; }
    setLoading(true); setError(''); setSuccess('');
    try {
      await apiFetch('/api/onboarding/test-sms', {
        method: 'POST',
        body: JSON.stringify({ to_phone: testPhone }),
      });
      setSuccess('Test SMS sent! Check your phone. Once confirmed, your system is live.');
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  const progressDots = [1, 2, 3, 4];

  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ maxWidth: '540px', width: '100%' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontFamily: C.cond, fontWeight: 800, fontSize: '1.75rem', color: C.text }}>
            AUTO<span style={{ color: C.rust }}>SHOP</span> SMS AI
          </div>
          <div style={{ fontFamily: C.mono, fontSize: '0.7rem', color: C.muted, marginTop: '0.25rem' }}>SETUP WIZARD</div>
        </div>

        {/* Progress */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', alignItems: 'center' }}>
          {progressDots.map(s => (
            <div key={s} style={{ flex: 1, height: '3px', background: s <= step ? C.rust : C.border, transition: 'background 0.3s' }} />
          ))}
        </div>

        <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: '2rem' }}>
          {error && <div style={{ color: C.rust, fontFamily: C.mono, fontSize: '0.75rem', marginBottom: '1rem', padding: '0.75rem', border: `1px solid ${C.rust}` }}>{error}</div>}
          {success && <div style={{ color: '#2A7A3B', fontFamily: C.mono, fontSize: '0.75rem', marginBottom: '1rem', padding: '0.75rem', border: '1px solid #2A7A3B' }}>{success}</div>}

          {/* STEP 1 — Shop Profile */}
          {step === 1 && (
            <div>
              <div style={{ fontFamily: C.mono, fontSize: '0.7rem', color: C.muted, letterSpacing: '0.1em', marginBottom: '0.5rem' }}>STEP 1 OF 4</div>
              <h2 style={{ fontFamily: C.cond, fontSize: '1.75rem', color: C.text, margin: '0 0 1.5rem' }}>Shop Profile</h2>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontFamily: C.mono, fontSize: '0.7rem', color: C.muted, display: 'block', marginBottom: '0.5rem' }}>SHOP NAME</label>
                <input style={input} value={shopName} onChange={e => setShopName(e.target.value)} placeholder="Mike's Auto Repair" />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontFamily: C.mono, fontSize: '0.7rem', color: C.muted, display: 'block', marginBottom: '0.5rem' }}>BUSINESS PHONE</label>
                <input style={input} value={phone} onChange={e => setPhone(e.target.value)} placeholder="(214) 555-0123" type="tel" />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontFamily: C.mono, fontSize: '0.7rem', color: C.muted, display: 'block', marginBottom: '0.5rem' }}>TIMEZONE</label>
                <select style={input} value={timezone} onChange={e => setTimezone(e.target.value)}>
                  <option value="America/Chicago">Central Time (Dallas, Houston, Austin)</option>
                  <option value="America/Denver">Mountain Time (El Paso)</option>
                </select>
              </div>
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ fontFamily: C.mono, fontSize: '0.7rem', color: C.muted, display: 'block', marginBottom: '0.75rem' }}>SERVICES OFFERED</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {serviceOptions.map(s => (
                    <button key={s} onClick={() => setServices(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])}
                      style={{ ...btnSecondary, padding: '0.35rem 0.75rem', fontSize: '0.8rem', background: services.includes(s) ? 'rgba(193,68,14,0.2)' : 'transparent', borderColor: services.includes(s) ? C.rust : C.border }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <button style={btn} onClick={submitStep1} disabled={loading}>
                {loading ? 'SAVING...' : 'NEXT: GET SMS NUMBER →'}
              </button>
            </div>
          )}

          {/* STEP 2 — Get SMS Number */}
          {step === 2 && (
            <div>
              <div style={{ fontFamily: C.mono, fontSize: '0.7rem', color: C.muted, letterSpacing: '0.1em', marginBottom: '0.5rem' }}>STEP 2 OF 4</div>
              <h2 style={{ fontFamily: C.cond, fontSize: '1.75rem', color: C.text, margin: '0 0 1rem' }}>Get Your SMS Number</h2>
              <p style={{ fontFamily: C.body, color: C.muted, fontSize: '0.9rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
                We'll provision a local Texas phone number. Customers who miss their call will receive SMS from this number.
              </p>
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ fontFamily: C.mono, fontSize: '0.7rem', color: C.muted, display: 'block', marginBottom: '0.5rem' }}>PREFERRED AREA CODE</label>
                <input style={{ ...input, maxWidth: '120px' }} value={areaCode} onChange={e => setAreaCode(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="214" maxLength={3} />
              </div>
              {provisionedNumber && (
                <div style={{ background: 'rgba(42,122,59,0.1)', border: '1px solid rgba(42,122,59,0.4)', padding: '1rem', marginBottom: '1.5rem' }}>
                  <div style={{ fontFamily: C.mono, fontSize: '0.7rem', color: '#2A7A3B' }}>YOUR SMS NUMBER</div>
                  <div style={{ fontFamily: C.cond, fontSize: '1.75rem', color: C.text, marginTop: '0.25rem' }}>{provisionedNumber}</div>
                </div>
              )}
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <button style={btn} onClick={submitStep2} disabled={loading}>
                  {loading ? 'PROVISIONING...' : 'PROVISION NUMBER →'}
                </button>
                <button style={btnSecondary} onClick={() => setStep(3)} disabled={loading}>
                  SKIP FOR NOW
                </button>
              </div>
            </div>
          )}

          {/* STEP 3 — Connect Google Calendar */}
          {step === 3 && (
            <div>
              <div style={{ fontFamily: C.mono, fontSize: '0.7rem', color: C.muted, letterSpacing: '0.1em', marginBottom: '0.5rem' }}>STEP 3 OF 4</div>
              <h2 style={{ fontFamily: C.cond, fontSize: '1.75rem', color: C.text, margin: '0 0 1rem' }}>Connect Google Calendar</h2>
              <p style={{ fontFamily: C.body, color: C.muted, fontSize: '0.9rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
                Booked appointments will automatically appear in your Google Calendar. Skip to do this later.
              </p>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <button style={btn} onClick={async () => {
                  const res = await apiFetch<{ url: string }>('/api/onboarding/google/oauth-url');
                  window.location.href = res.url;
                }}>
                  CONNECT GOOGLE CALENDAR →
                </button>
                <button style={btnSecondary} onClick={() => setStep(4)}>
                  SKIP FOR NOW
                </button>
              </div>
            </div>
          )}

          {/* STEP 4 — Call Forwarding */}
          {step === 4 && (
            <div>
              <div style={{ fontFamily: C.mono, fontSize: '0.7rem', color: C.muted, letterSpacing: '0.1em', marginBottom: '0.5rem' }}>STEP 4 OF 4</div>
              <h2 style={{ fontFamily: C.cond, fontSize: '1.75rem', color: C.text, margin: '0 0 1rem' }}>Set Up Call Forwarding</h2>
              <p style={{ fontFamily: C.body, color: C.muted, fontSize: '0.9rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
                Forward missed calls from your existing business phone to your SMS number. We'll text back every missed call automatically.
              </p>

              {!fwdInstructions && (
                <button style={{ ...btnSecondary, marginBottom: '1rem' }} onClick={loadFwdInstructions}>
                  LOAD FORWARDING INSTRUCTIONS
                </button>
              )}

              {fwdInstructions && (
                <div style={{ marginBottom: '1.5rem' }}>
                  {provisionedNumber && (
                    <div style={{ background: 'rgba(193,68,14,0.1)', border: '1px solid rgba(193,68,14,0.3)', padding: '1rem', marginBottom: '1rem' }}>
                      <div style={{ fontFamily: C.mono, fontSize: '0.7rem', color: C.rust }}>YOUR SMS NUMBER</div>
                      <div style={{ fontFamily: C.cond, fontSize: '1.75rem', color: C.text }}>{provisionedNumber}</div>
                    </div>
                  )}
                  {Object.entries(fwdInstructions).map(([carrier, instruction]) => (
                    <div key={carrier} style={{ padding: '0.75rem', borderBottom: `1px solid ${C.border}` }}>
                      <div style={{ fontFamily: C.mono, fontSize: '0.65rem', color: C.amber, textTransform: 'uppercase', marginBottom: '0.25rem' }}>{carrier}</div>
                      <div style={{ fontFamily: C.mono, fontSize: '0.8rem', color: C.muted }}>{instruction}</div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ fontFamily: C.mono, fontSize: '0.7rem', color: C.muted, display: 'block', marginBottom: '0.5rem' }}>SEND TEST SMS TO</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input style={{ ...input, flex: 1 }} value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="+12145550001" type="tel" />
                  <button style={btn} onClick={sendTestSms} disabled={loading}>
                    {loading ? '...' : 'SEND'}
                  </button>
                </div>
              </div>

              <button style={btn} onClick={() => window.location.href = '/dashboard'}>
                GO TO DASHBOARD →
              </button>
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: '1.5rem', fontFamily: C.mono, fontSize: '0.65rem', color: C.muted }}>
          <a href="/dashboard" style={{ color: C.muted }}>SKIP TO DASHBOARD</a>
        </div>
      </div>
    </div>
  );
}
