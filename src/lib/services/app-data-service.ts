import 'server-only';

import { currentUser, demoEnabled } from '@/lib/auth/session';
import { canAccess } from '@/lib/auth/guards';
import type { Doctor, MedicalRecord, User } from '@/lib/types';
import type { AppData } from '@/components/app-provider';
import type { Organization } from './booking-service';
import { isOrganizationPubliclyBookable } from './organization-policy';
import { fetchSupabaseAppData } from './supabase-data-service';

/** One identity/scope implementation for server rendering and HTTP snapshots. */
export async function fetchAppData(): Promise<AppData> {
  if (!demoEnabled()) return fetchSupabaseAppData();

  const { all, get, appointments, expirePending, db, ensureSeed } = await import('@/lib/demo-db');
  ensureSeed();
  const user = await currentUser();
  expirePending();
  const orgs = all<Organization>('organization');
  const orgById = new Map(orgs.map((organization) => [organization.id, organization]));
  const doctors = all<Doctor>('doctor')
    .filter(
      (doctor) =>
        user?.organizationId === doctor.organizationId ||
        (doctor.verified && isOrganizationPubliclyBookable(orgById.get(doctor.organizationId))),
    )
    .map((doctor) => {
      const organization = orgById.get(doctor.organizationId);
      return {
        ...doctor,
        bookingHorizonDays:
          organization?.tier === 'enterprise' ? 180 : organization?.tier === 'clinic_pro' ? 90 : 30,
        cancelHours: organization?.cancelHours ?? 2,
      };
    });

  const appts = user
    ? appointments().filter((appointment) => canAccess(user, appointment, 'appointment'))
    : [];
  const records = user
    ? all<MedicalRecord>('medical').filter((record) => {
        const appointment = appts.find((value) => value.id === record.appointmentId);
        return (
          appointment &&
          canAccess(user, appointment, 'medical') &&
          (user.role !== 'patient' || record.visible)
        );
      })
    : [];
  const staff = user?.organizationId
    ? all<User>('user')
        .filter((member) => member.organizationId === user.organizationId)
        .map(({ id, name, role, email, clinicId }) => ({ id, name, role, email, clinicId }))
    : [];
  const rawReviews = all<AppData['reviews'][number]>('review');
  const reviews = user?.organizationId
    ? rawReviews.filter((review) => {
        if (!review.doctorId) return false;
        return (
          doctors.find((doctor) => doctor.id === review.doctorId)?.organizationId ===
          user.organizationId
        );
      })
    : rawReviews.filter(
        (review) => review.doctorId && doctors.some((doctor) => doctor.id === review.doctorId),
      );

  return {
    user,
    doctors,
    appointments: appts,
    records,
    organization: user?.organizationId
      ? (get<Organization>('organization', user.organizationId) ?? null)
      : null,
    team: staff,
    branches: user?.organizationId
      ? all<AppData['branches'][number]>('branch').filter(
          (branch) => branch.organizationId === user.organizationId,
        )
      : [],
    references: all<AppData['references'][number]>('reference'),
    notifications: user
      ? all<AppData['notifications'][number] & { organizationId?: string; userId?: string }>(
          'notification',
        ).filter(
          (notification) =>
            notification.userId === user.id ||
            (!!user.organizationId && notification.organizationId === user.organizationId),
        )
      : [],
    schedules: user?.organizationId
      ? Object.fromEntries(
          doctors
            .filter(
              (doctor) =>
                doctor.organizationId === user.organizationId &&
                (user.role !== 'doctor' || doctor.id === user.id),
            )
            .map((doctor) => [
              doctor.id,
              get<AppData['schedules'][string]>('schedule', doctor.id) ?? [],
            ]),
        )
      : {},
    exceptions: user?.organizationId
      ? all<AppData['exceptions'][number] & { organizationId: string }>('exception').filter(
          (exception) => exception.organizationId === user.organizationId,
        )
      : [],
    reviews,
    billingRequests: user?.organizationId
      ? all<AppData['billingRequests'][number] & { organizationId: string }>(
          'billingRequest',
        ).filter((request) => request.organizationId === user.organizationId)
      : [],
    admin:
      user?.role === 'super_admin'
        ? {
            organizations: orgs,
            verifications:
              all<NonNullable<AppData['admin']>['verifications'][number]>('verification'),
            references: all<AppData['references'][number]>('reference'),
            audit: db
              .prepare('SELECT * FROM audit ORDER BY created_at DESC LIMIT 30')
              .all() as NonNullable<AppData['admin']>['audit'],
          }
        : null,
  };
}
