import { currentUser } from '@/lib/auth/session';
import { redirect, notFound } from 'next/navigation';
import { ClinicApp } from '@/components/clinic-app';
export const dynamic = 'force-dynamic';
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
      const { isSupabaseConfigured } = await import('@/lib/supabase/config');
      const { demoEnabled } = await import('@/lib/auth/session');
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
  return <ClinicApp route={route} />;
}
