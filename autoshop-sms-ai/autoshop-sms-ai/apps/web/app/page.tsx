// Marketing homepage — preserves existing HTML styling.
// The full HTML from autoshop-landing.html is served here.
// This component loads it and injects Clerk sign-up links.
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import LandingPage from './marketing/LandingPage';

export default async function HomePage() {
  const { userId } = auth();
  if (userId) redirect('/dashboard');
  return <LandingPage />;
}
