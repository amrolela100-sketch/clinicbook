import 'server-only';
import { createSupabaseServer } from '../supabase/server';
import { currentUser } from '../auth/session';
import type { AppData } from '@/components/app-provider';
import type { Doctor, Appointment, Status, MedicalRecord, Shift, User, Role } from '../types';
import type { Organization } from './booking-service';

interface PublicDoctorRpcRow {
  id: string;
  full_name: string;
  title_ar: string;
  bio_ar: string | null;
  specialty_id: string;
  specialty_name: string | null;
  organization_id: string;
  clinic_id: string | null;
  clinic_name: string | null;
  city_name: string | null;
  district: string | null;
  consultation_fee: number;
  follow_up_fee: number;
  years_of_experience: number;
  rating_avg: number;
  reviews_count: number;
  avatar_url: string | null;
  license_number: string;
}

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

interface TenantAppointmentRpcRow {
  id: string;
  organization_id: string;
  clinic_id: string;
  doctor_id: string;
  patient_id: string | null;
  patient_name: string;
  patient_phone: string;
  start_at: string;
  end_at: string;
  status: Status;
  visit_type: string;
  booking_source: string;
  fee_amount: number | null;
  payment_status: string;
  expires_at: string | null;
  patient_notes: string | null;
  cancel_reason: string | null;
  created_at: string;
}

export async function fetchSupabaseAppData(): Promise<AppData> {
  const client = await createSupabaseServer();
  const user = await currentUser();

  // 1. Fetch approved public doctors using public_doctor_directory RPC (no users table join / no leaks)
  const { data: rawRpcDoctors, error: rpcDocsError } = await client.rpc('public_doctor_directory');
  if (rpcDocsError) {
    console.warn('public_doctor_directory RPC fallback warning:', rpcDocsError.message);
  }

  const typedRpcDoctors = (rawRpcDoctors as unknown as PublicDoctorRpcRow[] | null) ?? [];
  const doctors: Doctor[] = typedRpcDoctors.map((d) => ({
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
    verified: true,
    license: d.license_number ?? '',
    bookingHorizonDays: 30,
    cancelHours: 2,
  }));

  // 2. Fetch references (cities and specialties) using public reference tables
  const { data: rawCities } = await client.from('cities').select('id, name_ar, name_en');
  const { data: rawSpecialties } = await client.from('specialties').select('id, name_ar, name_en');

  const typedCities = (rawCities as unknown as RawReference[] | null) ?? [];
  const typedSpecialties = (rawSpecialties as unknown as RawReference[] | null) ?? [];

  const references = [
    ...typedCities.map((c) => ({ id: c.id, name: c.name_ar, type: 'city' })),
    ...typedSpecialties.map((s) => ({ id: s.id, name: s.name_ar, type: 'specialty' })),
  ];

  // 3. Fetch doctor schedules / availability directly
  const { data: rawAvailability } = await client
    .from('availability')
    .select('id, doctor_id, clinic_id, day_of_week, start_time, end_time, slot_duration_minutes');

  const typedAvailability = (rawAvailability as unknown as RawAvailability[] | null) ?? [];
  const schedules: Record<string, Shift[]> = {};

  for (const a of typedAvailability) {
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

  // 4. Fetch user-specific appointments via user client (strictly zero service-role)
  let appointments: Appointment[] = [];
  if (user) {
    if (user.role === 'patient') {
      const { data: rawPatientAppts } = await client
        .from('appointments')
        .select('*')
        .eq('patient_id', user.id)
        .order('start_at', { ascending: true });

      const typedAppts = (rawPatientAppts as RawAppointment[] | null) ?? [];
      appointments = typedAppts.map((a) => {
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
    } else if (user.organizationId) {
      // Staff uses get_tenant_appointments RPC — RLS checked on server
      const { data: rawTenantAppts, error: tenantErr } = await client.rpc(
        'get_tenant_appointments',
        { p_org: user.organizationId },
      );

      if (!tenantErr && rawTenantAppts) {
        const typedStaffAppts = rawTenantAppts as TenantAppointmentRpcRow[];
        appointments = typedStaffAppts.map((a) => {
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
        // Fallback to direct scoped query if RPC not yet migrated in current DB
        const { data: rawStaffDirect } = await client
          .from('appointments')
          .select('*')
          .order('start_at', { ascending: true });

        const typedDirect = (rawStaffDirect as RawAppointment[] | null) ?? [];
        appointments = typedDirect.map((a) => {
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
    }
  }

  // 5. Fetch organization data if authenticated clinic staff
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
  let records: MedicalRecord[] = [];
  let notifications: {
    id: string;
    title: string;
    body: string;
    read: boolean;
    createdAt: string;
  }[] = [];
  let reviews: {
    appointmentId: string;
    doctorId: string;
    rating: number;
    comment: string;
    name: string;
  }[] = [];

  if (user?.organizationId) {
    const { data: orgRow } = await client
      .from('organizations')
      .select(
        'id, name, slug, tax_or_license_number, verification_status, is_active, subscriptions(tier, status, current_period_end), clinics(id, name, district, address, phone, timezone, cancel_window_hours, min_lead_minutes)',
      )
      .eq('id', user.organizationId)
      .maybeSingle();

    if (orgRow) {
      const sub = (
        orgRow.subscriptions as unknown as {
          tier?: string;
          status?: string;
          current_period_end?: string;
        }[]
      )?.[0];
      const cl = (
        orgRow.clinics as unknown as {
          id: string;
          name: string;
          district: string;
          address: string;
          phone: string;
          timezone: string;
          cancel_window_hours: number;
          min_lead_minutes: number;
        }[]
      )?.[0];
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

    const { data: rawBranches } = await client
      .from('clinics')
      .select('id, organization_id, name, district, phone, cities(name_ar)')
      .eq('organization_id', user.organizationId);

    if (rawBranches) {
      const typedBranches = rawBranches as unknown as Array<{
        id: string;
        organization_id: string;
        name: string;
        district: string;
        phone: string;
        cities?: { name_ar?: string } | Array<{ name_ar?: string }> | null;
      }>;
      branches = typedBranches.map((b) => {
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
    }

    // Call team_directory RPC (no users table cross-tenant join)
    const { data: rawTeamMembers, error: teamRpcError } = await client.rpc('team_directory', {
      p_org: user.organizationId,
    });

    if (!teamRpcError && rawTeamMembers) {
      const typedMembers = rawTeamMembers as Array<{
        id: string;
        full_name: string;
        email: string;
        clinic_id: string | null;
        member_role: string;
      }>;
      team = typedMembers.map((m) => ({
        id: m.id,
        name: m.full_name || 'عضو الفريق',
        email: m.email || '',
        role: (m.member_role === 'owner' ? 'clinic_owner' : m.member_role) as Role,
        organizationId: user.organizationId,
        clinicId: m.clinic_id ?? undefined,
      }));
    }

    const { data: rawEx } = await client
      .from('availability_exceptions')
      .select('id, doctor_id, start_at, end_at, reason');

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

  // 6. Medical records (strictly via user client — RLS enforced; only query for patient or treating doctor)
  if (user && (user.role === 'patient' || user.role === 'doctor')) {
    let recQuery = client.from('medical_records').select('*');
    if (user.role === 'patient') {
      recQuery = recQuery.eq('patient_id', user.id).eq('is_visible_to_patient', true);
    } else {
      recQuery = recQuery.eq('doctor_id', user.id);
    }

    const { data: rawMed } = await recQuery;
    if (rawMed) {
      records = rawMed.map(
        (r: {
          id: string;
          appointment_id: string;
          diagnosis: string;
          chief_complaint?: string | null;
          doctor_notes?: string | null;
          prescription_items?:
            { name: string; dose: string; frequency: string; duration: string }[] | null;
          follow_up_recommended_date?: string | null;
          is_visible_to_patient?: boolean;
        }) => ({
          appointmentId: r.appointment_id,
          diagnosis: r.diagnosis,
          complaint: r.chief_complaint ?? '',
          notes: r.doctor_notes ?? '',
          medications: r.prescription_items ?? [],
          followUp: r.follow_up_recommended_date ?? '',
          visible: r.is_visible_to_patient ?? true,
        }),
      );
    }
  }

  if (user) {
    const { data: rawNotifs } = await client
      .from('notifications')
      .select('id, title, body, is_read, created_at')
      .eq('user_id', user.id);

    if (rawNotifs) {
      notifications = rawNotifs.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        read: n.is_read,
        createdAt: n.created_at,
      }));
    }
  }

  // 7. Reviews: uses public_reviews RPC with masked display names (e.g. "سارة ك.")
  const { data: rawRpcReviews } = await client.rpc('public_reviews');
  if (rawRpcReviews) {
    const typedReviews = rawRpcReviews as Array<{
      appointment_id: string;
      doctor_id: string;
      rating: number;
      comment?: string | null;
      display_name: string;
    }>;
    reviews = typedReviews.map((rv) => ({
      appointmentId: rv.appointment_id,
      doctorId: rv.doctor_id,
      rating: rv.rating,
      comment: rv.comment ?? '',
      name: rv.display_name || 'مريض',
    }));
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
    billingRequests: [],
    admin: null,
  };
}
