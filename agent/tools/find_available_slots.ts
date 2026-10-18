import { z } from 'zod';
import { defineTool } from '../types';
import { all } from '@/lib/demo-db';
import { slotsFor } from '@/lib/services/booking-service';
import type { Doctor } from '@/lib/types';

/**
 * أداة البحث عن الفترات المتاحة للأطباء
 * تتيح للوكيل الذكي البحث بالاسم أو التخصص أو المدينة واسترجاع الفترات المتاحة فعلياً
 */
export default defineTool({
  name: 'find_available_slots',
  description: 'البحث عن الأطباء المتاحين وجلب الفترات الزمنية الشاغرة لحجز موعد مؤكد',
  inputSchema: z.object({
    specialty: z.string().optional().describe('التخصص الطبي المطلوب مثل: باطنية، أسنان، جلدية، أطفال'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('تاريخ اليوم المطلوب بالصيغة YYYY-MM-DD'),
    doctorId: z.string().optional().describe('معرّف الطبيب إن كان محدداً سلفاً'),
  }),
  async execute({ specialty, date, doctorId }) {
    const allDoctors = all<Doctor>('doctor').filter((d) => d.verified);

    let matchingDoctors = allDoctors;
    if (doctorId) {
      matchingDoctors = matchingDoctors.filter((d) => d.id === doctorId);
    } else if (specialty) {
      const normalizedQuery = specialty.trim().toLowerCase();
      matchingDoctors = matchingDoctors.filter((d) =>
        d.specialty.toLowerCase().includes(normalizedQuery),
      );
    }

    if (matchingDoctors.length === 0) {
      return {
        success: false,
        message: 'لم يتم العثور على أطباء معتمدين مطابقين للتخصص أو المعرف المطلوب.',
        doctors: [],
      };
    }

    const results = matchingDoctors.map((doc) => {
      const slots = slotsFor(doc.id, date);
      return {
        doctorId: doc.id,
        doctorName: doc.name,
        specialty: doc.specialty,
        clinic: doc.clinic,
        fee: doc.fee,
        availableSlotsCount: slots.length,
        slots: slots.map((s) => ({
          start: s.start,
          end: s.end,
        })),
      };
    });

    return {
      success: true,
      date,
      count: results.length,
      doctors: results,
    };
  },
});
