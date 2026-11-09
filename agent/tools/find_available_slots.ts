import { z } from 'zod';
import { defineTool } from '../types';
import { demoEnabled } from '@/lib/auth/session';
import type { Doctor } from '@/lib/types';

/**
 * أداة البحث عن الفترات المتاحة للأطباء
 * تتيح للوكيل الذكي البحث بالاسم أو التخصص أو المدينة واسترجاع الفترات المتاحة فعلياً
 */
export default defineTool({
  name: 'find_available_slots',
  description: 'البحث عن الأطباء المتاحين وجلب الفترات الزمنية الشاغرة لحجز موعد مؤكد',
  inputSchema: z.object({
    specialty: z
      .string()
      .optional()
      .describe('التخصص الطبي المطلوب مثل: باطنية، أسنان، جلدية، أطفال'),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe('تاريخ اليوم المطلوب بالصيغة YYYY-MM-DD'),
    doctorId: z.string().optional().describe('معرّف الطبيب إن كان محدداً سلفاً'),
  }),
  async execute({ specialty, date, doctorId }) {
    let allDoctors: Doctor[] = [];
    if (demoEnabled()) {
      const { all } = await import('@/lib/demo-db');
      allDoctors = all<Doctor>('doctor').filter((d) => d.verified);
    } else {
      const { isSupabaseConfigured } = await import('@/lib/supabase/config');
      if (isSupabaseConfigured()) {
        const { createSupabaseServer } = await import('@/lib/supabase/server');
        const client = await createSupabaseServer();
        const { data } = await client.rpc('public_doctor_directory');
        const rows = (data as Array<Record<string, unknown>> | null) ?? [];
        allDoctors = rows.map((d) => ({
          id: String(d.id),
          name: String(d.full_name || 'طبيب معتمد'),
          specialty: String(d.specialty_name || 'الطب العام'),
          organizationId: String(d.organization_id || d.id),
          clinicId: String(d.clinic_id || ''),
          clinic: String(d.clinic_name || 'العيادة الطبية'),
          city: String(d.city_name || 'دمشق'),
          district: String(d.district || ''),
          fee: Number(d.consultation_fee ?? 25),
          followUpFee: Number(d.follow_up_fee ?? 15),
          rating: Number(d.rating_avg ?? 4.8),
          reviews: Number(d.reviews_count ?? 0),
          experience: Number(d.years_of_experience ?? 1),
          bio: String(d.bio_ar || ''),
          color: '#e1eeeb',
          image: String(d.avatar_url || 'doctor-1.jpg'),
          verified: true,
          license: String(d.license_number || ''),
        }));
      }
    }

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

    let results;
    if (demoEnabled()) {
      const { slotsFor } = await import('@/lib/services/booking-service');
      results = matchingDoctors.map((doc) => {
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
    } else {
      const { getSupabaseSlots } = await import('@/lib/services/supabase-booking-service');
      results = await Promise.all(
        matchingDoctors.map(async (doc) => {
          const res = await getSupabaseSlots(doc.id, date, doc.clinicId || undefined);
          const slots = res.success ? res.data : [];
          return {
            doctorId: doc.id,
            doctorName: doc.name,
            specialty: doc.specialty,
            clinic: doc.clinic,
            fee: doc.fee,
            availableSlotsCount: slots.length,
            slots,
          };
        }),
      );
    }

    return {
      success: true,
      date,
      count: results.length,
      doctors: results,
    };
  },
});
