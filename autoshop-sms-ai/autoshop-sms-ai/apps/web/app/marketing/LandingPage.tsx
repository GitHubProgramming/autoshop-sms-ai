'use client';
import { SignUpButton, SignInButton } from '@clerk/nextjs';

// Design tokens matching existing landing page
const styles = {
  nav: {
    position: 'fixed' as const, top: 0, left: 0, right: 0, zIndex: 100,
    background: 'rgba(13,27,42,0.97)', borderBottom: '1px solid #1A2E42',
    padding: '0 2rem', display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', height: '64px',
  },
  logo: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: '1.5rem', color: '#F0EDE8', letterSpacing: '0.05em' },
  logoAccent: { color: '#C1440E' },
  hero: {
    minHeight: '100vh', display: 'flex', flexDirection: 'column' as const,
    alignItems: 'center', justifyContent: 'center', textAlign: 'center' as const,
    padding: '6rem 2rem 4rem', background: 'linear-gradient(180deg, #0D1B2A 0%, #0A1520 100%)',
  },
  heroTag: {
    fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.75rem',
    color: '#D4820A', letterSpacing: '0.15em', textTransform: 'uppercase' as const,
    border: '1px solid rgba(212,130,10,0.3)', padding: '0.35rem 1rem',
    borderRadius: '2px', marginBottom: '1.5rem', display: 'inline-block',
  },
  heroTitle: {
    fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800,
    fontSize: 'clamp(2.5rem, 8vw, 5rem)', lineHeight: 1.05,
    color: '#F0EDE8', marginBottom: '1.5rem', maxWidth: '800px',
  },
  accent: { color: '#C1440E' },
  heroSub: {
    fontFamily: 'Barlow, sans-serif', fontSize: '1.2rem', color: '#8CA0B5',
    maxWidth: '540px', lineHeight: 1.6, marginBottom: '2.5rem',
  },
  btnPrimary: {
    background: '#C1440E', color: '#F0EDE8', fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: 700, fontSize: '1.1rem', letterSpacing: '0.1em',
    textTransform: 'uppercase' as const, padding: '0.9rem 2.5rem',
    border: 'none', cursor: 'pointer', textDecoration: 'none',
    display: 'inline-block', marginRight: '1rem',
  },
  btnSecondary: {
    background: 'transparent', color: '#F0EDE8', fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: 600, fontSize: '1.1rem', letterSpacing: '0.05em',
    padding: '0.9rem 2rem', border: '1px solid rgba(240,237,232,0.3)',
    cursor: 'pointer', textDecoration: 'none', display: 'inline-block',
  },
  navBtn: {
    fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600,
    fontSize: '0.95rem', letterSpacing: '0.08em', padding: '0.5rem 1.25rem',
    cursor: 'pointer', background: 'transparent', border: 'none',
    color: '#F0EDE8', textTransform: 'uppercase' as const,
  },
  navBtnPrimary: {
    fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700,
    fontSize: '0.95rem', letterSpacing: '0.08em', padding: '0.5rem 1.5rem',
    cursor: 'pointer', background: '#C1440E', border: 'none',
    color: '#F0EDE8', textTransform: 'uppercase' as const,
  },
};

export default function LandingPage() {
  return (
    <div style={{ background: '#0D1B2A', minHeight: '100vh' }}>
      {/* NAV */}
      <nav style={styles.nav}>
        <div style={styles.logo}>
          AUTO<span style={styles.logoAccent}>SHOP</span> SMS AI
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <SignInButton mode="modal">
            <button style={styles.navBtn}>Log In</button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button style={styles.navBtnPrimary}>Start Free Trial</button>
          </SignUpButton>
        </div>
      </nav>

      {/* HERO */}
      <section style={styles.hero}>
        <div style={styles.heroTag}>Texas Auto Repair · Missed Call Recovery</div>
        <h1 style={styles.heroTitle}>
          Every Missed Call Is<br />
          <span style={styles.accent}>Lost Revenue.</span><br />
          We Fix That.
        </h1>
        <p style={styles.heroSub}>
          AutoShop SMS AI texts back every missed call in under 20 seconds.
          AI handles the conversation. Appointment booked. Calendar updated.
          Zero manual work.
        </p>
        <div>
          <SignUpButton mode="modal">
            <button style={styles.btnPrimary}>Start 14-Day Free Trial</button>
          </SignUpButton>
          <SignInButton mode="modal">
            <button style={styles.btnSecondary}>Sign In →</button>
          </SignInButton>
        </div>
        <p style={{ marginTop: '1.5rem', fontFamily: "'IBM Plex Mono'", fontSize: '0.75rem', color: '#4A6080' }}>
          14-day trial · 50 free conversations · No credit card required
        </p>
      </section>

      {/* PLANS */}
      <section style={{ padding: '5rem 2rem', maxWidth: '1100px', margin: '0 auto' }}>
        <h2 style={{ ...styles.heroTitle, fontSize: '2.5rem', textAlign: 'center', marginBottom: '3rem' }}>
          Simple, Transparent <span style={styles.accent}>Pricing</span>
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))', gap: '1.5rem' }}>
          {[
            { name: 'Starter', price: '$79', convs: '150 conversations/mo', cta: 'Get Started' },
            { name: 'Pro', price: '$149', convs: '400 conversations/mo', cta: 'Most Popular', highlight: true },
            { name: 'Premium', price: '$299', convs: '1,000 conversations/mo', cta: 'Go Premium' },
          ].map(plan => (
            <div key={plan.name} style={{
              background: plan.highlight ? 'rgba(193,68,14,0.1)' : 'rgba(255,255,255,0.03)',
              border: plan.highlight ? '1px solid rgba(193,68,14,0.5)' : '1px solid rgba(255,255,255,0.07)',
              padding: '2rem', textAlign: 'center',
            }}>
              <div style={{ fontFamily: "'Barlow Condensed'", fontSize: '1.25rem', color: plan.highlight ? '#C1440E' : '#8CA0B5', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>{plan.name}</div>
              <div style={{ fontFamily: "'Barlow Condensed'", fontSize: '3rem', fontWeight: 800, color: '#F0EDE8', marginBottom: '0.5rem' }}>{plan.price}<span style={{ fontSize: '1rem', color: '#8CA0B5' }}>/mo</span></div>
              <div style={{ fontFamily: 'Barlow', color: '#8CA0B5', marginBottom: '2rem' }}>{plan.convs}</div>
              <SignUpButton mode="modal">
                <button style={{ ...styles.btnPrimary, background: plan.highlight ? '#C1440E' : 'transparent', border: '1px solid rgba(193,68,14,0.5)', marginRight: 0, width: '100%' }}>{plan.cta}</button>
              </SignUpButton>
            </div>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '2rem', textAlign: 'center', color: '#4A6080', fontFamily: 'Barlow', fontSize: '0.875rem' }}>
        © 2025 AutoShop SMS AI · Texas Auto Repair Automation
      </footer>
    </div>
  );
}
