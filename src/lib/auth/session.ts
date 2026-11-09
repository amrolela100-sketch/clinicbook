import { cookies } from 'next/headers';
import { randomBytes, createHash } from 'node:crypto';
import type { User, Role } from '../types';

export { isSupabaseConfigured } from '../supabase/config';
import { isSupabaseConfigured } from '../supabase/config';

/**
 * Returns true strictly when CLINICBOOK_MODE is explicitly set to 'demo'
 * and Supabase is not forced.
 * Refuses startup if running in production without explicit configuration.
 */
export const demoEnabled = (): boolean => {
  if (process.env.FORCE_SUPABASE === 'true' || process.env.CLINICBOOK_MODE === 'production') {
    return false;
  }
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.CLINICBOOK_MODE !== 'production' &&
    process.env.CLINICBOOK_MODE !== 'demo'
  ) {
    throw new Error(
      'FATAL: CLINICBOOK_MODE must be set to "production" in production environments. Refusing to boot with unconfigured mode.',
    );
  }
  return process.env.CLINICBOOK_MODE === 'demo';
};

/** Get the secure cookie name based on environment (__Host- prefix in production) */
export function getSessionCookieName(): string {
  const isProd = process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false';
  return isProd ? '__Host-clinicbook-session' : 'clinicbook-session';
}

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

        const mappedRole: Role =
          profile?.role === 'admin'
            ? 'super_admin'
            : (profile?.role as Role) ||
              ((authUser.user_metadata?.intent_role === 'clinic_owner'
                ? 'clinic_owner'
                : 'patient') as Role);

        let orgId: string | undefined;
        let clinicId: string | undefined;

        if (mappedRole === 'clinic_owner') {
          const { data: org } = await client
            .from('organizations')
            .select('id')
            .eq('owner_id', authUser.id)
            .limit(1)
            .maybeSingle();
          if (org?.id) orgId = org.id;

          if (orgId) {
            const { data: cl } = await client
              .from('clinics')
              .select('id')
              .eq('organization_id', orgId)
              .limit(1)
              .maybeSingle();
            if (cl?.id) clinicId = cl.id;
          }
        } else if (mappedRole === 'doctor') {
          const { data: doc } = await client
            .from('doctors')
            .select('organization_id')
            .eq('id', authUser.id)
            .limit(1)
            .maybeSingle();
          if (doc?.organization_id) orgId = doc.organization_id;

          const { data: member } = await client
            .from('organization_members')
            .select('clinic_id')
            .eq('user_id', authUser.id)
            .limit(1)
            .maybeSingle();
          if (member?.clinic_id) clinicId = member.clinic_id;
        } else if (mappedRole === 'receptionist') {
          const { data: member } = await client
            .from('organization_members')
            .select('organization_id, clinic_id')
            .eq('user_id', authUser.id)
            .limit(1)
            .maybeSingle();
          if (member?.organization_id) orgId = member.organization_id;
          if (member?.clinic_id) clinicId = member.clinic_id;
        }

        const resolvedUser: User = {
          id: authUser.id,
          name:
            profile?.full_name ||
            authUser.user_metadata?.full_name ||
            authUser.email?.split('@')[0] ||
            'مستخدم',
          email: profile?.email || authUser.email || '',
          role: mappedRole,
          organizationId: orgId,
          clinicId,
        };

        return resolvedUser;
      }
    } catch (err) {
      console.error('Supabase session lookup error:', err);
    }
  }

  // 2. Check session cookie (for quick role preview & demo workspace)
  // Strictly disabled outside explicit demo mode: production never imports or touches SQLite
  if (process.env.CLINICBOOK_MODE === 'demo') {
    try {
      const jar = await cookies();
      const cookieName = getSessionCookieName();
      const token = jar.get(cookieName)?.value;
      if (!token) return null;

      const { db, get } = await import('../demo-db');
      const hash = createHash('sha256').update(token).digest('hex');
      const nowIso = new Date().toISOString();
      const maxAllowedIso = new Date(Date.now() + 86400000 + 5000).toISOString();
      const row = db
        .prepare('SELECT user_id FROM sessions WHERE token=? AND expires_at>? AND expires_at<=?')
        .get(hash, nowIso, maxAllowedIso) as { user_id: string } | undefined;

      if (!row) return null;

      // Crucial security fix: Always read role strictly from stored user record, NEVER from row.role
      const u = get<User>('user', row.user_id);
      return u ?? null;
    } catch {
      // Outside request context
      return null;
    }
  }

  return null;
}

/**
 * Creates a new session for a user.
 * Role parameter is removed — role is strictly read from user record in database.
 * Deletes prior sessions for this user to prevent session fixation.
 */
export async function createSession(userId: string): Promise<string> {
  if (process.env.CLINICBOOK_MODE !== 'demo') {
    throw new Error('FORBIDDEN: SQLite sessions are only available when CLINICBOOK_MODE=demo.');
  }

  const { db, get } = await import('../demo-db');
  const user = get<User>('user', userId);
  if (!user) {
    throw new Error('Cannot create session for non-existent user');
  }

  // 1. Session fixation defense: delete existing sessions for this user
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);

  // 2. Clean up expired sessions
  db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(new Date().toISOString());

  // 3. Create fresh secure session token
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 86400000).toISOString(); // 24h absolute lifetime

  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(tokenHash, userId, expiresAt, user.role);

  const cookieName = getSessionCookieName();
  const isSecure = process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false';

  try {
    (await cookies()).set(cookieName, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecure,
      path: '/',
      maxAge: 86400,
    });
  } catch {
    // Outside request context
  }
  return token;
}

export async function deleteSession(): Promise<void> {
  try {
    const jar = await cookies();
    const cookieName = getSessionCookieName();
    const token = jar.get(cookieName)?.value ?? jar.get('clinicbook-session')?.value;
    if (token && process.env.CLINICBOOK_MODE === 'demo') {
      const { db } = await import('../demo-db');
      db.prepare('DELETE FROM sessions WHERE token=?').run(
        createHash('sha256').update(token).digest('hex'),
      );
    }
    jar.delete(cookieName);
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
