import { demoEnabled } from '@/lib/auth/session';
import { NextResponse } from 'next/server';
import { slotsFor } from '@/lib/services/booking-service';
import { getSupabaseSlots } from '@/lib/services/supabase-booking-service';
import { z } from 'zod';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = Object.fromEntries(url.searchParams);
  const p = z
    .object({
      doctorId: z.string().min(1),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .refine((v) => !isNaN(new Date(v).getTime())),
      clinicId: z.string().optional(),
    })
    .safeParse(q);

  if (!p.success)
    return NextResponse.json({ success: false, error: 'تاريخ أو معرف طبيب غير صالح' }, { status: 400 });

  if (!demoEnabled()) {
    const result = await getSupabaseSlots(p.data.doctorId, p.data.date, p.data.clinicId);
    return NextResponse.json(result, {
      status: result.success ? 200 : 422,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  return NextResponse.json(
    { success: true, data: slotsFor(p.data.doctorId, p.data.date) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
