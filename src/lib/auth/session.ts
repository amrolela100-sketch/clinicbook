import { cookies } from 'next/headers';
import { randomBytes, createHash } from 'node:crypto';
import { db, get, put } from '../demo-db';
import type { User, Role } from '../types';

export { isSupabaseConfigured } from '../supabase/config';
import { isSupabaseConfigured } from '../supabase/config';

export const demoEnabled = () =>
  process.env.CLINICBOOK_MODE !== 'production' || !isSupabaseConfigured();

export async function currentUser(): Promise<User | null> {
  // 1. Check Supabase Auth session (cookie-based, refreshed by middleware)
  if (isSupabaseConfigured()) {
    try {
      const { createSupabaseServer } = await import('../supabase/server');
      const client = await createSupabaseServer();
      const {
        data: { user: authUser },
      } = await client.auth.getUser();

      if (authUser) {
        // Prefer SQLite mirror (single source of truth after onboarding)
        const mirror = get<User>('user', authUser.id);
        if (mirror) return mirror;

        // No mirror yet — build one from public.users
        const { data: profile } = await client
          .from('users')
          .select('id, full_name, email, role')
          .eq('id', authUser.id)
          .maybeSingle();

        if (profile) {
          const mappedRole: Role =
            profile.role === 'admin' ? 'super_admin' : (profile.role as Role);
          const newMirror: User = {
            id: profile.id,
            name: profile.full_name,
            email: profile.email,
            role: mappedRole,
          };
          put('user', profile.id, newMirror);
          return newMirror;
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
