import { randomUUID } from 'node:crypto';
import { formatInTimeZone } from 'date-fns-tz';
import { z } from 'zod';
import { db, get, all, appointments, expirePending, saveAppointment, audit } from '../demo-db';
import { getAvailableSlots } from './slots-engine';
import type { Appointment, Doctor, User, Shift, ActionResult } from '../types';
export const bookingSchema = z
  .object({
    doctorId: z.string().min(1),
    start: z.string().datetime(),
    visitType: z
      .enum(['first_visit', 'follow_up', 'walk_in', 'consultation'])
      .default('first_visit'),
    patientName: z.string().trim().min(2).max(100).optional(),
    phone: z.string().trim().min(7).max(25).optional(),
    notes: z.string().max(1000).optional(),
  })
  .strict();
export type Organization = {
  id: string;
  name: string;
  city: string;
  district: string;
  phone: string;
  address?: string;
  license?: string;
  status: string;
  tier: string;
  subscriptionStatus: string;
  periodEnd: string;
  cancelHours: number;
  leadMinutes: number;
  pendingHours: number;
  expiryMinutes: number;
  autoConfirm?: boolean;
  timezone: string;
};
export function slotsFor(doctorId: string, date: string) {
  const d = get<Doctor>('doctor', doctorId);
  if (!d || !d.verified) return [];
  const org = get<Organization>('organization', d.organizationId);
  if (
    !org ||
    org.status !== 'approved' ||
    !['active', 'trialing'].includes(org.subscriptionStatus) ||
    new Date(org.periodEnd) <= new Date()
  )
    return [];
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const shifts = (get<Shift[]>('schedule', doctorId) ?? []).filter(
    (s) => s.day === day && s.active,
  );
  return getAvailableSlots({
    date,
    timezone: org.timezone,
    shifts,
    now: new Date(),
    leadMinutes: org.leadMinutes,
    horizonDays: org.tier === 'enterprise' ? 180 : org.tier === 'clinic_pro' ? 90 : 30,
    bookings: appointments().filter((a) => a.doctorId === doctorId),
    exceptions: all<{ doctorId: string; start: string; end: string }>('exception').filter(
      (e) => e.doctorId === doctorId,
    ),
  });
}
export function createBooking(user: User, input: unknown): ActionResult<Appointment> {
  const parsed = bookingSchema.safeParse(input);
  if (!parsed.success)
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      error: 'يرجى التحقق من بيانات الحجز ورقم الهاتف.',
    };
  const b = parsed.data;
  const d = get<Doctor>('doctor', b.doctorId);
  if (!d || !d.verified)
    return { success: false, code: 'VALIDATION_ERROR', error: 'الطبيب غير متاح.' };
  const patient = user.role === 'patient';
  if (
    !patient &&
    !(
      user.organizationId === d.organizationId &&
      ((user.role === 'doctor' && user.id === d.id) ||
        (user.role === 'receptionist' && user.clinicId === d.clinicId))
    )
  )
    return {
      success: false,
      code: 'FORBIDDEN',
      error: 'الحجز المباشر متاح للطبيب المعالج أو موظف استقبال الفرع.',
    };
  if (!patient && (!b.patientName || !b.phone))
    return { success: false, code: 'VALIDATION_ERROR', error: 'اسم المريض ورقم الهاتف مطلوبان.' };
  const org = get<Organization>('organization', d.organizationId)!;
  if (
    !['active', 'trialing'].includes(org.subscriptionStatus) ||
    new Date(org.periodEnd) <= new Date()
  )
    return { success: false, code: 'SUBSCRIPTION_INACTIVE', error: 'اشتراك المركز غير نشط.' };
  try {
    return db
      .transaction(() => {
        expirePending();
        const now = new Date();
        const start = new Date(b.start).toISOString();
        if (
          appointments().some(
            (a) =>
              a.doctorId === d.id &&
              ['confirmed', 'pending', 'checked_in'].includes(a.status) &&
              a.start <= start &&
              a.end > start,
          )
        )
          return {
            success: false as const,
            code: 'SLOT_CONFLICT',
            error: 'حُجزت هذه الفترة للتو. اختر وقتاً آخر من الجدول المحدّث.',
          };
        const slot = slotsFor(
          d.id,
          formatInTimeZone(new Date(start), org.timezone, 'yyyy-MM-dd'),
        ).find((s) => s.start === start);
        if (!slot)
          return {
            success: false as const,
            code: 'SLOT_TOO_SOON',
            error: 'الفترة خارج الدوام أو لم تعد متاحة. اختر فترة أخرى.',
          };
        if (
          patient &&
          appointments().filter(
            (a) =>
              a.patientId === user.id &&
              ['pending', 'confirmed', 'checked_in'].includes(a.status) &&
              new Date(a.end) > now,
          ).length >= 3
        )
          return {
            success: false as const,
            code: 'MAX_ACTIVE_REACHED',
            error: 'يمكنك الاحتفاظ بثلاثة حجوزات نشطة كحد أقصى.',
          };
        const pending = patient && !org.autoConfirm;
        const expiresAt = pending
          ? new Date(
              Math.min(
                now.getTime() + org.pendingHours * 3600000,
                new Date(start).getTime() - org.expiryMinutes * 60000,
              ),
            ).toISOString()
          : undefined;
        if (expiresAt && new Date(expiresAt) <= now)
          return {
            success: false as const,
            code: 'SLOT_TOO_SOON',
            error: 'اختر فترة أبعد لإتاحة مهلة تأكيد الحجز.',
          };
        const a: Appointment = {
          id: randomUUID(),
          organizationId: d.organizationId,
          clinicId: d.clinicId,
          doctorId: d.id,
          patientId: patient ? user.id : undefined,
          patientName: patient ? user.name : b.patientName!,
          phone: b.phone ?? '',
          start,
          end: slot.end,
          status: pending ? 'pending' : 'confirmed',
          visitType: b.visitType,
          source: patient
            ? 'patient_portal'
            : user.role === 'doctor'
              ? 'doctor_direct'
              : 'reception_desk',
          fee: b.visitType === 'follow_up' ? d.followUpFee : d.fee,
          payment: 'unpaid',
          notes: b.notes,
          expiresAt,
          createdAt: now.toISOString(),
        };
        saveAppointment(a);
        audit(user, 'appointment.created', a.id);
        return { success: true as const, data: a };
      })
      .immediate();
  } catch (e) {
    if (String(e).includes('SLOT_CONFLICT'))
      return {
        success: false,
        code: 'SLOT_CONFLICT',
        error: 'حُجزت هذه الفترة للتو، يرجى اختيار وقت آخر.',
      };
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: 'تعذر حفظ الحجز. يرجى المحاولة مجدداً.',
    };
  }
}
