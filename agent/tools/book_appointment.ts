import { z } from 'zod';
import { defineTool } from '../types';
import { demoEnabled } from '@/lib/auth/session';
import type { User } from '@/lib/types';

/**
 * أداة حجز موعد ذري للوكيل الذكي
 * تستدعي دالة الحجز الرسمية حسب وضع التشغيل لمنع التعارض والحفاظ على تناسق قاعدة البيانات
 */
export default defineTool({
  name: 'book_appointment',
  description: 'حجز موعد مؤكد لمريض مع طبيب محدد في فترة زمنية شاغرة',
  inputSchema: z.object({
    doctorId: z.string().min(1).describe('معرف الطبيب'),
    start: z.string().datetime().describe('توقيت بداية الموعد بصيغة ISO-8601 UTC'),
    patientName: z.string().min(2).max(100).describe('اسم المريض الكامل'),
    phone: z.string().min(7).max(25).describe('رقم هاتف المريض للتواصل والتأكيد'),
    visitType: z.enum(['first_visit', 'follow_up', 'consultation']).default('first_visit'),
    notes: z.string().max(500).optional().describe('ملاحظات إضافية حول الزيارة'),
    patientId: z.string().optional().describe('معرف المريض المسجل إن وجد'),
    patientEmail: z.string().email().optional().describe('بريد المريض المسجل إن وجد'),
  }),
  async execute({
    doctorId,
    start,
    patientName,
    phone,
    visitType,
    notes,
    patientId,
    patientEmail,
  }) {
    if (!patientId) {
      return {
        success: false,
        code: 'UNAUTHORIZED',
        error: 'حجز الموعد يتطلب حساب مريض مسجّل ومسجل دخوله.',
      };
    }

    // استخدام هوية المريض الحقيقية الموثقة من الجلسة
    const patientUser: User = {
      id: patientId,
      name: patientName,
      email: patientEmail || `patient-${patientId}@clinicbook.local`,
      role: 'patient',
    };

    const bookingPayload = {
      doctorId,
      start,
      visitType,
      patientName,
      phone,
      notes: notes
        ? `[تم الحجز عبر مساعد ClinicBook الذكي] ${notes}`
        : '[تم الحجز عبر مساعد ClinicBook الذكي]',
    };

    const bookingResult = demoEnabled()
      ? (await import('@/lib/services/booking-service')).createBooking(patientUser, bookingPayload)
      : await (
          await import('@/lib/services/supabase-booking-service')
        ).createSupabaseBooking(bookingPayload);

    if (!bookingResult.success) {
      return {
        success: false,
        code: bookingResult.code,
        error: bookingResult.error,
      };
    }

    const appt = bookingResult.data as Record<string, unknown>;
    return {
      success: true,
      appointmentId: appt.id,
      patientName: appt.patientName ?? appt.walk_in_patient_name ?? patientName,
      doctorId: appt.doctorId ?? appt.doctor_id ?? doctorId,
      start: appt.start ?? appt.start_at ?? start,
      end: appt.end ?? appt.end_at,
      status: appt.status,
      fee: appt.fee ?? appt.fee_amount,
      message: 'تم حجز الموعد بنجاح وبشكل ذري بدون تعارض.',
    };
  },
});
