'use client';

import type { User } from './types';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

/** Event-driven invalidation, with conservative visible-tab reconciliation. */
export function startAppDataRevalidation(user: User | null, refresh: () => Promise<void>) {
  let disposed = false;
  let queued = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let client: SupabaseClient | undefined;
  let channel: RealtimeChannel | undefined;

  function invalidate() {
    if (disposed || document.visibilityState !== 'visible') return;
    queued = true;
    if (timer !== undefined || running) return;
    timer = setTimeout(async () => {
      timer = undefined;
      if (disposed || document.visibilityState !== 'visible') {
        queued = false;
        return;
      }
      queued = false;
      running = true;
      try {
        await refresh();
      } catch {
        /* The refresh owner displays connection failures. */
      } finally {
        running = false;
        if (queued && !disposed) invalidate();
      }
    }, 250);
  }

  window.addEventListener('focus', invalidate);
  document.addEventListener('visibilitychange', invalidate);
  // Also reconcile missing DELETE/revocation events, even on a healthy channel.
  const fallback = setInterval(invalidate, 5 * 60_000);

  // Never subscribe anonymous visitors or platform administrators to clinical
  // tables. Realtime RLS remains authoritative even if a client changes filters.
  if (user && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    void import('./supabase/browser')
      .then(async ({ createSupabaseBrowser }) => {
        if (disposed) return;
        client = createSupabaseBrowser();
        const { data } = await client.auth.getSession();
        if (disposed || data.session?.user.id !== user.id || !data.session?.access_token) return;
        await client.realtime.setAuth(data.session.access_token);
        if (disposed) return;

        channel = client.channel(
          `clinicbook-data-${user.id}-${Math.random().toString(36).slice(2)}`,
        );
        const scopes: Array<{ table: string; filter: string }> = [
          { table: 'notifications', filter: `user_id=eq.${user.id}` },
        ];
        const appointmentFilter =
          user.role === 'patient'
            ? `patient_id=eq.${user.id}`
            : user.role === 'doctor'
              ? `doctor_id=eq.${user.id}`
              : user.role === 'receptionist' && user.clinicId
                ? `clinic_id=eq.${user.clinicId}`
                : user.role === 'clinic_owner' && user.organizationId
                  ? `organization_id=eq.${user.organizationId}`
                  : null;
        if (appointmentFilter) scopes.push({ table: 'appointments', filter: appointmentFilter });
        if (user.role === 'doctor' || user.role === 'patient') {
          scopes.push({
            table: 'medical_records',
            filter: `${user.role === 'doctor' ? 'doctor_id' : 'patient_id'}=eq.${user.id}`,
          });
        }

        for (const scope of scopes) {
          // DELETE changes have different Realtime/RLS semantics. Cancellation and
          // completion are UPDATE events; hard-deletion reconciliation uses a full
          // authorized refresh on focus or the conservative fallback instead.
          for (const event of ['INSERT', 'UPDATE'] as const) {
            channel.on('postgres_changes', { event, schema: 'public', ...scope }, invalidate);
          }
        }
        channel.subscribe((status) => {
          if (disposed) return;
          if (status === 'SUBSCRIBED') invalidate();
        });
      })
      .catch(() => {
        /* Focus and periodic reconciliation remain available. */
      });
  }

  return () => {
    disposed = true;
    clearInterval(fallback);
    if (timer !== undefined) clearTimeout(timer);
    window.removeEventListener('focus', invalidate);
    document.removeEventListener('visibilitychange', invalidate);
    if (channel && client) void client.removeChannel(channel).catch(() => {});
  };
}
