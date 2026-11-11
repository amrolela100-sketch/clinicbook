import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { currentUser, demoEnabled } from '@/lib/auth/session';
import { createSupabaseBooking } from '@/lib/services/supabase-booking-service';
import { RATE_LIMIT_CONFIGS } from '@/lib/rate-limit';
import { limitHttpRequest } from '@/lib/http-rate-limit';

function revalidateAppPaths() {
  try {
    revalidatePath('/workspace');
    revalidatePath('/my-appointments');
  } catch {
    // Safe fallback if called outside Next.js request context (e.g. tests)
  }
}

export async function POST(request: Request) {
  const rateResponse = await limitHttpRequest(
    request,
    '/api/appointments',
    RATE_LIMIT_CONFIGS.appointments,
  );
  if (rateResponse) return rateResponse;

  const user = await currentUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'سجّل الدخول أولاً.', code: 'UNAUTHORIZED' },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);

  if (!demoEnabled()) {
    const result = await createSupabaseBooking(body);
    if (result.success) {
      revalidateAppPaths();
    }
    return NextResponse.json(result, {
      status: result.success
        ? 201
        : result.code === 'SLOT_CONFLICT'
          ? 409
          : result.code === 'FORBIDDEN'
            ? 403
            : result.code === 'UNAUTHORIZED'
              ? 401
              : result.code === 'NOT_FOUND'
                ? 404
                : 422,
    });
  }

  const { createBooking } = await import('@/lib/services/booking-service');
  const result = createBooking(user, body);
  if (result.success) {
    revalidateAppPaths();
  }
  return NextResponse.json(result, {
    status: result.success
      ? 201
      : result.code === 'SLOT_CONFLICT'
        ? 409
        : result.code === 'FORBIDDEN'
          ? 403
          : 422,
  });
}
