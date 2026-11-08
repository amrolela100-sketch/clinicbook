import 'server-only';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { createSupabaseServer } from '../supabase/server';
import { getAvailableSlots } from './slots-engine';
import type { ActionResult, Shift, Status } from '../types';

const bookingInputSchema = z.object({
  doctor_id: z.string().uuid().optional(),
  doctorId: z.string().uuid().optional(),
  clinic_id: z.string().uuid().optional(),
  clinicId: z.string().uuid().optional(),
  start_at: z.string().datetime().optional(),
  start: z.string().datetime().optional(),
  end_at: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
  visit_type: z
    .enum(['first_visit', 'follow_up', 'consultation', 'walk_in'])
    .default('first_visit')
    .optional(),
  visitType: z
    .enum(['first_visit', 'follow_up', 'consultation', 'walk_in'])
    .default('first_visit')
    .optional(),
  patientName: z.string().min(2).max(100).optional(),
  patient_name: z.string().min(2).max(100).optional(),
  phone: z.string().min(7).max(25).optional(),
  patient_notes: z.string().max(1000).optional(),
  patientNotes: z.string().max(1000).optional(),
  notes: z.string().max(1000).optional(),
});

interface RawAvailabilityRow {
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
}

interface RawBookingRow {
  start_at: string;
  end_at: string;
  status: Status;
  expires_at: string | null;
}

interface RawExceptionRow {
  start_at: string;
  end_at: string;
}

export async function createSupabaseBooking(
  input: unknown,
): Promise<ActionResult<Record<string, unknown>>> {
  const p = bookingInputSchema.safeParse(input);
  if (!p.success)
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      error: 'بيانات الحجز غير صالحة، تحقق من الحقول.',
    };

  const raw = p.data;
  const doctorId = raw.doctor_id ?? raw.doctorId;
  const startAt = raw.start_at ?? raw.start;

  if (!doctorId || !startAt) {
    return { success: false, code: 'VALIDATION_ERROR', error: 'معرف الطبيب ووقت البداية مطلوبان.' };
  }

  const { currentUser } = await import('../auth/session');
  const user = await currentUser();
  if (!user) return { success: false, code: 'UNAUTHORIZED', error: 'يرجى تسجيل الدخول أولاً.' };

  const { createSupabaseAdmin } = await import('../supabase/admin');
  const adminClient = createSupabaseAdmin();

  let clinicId = raw.clinic_id ?? raw.clinicId;
  let organizationId = '';

  const { data: docRecord } = await adminClient
    .from('doctors')
    .select('organization_id, consultation_fee, follow_up_fee')
    .eq('id', doctorId)
    .limit(1)
    .maybeSingle();

  if (docRecord?.organization_id) {
    organizationId = docRecord.organization_id;
  }

  if (!clinicId) {
    const { data: avail } = await adminClient
      .from('availability')
      .select('clinic_id')
      .eq('doctor_id', doctorId)
      .limit(1)
      .maybeSingle();
    if (avail?.clinic_id) clinicId = avail.clinic_id;

    if (!clinicId) {
      const { data: member } = await adminClient
        .from('organization_members')
        .select('clinic_id')
        .eq('user_id', doctorId)
        .limit(1)
        .maybeSingle();
      if (member?.clinic_id) clinicId = member.clinic_id;
    }

    if (!clinicId && organizationId) {
      const { data: cl } = await adminClient
        .from('clinics')
        .select('id')
        .eq('organization_id', organizationId)
        .limit(1)
        .maybeSingle();
      if (cl?.id) clinicId = cl.id;
    }
  }

  if (!clinicId) {
    return { success: false, code: 'VALIDATION_ERROR', error: 'العيادة غير محددة للطبيب.' };
  }

  if (!organizationId) {
    const { data: cl } = await adminClient
      .from('clinics')
      .select('organization_id')
      .eq('id', clinicId)
      .limit(1)
      .maybeSingle();
    if (cl?.organization_id) organizationId = cl.organization_id;
  }

  let endAt = raw.end_at ?? raw.end;
  if (!endAt) {
    endAt = new Date(new Date(startAt).getTime() + 20 * 60000).toISOString();
  }

  const visitType = raw.visit_type ?? raw.visitType ?? 'first_visit';

  // تحديد المريض: إما المريض المسجل نفسه أو مريض حجز مباشر (Walk-in)
  let targetPatientId = user.role === 'patient' ? user.id : '';
  const patientFullName = (raw.patientName ?? raw.patient_name ?? '').trim();
  const patientPhone = (raw.phone ?? '').trim();

  if (!targetPatientId && (patientFullName || patientPhone)) {
    if (patientPhone) {
      const { data: byPhone } = await adminClient
        .from('users')
        .select('id')
        .eq('phone', patientPhone)
        .limit(1)
        .maybeSingle();
      if (byPhone) targetPatientId = byPhone.id;
    }
    if (!targetPatientId && patientFullName) {
      const { data: byName } = await adminClient
        .from('users')
        .select('id')
        .eq('full_name', patientFullName)
        .limit(1)
        .maybeSingle();
      if (byName) targetPatientId = byName.id;
    }
    if (!targetPatientId) {
      const dummyEmail = `walkin_${Date.now()}_${Math.floor(Math.random() * 1000)}@gmail.com`;
      const { data: authCreated } = await adminClient.auth.admin.createUser({
        email: dummyEmail,
        password: randomUUID(),
        email_confirm: true,
        user_metadata: { full_name: patientFullName || 'مريض عيادة', phone: patientPhone || '' },
      });

      const newId = authCreated?.user?.id ?? randomUUID();
      await adminClient.from('users').upsert({
        id: newId,
        full_name: patientFullName || 'مريض عيادة',
        phone: patientPhone || null,
        email: dummyEmail,
        role: 'patient',
        status: 'active',
      });
      targetPatientId = newId;
    }
  }

  if (!targetPatientId) {
    targetPatientId = user.id;
  }

  // 1. فحص التعارض الزمني
  const { data: conflicts } = await adminClient
    .from('appointments')
    .select('id')
    .eq('doctor_id', doctorId)
    .in('status', ['confirmed', 'pending', 'checked_in'])
    .lt('start_at', endAt)
    .gt('end_at', startAt);

  if (conflicts && conflicts.length > 0) {
    return {
      success: false,
      code: 'SLOT_CONFLICT',
      error: 'حُجزت هذه الفترة للتو. يرجى اختيار فترة أخرى.',
    };
  }

  // حد المواعيد ينطبق فقط على حجز المريض الإلكتروني
  if (user.role === 'patient') {
    const { data: userActive } = await adminClient
      .from('appointments')
      .select('id')
      .eq('patient_id', targetPatientId)
      .in('status', ['confirmed', 'pending', 'checked_in'])
      .gt('end_at', new Date().toISOString());

    if (userActive && userActive.length >= 3) {
      return {
        success: false,
        code: 'MAX_ACTIVE_REACHED',
        error: 'بلغت الحد الأقصى للحجوزات النشطة (3 مواعيد).',
      };
    }
  }

  const appointmentId = randomUUID();
  const defaultExpiresAt = new Date(
    Math.min(Date.now() + 12 * 3600000, new Date(startAt).getTime() - 3600000),
  ).toISOString();

  const isStaff = ['doctor', 'receptionist', 'clinic_owner', 'super_admin'].includes(user.role);
  const initialStatus = isStaff ? 'confirmed' : 'pending';
  const feeAmount =
    visitType === 'follow_up'
      ? Number(docRecord?.follow_up_fee ?? 15)
      : Number(docRecord?.consultation_fee ?? 25);

  const { data: newAppt, error: insertError } = await adminClient
    .from('appointments')
    .insert({
      id: appointmentId,
      organization_id: organizationId,
      patient_id: targetPatientId,
      doctor_id: doctorId,
      clinic_id: clinicId,
      start_at: startAt,
      end_at: endAt,
      fee_amount: feeAmount,
      status: initialStatus,
      visit_type: visitType,
      expires_at: defaultExpiresAt,
      walk_in_patient_name: isStaff && patientFullName ? patientFullName : null,
      walk_in_patient_phone: isStaff && patientPhone ? patientPhone : null,
      booking_source: isStaff
        ? user.role === 'doctor'
          ? 'doctor_direct'
          : 'reception_desk'
        : 'patient_portal',
    })
    .select()
    .single();

  if (insertError) {
    if (insertError.code === '23P01' || insertError.message?.includes('overlap')) {
      return {
        success: false,
        code: 'SLOT_CONFLICT',
        error: 'عذراً، هذا الموعد تم حجزه للتو من قبل مريض آخر.',
      };
    }
    console.error('Supabase appointment insert error:', insertError);
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: insertError.message || 'تعذر حفظ الموعد.',
    };
  }

  return { success: true, data: newAppt };
}

export async function transitionSupabaseAppointment(
  appointmentId: string,
  nextStatus: string,
  reason?: string,
): Promise<ActionResult<Record<string, unknown>>> {
  const client = await createSupabaseServer();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return { success: false, code: 'UNAUTHORIZED', error: 'يرجى تسجيل الدخول.' };

  // 1. Try transition_appointment RPC
  const { data: rpcData, error: rpcError } = await client.rpc('transition_appointment', {
    p_id: appointmentId,
    p_next: nextStatus,
    p_reason: reason ?? null,
  });

  if (!rpcError && rpcData) {
    return { success: true, data: rpcData };
  }

  // 2. Direct table fallback
  const updates: Record<string, unknown> = {
    status: nextStatus,
    updated_at: new Date().toISOString(),
  };

  if (nextStatus === 'checked_in') {
    updates.checked_in_at = new Date().toISOString();
  } else if (nextStatus === 'completed') {
    updates.completed_at = new Date().toISOString();
  } else if (['cancelled', 'rejected'].includes(nextStatus)) {
    updates.cancelled_by = user.id;
    updates.cancel_reason = reason ?? null;
  }

  const { data: updated, error: updateError } = await client
    .from('appointments')
    .update(updates)
    .eq('id', appointmentId)
    .select()
    .single();

  if (updateError) {
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: updateError.message || 'تعذر تحديث حالة الموعد.',
    };
  }

  return { success: true, data: updated };
}

export async function getSupabaseSlots(
  doctorId: string,
  date: string,
  clinicId?: string,
): Promise<ActionResult<{ start: string; end: string }[]>> {
  const { createSupabaseAdmin } = await import('../supabase/admin');
  const client = createSupabaseAdmin();

  let targetClinicId = clinicId;
  let timezone = 'Asia/Damascus';

  if (!targetClinicId) {
    const { data: avail } = await client
      .from('availability')
      .select('clinic_id')
      .eq('doctor_id', doctorId)
      .limit(1)
      .maybeSingle();
    if (avail?.clinic_id) targetClinicId = avail.clinic_id;

    if (!targetClinicId) {
      const { data: docData } = await client
        .from('doctors')
        .select('organization_id')
        .eq('id', doctorId)
        .limit(1)
        .maybeSingle();
      if (docData?.organization_id) {
        const { data: cl } = await client
          .from('clinics')
          .select('id, timezone')
          .eq('organization_id', docData.organization_id)
          .limit(1)
          .maybeSingle();
        if (cl?.id) {
          targetClinicId = cl.id;
          if (cl.timezone) timezone = cl.timezone;
        }
      }
    }
  }

  if (targetClinicId && !timezone) {
    const { data: cl } = await client
      .from('clinics')
      .select('timezone')
      .eq('id', targetClinicId)
      .limit(1)
      .maybeSingle();
    if (cl?.timezone) timezone = cl.timezone;
  }

  if (!targetClinicId) {
    return { success: false, code: 'NOT_FOUND', error: 'العيادة غير موجودة لهذا الطبيب.' };
  }

  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const { data: rawAvail } = await client
    .from('availability')
    .select('day_of_week, start_time, end_time, slot_duration_minutes')
    .eq('clinic_id', targetClinicId)
    .eq('doctor_id', doctorId)
    .eq('day_of_week', day);

  const typedAvail = (rawAvail as RawAvailabilityRow[] | null) ?? [];
  const shifts: Shift[] = typedAvail.map((a) => ({
    day: a.day_of_week,
    start: a.start_time.slice(0, 5),
    end: a.end_time.slice(0, 5),
    duration: a.slot_duration_minutes,
    active: true,
  }));

  const { data: rawBookings } = await client
    .from('appointments')
    .select('start_at, end_at, status, expires_at')
    .eq('doctor_id', doctorId)
    .in('status', ['confirmed', 'pending', 'checked_in']);

  const typedBookings = (rawBookings as RawBookingRow[] | null) ?? [];
  const bookings = typedBookings.map((b) => ({
    start: b.start_at,
    end: b.end_at,
    status: b.status,
    expiresAt: b.expires_at ?? undefined,
  }));

  const { data: rawExceptions } = await client
    .from('availability_exceptions')
    .select('start_at, end_at')
    .eq('doctor_id', doctorId);

  const typedExceptions = (rawExceptions as RawExceptionRow[] | null) ?? [];
  const exceptions = typedExceptions.map((e) => ({
    start: e.start_at,
    end: e.end_at,
  }));

  const slots = getAvailableSlots({
    date,
    timezone,
    shifts,
    now: new Date(),
    leadMinutes: 60,
    horizonDays: 30,
    bookings,
    exceptions,
  });

  return { success: true, data: slots };
}
