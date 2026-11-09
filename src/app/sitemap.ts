import type { MetadataRoute } from 'next';
import { demoEnabled } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import type { Doctor } from '@/lib/types';
import type { PublicDoctorDirectoryRow } from '@/lib/supabase/database.types';

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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = resolveSiteBaseUrl();
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl}/`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${baseUrl}/search`,
      lastModified: now,
      changeFrequency: 'hourly',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/register-clinic`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
  ];

  try {
    let doctorIds: string[] = [];
    if (demoEnabled()) {
      const { all } = await import('@/lib/demo-db');
      doctorIds = all<Doctor>('doctor')
        .filter((d) => d.verified)
        .map((d) => d.id);
    } else if (isSupabaseConfigured()) {
      const { createSupabaseServer } = await import('@/lib/supabase/server');
      const client = await createSupabaseServer();
      const { data } = await client.rpc('public_doctor_directory');
      const rows = Array.isArray(data) ? (data as PublicDoctorDirectoryRow[]) : [];
      doctorIds = rows.map((r) => r.id).filter(Boolean);
    }

    const doctorRoutes: MetadataRoute.Sitemap = doctorIds.map((id) => ({
      url: `${baseUrl}/doctors/${encodeURIComponent(id)}`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.8,
    }));

    return [...staticRoutes, ...doctorRoutes];
  } catch {
    return staticRoutes;
  }
}
