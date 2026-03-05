import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#0D1B2A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <SignUp appearance={{ elements: { card: { background: '#0F2233', border: '1px solid rgba(255,255,255,0.07)' }, formButtonPrimary: { background: '#C1440E' } } }} afterSignUpUrl="/onboarding" />
    </div>
  );
}
