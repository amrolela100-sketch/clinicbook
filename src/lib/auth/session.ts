import { cookies } from 'next/headers';
import { randomBytes, createHash } from 'node:crypto';
import { db, get, put } from '../demo-db';
import type { User, Role } from '../types';

export { isSupabaseConfigured } from '../supabase/config';
import { isSupabaseConfigured } from '../supabase/config';

export const demoEnabled = () => {
  if (process.env.FORCE_SUPABASE === 'true' || process.env.CLINICBOOK_MODE === 'production') {
    return false;
  }
  if (process.env.CLINICBOOK_MODE === 'demo') {
    return true;
  }
  return !isSupabaseConfigured();
};

export async function currentUser(): Promise<User | null> {
  // 1. Check Supabase Auth session (cookie-based, refreshed by middleware)
  if (!demoEnabled() && isSupabaseConfigured()) {
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

        const mirror = get<User>('user', authUser.id);

        const mappedRole: Role =
          profile?.role === 'admin'
            ? 'super_admin'
            : (profile?.role as Role) ||
              mirror?.role ||
              ((authUser.user_metadata?.intent_role === 'clinic_owner'
                ? 'clinic_owner'
                : 'patient') as Role);

        let orgId: string | undefined = mirror?.organizationId;
        let clinicId: string | undefined = mirror?.clinicId;

        if (mappedRole === 'clinic_owner') {
          if (!orgId) {
            const { data: org } = await client
              .from('organizations')
              .select('id')
              .eq('owner_id', authUser.id)
              .limit(1)
              .maybeSingle();
            if (org?.id) orgId = org.id;
          }
          if (!clinicId && orgId) {
            const { data: cl } = await client
              .from('clinics')
              .select('id')
              .eq('organization_id', orgId)
              .limit(1)
              .maybeSingle();
            if (cl?.id) clinicId = cl.id;
          }
        } else if (mappedRole === 'doctor') {
          if (!orgId) {
            const { data: doc } = await client
              .from('doctors')
              .select('organization_id')
              .eq('id', authUser.id)
              .limit(1)
              .maybeSingle();
            if (doc?.organization_id) orgId = doc.organization_id;
          }
          if (!clinicId) {
            const { data: member } = await client
              .from('organization_members')
              .select('clinic_id')
              .eq('user_id', authUser.id)
              .limit(1)
              .maybeSingle();
            if (member?.clinic_id) clinicId = member.clinic_id;
          }
        } else if (mappedRole === 'receptionist') {
          if (!orgId || !clinicId) {
            const { data: member } = await client
              .from('organization_members')
              .select('organization_id, clinic_id')
              .eq('user_id', authUser.id)
              .limit(1)
              .maybeSingle();
            if (member?.organization_id) orgId = member.organization_id;
            if (member?.clinic_id) clinicId = member.clinic_id;
          }
        }

        const resolvedUser: User = {
          id: authUser.id,
          name:
            profile?.full_name ||
            authUser.user_metadata?.full_name ||
            mirror?.name ||
            authUser.email?.split('@')[0] ||
            'مستخدم',
          email: profile?.email || authUser.email || mirror?.email || '',
          role: mappedRole,
          organizationId: orgId,
          clinicId,
        };

        put('user', authUser.id, resolvedUser);
        return resolvedUser;
      }
    } catch {
      // Continue to cookie check
    }
  }

  // 2. Check session cookie (for quick role preview & demo workspace)
  try {
    const jar = await cookies();
    const token = jar.get('clinicbook-session')?.value;
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
  } catch {
    // Outside request context
    return null;
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
  try {
    (await cookies()).set('clinicbook-session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true',
      path: '/',
      maxAge: 86400,
    });
  } catch {
    // Outside request context
  }
  return token;
}

export async function deleteSession() {
  try {
    const jar = await cookies();
    const token = jar.get('clinicbook-session')?.value;
    if (token)
      db.prepare('DELETE FROM sessions WHERE token=?').run(
        createHash('sha256').update(token).digest('hex'),
      );
    jar.delete('clinicbook-session');
  } catch {
    // Outside request context
  }

  if (!demoEnabled() && isSupabaseConfigured()) {
    try {
      const { createSupabaseServer } = await import('../supabase/server');
      const client = await createSupabaseServer();
      await client.auth.signOut();
    } catch {
      // Ignored if not signed in to Supabase
    }
  }
}

/** Determine post-login redirect based on user role & state. */
export function redirectForUser(user: User): string {
  if (user.role === 'patient') return '/my-appointments';
  if (user.role === 'clinic_owner' && !user.organizationId) return '/register-clinic?onboarding=1';
  if (user.role === 'super_admin') return '/admin';
  return '/workspace/dashboard';
}
