import { NextResponse } from 'next/server';
import { z } from 'zod';
import { processAgentMessage } from '@/lib/services/agent-service';
import bookAppointmentTool from '../../../../../agent/tools/book_appointment';
import { currentUser } from '@/lib/auth/session';
import { RATE_LIMIT_CONFIGS } from '@/lib/rate-limit';
import { limitHttpRequest } from '@/lib/http-rate-limit';

const chatRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('chat'),
    message: z
      .string()
      .trim()
      .min(1, 'الرسالة مطلوبة')
      .max(2000, 'يجب ألا تتجاوز الرسالة 2000 حرف'),
    sessionId: z.string().optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
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
    const json = await req.json().catch(() => null);
    const parsed = chatRequestSchema.safeParse(json);

    if (!parsed.success) {
      const rateResponse = await limitHttpRequest(
        req,
        '/api/agent/chat:invalid',
        RATE_LIMIT_CONFIGS.chat,
      );
      if (rateResponse) return rateResponse;
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
      const rateResponse = await limitHttpRequest(
        req,
        '/api/agent/chat:chat',
        RATE_LIMIT_CONFIGS.chat,
      );
      if (rateResponse) return rateResponse;

      const user = await currentUser();
      const result = await processAgentMessage(
        {
          message: payload.message,
          sessionId: payload.sessionId,
          date: payload.date,
        },
        user,
      );

      return NextResponse.json(result, { status: result.success ? 200 : 422 });
    }

    if (payload.action === 'book_slot') {
      // 1. Rate limiting on slot booking
      const rateResponse = await limitHttpRequest(
        req,
        '/api/agent/chat:book_slot',
        RATE_LIMIT_CONFIGS.bookSlot,
      );
      if (rateResponse) return rateResponse;

      // 2. Authentication check: book_slot requires an authenticated patient session
      const user = await currentUser();
      if (!user || user.role !== 'patient') {
        return NextResponse.json(
          {
            success: false,
            code: 'UNAUTHORIZED',
            error: 'حجز الموعد يتطلب تسجيل الدخول كحساب مريض مسجل.',
          },
          { status: 401 },
        );
      }

      const result = await bookAppointmentTool.execute({
        doctorId: payload.doctorId,
        start: payload.start,
        patientName: payload.patientName,
        phone: payload.phone,
        visitType: payload.visitType,
        notes: payload.notes,
        patientId: user.id,
        patientEmail: user.email,
      });

      const resObj =
        typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : null;
      const isSuccess = Boolean(resObj?.success);
      const resCode = typeof resObj?.code === 'string' ? resObj.code : undefined;
      const resError = typeof resObj?.error === 'string' ? resObj.error : undefined;

      const status = isSuccess
        ? 200
        : resCode === 'SLOT_CONFLICT'
          ? 409
          : resCode === 'FORBIDDEN'
            ? 403
            : resCode === 'UNAUTHORIZED'
              ? 401
              : resCode === 'NOT_FOUND'
                ? 404
                : 422;

      return NextResponse.json(
        isSuccess
          ? { success: true, data: result }
          : {
              success: false,
              ...(resCode ? { code: resCode } : {}),
              ...(resError ? { error: resError } : {}),
              data: result,
            },
        { status },
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
