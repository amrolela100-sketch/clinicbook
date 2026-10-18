import { cookies } from 'next/headers';
import { randomBytes, createHash } from 'node:crypto';
import { db, get } from '../demo-db';
import type { User, Role } from '../types';

export const isSupabaseConfigured = () =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export const demoEnabled = () =>
  process.env.CLINICBOOK_MODE !== 'production' || !isSupabaseConfigured();

export async function currentUser(): Promise<User | null> {
  // 1. Check Supabase Auth session if token exists
  if (isSupabaseConfigured()) {
    try {
      const { createSupabaseServer } = await import('../supabase/server');
      const client = await createSupabaseServer();
      const {
        data: { user: authUser },
      } = await client.auth.getUser();

      if (authUser) {
        const { data: profile } = await client
          .from('users')
          .select('id, full_name, email, role')
          .eq('id', authUser.id)
          .maybeSingle();

        if (profile) {
          const { data: clinic } = await client
            .from('clinics')
            .select('id, name')
            .eq('doctor_id', profile.id)
            .limit(1)
            .maybeSingle();

          const mappedRole = profile.role === 'admin' ? 'super_admin' : profile.role;
          return {
            id: profile.id,
            name: profile.full_name,
            email: profile.email,
            role: mappedRole as Role,
            organizationId: clinic?.id ?? profile.id,
            clinicId: clinic?.id,
          };
        }
      }
    } catch {
      // Continue to cookie check
    }
  }

  // 2. Check session cookie (for quick role preview & demo workspace)
  const token = (await cookies()).get('clinicbook-session')?.value;
  if (!token) return null;

  const hash = createHash('sha256').update(token).digest('hex');
  const row = db
    .prepare('SELECT user_id, role FROM sessions WHERE token=? AND expires_at>?')
    .get(hash, new Date().toISOString()) as { user_id: string; role?: string } | undefined;

  if (!row) return null;

  // Check if this user exists in Supabase
  if (isSupabaseConfigured()) {
    try {
      const { createSupabaseAdmin } = await import('../supabase/admin');
      const adminClient = createSupabaseAdmin();
      const { data: profile } = await adminClient
        .from('users')
        .select('id, full_name, email, role')
        .eq('id', row.user_id)
        .maybeSingle();

      if (profile) {
        const { data: clinic } = await adminClient
          .from('clinics')
          .select('id, name')
          .eq('doctor_id', profile.id)
          .limit(1)
          .maybeSingle();

        const mappedRole = (row.role as Role) || (profile.role === 'admin' ? 'super_admin' : (clinic && profile.role === 'doctor' ? 'clinic_owner' : profile.role));
        return {
          id: profile.id,
          name: profile.full_name,
          email: profile.email,
          role: mappedRole as Role,
          organizationId: clinic?.id ?? profile.id,
          clinicId: clinic?.id,
        };
      }
    } catch {
      // Fallback to SQLite store
    }
  }

  const u = get<User>('user', row.user_id);
  if (u) {
    return row.role ? { ...u, role: row.role as Role } : u;
  }
  return null;
}

export async function createSession(userId: string, role?: Role) {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(
    createHash('sha256').update(token).digest('hex'),
    userId,
    new Date(Date.now() + 86400000).toISOString(),
    role ?? null,
  );
  (await cookies()).set('clinicbook-session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: 86400,
  });
}

export async function deleteSession() {
  const jar = await cookies();
  const token = jar.get('clinicbook-session')?.value;
  if (token)
    db.prepare('DELETE FROM sessions WHERE token=?').run(
      createHash('sha256').update(token).digest('hex'),
    );
  jar.delete('clinicbook-session');

  if (isSupabaseConfigured()) {
    try {
      const { createSupabaseServer } = await import('../supabase/server');
      const client = await createSupabaseServer();
      await client.auth.signOut();
    } catch {
      // Ignored if not signed in to Supabase
    }
  }
}
