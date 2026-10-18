import { appointments, get } from '@/lib/demo-db';
import type { Doctor } from '@/lib/types';

export interface RetentionJobResult {
  checkedCount: number;
  upcomingCount: number;
  candidatesForConfirmation: Array<{
    appointmentId: string;
    patientName: string;
    phone: string;
    doctorName: string;
    start: string;
    hoursUntilStart: number;
  }>;
}

/**
 * مهمة الجدولة الدائمة (Durable Schedule) لمراقبة وتأكيد المواعيد
 * تعمل في الخلفية عبر Eve Workflow لرصد مواعيد الـ 24 ساعة القادمة
 */
export async function checkUpcomingAppointmentsRetention(
  horizonHours = 24,
  now = new Date(),
): Promise<RetentionJobResult> {
  const allAppts = appointments();
  const nowMs = now.getTime();
  const maxMs = nowMs + horizonHours * 3600000;

  const upcoming = allAppts.filter((a) => {
    const startMs = new Date(a.start).getTime();
    return (
      startMs > nowMs &&
      startMs <= maxMs &&
      ['confirmed', 'pending'].includes(a.status)
    );
  });

  const candidates = upcoming.map((a) => {
    const doc = get<Doctor>('doctor', a.doctorId);
    const startMs = new Date(a.start).getTime();
    const hoursUntilStart = Math.round((startMs - nowMs) / 3600000);

    return {
      appointmentId: a.id,
      patientName: a.patientName,
      phone: a.phone,
      doctorName: doc?.name ?? 'الطبيب المعالج',
      start: a.start,
      hoursUntilStart,
    };
  });

  return {
    checkedCount: allAppts.length,
    upcomingCount: upcoming.length,
    candidatesForConfirmation: candidates,
  };
}

export default {
  cron: '0 * * * *', // تشغيل رأس كل ساعة لفحص المواعيد
  handler: async () => {
    return await checkUpcomingAppointmentsRetention(24);
  },
};
