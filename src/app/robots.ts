import type { MetadataRoute } from 'next';

function resolveSiteBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (raw) {
    try {
      return new URL(raw).origin;
    } catch {
      // Fallback below
    }
  }
  return 'https://clinicbook.local';
}

export default function robots(): MetadataRoute.Robots {
  const baseUrl = resolveSiteBaseUrl();
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/search', '/doctors/', '/register-clinic'],
        disallow: ['/workspace/', '/admin', '/my-appointments', '/api/', '/auth/'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
