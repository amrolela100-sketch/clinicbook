import 'server-only';
import { createSupabaseServer } from '../supabase/server';
import { currentUser } from '../auth/session';
import type { AppData } from '@/components/app-provider';
import type { Doctor, Appointment, Status, MedicalRecord, Shift } from '../types';

interface RawDoctorWithJoins {
  id: string;
  specialty_id: string;
  license_number: string;
  bio: string | null;
  consultation_fee: number;
  verification_status: string;
  users: { full_name: string; avatar_url: string | null } | null;
  specialties: { name: string } | null;
  clinics: {
    id: string;
    name: string;
    district: string;
    address: string;
    phone: string;
    timezone: string;
  }[] | null;
}

interface RawAvailability {
  id: string;
  clinic_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  clinics: {
    id: string;
    doctor_id: string;
  } | null;
}

interface RawReference {
  id: string;
  name: string;
}

interface RawAppointment {
  id: string;
  patient_id: string;
  doctor_id: string;
  clinic_id: string;
  start_at: string;
  end_at: string;
  status: Status;
  visit_type: string;
  expires_at: string | null;
  cancel_reason: string | null;
  created_at: string;
}

export async function fetchSupabaseAppData(): Promise<AppData> {
  const client = await createSupabaseServer();
  const user = await currentUser();

  // 1. Fetch active doctors with clinics and specialty info
  const { data: rawDoctors } = await client
    .from('doctors')
    .select(`
      id,
      specialty_id,
      license_number,
      bio,
      consultation_fee,
      verification_status,
      users(full_name, avatar_url),
      specialties(name),
      clinics(id, name, district, address, phone, timezone)
    `);

  const typedDoctors = (rawDoctors as unknown as RawDoctorWithJoins[] | null) ?? [];
  const doctors: Doctor[] = typedDoctors.map((d) => {
    const primaryClinic = d.clinics?.[0];
    return {
      id: d.id,
      name: d.users?.full_name ?? 'طبيب معتمد',
      specialty: d.specialties?.name ?? 'الطب العام',
      organizationId: primaryClinic?.id ?? d.id,
      clinicId: primaryClinic?.id ?? '',
      clinic: primaryClinic?.name ?? 'العيادة الطبية',
      city: 'دمشق',
      district: primaryClinic?.district ?? 'وسط المدينة',
      fee: Number(d.consultation_fee ?? 20),
      followUpFee: Math.round(Number(d.consultation_fee ?? 20) * 0.6),
      rating: 4.8,
      reviews: 12,
      experience: 10,
      bio: d.bio ?? '',
      color: '#e1eeeb',
      image: d.users?.avatar_url ?? 'doctor-1.jpg',
      verified: d.verification_status === 'approved',
      license: d.license_number ?? '',
      bookingHorizonDays: 30,
      cancelHours: 2,
    };
  });

  // 2. Fetch references (cities and specialties)
  const { data: rawCities } = await client.from('cities').select('id, name');
  const { data: rawSpecialties } = await client.from('specialties').select('id, name');

  const typedCities = (rawCities as RawReference[] | null) ?? [];
  const typedSpecialties = (rawSpecialties as RawReference[] | null) ?? [];

  const references = [
    ...typedCities.map((c) => ({ id: c.id, name: c.name, type: 'city' })),
    ...typedSpecialties.map((s) => ({ id: s.id, name: s.name, type: 'specialty' })),
  ];

  // 3. Fetch doctor schedules / availability
  const { data: rawAvailability } = await client
    .from('availability')
    .select('id, clinic_id, day_of_week, start_time, end_time, slot_duration_minutes, clinics(id, doctor_id)');

  const typedAvailability = (rawAvailability as unknown as RawAvailability[] | null) ?? [];
  const schedules: Record<string, Shift[]> = {};

  for (const a of typedAvailability) {
    const docId = a.clinics?.doctor_id;
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

  // 4. Fetch user-specific appointments if authenticated
  let appointments: Appointment[] = [];
  if (user) {
    let query = client.from('appointments').select('*').order('start_at', { ascending: true });
    if (user.role === 'patient') {
      query = query.eq('patient_id', user.id);
    } else if (user.role === 'doctor') {
      query = query.eq('doctor_id', user.id);
    }

    const { data: rawAppts } = await query;
    const typedAppts = (rawAppts as RawAppointment[] | null) ?? [];

    const patientIds = Array.from(new Set(typedAppts.map((a) => a.patient_id)));
    const patientProfiles: Record<string, { full_name: string; phone: string }> = {};
    if (patientIds.length > 0) {
      const { createSupabaseAdmin } = await import('../supabase/admin');
      const adminClient = createSupabaseAdmin();
      const { data: profiles } = await adminClient
        .from('users')
        .select('id, full_name, phone')
        .in('id', patientIds);
      if (profiles) {
        for (const p of profiles) {
          patientProfiles[p.id] = { full_name: p.full_name, phone: p.phone ?? '' };
        }
      }
    }

    appointments = typedAppts.map((a) => {
      const doc = doctors.find((d) => d.id === a.doctor_id);
      const profile = patientProfiles[a.patient_id];
      return {
        id: a.id,
        organizationId: a.clinic_id,
        clinicId: a.clinic_id,
        doctorId: a.doctor_id,
        patientId: a.patient_id,
        patientName: profile?.full_name || (user.role === 'patient' ? user.name : 'مريض'),
        phone: profile?.phone || '',
        start: a.start_at,
        end: a.end_at,
        status: a.status,
        visitType: a.visit_type,
        source: 'patient_portal',
        fee: doc?.fee ?? 25,
        payment: 'unpaid',
        expiresAt: a.expires_at ?? undefined,
        reason: a.cancel_reason ?? undefined,
        createdAt: a.created_at,
      };
    });
  }

  return {
    user,
    doctors,
    appointments,
    records: [],
    organization: null,
    team: [],
    branches: [],
    references,
    notifications: [],
    schedules,
    exceptions: [],
    reviews: [],
    billingRequests: [],
    admin: null,
  };
}
