import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { createSession, deleteSession, isSupabaseConfigured, currentUser } from '@/lib/auth/session';
import { roles, put, get, db } from '@/lib/demo-db';
import type { User, Role } from '@/lib/types';

const sessionSchema = z.object({
  mode: z.enum(['signin', 'signup']).optional(),
  role: z.string().optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  fullName: z.string().min(2).max(100).optional(),
  phone: z.string().min(7).max(25).optional(),
  intent: z.enum(['patient', 'clinic_owner']).optional(),
});

/** Translate common Supabase error messages to Arabic. */
function translateAuthError(msg: string): string {
  if (msg.includes('already registered') || msg.includes('already been registered'))
    return 'هذا البريد مسجل بالفعل.';
  if (msg.includes('Invalid login credentials'))
    return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
  if (msg.includes('Email not confirmed'))
    return 'يرجى تأكيد بريدك الإلكتروني أولاً.';
  if (msg.includes('rate limit') || msg.includes('too many requests'))
    return 'محاولات كثيرة جداً. حاول بعد قليل.';
  if (msg.includes('password') && msg.includes('short'))
    return 'كلمة المرور قصيرة جداً (6 أحرف على الأقل).';
  return msg;
}

/** Determine post-login redirect based on user role & state. */
function redirectForUser(user: User): string {
  if (user.role === 'patient') return '/my-appointments';
  if (user.role === 'clinic_owner' && !user.organizationId) return '/register-clinic?onboarding=1';
  if (user.role === 'super_admin') return '/admin';
  return '/workspace/dashboard';
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = sessionSchema.safeParse(body);

  if (!parsed.success)
    return NextResponse.json(
      { success: false, error: 'بيانات غير صالحة، تحقق من الحقول المطلوبة.' },
      { status: 400 },
    );

  const { mode, role, email, password, fullName, phone, intent } = parsed.data;

  // ─── 1. Sign Up ────────────────────────────────────────────
  if (mode === 'signup' || (fullName && email && password)) {
    if (!fullName || !email || !password) {
      return NextResponse.json(
        { success: false, error: 'الاسم الكامل، البريد، وكلمة المرور مطلوبة.' },
        { status: 400 },
      );
    }

    const effectiveIntent = intent ?? 'patient';

    if (isSupabaseConfigured()) {
      try {
        const { createSupabaseServer } = await import('@/lib/supabase/server');
        const client = await createSupabaseServer();
        const origin = request.headers.get('origin') ?? process.env.NEXT_PUBLIC_APP_URL ?? '';

        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName, phone: phone ?? '', intent_role: effectiveIntent },
            emailRedirectTo: `${origin}/auth/callback`,
          },
        });

        if (error) {
          return NextResponse.json(
            { success: false, error: translateAuthError(error.message) },
            { status: 422 },
          );
        }

        // Email confirmation required (no session returned)
        if (!data.session) {
          return NextResponse.json({
            success: true,
            needsConfirmation: true,
            error: 'تم إرسال رابط التأكيد إلى بريدك الإلكتروني.',
          });
        }

        // Session obtained — create SQLite mirror
        const userId = data.user!.id;
        const userRole: Role = effectiveIntent === 'clinic_owner' ? 'clinic_owner' : 'patient';
        put('user', userId, {
          id: userId,
          name: fullName,
          email,
          role: userRole,
        });

        const user: User = { id: userId, name: fullName, email, role: userRole };
        return NextResponse.json({
          success: true,
          data: user,
          redirectTo: redirectForUser(user),
        });
      } catch (e) {
        console.error('Supabase signup error:', e);
        return NextResponse.json(
          { success: false, error: 'تعذر إنشاء الحساب في السحابة.' },
          { status: 500 },
        );
      }
    }

    // Fallback: SQLite demo
    const id = randomUUID();
    const user: User = { id, name: fullName, email, role: 'patient' };
    put('user', id, user);
    await createSession(id);
    return NextResponse.json({ success: true, data: user, redirectTo: '/my-appointments' });
  }

  // ─── 2. Sign In (email + password) ─────────────────────────
  if (email && password) {
    if (isSupabaseConfigured()) {
      try {
        const { createSupabaseServer } = await import('@/lib/supabase/server');
        const client = await createSupabaseServer();
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) {
          return NextResponse.json(
            { success: false, error: translateAuthError(error.message) },
            { status: 401 },
          );
        }

        // Supabase cookies are set via the server client — read user
        const user = await currentUser();
        if (!user) {
          return NextResponse.json(
            { success: false, error: 'تعذر جلب بيانات المستخدم بعد الدخول.' },
            { status: 500 },
          );
        }

        return NextResponse.json({
          success: true,
          data: user,
          redirectTo: redirectForUser(user),
        });
      } catch (e) {
        console.error('Supabase signIn error:', e);
        return NextResponse.json(
          { success: false, error: 'تعذر الاتصال بخدمة المصادقة.' },
          { status: 500 },
        );
      }
    }

    // Fallback: SQLite demo
    const existing = db
      .prepare('SELECT id, name, email, role FROM users WHERE email = ?')
      .get(email) as User | undefined;
    if (existing) {
      await createSession(existing.id);
      return NextResponse.json({ success: true, data: existing });
    }
    const newId = randomUUID();
    const newUser: User = { id: newId, name: email.split('@')[0], email, role: 'patient' };
    put('user', newId, newUser);
    await createSession(newId);
    return NextResponse.json({ success: true, data: newUser });
  }

  // ─── 3. Quick Role Preview (demo) ──────────────────────────
  // TODO: remove before production — allows impersonating any role without password.
  if (role) {
    if (isSupabaseConfigured()) {
      try {
        const { createSupabaseServer } = await import('@/lib/supabase/server');
        const client = await createSupabaseServer();
        // Sign out any active Supabase session so SQLite demo user takes priority
        await client.auth.signOut();
      } catch {
        // Ignore
      }
    }

    // Use SQLite demo users
    const user = roles.find((u) => u.role === role);
    if (!user)
      return NextResponse.json({ success: false, error: 'الدور غير متاح.' }, { status: 400 });
    await createSession(user.id, user.role);
    return NextResponse.json({ success: true, data: user });
  }

  return NextResponse.json(
    { success: false, error: 'حدد البريد الإلكتروني وكلمة المرور أو الدور المطلوب.' },
    { status: 400 },
  );
}

export async function DELETE() {
  await deleteSession();
  return NextResponse.json({ success: true });
}
