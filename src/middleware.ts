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

    // A client-supplied platform marker must not turn x-forwarded-host into
    // an authority for CSRF checks. Production uses the configured app origin.
    let expectedOrigin: string;
    try {
      const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
      if (process.env.NODE_ENV === 'production' && !configuredUrl) {
        throw new Error('NEXT_PUBLIC_APP_URL is required in production');
      }
      expectedOrigin = new URL(configuredUrl || request.nextUrl.origin).origin;
    } catch {
      return NextResponse.json(
        { success: false, code: 'SERVICE_UNAVAILABLE', error: 'إعدادات مصدر التطبيق غير صالحة.' },
        { status: 503 },
      );
    }

    const origin = request.headers.get('origin');
    const referer = request.headers.get('referer');
    if (origin) {
      try {
        if (new URL(origin).origin !== expectedOrigin)
          return NextResponse.json(
            { success: false, code: 'CSRF_FORBIDDEN', error: 'طلب غير مسموح من مصدر خارجي.' },
            { status: 403 },
          );
      } catch {
        return NextResponse.json(
          { success: false, code: 'CSRF_FORBIDDEN', error: 'مصدر غير صالح.' },
          { status: 403 },
        );
      }
    } else if (!isCronRoute && referer) {
      try {
        if (new URL(referer).origin !== expectedOrigin)
          return NextResponse.json(
            { success: false, code: 'CSRF_FORBIDDEN', error: 'مرجع الطلب غير مسموح.' },
            { status: 403 },
          );
      } catch {
        return NextResponse.json(
          { success: false, code: 'CSRF_FORBIDDEN', error: 'مرجع الطلب غير صالح.' },
          { status: 403 },
        );
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
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  let supabaseConnectSrc = '';
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabaseUrl) {
    try {
      const origin = new URL(supabaseUrl);
      if (!['https:', 'http:'].includes(origin.protocol))
        throw new Error('Invalid Supabase protocol');
      const websocket = new URL(origin.origin);
      websocket.protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
      supabaseConnectSrc = ` ${origin.origin} ${websocket.origin}`;
    } catch (err) {
      console.warn('Invalid NEXT_PUBLIC_SUPABASE_URL in middleware:', err);
    }
  }
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${supabaseConnectSrc}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ');

  // Next reads the request CSP to nonce its framework and hydration scripts.
  // Never retain a client-supplied policy or an unrelated report-only nonce.
  requestHeaders.set('Content-Security-Policy', csp);
  requestHeaders.delete('Content-Security-Policy-Report-Only');

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
              const cookieHeader = request.headers.get('cookie');
              if (cookieHeader) requestHeaders.set('cookie', cookieHeader);
              else requestHeaders.delete('cookie');
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

  // --- Security headers & CSP (enforced by default in production) ---
  const enforceCsp =
    process.env.CSP_ENFORCE === 'true' ||
    (process.env.NODE_ENV === 'production' && process.env.CSP_REPORT_ONLY !== 'true');
  if (enforceCsp) {
    response.headers.set('Content-Security-Policy', csp);
  } else {
    response.headers.set('Content-Security-Policy-Report-Only', csp);
  }
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
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
  runtime: 'nodejs',
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ttf|woff|woff2|ico)$).*)',
  ],
};
