import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase/server';
import { currentUser, redirectForUser } from '@/lib/auth/session';

function sanitizeRedirect(target: string | null, fallback = '/my-appointments'): string {
  if (!target) return fallback;
  // Must be a relative path starting with a single '/' and not containing '//' or any backslash
  if (target.startsWith('/') && !target.startsWith('//') && !target.includes('\\')) {
    return target;
  }
  return fallback;
}

/**
 * OAuth / email-confirmation callback handler.
 * Exchanges the authorization code for a session, then redirects.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const rawNext = url.searchParams.get('next');
  const explicitNext = rawNext ? sanitizeRedirect(rawNext) : null;

  if (code) {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (explicitNext && explicitNext !== '/my-appointments') {
        return NextResponse.redirect(new URL(explicitNext, url.origin));
      }
      const user = await currentUser();
      const destination = user ? redirectForUser(user) : (explicitNext ?? '/my-appointments');
      return NextResponse.redirect(new URL(destination, url.origin));
    }
  }

  return NextResponse.redirect(new URL('/login?error=auth', url.origin));
}
