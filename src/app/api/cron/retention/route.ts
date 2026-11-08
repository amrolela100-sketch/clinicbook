import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { checkUpcomingAppointmentsRetention } from '../../../../../agent/schedules/appointment_retention';
import { audit } from '@/lib/demo-db';
import type { User } from '@/lib/types';

/**
 * نقطة النهاية السحابية للمهام المجدولة الدائمة (Automated Retention Cron)
 * تستدعيها Vercel Cron أو أي مجدول مهام خارجي دورياً لرصد وتأكيد مواعيد الـ 24 ساعة القادمة
 */
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization') ?? '';
    const cronSecret =
      process.env.CRON_SECRET ||
      (process.env.NODE_ENV !== 'production' ? 'clinicbook-internal-cron-secret' : undefined);

    if (!cronSecret) {
      return NextResponse.json(
        {
          success: false,
          code: 'CRON_NOT_CONFIGURED',
          error: 'خدمة الجدولة غير مهيأة أمنياً على الخادم.',
        },
        { status: 500 },
      );
    }

    const expectedHeader = `Bearer ${cronSecret}`;
    const authBuf = Buffer.from(authHeader);
    const expBuf = Buffer.from(expectedHeader);
    const valid = authBuf.length === expBuf.length && timingSafeEqual(authBuf, expBuf);

    if (!valid) {
      return NextResponse.json(
        {
          success: false,
          code: 'UNAUTHORIZED',
          error: 'غير مصرح باستدعاء مهمة الجدولة التلقائية.',
        },
        { status: 401 },
      );
    }

    const retentionResult = await checkUpcomingAppointmentsRetention(24);

    const systemBot: User = {
      id: 'eve-retention-cron',
      name: 'مجدول ClinicBook الآلي',
      email: 'cron@clinicbook.local',
      role: 'super_admin',
    };

    // تسجيل عمليات المراقبة في سجل التدقيق
    if (retentionResult.candidatesForConfirmation.length > 0) {
      for (const candidate of retentionResult.candidatesForConfirmation) {
        audit(systemBot, 'appointment.retention_scanned', candidate.appointmentId);
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: retentionResult,
    });
  } catch (error) {
    console.error('[Retention Cron Error]:', error);
    return NextResponse.json(
      {
        success: false,
        code: 'INTERNAL_ERROR',
        error: 'حدث خطأ أثناء تنفيذ مهمة الجدولة الدائمة.',
      },
      { status: 500 },
    );
  }
}

// دعم الـ GET لتسهيل الفحص الدوري عبر Vercel Cron
export async function GET(req: Request) {
  return POST(req);
}
