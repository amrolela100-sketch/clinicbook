import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@/lib/types';

const routeMocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  demoEnabled: vi.fn(() => true),
  configured: vi.fn(() => false),
  redirect: vi.fn((location: string) => {
    throw new Error(`REDIRECT:${location}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session', () => ({
  currentUser: routeMocks.currentUser,
  demoEnabled: routeMocks.demoEnabled,
  redirectForUser: (user: User) =>
    user.role === 'patient'
      ? '/my-appointments'
      : user.role === 'super_admin'
        ? '/admin'
        : '/workspace/dashboard',
}));
vi.mock('@/lib/supabase/config', () => ({ isSupabaseConfigured: routeMocks.configured }));
vi.mock('next/navigation', () => ({
  redirect: routeMocks.redirect,
  notFound: routeMocks.notFound,
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-nonce': 'test-nonce' }) }));
vi.mock('@/components/clinic-app', () => ({ ClinicApp: ({ route }: { route: string }) => route }));

import { metadataForClinicRoute, renderClinicRoute } from '@/lib/clinic-routes';

describe('File-route server guard interface', () => {
  beforeEach(() => {
    routeMocks.currentUser.mockReset().mockResolvedValue(null);
    routeMocks.demoEnabled.mockReset().mockReturnValue(true);
    routeMocks.configured.mockReset().mockReturnValue(false);
    routeMocks.redirect.mockClear();
    routeMocks.notFound.mockClear();
  });

  it('returns route-specific public metadata and a safe default', async () => {
    expect(String((await metadataForClinicRoute('/search')).title)).toContain('ابحث عن طبيب');
    expect(String((await metadataForClinicRoute('/register-clinic')).title)).toContain(
      'سجّل عيادتك',
    );
    expect(String((await metadataForClinicRoute('/login')).title)).toContain('تسجيل الدخول');
    expect(String((await metadataForClinicRoute('/unknown')).title)).toContain('ClinicBook');
  });

  it('rejects unknown routes before rendering the client view', async () => {
    await expect(renderClinicRoute('/unknown')).rejects.toThrow('NOT_FOUND');
    expect(routeMocks.notFound).toHaveBeenCalledTimes(1);
  });

  it('redirects unauthenticated protected routes and Supabase clinic registration', async () => {
    await expect(renderClinicRoute('/workspace/dashboard')).rejects.toThrow(
      'REDIRECT:/login?next=%2Fworkspace%2Fdashboard',
    );
    routeMocks.demoEnabled.mockReturnValue(false);
    routeMocks.configured.mockReturnValue(true);
    await expect(renderClinicRoute('/register-clinic')).rejects.toThrow(
      'REDIRECT:/login?next=/register-clinic',
    );
  });

  it.each([
    ['/admin', 'patient', '/my-appointments'],
    ['/workspace/dashboard', 'patient', '/my-appointments'],
    ['/my-appointments', 'doctor', '/workspace/dashboard'],
    ['/workspace/billing', 'doctor', '/workspace/dashboard'],
    ['/workspace/patients/patient-1', 'receptionist', '/workspace/patients'],
  ] as const)('redirects %s away from the %s role', async (route, role, expected) => {
    routeMocks.currentUser.mockResolvedValue({
      id: `${role}-1`,
      role,
      name: role,
      email: `${role}@example.test`,
      organizationId: 'org-1',
    } satisfies User);
    await expect(renderClinicRoute(route)).rejects.toThrow(`REDIRECT:${expected}`);
  });

  it('sends an owner without an organization to onboarding and an authenticated login away', async () => {
    routeMocks.currentUser.mockResolvedValue({
      id: 'owner-new',
      role: 'clinic_owner',
      name: 'Owner',
      email: 'owner@example.test',
    } satisfies User);
    await expect(renderClinicRoute('/workspace/dashboard')).rejects.toThrow(
      'REDIRECT:/register-clinic?onboarding=1',
    );

    routeMocks.currentUser.mockResolvedValue({
      id: 'admin-1',
      role: 'super_admin',
      name: 'Admin',
      email: 'admin@example.test',
    } satisfies User);
    await expect(renderClinicRoute('/login')).rejects.toThrow('REDIRECT:/admin');
  });

  it('renders allowed public and protected routes without redirecting', async () => {
    const publicResult = await renderClinicRoute('/');
    expect(publicResult).toBeDefined();
    routeMocks.currentUser.mockResolvedValue({
      id: 'doctor-allowed',
      role: 'doctor',
      name: 'Doctor',
      email: 'doctor@example.test',
      organizationId: 'org-1',
    } satisfies User);
    const workspaceResult = await renderClinicRoute('/workspace/schedule');
    expect(workspaceResult).toBeDefined();
    expect(routeMocks.redirect).not.toHaveBeenCalled();
  });
});
