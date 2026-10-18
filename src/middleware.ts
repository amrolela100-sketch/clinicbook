import { NextResponse, type NextRequest } from 'next/server';
export function middleware(request: NextRequest) {
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) {
    const origin = request.headers.get('origin');
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    if (origin) {
      try {
        if (new URL(origin).host !== host)
          return NextResponse.json(
            { success: false, error: 'طلب غير مسموح من مصدر خارجي.' },
            { status: 403 },
          );
      } catch {
        return NextResponse.json({ success: false, error: 'مصدر غير صالح.' }, { status: 403 });
      }
    }
    if (Number(request.headers.get('content-length') ?? 0) > 65536)
      return NextResponse.json(
        { success: false, error: 'حجم الطلب أكبر من المسموح.' },
        { status: 413 },
      );
  }
  const response = NextResponse.next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return response;
}
export const config = { matcher: '/api/:path*' };
