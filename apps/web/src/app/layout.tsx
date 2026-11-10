import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration';

export const metadata: Metadata = {
  title: { default: 'GABRIELA 2026', template: '%s | GABRIELA' },
  description: 'Přehledná správa bytových domů, jednotek, lidí a požadavků.',
  manifest: '/manifest.webmanifest',
  applicationName: 'GABRIELA'
};

export const viewport: Viewport = { themeColor: '#15354f', colorScheme: 'light' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="cs"><body><ServiceWorkerRegistration />{children}</body></html>;
}
