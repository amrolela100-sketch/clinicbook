import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * OAuth / email-confirmation callback handler.
 * Exchanges the authorization code for a session, then redirects.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/my-appointments';

  if (code) {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }

  return NextResponse.redirect(new URL('/login?error=auth', url.origin));
}
