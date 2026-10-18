import type { Metadata } from 'next';
import { AppProvider } from '@/components/app-provider';
import { DirectionProvider } from '@radix-ui/react-direction';
import './globals.css';
export const metadata: Metadata = {
  title: 'ClinicBook | رعاية أقرب. حياة أفضل.',
  description: 'مساحة واحدة لرعاية أفضل. اكتشف طبيبك واحجز موعدك، وأدر عيادتك بكل هدوء.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
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
        <link
          rel="preload"
          as="image"
          href="/images/care-editorial.jpg"
          fetchPriority="high"
        />
      </head>
      <body>
        <DirectionProvider dir="rtl">
          <AppProvider>{children}</AppProvider>
        </DirectionProvider>
      </body>
    </html>
  );
}
