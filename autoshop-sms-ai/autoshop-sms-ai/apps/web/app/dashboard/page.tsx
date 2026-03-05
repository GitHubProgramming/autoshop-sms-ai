import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import DashboardClient from './DashboardClient';

export default async function DashboardPage() {
  const { userId } = auth();
  if (!userId) redirect('/sign-in');
  return <DashboardClient />;
}
