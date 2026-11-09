import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isSupabaseConfigured } from '@/lib/supabase/config';

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isUnsafeMethod = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method);
  const isCronRoute = pathname.startsWith('/api/cron/');

  // --- CSRF, Sec-Fetch-Site & body-size checks (API routes only) ---
  if (pathname.startsWith('/api') && isUnsafeMethod) {
    const secFetchSite = request.headers.get('sec-fetch-site');
    if (!isCronRoute && secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
      return NextResponse.json(
        { success: false, code: 'CSRF_FORBIDDEN', error: 'طلب غير مسموح من مصدر خارجي.' },
        { status: 403 },
      );
    }

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

    const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
    const transferEncoding = (request.headers.get('transfer-encoding') ?? '').toLowerCase();
    const contentLengthHeader = request.headers.get('content-length');
    const requiresLength =
      contentType.length > 0 ||
      transferEncoding.length > 0 ||
      (!isCronRoute && request.method !== 'DELETE');

    if (requiresLength && contentLengthHeader === null) {
      return NextResponse.json(
        {
          success: false,
          code: 'LENGTH_REQUIRED',
          error: 'مطلوب تحديد طول المحتوى (Content-Length).',
        },
        { status: 411 },
      );
    }

    let parsedLength = 0;
    if (contentLengthHeader !== null) {
      const trimmedLength = contentLengthHeader.trim();
      if (!/^\d+$/.test(trimmedLength)) {
        return NextResponse.json(
          {
            success: false,
            code: 'LENGTH_REQUIRED',
            error: 'قيمة Content-Length غير صالحة.',
          },
          { status: 411 },
        );
      }
      parsedLength = Number(trimmedLength);
      if (parsedLength > 65536) {
        return NextResponse.json(
          { success: false, error: 'حجم الطلب أكبر من المسموح.' },
          { status: 413 },
        );
      }
    }

    if (
      !isCronRoute &&
      (contentType.length > 0 || parsedLength > 0) &&
      !contentType.includes('application/json')
    ) {
      return NextResponse.json(
        {
          success: false,
          code: 'UNSUPPORTED_MEDIA_TYPE',
          error: 'نوع المحتوى غير مدعوم. استخدم application/json.',
        },
        { status: 415 },
      );
    }
  }

  // --- Prepare request headers with cryptographic CSP nonce ---
  const nonce = btoa(crypto.randomUUID());
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  // --- Supabase session refresh (all matched routes) ---
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  if (
    isSupabaseConfigured() &&
    (process.env.CLINICBOOK_MODE === 'production' || process.env.FORCE_SUPABASE === 'true')
  ) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

    if (url && key) {
      try {
        const supabase = createServerClient(url, key, {
          cookies: {
            getAll: () => request.cookies.getAll(),
            setAll: (list) => {
              list.forEach(({ name, value }) => request.cookies.set(name, value));
              response = NextResponse.next({ request: { headers: requestHeaders } });
              list.forEach(({ name, value, options }) =>
                response.cookies.set(name, value, options),
              );
            },
          },
        });

        // Refreshes the session token if expired — writes updated cookies via setAll
        await supabase.auth.getUser();
      } catch {
        // Silently continue if Supabase is temporarily unreachable
      }
    }
  }

  // --- Security headers & CSP Report-Only ---
  let supabaseConnectSrc = '';
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabaseUrl) {
    try {
      supabaseConnectSrc = ` ${new URL(supabaseUrl).origin}`;
    } catch (err) {
      // Invalid URL in env; log and keep connect-src strictly 'self' (fail-closed)
      console.warn('Invalid NEXT_PUBLIC_SUPABASE_URL in middleware:', err);
    }
  }

  const cspReportOnly = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${supabaseConnectSrc}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ');

  response.headers.set('Content-Security-Policy-Report-Only', cspReportOnly);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload',
    );
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ttf|woff|woff2|ico)$).*)',
  ],
};
