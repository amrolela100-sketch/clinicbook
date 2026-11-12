import type { Metadata } from 'next';
import { AppProvider } from '@/components/app-provider';
import { DirectionProvider } from '@radix-ui/react-direction';
import { fetchAppData } from '@/lib/services/app-data-service';
import './globals.css';
export const metadata: Metadata = {
  title: 'ClinicBook | رعاية أقرب. حياة أفضل.',
  description: 'مساحة واحدة لرعاية أفضل. اكتشف طبيبك واحجز موعدك، وأدر عيادتك بكل هدوء.',
};
// Per-request CSP nonces and personalized snapshots cannot use a shared static document.
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const initialData = await fetchAppData().catch(() => null);
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link
          rel="preload"
          href="/fonts/plex-400.ttf"
          as="font"
          type="font/ttf"
          crossOrigin="anonymous"
        />
        <link rel="preload" as="image" href="/images/care-editorial.jpg" fetchPriority="high" />
      </head>
      <body>
        <DirectionProvider dir="rtl">
          <AppProvider initialData={initialData}>{children}</AppProvider>
        </DirectionProvider>
      </body>
    </html>
  );
}
