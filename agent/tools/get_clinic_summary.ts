import { z } from 'zod';
import { defineTool } from '../types';
import { appointments, all } from '@/lib/demo-db';
import type { Appointment, Doctor } from '@/lib/types';
import { formatInTimeZone } from 'date-fns-tz';

export interface ClinicDailySummary {
  date: string;
  totalAppointments: number;
  confirmedCount: number;
  checkedInCount: number;
  completedCount: number;
  pendingCount: number;
  cancelledCount: number;
  totalEstimatedRevenue: number;
  doctorLoad: Array<{
    doctorId: string;
    doctorName: string;
    specialty: string;
    appointmentCount: number;
  }>;
}

/**
 * أداة استعلام الملخص التشغيلي اليومي للعيادة (Staff & Doctor Copilot)
 * تتيح لموظفي الاستقبال والأطباء معرفة ضغط العمل ومعدل إشغال العيادة
 */
export default defineTool({
  name: 'get_clinic_summary',
  description: 'جلب ملخص مواعيد وإيرادات العيادة والضغط التشغيلي ليوم محدد',
  inputSchema: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('تاريخ اليوم المطلوب YYYY-MM-DD'),
    organizationId: z.string().optional().describe('معرف المركز الطبي'),
  }),
  async execute({ date, organizationId }) {
    const targetDate = date ?? formatInTimeZone(new Date(), 'Asia/Damascus', 'yyyy-MM-dd');
    const allAppts = appointments();
    const allDoctors = all<Doctor>('doctor');

    // تصفية المواعيد لليوم المطلوب وللمنظمة إن حُددت
    const dayAppts = allAppts.filter((a) => {
      const apptDate = a.start.slice(0, 10);
      const orgMatch = organizationId ? a.organizationId === organizationId : true;
      return apptDate === targetDate && orgMatch;
    });

    const confirmedCount = dayAppts.filter((a) => a.status === 'confirmed').length;
    const checkedInCount = dayAppts.filter((a) => a.status === 'checked_in').length;
    const completedCount = dayAppts.filter((a) => a.status === 'completed').length;
    const pendingCount = dayAppts.filter((a) => a.status === 'pending').length;
    const cancelledCount = dayAppts.filter((a) => a.status === 'cancelled').length;

    const totalEstimatedRevenue = dayAppts
      .filter((a) => ['confirmed', 'checked_in', 'completed'].includes(a.status))
      .reduce((sum, a) => sum + (a.fee || 0), 0);

    // توزيع الضغط على الأطباء
    const doctorLoadMap = new Map<string, number>();
    for (const a of dayAppts) {
      doctorLoadMap.set(a.doctorId, (doctorLoadMap.get(a.doctorId) ?? 0) + 1);
    }

    const doctorLoad = allDoctors
      .filter((d) => !organizationId || d.organizationId === organizationId)
      .map((d) => ({
        doctorId: d.id,
        doctorName: d.name,
        specialty: d.specialty,
        appointmentCount: doctorLoadMap.get(d.id) ?? 0,
      }));

    const summary: ClinicDailySummary = {
      date: targetDate,
      totalAppointments: dayAppts.length,
      confirmedCount,
      checkedInCount,
      completedCount,
      pendingCount,
      cancelledCount,
      totalEstimatedRevenue,
      doctorLoad,
    };

    return {
      success: true,
      summary,
    };
  },
});
