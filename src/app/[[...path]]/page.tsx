import type { Metadata } from 'next';
import { currentUser, demoEnabled } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { formatDoctorName } from '@/lib/format';
import { isOrganizationPubliclyBookable } from '@/lib/services/organization-policy';
import type { Doctor } from '@/lib/types';
import type { PublicDoctorDirectoryRow } from '@/lib/supabase/database.types';
import { redirect, notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { ClinicApp } from '@/components/clinic-app';

export const dynamic = 'force-dynamic';

interface PublicDoctorSummary {
  id: string;
  name: string;
  specialty: string;
  clinic: string;
  city: string;
  district: string;
  bio: string;
  fee: number;
  rating: number;
  reviews: number;
}

async function resolvePublicDoctor(doctorId: string): Promise<PublicDoctorSummary | null> {
  try {
    if (demoEnabled()) {
      const { get } = await import('@/lib/demo-db');
      const doc = get<Doctor>('doctor', doctorId);
      const org = doc
        ? get<{
            status: string;
            subscriptionStatus: string;
            periodEnd: string;
          }>('organization', doc.organizationId)
        : null;
      if (!doc || !doc.verified || !isOrganizationPubliclyBookable(org)) return null;
      return {
        id: doc.id,
        name: doc.name,
        specialty: doc.specialty,
        clinic: doc.clinic,
        city: doc.city,
        district: doc.district,
        bio: doc.bio,
        fee: doc.fee,
        rating: doc.rating,
        reviews: doc.reviews,
      };
    }

    if (isSupabaseConfigured()) {
      const { createSupabaseServer } = await import('@/lib/supabase/server');
      const client = await createSupabaseServer();
      const { data } = await client.rpc('public_doctor_directory');
      const rows = Array.isArray(data) ? (data as PublicDoctorDirectoryRow[]) : [];
      const found = rows.find((r) => r.id === doctorId);
      if (!found) return null;
      return {
        id: found.id,
        name: found.full_name,
        specialty: found.specialty_name ?? 'الطب العام',
        clinic: found.clinic_name ?? 'العيادة الطبية',
        city: found.city_name ?? 'دمشق',
        district: found.district ?? '',
        bio: found.bio_ar ?? '',
        fee: Number(found.consultation_fee ?? 25),
        rating: Number(found.rating_avg ?? 4.8),
        reviews: Number(found.reviews_count ?? 0),
      };
    }
  } catch {
    // Graceful fallback if directory is temporarily unreachable
  }
  return null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}): Promise<Metadata> {
  const { path } = await params;
  const route = '/' + (path ?? []).join('/');

  if (route === '/search') {
    return {
      title: 'ابحث عن طبيب واحجز موعدك فوراً | ClinicBook',
      description:
        'استكشف نخبة الأطباء والمراكز الطبية المعتمدة حسب التخصص والمدينة والحي واحجز موعدك المؤكد مباشرة.',
      openGraph: {
        title: 'اكتشف الأطباء واحجز موعدك | ClinicBook',
        description: 'محرك بحث طبي متقدم لحجز المواعيد السريرية المؤكدة دون انتظار.',
        locale: 'ar_SY',
        type: 'website',
      },
    };
  }

  if (route === '/register-clinic') {
    return {
      title: 'سجّل عيادتك أو مركزك الطبي | ClinicBook SaaS',
      description:
        'انضم إلى منظومة كلينك بوك السحابية لإدارة المواعيد، طابور الاستقبال، والسجل الطبي الإلكتروني.',
    };
  }

  if (route === '/login') {
    return {
      title: 'تسجيل الدخول | ClinicBook',
      description: 'بوابة الدخول الموحدة للمرضى والأطباء وإدارات المراكز الطبية.',
    };
  }

  const docMatch = /^\/doctors\/([^/]+)$/.exec(route);
  if (docMatch) {
    const doc = await resolvePublicDoctor(decodeURIComponent(docMatch[1]));
    if (doc) {
      const displayName = formatDoctorName(doc.name);
      const title = `${displayName} — ${doc.specialty} في ${doc.city} | ClinicBook`;
      const description =
        doc.bio ||
        `احجز موعدك الإلكتروني مع ${displayName} (${doc.specialty}) في ${doc.clinic} — ${doc.city}.`;
      return {
        title,
        description,
        openGraph: {
          title,
          description,
          locale: 'ar_SY',
          type: 'profile',
        },
      };
    }
  }

  return {
    title: 'ClinicBook | رعاية أقرب. حياة أفضل.',
    description: 'مساحة واحدة لرعاية أفضل. اكتشف طبيبك واحجز موعدك، وأدر عيادتك بكل هدوء.',
  };
}

export default async function Page({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path } = await params;
  const route = '/' + (path ?? []).join('/');
  const valid = [
    '/',
    '/search',
    '/login',
    '/register-clinic',
    '/my-appointments',
    '/admin',
    '/workspace/dashboard',
    '/workspace/appointments',
    '/workspace/patients',
    '/workspace/schedule',
    '/workspace/team',
    '/workspace/billing',
    '/workspace/reports',
    '/workspace/settings',
  ];
  if (
    !valid.includes(route) &&
    !/^\/doctors\/[^/]+$/.test(route) &&
    !/^\/workspace\/patients\/[^/]+$/.test(route)
  )
    notFound();
  if (route === '/login') {
    const user = await currentUser();
    if (user) {
      const { redirectForUser } = await import('@/lib/auth/session');
      redirect(redirectForUser(user));
    }
  }
  if (
    route.startsWith('/workspace') ||
    route === '/admin' ||
    route === '/my-appointments' ||
    route === '/register-clinic'
  ) {
    const user = await currentUser();
    if (route === '/register-clinic') {
      // Clinic registration requires authentication when Supabase is active
      if (!demoEnabled() && isSupabaseConfigured() && !user) {
        redirect('/login?next=/register-clinic');
      }
    } else if (!user) {
      redirect(`/login?next=${encodeURIComponent(route)}`);
    }
    if (user) {
      const { redirectForUser } = await import('@/lib/auth/session');
      if (route === '/admin' && user.role !== 'super_admin') redirect(redirectForUser(user));
      if (
        route.startsWith('/workspace') &&
        !['clinic_owner', 'doctor', 'receptionist'].includes(user.role)
      )
        redirect(redirectForUser(user));
      if (route === '/my-appointments' && user.role !== 'patient') redirect(redirectForUser(user));
      // Clinic owner without org → must complete onboarding
      if (route.startsWith('/workspace') && user.role === 'clinic_owner' && !user.organizationId)
        redirect('/register-clinic?onboarding=1');
      if (
        [
          '/workspace/billing',
          '/workspace/team',
          '/workspace/settings',
          '/workspace/reports',
        ].includes(route) &&
        user.role !== 'clinic_owner'
      )
        redirect('/workspace/dashboard');
      if (route.startsWith('/workspace/patients/') && user.role !== 'doctor')
        redirect('/workspace/patients');
    }
  }

  const docMatch = /^\/doctors\/([^/]+)$/.exec(route);
  const doctorStructuredData = docMatch
    ? await resolvePublicDoctor(decodeURIComponent(docMatch[1]))
    : null;

  const jsonLd = doctorStructuredData
    ? JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Physician',
        name: formatDoctorName(doctorStructuredData.name),
        medicalSpecialty: doctorStructuredData.specialty,
        description: doctorStructuredData.bio,
        address: {
          '@type': 'PostalAddress',
          addressLocality: doctorStructuredData.city,
          streetAddress: doctorStructuredData.district,
        },
        worksFor: {
          '@type': 'MedicalClinic',
          name: doctorStructuredData.clinic,
        },
        ...(doctorStructuredData.reviews > 0
          ? {
              aggregateRating: {
                '@type': 'AggregateRating',
                ratingValue: doctorStructuredData.rating,
                reviewCount: doctorStructuredData.reviews,
              },
            }
          : {}),
      }).replace(/</g, '\\u003c')
    : null;

  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: jsonLd }}
        />
      )}
      <ClinicApp route={route} />
    </>
  );
}
