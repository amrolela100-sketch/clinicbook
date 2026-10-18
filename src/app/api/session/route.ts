import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { createSession, deleteSession, isSupabaseConfigured, currentUser } from '@/lib/auth/session';
import { roles, put, db } from '@/lib/demo-db';
import type { User, Role } from '@/lib/types';

const sessionSchema = z.object({
  mode: z.enum(['signin', 'signup']).optional(),
  role: z.string().optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  fullName: z.string().min(2).max(100).optional(),
  phone: z.string().min(7).max(25).optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = sessionSchema.safeParse(body);

  if (!parsed.success)
    return NextResponse.json({ success: false, error: 'بيانات غير صالحة، تحقق من الحقول المطلوبة.' }, { status: 400 });

  const { mode, role, email, password, fullName, phone } = parsed.data;

  // 1. إنشاء حساب مريض جديد (Sign Up as Patient)
  if (mode === 'signup' || (fullName && email && password)) {
    if (!fullName || !email || !password) {
      return NextResponse.json({ success: false, error: 'الاسم الكامل، البريد، وكلمة المرور مطلوبة.' }, { status: 400 });
    }

    if (isSupabaseConfigured()) {
      try {
        const { createSupabaseServer } = await import('@/lib/supabase/server');
        const { createSupabaseAdmin } = await import('@/lib/supabase/admin');
        const client = await createSupabaseServer();
        const adminClient = createSupabaseAdmin();

        const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: fullName, phone: phone ?? '' },
        });

        if (authError) {
          return NextResponse.json(
            { success: false, error: authError.message.includes('already registered') || authError.message.includes('already been registered') ? 'هذا البريد مسجل بالفعل.' : authError.message },
            { status: 422 },
          );
        }

        const newUserId = authData.user?.id;
        if (newUserId) {
          // تسجيل الدخول بالعميل لضبط الكوكيز
          try {
            await client.auth.signInWithPassword({ email, password });
          } catch {
            // كوكيز العميل
          }
          // مزامنة الملف الشخصي مع جدول public.users بصلاحية مريض
          await adminClient.from('users').upsert({
            id: newUserId,
            email,
            full_name: fullName,
            phone: phone ?? null,
            role: 'patient',
            status: 'active',
          });

          await createSession(newUserId);
          const user: User = {
            id: newUserId,
            name: fullName,
            email,
            role: 'patient',
          };
          return NextResponse.json({ success: true, data: user });
        }
      } catch (e) {
        console.error('Supabase signup error:', e);
        return NextResponse.json({ success: false, error: 'تعذر إنشاء الحساب في السحابة.' }, { status: 500 });
      }
    }

    // وضع العرض التجريبي الاحتياطي (SQLite)
    const id = randomUUID();
    put('user', id, { id, name: fullName, email, role: 'patient' });
    await createSession(id);
    return NextResponse.json({ success: true, data: { id, name: fullName, email, role: 'patient' } });
  }

  // 2. تسجيل الدخول بالبريد وكلمة المرور (Sign In with Email & Password)
  if (email && password) {
    if (isSupabaseConfigured()) {
      try {
        const { createSupabaseServer } = await import('@/lib/supabase/server');
        const client = await createSupabaseServer();
        const { data: authData, error } = await client.auth.signInWithPassword({ email, password });
        if (error) {
          return NextResponse.json(
            { success: false, error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' },
            { status: 401 },
          );
        }
        if (authData.user) {
          await createSession(authData.user.id);
        }
        const user = await currentUser();
        return NextResponse.json({ success: true, data: user });
      } catch (e) {
        console.error('Supabase signIn error:', e);
        return NextResponse.json(
          { success: false, error: 'تعذر الاتصال بخدمة المصادقة.' },
          { status: 500 },
        );
      }
    }

    // وضع العرض التجريبي الاحتياطي (SQLite)
    const existing = db.prepare('SELECT id, name, email, role FROM users WHERE email = ?').get(email) as User | undefined;
    if (existing) {
      await createSession(existing.id);
      return NextResponse.json({ success: true, data: existing });
    }
    const newId = randomUUID();
    put('user', newId, { id: newId, name: email.split('@')[0], email, role: 'patient' });
    await createSession(newId);
    return NextResponse.json({ success: true, data: { id: newId, name: email.split('@')[0], email, role: 'patient' } });
  }

  // 3. الدخول السريع للاستكشاف عبر الأدوار (Quick Role Preview)
  if (role) {
    if (isSupabaseConfigured()) {
      try {
        const { createSupabaseAdmin } = await import('@/lib/supabase/admin');
        const adminClient = createSupabaseAdmin();
        const targetRole = role === 'clinic_owner' ? 'doctor' : role === 'super_admin' ? 'admin' : role;

        const { data: users } = await adminClient
          .from('users')
          .select('id, full_name, email, role')
          .eq('role', targetRole)
          .limit(1);

        const suUser = users?.[0];
        if (suUser) {
          const effectiveRole = (role === 'clinic_owner' ? 'clinic_owner' : role) as Role;
          await createSession(suUser.id, effectiveRole);
          const user: User = {
            id: suUser.id,
            name: suUser.full_name,
            email: suUser.email,
            role: effectiveRole,
            organizationId: suUser.id,
          };
          return NextResponse.json({ success: true, data: user });
        }
      } catch (e) {
        console.error('Supabase role preview lookup error:', e);
      }
    }

    // Fallback to SQLite roles
    const user = roles.find((u) => u.role === role);
    if (!user) return NextResponse.json({ success: false, error: 'الدور غير متاح.' }, { status: 400 });
    await createSession(user.id, user.role);
    return NextResponse.json({ success: true, data: user });
  }

  return NextResponse.json({ success: false, error: 'حدد البريد الإلكتروني وكلمة المرور أو الدور المطلوب.' }, { status: 400 });
}

export async function DELETE() {
  await deleteSession();
  return NextResponse.json({ success: true });
}
