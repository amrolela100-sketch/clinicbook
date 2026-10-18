import { NextResponse } from 'next/server';
import { currentUser, demoEnabled } from '@/lib/auth/session';
import { createBooking } from '@/lib/services/booking-service';
import { createSupabaseBooking } from '@/lib/services/supabase-booking-service';

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json(
      { success: false, error: 'سجّل الدخول أولاً.', code: 'UNAUTHORIZED' },
      { status: 401 },
    );

  const body = await request.json().catch(() => null);

  if (!demoEnabled()) {
    const result = await createSupabaseBooking(body);
    return NextResponse.json(result, {
      status: result.success
        ? 201
        : result.code === 'SLOT_CONFLICT'
          ? 409
          : result.code === 'FORBIDDEN'
            ? 403
            : result.code === 'UNAUTHORIZED'
              ? 401
              : 422,
    });
  }

  const result = createBooking(user, body);
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
