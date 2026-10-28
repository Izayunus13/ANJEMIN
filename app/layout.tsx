import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import '../client/styles.css';

// Keep the existing icon set and theme boot sequence as the shared source.
const template = readFileSync(path.join(process.cwd(), 'client/index.html'), 'utf8');
const icons = template.match(/<svg aria-hidden="true"[\s\S]*?<\/svg>/)?.[0] || '';
const themeScript = template.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '';
const bootStyles = template.match(/<style>([\s\S]*?)<\/style>/)?.[1] || '';

export const metadata: Metadata = {
  title: 'ANJEMIN — Mager? ANJEMIN Aja!',
  description: 'Anjem, Anterin Barang, Jastip, dan Lapak dalam satu tempat.',
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f9f6ff',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: bootStyles }} />
        <Script id="anjemin-theme" strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <div dangerouslySetInnerHTML={{ __html: icons }} />
        {children}
      </body>
    </html>
  );
}
