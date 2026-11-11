import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { demoEnabled } from '@/lib/auth/session';
import type { User } from '@/lib/types';
import { z } from 'zod';

const jobCounts = z.object({
  expiredCount: z.number().int().nonnegative(),
  noShowCount: z.number().int().nonnegative(),
  reminderCount: z.number().int().nonnegative(),
  subscriptionExpiredCount: z.number().int().nonnegative(),
  archivedCount: z.number().int().nonnegative(),
});

function cronResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * نقطة النهاية السحابية للمهام المجدولة الدائمة (Automated Retention Cron)
 * تستدعيها Vercel Cron أو أي مجدول مهام خارجي دورياً لرصد وتأكيد مواعيد الـ 24 ساعة القادمة
 */
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization') ?? '';
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      return cronResponse(
        {
          success: false,
          code: 'CRON_NOT_CONFIGURED',
          error: 'خدمة الجدولة غير مهيأة أمنياً على الخادم.',
        },
        500,
      );
    }

    const expectedHeader = `Bearer ${cronSecret}`;
    const authBuf = Buffer.from(authHeader);
    const expBuf = Buffer.from(expectedHeader);
    const valid = authBuf.length === expBuf.length && timingSafeEqual(authBuf, expBuf);

    if (!valid) {
      return cronResponse(
        {
          success: false,
          code: 'UNAUTHORIZED',
          error: 'غير مصرح باستدعاء مهمة الجدولة التلقائية.',
        },
        401,
      );
    }

    if (!demoEnabled()) {
      const { createSupabaseAdmin } = await import('@/lib/supabase/admin');
      const adminClient = createSupabaseAdmin();
      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error('RETENTION_TIMEOUT'));
        }, 10_000);
      });
      let rpcResult;
      try {
        rpcResult = await Promise.race([
          adminClient.rpc('run_retention_jobs').abortSignal(controller.signal),
          timeoutPromise,
        ]);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
      const { data: result, error: rpcErr } = rpcResult;
      if (rpcErr) {
        throw new Error('Retention jobs failed');
      }

      return cronResponse({
        success: true,
        timestamp: new Date().toISOString(),
        data: jobCounts.parse(result),
      });
    }

    const { checkUpcomingAppointmentsRetention } =
      await import('../../../../../agent/schedules/appointment_retention');
    const { audit, appointments, expirePending } = await import('@/lib/demo-db');

    const expiredCount = appointments().filter(
      (appointment) =>
        appointment.status === 'pending' &&
        appointment.expiresAt &&
        new Date(appointment.expiresAt) <= new Date(),
    ).length;
    expirePending();

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

    return cronResponse({
      success: true,
      timestamp: new Date().toISOString(),
      data: {
        checkedCount: retentionResult.checkedCount,
        upcomingCount: retentionResult.upcomingCount,
        expiredCount,
      },
    });
  } catch (error) {
    console.error('[Retention Cron Error]:', error instanceof Error ? error.name : 'UnknownError');
    return cronResponse(
      {
        success: false,
        code: 'INTERNAL_ERROR',
        error: 'حدث خطأ أثناء تنفيذ مهمة الجدولة الدائمة.',
      },
      500,
    );
  }
}

// دعم الـ GET لتسهيل الفحص الدوري عبر Vercel Cron
export async function GET(req: Request) {
  return POST(req);
}
