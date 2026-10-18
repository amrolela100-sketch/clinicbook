import { z } from 'zod';
import { defineTool } from '../types';
import { appointments, saveAppointment, get, audit } from '@/lib/demo-db';
import { canTransition } from '@/lib/services/appointment-lifecycle';
import type { User } from '@/lib/types';
import type { Organization } from '@/lib/services/booking-service';

/**
 * أداة معالجة رد المريض على التذكير (تأكيد الحضور أو الاعتذار والإلغاء)
 * تضمن الانتقال السليم في آلة الحالات (State Machine) وتحرير الفترات فوراً
 */
export default defineTool({
  name: 'handle_patient_response',
  description: 'معالجة رد المريض على رسالة التأكيد: تأكيد الحضور، أو طلب الإلغاء، أو الاعتذار',
  inputSchema: z.object({
    appointmentId: z.string().describe('معرف الموعد المراد تحديثه'),
    action: z.enum(['confirm_attendance', 'cancel_appointment']).describe('الإجراء المطلوب بناءً على رد المريض'),
    reason: z.string().max(500).default('').describe('سبب الإلغاء في حال اعتذار المريض'),
  }),
  async execute({ appointmentId, action, reason }) {
    const allAppts = appointments();
    const appt = allAppts.find((a) => a.id === appointmentId);

    if (!appt) {
      return {
        success: false,
        code: 'NOT_FOUND',
        message: 'لم يتم العثور على الموعد المحدد.',
      };
    }

    const org = get<Organization>('organization', appt.organizationId);
    const cancelHours = org?.cancelHours ?? 2;
    const now = new Date();

    const systemUser: User = {
      id: 'eve-agent-coordinator',
      name: 'مساعد ClinicBook الذكي',
      email: 'coordinator@clinicbook.local',
      role: 'patient',
    };

    if (action === 'confirm_attendance') {
      if (appt.status === 'confirmed') {
        return {
          success: true,
          status: 'confirmed',
          message: 'الموعد مؤكد مسبقاً، تم تثبيت تأكيد حضور المريض في النظام.',
        };
      }

      const check = canTransition(appt, 'confirmed', 'doctor', now, cancelHours);
      if (!check.success) {
        return {
          success: false,
          code: check.code,
          message: check.error,
        };
      }

      const updated = { ...appt, status: 'confirmed' as const };
      saveAppointment(updated);
      audit(systemUser, 'appointment.confirmed_by_agent', appt.id);

      return {
        success: true,
        status: 'confirmed',
        message: 'تم تأكيد موعد المريض بنجاح، وتنبيه العيادة.',
      };
    }

    if (action === 'cancel_appointment') {
      const check = canTransition(
        appt,
        'cancelled',
        'patient',
        now,
        cancelHours,
        reason || 'اعتذار المريض عبر المساعد الذكي',
      );

      if (!check.success) {
        return {
          success: false,
          code: check.code,
          message: check.error,
        };
      }

      const updated = {
        ...appt,
        status: 'cancelled' as const,
        reason: reason || 'اعتذار المريض عبر المساعد الذكي',
      };
      saveAppointment(updated);
      audit(systemUser, 'appointment.cancelled_by_agent', appt.id);

      return {
        success: true,
        status: 'cancelled',
        message: 'تم إلغاء الموعد وتحرير الفترة الزمنية لتصبح متاحة فوراً لمرضى آخرين.',
      };
    }

    return {
      success: false,
      code: 'UNHANDLED_ACTION',
      message: 'إجراء غير معروف.',
    };
  },
});
