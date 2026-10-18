import { z } from 'zod';
import { defineTool } from '../types';
import { createBooking } from '@/lib/services/booking-service';
import type { User } from '@/lib/types';

/**
 * أداة حجز موعد ذري للوكيل الذكي
 * تستدعي دالة createBooking الرسمية لمنع التعارض والحفاظ على تناسق قاعدة البيانات
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
  }),
  async execute({ doctorId, start, patientName, phone, visitType, notes }) {
    // تمثيل هوية المريض عبر جلسة النظام المحمية
    const patientUser: User = {
      id: `agent-patient-${phone.replace(/\D/g, '').slice(-8) || 'guest'}`,
      name: patientName,
      email: `${phone.replace(/\D/g, '') || 'patient'}@clinicbook.local`,
      role: 'patient',
    };

    const bookingResult = createBooking(patientUser, {
      doctorId,
      start,
      visitType,
      patientName,
      phone,
      notes: notes ? `[تم الحجز عبر مساعد ClinicBook الذكي] ${notes}` : '[تم الحجز عبر مساعد ClinicBook الذكي]',
    });

    if (!bookingResult.success) {
      return {
        success: false,
        code: bookingResult.code,
        error: bookingResult.error,
      };
    }

    const appt = bookingResult.data;
    return {
      success: true,
      appointmentId: appt.id,
      patientName: appt.patientName,
      doctorId: appt.doctorId,
      start: appt.start,
      end: appt.end,
      status: appt.status,
      fee: appt.fee,
      message: 'تم حجز الموعد بنجاح وبشكل ذري بدون تعارض.',
    };
  },
});
