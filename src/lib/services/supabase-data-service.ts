import 'server-only';
import { createSupabaseServer } from '../supabase/server';
import { currentUser } from '../auth/session';
import type { AppData } from '@/components/app-provider';
import type { Doctor, Appointment, Status, MedicalRecord, Shift, User, Role } from '../types';
import type { Organization } from './booking-service';
import type {
  PublicDoctorDirectoryRow,
  TenantDoctorDirectoryRow,
  TenantAppointmentRpcRow,
  TenantTeamMemberRpcRow,
  TenantBillingRequestRpcRow,
  PublicReviewRpcRow,
  SuperAdminDashboardSnapshot,
} from '../supabase/database.types';

interface RawAvailability {
  id: string;
  doctor_id: string;
  clinic_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
}

interface RawReference {
  id: string;
  name_ar: string;
  name_en: string;
}

interface RawAppointment {
  id: string;
  patient_id: string;
  doctor_id: string;
  clinic_id: string;
  organization_id: string;
  start_at: string;
  end_at: string;
  status: Status;
  visit_type: string;
  payment_status: string;
  fee_amount?: number | null;
  expires_at: string | null;
  cancel_reason: string | null;
  created_at: string;
}

interface RawOrgSubscription {
  tier?: string;
  status?: string;
  current_period_end?: string;
}

interface RawOrgClinic {
  id: string;
  name: string;
  district: string;
  address: string;
  phone: string;
  timezone: string;
  cancel_window_hours: number;
  min_lead_minutes: number;
}

interface RawBranchRow {
  id: string;
  organization_id: string;
  name: string;
  district: string;
  phone: string;
  cities?: { name_ar?: string } | Array<{ name_ar?: string }> | null;
}

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function mapDoctorRow(
  d: PublicDoctorDirectoryRow | TenantDoctorDirectoryRow,
  verifiedOverride?: boolean,
): Doctor {
  const verified =
    verifiedOverride ?? ('verification_status' in d ? d.verification_status === 'approved' : true);
  return {
    id: d.id,
    name: d.full_name || 'طبيب معتمد',
    specialty: d.specialty_name ?? 'الطب العام',
    organizationId: d.organization_id || d.id,
    clinicId: d.clinic_id ?? '',
    clinic: d.clinic_name ?? 'العيادة الطبية',
    city: d.city_name ?? 'دمشق',
    district: d.district ?? 'وسط المدينة',
    fee: Number(d.consultation_fee ?? 25),
    followUpFee: Number(d.follow_up_fee ?? Math.round(Number(d.consultation_fee ?? 25) * 0.6)),
    rating: Number(d.rating_avg ?? 4.8),
    reviews: Number(d.reviews_count ?? 12),
    experience: Number(d.years_of_experience ?? 10),
    bio: d.bio_ar ?? '',
    color: '#e1eeeb',
    image: d.avatar_url ?? 'doctor-1.jpg',
    verified,
    license: d.license_number ?? '',
    bookingHorizonDays: 30,
    cancelHours: 2,
  };
}

export async function fetchSupabaseAppData(preResolvedUser?: User | null): Promise<AppData> {
  const client = await createSupabaseServer();
  const user = preResolvedUser !== undefined ? preResolvedUser : await currentUser();

  // 1. Execute independent public & directory reads in parallel (REM-01)
  const [
    { data: rawRpcDoctors, error: rpcDocsError },
    { data: rawCities },
    { data: rawSpecialties },
    { data: rawAvailability },
    { data: rawRpcReviews },
  ] = await Promise.all([
    client.rpc('public_doctor_directory'),
    client.from('cities').select('id, name_ar, name_en'),
    client.from('specialties').select('id, name_ar, name_en'),
    client
      .from('availability')
      .select('id, doctor_id, clinic_id, day_of_week, start_time, end_time, slot_duration_minutes'),
    client.rpc('public_reviews'),
  ]);

  if (rpcDocsError) {
    console.warn('public_doctor_directory RPC fallback warning:', rpcDocsError.message);
  }

  const doctorMap = new Map<string, Doctor>();
  for (const d of toArray<PublicDoctorDirectoryRow>(rawRpcDoctors)) {
    doctorMap.set(d.id, mapDoctorRow(d, true));
  }

  const typedCities = toArray<RawReference>(rawCities);
  const typedSpecialties = toArray<RawReference>(rawSpecialties);

  const references = [
    ...typedCities.map((c) => ({ id: c.id, name: c.name_ar, type: 'city' })),
    ...typedSpecialties.map((s) => ({ id: s.id, name: s.name_ar, type: 'specialty' })),
  ];

  const schedules: Record<string, Shift[]> = {};
  for (const a of toArray<RawAvailability>(rawAvailability)) {
    const docId = a.doctor_id;
    if (!docId) continue;
    if (!schedules[docId]) schedules[docId] = [];
    schedules[docId].push({
      day: a.day_of_week,
      start: a.start_time.slice(0, 5),
      end: a.end_time.slice(0, 5),
      duration: a.slot_duration_minutes,
      active: true,
    });
  }

  const reviews = toArray<PublicReviewRpcRow>(rawRpcReviews).map((rv) => ({
    appointmentId: rv.appointment_id,
    doctorId: rv.doctor_id,
    rating: rv.rating,
    comment: rv.comment ?? '',
    name: rv.display_name || 'مريض',
  }));

  // 2. Organization & Staff Scoped Queries (parallelized, strictly zero service-role)
  let organization: Organization | null = null;
  let team: User[] = [];
  let branches: {
    id: string;
    organizationId: string;
    name: string;
    city: string;
    district: string;
    phone: string;
  }[] = [];
  let exceptions: {
    id: string;
    doctorId: string;
    start: string;
    end: string;
    reason: string;
    affected: number;
  }[] = [];
  let billingRequests: { id: string; tier: string; status: string; createdAt: string }[] = [];

  if (user?.organizationId) {
    const [
      { data: orgRow },
      { data: rawBranches },
      { data: rawTeamMembers, error: teamRpcError },
      { data: rawTenantDoctors, error: tenantDocsError },
      { data: rawBillingRequests, error: billingRpcError },
      { data: rawEx },
    ] = await Promise.all([
      client
        .from('organizations')
        .select(
          'id, name, slug, tax_or_license_number, verification_status, is_active, subscriptions(tier, status, current_period_end), clinics(id, name, district, address, phone, timezone, cancel_window_hours, min_lead_minutes)',
        )
        .eq('id', user.organizationId)
        .maybeSingle(),
      client
        .from('clinics')
        .select('id, organization_id, name, district, phone, cities(name_ar)')
        .eq('organization_id', user.organizationId),
      client.rpc('team_directory', { p_org: user.organizationId }),
      client.rpc('tenant_doctors_directory', { p_org: user.organizationId }),
      client.rpc('tenant_billing_requests', { p_org: user.organizationId }),
      client.from('availability_exceptions').select('id, doctor_id, start_at, end_at, reason'),
    ]);

    if (!tenantDocsError && rawTenantDoctors) {
      for (const td of toArray<TenantDoctorDirectoryRow>(rawTenantDoctors)) {
        doctorMap.set(td.id, mapDoctorRow(td));
      }
    }

    if (orgRow) {
      const subs = toArray<RawOrgSubscription>((orgRow as Record<string, unknown>).subscriptions);
      const cls = toArray<RawOrgClinic>((orgRow as Record<string, unknown>).clinics);
      const sub = subs[0];
      const cl = cls[0];
      organization = {
        id: orgRow.id,
        name: orgRow.name,
        city: 'دمشق',
        district: cl?.district ?? 'وسط المدينة',
        phone: cl?.phone ?? '011-2233445',
        license: orgRow.tax_or_license_number ?? 'SY-MED-2026',
        tier: (sub?.tier as 'solo_starter' | 'clinic_pro' | 'enterprise') ?? 'clinic_pro',
        status: (orgRow.verification_status as 'approved' | 'pending' | 'rejected') ?? 'approved',
        subscriptionStatus:
          (sub?.status as 'active' | 'trialing' | 'past_due' | 'canceled') ?? 'active',
        periodEnd: sub?.current_period_end ?? new Date(Date.now() + 30 * 86400000).toISOString(),
        cancelHours: cl?.cancel_window_hours ?? 2,
        leadMinutes: cl?.min_lead_minutes ?? 60,
        pendingHours: 12,
        expiryMinutes: 60,
        timezone: cl?.timezone ?? 'Asia/Damascus',
      };
    }

    branches = toArray<RawBranchRow>(rawBranches).map((b) => {
      const cityName = Array.isArray(b.cities) ? b.cities[0]?.name_ar : b.cities?.name_ar;
      return {
        id: b.id,
        organizationId: b.organization_id,
        name: b.name,
        city: cityName ?? 'دمشق',
        district: b.district,
        phone: b.phone,
      };
    });

    if (organization && branches[0]?.city) {
      organization.city = branches[0].city;
    }

    if (!teamRpcError && rawTeamMembers) {
      team = toArray<TenantTeamMemberRpcRow>(rawTeamMembers).map((m) => ({
        id: m.id,
        name: m.full_name || 'عضو الفريق',
        email: m.email || '',
        role: (m.member_role === 'owner' ? 'clinic_owner' : m.member_role) as Role,
        organizationId: user.organizationId,
        clinicId: m.clinic_id ?? undefined,
      }));
    }

    if (!billingRpcError && rawBillingRequests) {
      billingRequests = toArray<TenantBillingRequestRpcRow>(rawBillingRequests).map((r) => ({
        id: r.id,
        tier: r.tier,
        status: r.status,
        createdAt: r.created_at,
      }));
    }

    if (rawEx) {
      exceptions = rawEx.map((e) => ({
        id: e.id,
        doctorId: e.doctor_id,
        start: e.start_at,
        end: e.end_at,
        reason: e.reason,
        affected: 0,
      }));
    }
  }

  const doctors: Doctor[] = Array.from(doctorMap.values()).map((d) => {
    if (organization && d.organizationId === organization.id) {
      const horizon =
        organization.tier === 'enterprise' ? 180 : organization.tier === 'clinic_pro' ? 90 : 30;
      return {
        ...d,
        bookingHorizonDays: horizon,
        cancelHours: organization.cancelHours ?? 2,
      };
    }
    return d;
  });

  // 3. Appointments, Clinical Records, Notifications & Super-Admin Governance Console
  let appointments: Appointment[] = [];
  let records: MedicalRecord[] = [];
  let notifications: {
    id: string;
    title: string;
    body: string;
    read: boolean;
    createdAt: string;
  }[] = [];
  let admin: AppData['admin'] = null;

  if (user) {
    const notificationsPromise = client
      .from('notifications')
      .select('id, title, body, is_read, created_at')
      .eq('user_id', user.id);

    const recordsPromise =
      user.role === 'patient'
        ? client
            .from('medical_records')
            .select('*')
            .eq('patient_id', user.id)
            .eq('is_visible_to_patient', true)
        : user.role === 'doctor'
          ? client.from('medical_records').select('*').eq('doctor_id', user.id)
          : Promise.resolve({ data: null });

    const adminPromise =
      user.role === 'super_admin'
        ? client.rpc('super_admin_dashboard_data')
        : Promise.resolve({ data: null, error: null });

    if (user.role === 'patient') {
      const [{ data: rawPatientAppts }, { data: rawMed }, { data: rawNotifs }] = await Promise.all([
        client
          .from('appointments')
          .select('*')
          .eq('patient_id', user.id)
          .order('start_at', { ascending: true }),
        recordsPromise,
        notificationsPromise,
      ]);

      appointments = toArray<RawAppointment>(rawPatientAppts).map((a) => {
        const doc = doctors.find((d) => d.id === a.doctor_id);
        return {
          id: a.id,
          organizationId: a.organization_id || a.clinic_id,
          clinicId: a.clinic_id,
          doctorId: a.doctor_id,
          patientId: a.patient_id,
          patientName: user.name,
          phone: '',
          start: a.start_at,
          end: a.end_at,
          status: a.status,
          visitType: a.visit_type,
          source: 'patient_portal',
          fee: a.fee_amount != null ? Number(a.fee_amount) : (doc?.fee ?? 25),
          payment:
            (a.payment_status as 'unpaid' | 'paid_cash' | 'paid_online' | 'refunded') || 'unpaid',
          expiresAt: a.expires_at ?? undefined,
          reason: a.cancel_reason ?? undefined,
          createdAt: a.created_at,
        };
      });

      if (rawMed) {
        records = rawMed.map((r) => ({
          appointmentId: r.appointment_id,
          diagnosis: r.diagnosis,
          complaint: r.chief_complaint ?? '',
          notes: r.doctor_notes ?? '',
          medications: r.prescription_items ?? [],
          followUp: r.follow_up_recommended_date ?? '',
          visible: r.is_visible_to_patient ?? true,
        }));
      }

      if (rawNotifs) {
        notifications = rawNotifs.map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          read: n.is_read,
          createdAt: n.created_at,
        }));
      }
    } else if (user.organizationId) {
      const [{ data: rawTenantAppts, error: tenantErr }, { data: rawMed }, { data: rawNotifs }] =
        await Promise.all([
          client.rpc('get_tenant_appointments', { p_org: user.organizationId }),
          recordsPromise,
          notificationsPromise,
        ]);

      if (!tenantErr && rawTenantAppts) {
        appointments = toArray<TenantAppointmentRpcRow>(rawTenantAppts).map((a) => {
          const doc = doctors.find((d) => d.id === a.doctor_id);
          return {
            id: a.id,
            organizationId: a.organization_id,
            clinicId: a.clinic_id,
            doctorId: a.doctor_id,
            patientId: a.patient_id ?? undefined,
            patientName: a.patient_name || 'مريض',
            phone: a.patient_phone || '',
            start: a.start_at,
            end: a.end_at,
            status: a.status,
            visitType: a.visit_type,
            source: a.booking_source || 'reception_desk',
            fee: a.fee_amount != null ? Number(a.fee_amount) : (doc?.fee ?? 25),
            payment:
              (a.payment_status as 'unpaid' | 'paid_cash' | 'paid_online' | 'refunded') || 'unpaid',
            expiresAt: a.expires_at ?? undefined,
            reason: a.cancel_reason ?? undefined,
            createdAt: a.created_at,
          };
        });
      } else {
        const { data: rawStaffDirect } = await client
          .from('appointments')
          .select('*')
          .order('start_at', { ascending: true });

        appointments = toArray<RawAppointment>(rawStaffDirect).map((a) => {
          const doc = doctors.find((d) => d.id === a.doctor_id);
          return {
            id: a.id,
            organizationId: a.organization_id || a.clinic_id,
            clinicId: a.clinic_id,
            doctorId: a.doctor_id,
            patientId: a.patient_id,
            patientName: 'مريض',
            phone: '',
            start: a.start_at,
            end: a.end_at,
            status: a.status,
            visitType: a.visit_type,
            source: 'reception_desk',
            fee: a.fee_amount != null ? Number(a.fee_amount) : (doc?.fee ?? 25),
            payment:
              (a.payment_status as 'unpaid' | 'paid_cash' | 'paid_online' | 'refunded') || 'unpaid',
            expiresAt: a.expires_at ?? undefined,
            reason: a.cancel_reason ?? undefined,
            createdAt: a.created_at,
          };
        });
      }

      if (rawMed) {
        records = rawMed.map((r) => ({
          appointmentId: r.appointment_id,
          diagnosis: r.diagnosis,
          complaint: r.chief_complaint ?? '',
          notes: r.doctor_notes ?? '',
          medications: r.prescription_items ?? [],
          followUp: r.follow_up_recommended_date ?? '',
          visible: r.is_visible_to_patient ?? true,
        }));
      }

      if (rawNotifs) {
        notifications = rawNotifs.map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          read: n.is_read,
          createdAt: n.created_at,
        }));
      }
    } else {
      const [{ data: rawNotifs }, { data: rawAdmin, error: adminErr }] = await Promise.all([
        notificationsPromise,
        adminPromise,
      ]);

      if (rawNotifs) {
        notifications = rawNotifs.map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          read: n.is_read,
          createdAt: n.created_at,
        }));
      }

      if (user.role === 'super_admin' && !adminErr && rawAdmin && typeof rawAdmin === 'object') {
        const snap = (Array.isArray(rawAdmin) ? rawAdmin[0] : rawAdmin) as
          Partial<SuperAdminDashboardSnapshot> | undefined;
        if (snap && (snap.organizations || snap.verifications || snap.audit)) {
          admin = {
            organizations: toArray<Organization>(snap.organizations),
            verifications: toArray(snap.verifications),
            references: toArray(snap.references).length ? toArray(snap.references) : references,
            audit: toArray(snap.audit),
          };
        }
      }
    }
  }

  return {
    user,
    doctors,
    appointments,
    records,
    organization,
    team,
    branches,
    references,
    notifications,
    schedules,
    exceptions,
    reviews,
    billingRequests,
    admin,
  };
}
