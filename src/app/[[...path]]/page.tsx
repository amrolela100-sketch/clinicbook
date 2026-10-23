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
  if (route.startsWith('/workspace') || route === '/admin' || route === '/my-appointments' || route === '/register-clinic') {
    const user = await currentUser();
    if (route === '/register-clinic') {
      // Clinic registration requires authentication when Supabase is active
      const { isSupabaseConfigured } = await import('@/lib/supabase/config');
      if (isSupabaseConfigured() && !user) redirect('/login?next=/register-clinic');
    } else if (!user) {
      redirect('/login');
    }
    if (user) {
      if (route === '/admin' && user.role !== 'super_admin') redirect('/login');
      if (
        route.startsWith('/workspace') &&
        !['clinic_owner', 'doctor', 'receptionist'].includes(user.role)
      )
        redirect('/login');
      if (route === '/my-appointments' && user.role !== 'patient') redirect('/login');
      // Clinic owner without org → must complete onboarding
      if (
        route.startsWith('/workspace') &&
        user.role === 'clinic_owner' &&
        !user.organizationId
      )
        redirect('/register-clinic');
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
