import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { ThemeProvider } from '../theme/ThemeProvider';
import { AuthProvider } from '../auth/AuthProvider';
import '@noor-note/ui/styles.css';
import 'katex/dist/katex.min.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Noor Note — A brighter place to think',
  description: 'A private, local-first space for Markdown notes, tasks, and connected ideas.',
  applicationName: 'Noor Note',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#18382f',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body><ThemeProvider><AuthProvider>{children}</AuthProvider></ThemeProvider><Script src="/theme-init.js" strategy="beforeInteractive" /></body></html>;
}
