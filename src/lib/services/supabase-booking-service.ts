import 'server-only';
import { z } from 'zod';
import { formatInTimeZone } from 'date-fns-tz';
import { createSupabaseServer } from '../supabase/server';
import type { ActionResult } from '../types';

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

export function translatePostgresBookingError(err: { code?: string; message?: string }): {
  code: string;
  error: string;
} {
  const msg = err.message || '';
  const pgCode = err.code || '';

  if (pgCode === '23P01' || msg.includes('overlap') || msg.includes('appointment_no_overlap')) {
    return {
      code: 'SLOT_CONFLICT',
      error: 'عذراً، هذا الموعد تم حجزه للتو من قبل مريض آخر.',
    };
  }
  if (pgCode === 'P0006' || msg.includes('MAX_ACTIVE_BOOKINGS_REACHED')) {
    return {
      code: 'MAX_ACTIVE_REACHED',
      error: 'بلغت الحد الأقصى للحجوزات النشطة (3 مواعيد).',
    };
  }
  if (msg.includes('HOLD_EXPIRES_IMMEDIATELY')) {
    return {
      code: 'VALIDATION_ERROR',
      error: 'اختر فترة أبعد لإتاحة مهلة تأكيد الحجز.',
    };
  }
  if (pgCode === 'P0004' || msg.includes('SLOT_TOO_SOON')) {
    return {
      code: 'VALIDATION_ERROR',
      error: 'الموعد المحدد قريب جداً ولا يحقق المهلة الدنيا للحجز.',
    };
  }
  if (pgCode === 'P0005' || msg.includes('SLOT_BEYOND_HORIZON')) {
    return {
      code: 'VALIDATION_ERROR',
      error: 'الموعد يتجاوز الأفق الزمني المسموح به للحجز.',
    };
  }
  if (msg.includes('SLOT_OUTSIDE_AVAILABILITY')) {
    return {
      code: 'VALIDATION_ERROR',
      error: 'الموعد المحدد يقع خارج أوقات الدوام الأسبوعي المعتمد للطبيب.',
    };
  }
  if (msg.includes('SLOT_IN_EXCEPTION')) {
    return {
      code: 'VALIDATION_ERROR',
      error: 'الموعد يتعارض مع فترة إجازة أو استثناء معتمد للطبيب.',
    };
  }
  if (msg.includes('WALK_IN_NAME_AND_PHONE_REQUIRED')) {
    return {
      code: 'VALIDATION_ERROR',
      error: 'اسم المريض ورقم الهاتف مطلوبان لحجز المراجع المباشر.',
    };
  }
  if (pgCode === '22023' || msg.includes('INVALID_INPUT')) {
    return {
      code: 'VALIDATION_ERROR',
      error: 'بيانات الموعد غير صالحة، تحقق من الحقول.',
    };
  }
  if (msg.includes('PATIENT_NOT_FOUND')) {
    return {
      code: 'NOT_FOUND',
      error: 'حساب المريض غير موجود أو غير نشط.',
    };
  }
  if (
    pgCode === 'P0002' ||
    msg.includes('DOCTOR_OR_ORGANIZATION_UNAVAILABLE') ||
    msg.includes('CLINIC_UNAVAILABLE')
  ) {
    return {
      code: 'VALIDATION_ERROR',
      error: 'الطبيب أو العيادة غير متاحة حالياً للحجز.',
    };
  }
  if (msg.trim() === 'UNAUTHORIZED') {
    return {
      code: 'UNAUTHORIZED',
      error: 'يرجى تسجيل الدخول أولاً.',
    };
  }
  if (
    pgCode === '42501' ||
    msg.includes('UNAUTHORIZED_PATIENT') ||
    msg.includes('PATIENT_INACTIVE') ||
    msg.includes('FORBIDDEN') ||
    msg.includes('TENANT_FORBIDDEN') ||
    msg.includes('DOCTOR_MISMATCH') ||
    msg.includes('RECEPTIONIST_CLINIC_MISMATCH')
  ) {
    return {
      code: 'FORBIDDEN',
      error: 'غير مصرح لك بحجز هذا الموعد.',
    };
  }

  console.error('[Supabase Booking RPC Error]:', { code: pgCode, message: msg });
  return {
    code: 'INTERNAL_ERROR',
    error: 'تعذر إتمام الحجز الذري.',
  };
}

interface AvailabilityShiftRow {
  day_of_week?: number;
  start_time?: string;
  end_time?: string;
  slot_duration_minutes?: number | null;
}

async function resolveSlotDurationMinutes(
  client: Awaited<ReturnType<typeof createSupabaseServer>>,
  doctorId: string,
  clinicId: string,
  startAtIso: string,
): Promise<number> {
  const startDate = new Date(startAtIso);
  const { data: clinicRow } = await client
    .from('clinics')
    .select('timezone')
    .eq('id', clinicId)
    .maybeSingle();
  const timezone =
    typeof (clinicRow as { timezone?: unknown } | null)?.timezone === 'string' &&
    (clinicRow as { timezone: string }).timezone
      ? (clinicRow as { timezone: string }).timezone
      : 'Asia/Damascus';

  const localDate = formatInTimeZone(startDate, timezone, 'yyyy-MM-dd');
  const localTime = formatInTimeZone(startDate, timezone, 'HH:mm:ss');
  const localDow = new Date(`${localDate}T12:00:00Z`).getUTCDay();

  const { data: availRows } = await client
    .from('availability')
    .select('day_of_week, start_time, end_time, slot_duration_minutes')
    .eq('doctor_id', doctorId)
    .eq('clinic_id', clinicId)
    .eq('is_active', true);

  const shifts = (availRows as AvailabilityShiftRow[] | null) ?? [];
  const matchingShift = shifts.find(
    (s) =>
      s.day_of_week === localDow &&
      typeof s.start_time === 'string' &&
      typeof s.end_time === 'string' &&
      s.start_time <= localTime &&
      s.end_time > localTime &&
      typeof s.slot_duration_minutes === 'number' &&
      s.slot_duration_minutes > 0,
  );
  if (matchingShift?.slot_duration_minutes) {
    return matchingShift.slot_duration_minutes;
  }

  const { data: rpcSlots } = await client.rpc('get_available_slots', {
    p_doctor_id: doctorId,
    p_clinic_id: clinicId,
    p_date: localDate,
  });
  const matchingSlot = (
    (rpcSlots as Array<{ start_at: string; end_at: string }> | null) ?? []
  ).find((slot) => new Date(slot.start_at).getTime() === startDate.getTime());
  if (matchingSlot) {
    const mins = Math.round(
      (new Date(matchingSlot.end_at).getTime() - new Date(matchingSlot.start_at).getTime()) / 60000,
    );
    if (mins > 0) return mins;
  }

  const fallbackRow = shifts.find(
    (s) => typeof s.slot_duration_minutes === 'number' && s.slot_duration_minutes > 0,
  );
  return fallbackRow?.slot_duration_minutes ?? 20;
}

export async function createSupabaseBooking(
  input: unknown,
): Promise<ActionResult<Record<string, unknown>>> {
  const p = bookingInputSchema.safeParse(input);
  if (!p.success) {
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      error: 'بيانات الحجز غير صالحة، تحقق من الحقول.',
    };
  }

  const raw = p.data;
  const doctorId = raw.doctor_id ?? raw.doctorId;
  const startAt = raw.start_at ?? raw.start;

  if (!doctorId || !startAt) {
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      error: 'معرف الطبيب ووقت البداية مطلوبان.',
    };
  }

  const { currentUser } = await import('../auth/session');
  const user = await currentUser();
  if (!user) {
    return { success: false, code: 'UNAUTHORIZED', error: 'يرجى تسجيل الدخول أولاً.' };
  }

  const client = await createSupabaseServer();

  let clinicId = raw.clinic_id ?? raw.clinicId;
  if (!clinicId) {
    const { data: avail } = await client
      .from('availability')
      .select('clinic_id')
      .eq('doctor_id', doctorId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (avail?.clinic_id) clinicId = avail.clinic_id;

    if (!clinicId) {
      const { data: member } = await client
        .from('organization_members')
        .select('clinic_id')
        .eq('user_id', doctorId)
        .limit(1)
        .maybeSingle();
      if (member?.clinic_id) clinicId = member.clinic_id;
    }
  }

  if (!clinicId) {
    return { success: false, code: 'VALIDATION_ERROR', error: 'العيادة غير محددة للطبيب.' };
  }

  let endAt = raw.end_at ?? raw.end;
  if (!endAt) {
    const durationMinutes = await resolveSlotDurationMinutes(client, doctorId, clinicId, startAt);
    endAt = new Date(new Date(startAt).getTime() + durationMinutes * 60000).toISOString();
  }

  const visitType = raw.visit_type ?? raw.visitType ?? 'first_visit';
  const notes = raw.notes ?? raw.patient_notes ?? raw.patientNotes ?? null;
  const patientFullName = (raw.patientName ?? raw.patient_name ?? '').trim();
  const patientPhone = (raw.phone ?? '').trim();

  // Branch A: Registered Patient Booking (calls create_appointment_atomic via user context)
  if (user.role === 'patient') {
    const { data: appt, error: rpcError } = await client.rpc('create_appointment_atomic', {
      p_patient_id: user.id,
      p_doctor_id: doctorId,
      p_clinic_id: clinicId,
      p_start_at: startAt,
      p_end_at: endAt,
      p_visit_type: visitType === 'walk_in' ? 'first_visit' : visitType,
      p_patient_notes: notes,
    });

    if (rpcError) {
      const translated = translatePostgresBookingError(rpcError);
      return { success: false, code: translated.code, error: translated.error };
    }

    return { success: true, data: appt as Record<string, unknown> };
  }

  // Branch B: Staff / Doctor Booking (verified patient phone resolution happens inside SECURITY DEFINER RPC)
  const isStaff = ['doctor', 'receptionist', 'clinic_owner'].includes(user.role);
  if (!isStaff) {
    return { success: false, code: 'FORBIDDEN', error: 'غير مصرح لك بإجراء حجز بالنيابة.' };
  }

  const { data: staffAppt, error: staffRpcError } = await client.rpc(
    'create_staff_appointment_atomic',
    {
      p_doctor_id: doctorId,
      p_clinic_id: clinicId,
      p_start_at: startAt,
      p_end_at: endAt,
      p_visit_type: visitType,
      p_patient_id: null,
      p_walk_in_name: patientFullName || null,
      p_walk_in_phone: patientPhone || null,
      p_notes: notes,
    },
  );

  if (staffRpcError) {
    const translated = translatePostgresBookingError(staffRpcError);
    return { success: false, code: translated.code, error: translated.error };
  }

  return { success: true, data: staffAppt as Record<string, unknown> };
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

  const { data: rpcData, error: rpcError } = await client.rpc('transition_appointment', {
    p_id: appointmentId,
    p_next: nextStatus,
    p_reason: reason ?? null,
  });

  if (!rpcError && rpcData) {
    return { success: true, data: rpcData as Record<string, unknown> };
  }

  if (rpcError) {
    const msg = rpcError.message || '';
    if (msg.trim() === 'UNAUTHORIZED') {
      return { success: false, code: 'UNAUTHORIZED', error: 'يرجى تسجيل الدخول أولاً.' };
    }
    if (rpcError.code === '42501' || msg.includes('FORBIDDEN')) {
      return { success: false, code: 'FORBIDDEN', error: 'غير مصرح لك بتغيير حالة هذا الموعد.' };
    }
    if (rpcError.code === 'P0002') {
      return { success: false, code: 'NOT_FOUND', error: 'الموعد غير موجود.' };
    }
    if (rpcError.code === '22023' || msg.includes('INVALID_TRANSITION')) {
      return {
        success: false,
        code: 'INVALID_STATE',
        error: 'لا يمكن تنفيذ هذا الانتقال لحالة الموعد في الوقت الحالي.',
      };
    }

    console.error('[Supabase Transition RPC Error]:', { code: rpcError.code, message: msg });
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: 'تعذر تحديث حالة الموعد عبر الدالة الذرية.',
    };
  }

  return { success: false, code: 'INTERNAL_ERROR', error: 'تعذر تحديث حالة الموعد.' };
}

export async function getSupabaseSlots(
  doctorId: string,
  date: string,
  clinicId?: string,
): Promise<ActionResult<{ start: string; end: string }[]>> {
  const client = await createSupabaseServer();

  let targetClinicId = clinicId;
  if (!targetClinicId) {
    const { data: avail } = await client
      .from('availability')
      .select('clinic_id')
      .eq('doctor_id', doctorId)
      .eq('is_active', true)
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
          .select('id')
          .eq('organization_id', docData.organization_id)
          .limit(1)
          .maybeSingle();
        if (cl?.id) targetClinicId = cl.id;
      }
    }
  }

  if (!targetClinicId) {
    return { success: false, code: 'NOT_FOUND', error: 'العيادة غير موجودة لهذا الطبيب.' };
  }

  const { data: rpcSlots, error: rpcError } = await client.rpc('get_available_slots', {
    p_doctor_id: doctorId,
    p_clinic_id: targetClinicId,
    p_date: date,
  });

  if (rpcError) {
    console.error('get_available_slots RPC error:', rpcError);
    return { success: false, code: 'INTERNAL_ERROR', error: 'تعذر جلب الفترات المتاحة.' };
  }

  const typedSlots = (rpcSlots as Array<{ start_at: string; end_at: string }> | null) ?? [];
  const slots = typedSlots.map((s) => ({
    start: s.start_at,
    end: s.end_at,
  }));

  return { success: true, data: slots };
}
