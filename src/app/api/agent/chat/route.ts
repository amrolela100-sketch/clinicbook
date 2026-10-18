import { NextResponse } from 'next/server';
import { z } from 'zod';
import { processAgentMessage } from '@/lib/services/agent-service';
import bookAppointmentTool from '../../../../../agent/tools/book_appointment';

const chatRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('chat'),
    message: z.string().trim().min(1, 'الرسالة مطلوبة'),
    sessionId: z.string().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  z.object({
    action: z.literal('book_slot'),
    doctorId: z.string().min(1),
    start: z.string().datetime(),
    patientName: z.string().min(2).max(100),
    phone: z.string().min(7).max(25),
    visitType: z.enum(['first_visit', 'follow_up', 'consultation']).default('first_visit'),
    notes: z.string().max(500).optional(),
  }),
]);

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const parsed = chatRequestSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          code: 'VALIDATION_ERROR',
          error: 'البيانات المرسلة غير صالحة. يرجى مراجعة الحقول.',
        },
        { status: 400 },
      );
    }

    const payload = parsed.data;

    if (payload.action === 'chat') {
      const result = await processAgentMessage({
        message: payload.message,
        sessionId: payload.sessionId,
        date: payload.date,
      });

      return NextResponse.json(result, { status: result.success ? 200 : 422 });
    }

    if (payload.action === 'book_slot') {
      const result = await bookAppointmentTool.execute({
        doctorId: payload.doctorId,
        start: payload.start,
        patientName: payload.patientName,
        phone: payload.phone,
        visitType: payload.visitType,
        notes: payload.notes,
      });

      const isSuccess =
        typeof result === 'object' &&
        result !== null &&
        'success' in result &&
        Boolean((result as Record<string, unknown>).success);

      return NextResponse.json(
        {
          success: isSuccess,
          data: result,
        },
        { status: isSuccess ? 200 : 422 },
      );
    }

    return NextResponse.json(
      { success: false, code: 'INVALID_ACTION', error: 'إجراء غير مدعوم.' },
      { status: 400 },
    );
  } catch (error) {
    console.error('[Agent API Error]:', error);
    return NextResponse.json(
      {
        success: false,
        code: 'INTERNAL_ERROR',
        error: 'حدث خطأ أثناء معالجة طلب المساعد الذكي.',
      },
      { status: 500 },
    );
  }
}
