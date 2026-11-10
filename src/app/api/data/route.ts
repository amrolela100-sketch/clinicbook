import { NextResponse } from 'next/server';
import { currentUser, demoEnabled } from '@/lib/auth/session';
import { canAccess } from '@/lib/auth/guards';
import type { Doctor, MedicalRecord, User } from '@/lib/types';
import type { Organization } from '@/lib/services/booking-service';
import { isOrganizationPubliclyBookable } from '@/lib/services/organization-policy';
import { fetchSupabaseAppData } from '@/lib/services/supabase-data-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!demoEnabled()) {
    try {
      const data = await fetchSupabaseAppData();
      return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
      console.error('Supabase app data fetch error:', e);
      return NextResponse.json(
        { success: false, error: 'تعذر تحميل بيانات العيادة من قاعدة البيانات السحابية.' },
        { status: 500 },
      );
    }
  }

  const { all, get, appointments, expirePending, db, ensureSeed } = await import('@/lib/demo-db');
  ensureSeed();
  const user = await currentUser();
  expirePending();
  const orgs = all<Organization>('organization');
  const orgById = new Map(orgs.map((organization) => [organization.id, organization]));
  const doctors = all<Doctor>('doctor')
    .filter(
      (d) =>
        user?.organizationId === d.organizationId ||
        (d.verified && isOrganizationPubliclyBookable(orgById.get(d.organizationId))),
    )
    .map((d) => {
      const o = orgById.get(d.organizationId);
      const bookingHorizonDays =
        o?.tier === 'enterprise' ? 180 : o?.tier === 'clinic_pro' ? 90 : 30;
      return {
        ...d,
        bookingHorizonDays,
        cancelHours: o?.cancelHours ?? 2,
      };
    });

  const appts = user ? appointments().filter((a) => canAccess(user, a, 'appointment')) : [];
  const records = user
    ? all<MedicalRecord>('medical').filter((r) => {
        const a = appts.find((appt) => appt.id === r.appointmentId);
        return a && canAccess(user, a, 'medical') && (user.role !== 'patient' || r.visible);
      })
    : [];

  const staff = user?.organizationId
    ? all<User>('user')
        .filter((u) => u.organizationId === user.organizationId)
        .map(({ id, name, role, email, clinicId }) => ({ id, name, role, email, clinicId }))
    : [];

  const rawReviews = all<{ doctorId?: string }>('review');
  const reviews = user?.organizationId
    ? rawReviews.filter((r) => {
        if (!r.doctorId) return false;
        const doc = doctors.find((d) => d.id === r.doctorId);
        return doc?.organizationId === user.organizationId;
      })
    : rawReviews.filter((r) => {
        if (!r.doctorId) return false;
        return doctors.some((d) => d.id === r.doctorId);
      });

  const data = {
    user,
    doctors,
    appointments: appts,
    records,
    organization: user?.organizationId ? get('organization', user.organizationId) : null,
    team: staff,
    branches: user?.organizationId
      ? all<{ organizationId: string }>('branch').filter(
          (b) => b.organizationId === user.organizationId,
        )
      : [],
    references: all('reference'),
    notifications: user
      ? all<{ organizationId: string; userId?: string }>('notification').filter(
          (n) =>
            n.userId === user.id ||
            (!!user.organizationId && n.organizationId === user.organizationId),
        )
      : [],
    schedules: user?.organizationId
      ? Object.fromEntries(
          doctors
            .filter(
              (d) =>
                d.organizationId === user.organizationId &&
                (user.role !== 'doctor' || d.id === user.id),
            )
            .map((d) => [d.id, get('schedule', d.id)]),
        )
      : {},
    exceptions: user?.organizationId
      ? all<{ organizationId: string }>('exception').filter(
          (e) => e.organizationId === user.organizationId,
        )
      : [],
    reviews,
    billingRequests: user?.organizationId
      ? all<{ organizationId: string }>('billingRequest').filter(
          (r) => r.organizationId === user.organizationId,
        )
      : [],
    admin:
      user?.role === 'super_admin'
        ? {
            organizations: orgs,
            verifications: all('verification'),
            references: all('reference'),
            audit: db.prepare('SELECT * FROM audit ORDER BY created_at DESC LIMIT 30').all(),
          }
        : null,
  };

  return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
}
