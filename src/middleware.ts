import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isSupabaseConfigured } from '@/lib/supabase/config';

export async function middleware(request: NextRequest) {
  // --- CSRF & body-size checks (API routes only) ---
  if (
    request.nextUrl.pathname.startsWith('/api') &&
    ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)
  ) {
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

  // --- Supabase session refresh (all matched routes) ---
  let response = NextResponse.next({ request });

  if (isSupabaseConfigured()) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });

    // Refreshes the session token if expired — writes updated cookies via setAll
    await supabase.auth.getUser();
  }

  // --- Security headers ---
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ttf|woff|woff2|ico)$).*)',
  ],
};
