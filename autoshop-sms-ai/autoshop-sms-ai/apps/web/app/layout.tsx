import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AutoShop SMS AI — Never Miss a Customer Again',
  description: 'Automated SMS follow-up for Texas auto repair shops',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <head>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=Barlow:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
        </head>
        <body style={{ margin: 0, background: '#0D1B2A', color: '#F0EDE8', fontFamily: 'Barlow, sans-serif' }}>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
