import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@/lib/types';

const realtime = vi.hoisted(() => {
  const handlers: Array<{
    channelEvent: string;
    config: { event: string; table: string; filter: string };
    callback: () => void;
  }> = [];
  const channel = {
    on: vi.fn(
      (
        channelEvent: string,
        config: { event: string; table: string; filter: string },
        callback: () => void,
      ) => {
        handlers.push({ channelEvent, config, callback });
        return channel;
      },
    ),
    subscribe: vi.fn((callback: (status: string) => void) => {
      realtime.subscriptionCallback = callback;
      return channel;
    }),
  };
  return {
    handlers,
    channel,
    subscriptionCallback: undefined as ((status: string) => void) | undefined,
    sessionUserId: 'patient-live',
    token: 'synthetic-access-token',
    getSession: vi.fn(),
    setAuth: vi.fn(),
    removeChannel: vi.fn(),
    createChannel: vi.fn(() => channel),
  };
});

vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowser: () => ({
    auth: { getSession: realtime.getSession },
    realtime: { setAuth: realtime.setAuth },
    channel: realtime.createChannel,
    removeChannel: realtime.removeChannel,
  }),
}));

import { startAppDataRevalidation } from '@/lib/app-data-revalidation';

describe('App-data revalidation interface', () => {
  const windowListeners = new Map<string, () => void>();
  const documentListeners = new Map<string, () => void>();
  let visibilityState: DocumentVisibilityState;

  beforeEach(() => {
    vi.useFakeTimers();
    visibilityState = 'visible';
    windowListeners.clear();
    documentListeners.clear();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'synthetic-anon-key');
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        addEventListener: vi.fn((name: string, listener: () => void) =>
          windowListeners.set(name, listener),
        ),
        removeEventListener: vi.fn((name: string) => windowListeners.delete(name)),
      },
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        get visibilityState() {
          return visibilityState;
        },
        addEventListener: vi.fn((name: string, listener: () => void) =>
          documentListeners.set(name, listener),
        ),
        removeEventListener: vi.fn((name: string) => documentListeners.delete(name)),
      },
    });
    realtime.handlers.length = 0;
    realtime.subscriptionCallback = undefined;
    realtime.getSession.mockReset().mockResolvedValue({
      data: {
        session: { user: { id: realtime.sessionUserId }, access_token: realtime.token },
      },
    });
    realtime.setAuth.mockReset().mockResolvedValue(undefined);
    realtime.removeChannel.mockReset().mockResolvedValue(undefined);
    realtime.createChannel.mockClear();
    realtime.channel.on.mockClear();
    realtime.channel.subscribe.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'document');
  });

  it('coalesces visible focus events and stops all reconciliation after cleanup', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const cleanup = startAppDataRevalidation(null, refresh);

    windowListeners.get('focus')?.();
    windowListeners.get('focus')?.();
    await vi.advanceTimersByTimeAsync(249);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    visibilityState = 'hidden';
    documentListeners.get('visibilitychange')?.();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    visibilityState = 'visible';
    documentListeners.get('visibilitychange')?.();
    await vi.advanceTimersByTimeAsync(250);
    expect(refresh).toHaveBeenCalledTimes(2);

    cleanup();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(windowListeners.has('focus')).toBe(false);
  });

  it('subscribes a matching patient to scoped insert/update events and removes the channel', async () => {
    const user = {
      id: realtime.sessionUserId,
      role: 'patient',
      name: 'Patient',
      email: 'patient@example.test',
    } satisfies User;
    const refresh = vi.fn().mockResolvedValue(undefined);
    const cleanup = startAppDataRevalidation(user, refresh);
    await vi.dynamicImportSettled();

    expect(realtime.setAuth).toHaveBeenCalledWith(realtime.token);
    expect(realtime.createChannel).toHaveBeenCalledTimes(1);
    expect(realtime.handlers).toHaveLength(6);
    expect(realtime.handlers.every(({ channelEvent }) => channelEvent === 'postgres_changes')).toBe(
      true,
    );
    expect(
      realtime.handlers.map(({ config }) => ({ table: config.table, filter: config.filter })),
    ).toEqual(
      expect.arrayContaining([
        { table: 'notifications', filter: `user_id=eq.${user.id}` },
        { table: 'appointments', filter: `patient_id=eq.${user.id}` },
        { table: 'medical_records', filter: `patient_id=eq.${user.id}` },
      ]),
    );
    expect(new Set(realtime.handlers.map(({ config }) => config.event))).toEqual(
      new Set(['INSERT', 'UPDATE']),
    );

    realtime.subscriptionCallback?.('SUBSCRIBED');
    realtime.handlers[0].callback();
    await vi.advanceTimersByTimeAsync(250);
    expect(refresh).toHaveBeenCalledTimes(1);

    cleanup();
    expect(realtime.removeChannel).toHaveBeenCalledWith(realtime.channel);
  });

  it.each([
    ['doctor', undefined, `doctor_id=eq.doctor-live`, 'doctor_id=eq.doctor-live'],
    ['receptionist', 'clinic-live', 'clinic_id=eq.clinic-live', null],
    ['clinic_owner', undefined, 'organization_id=eq.org-live', null],
    ['super_admin', undefined, null, null],
  ] as const)(
    'builds only authorized realtime scopes for %s',
    async (role, clinicId, appointmentFilter, recordFilter) => {
      const id = `${role}-live`;
      realtime.sessionUserId = id;
      realtime.getSession.mockResolvedValue({
        data: { session: { user: { id }, access_token: realtime.token } },
      });
      const user = {
        id,
        role,
        name: role,
        email: `${role}@example.test`,
        organizationId: role === 'clinic_owner' ? 'org-live' : undefined,
        clinicId,
      } satisfies User;

      const cleanup = startAppDataRevalidation(user, vi.fn().mockResolvedValue(undefined));
      await vi.dynamicImportSettled();
      const filters = realtime.handlers.map(({ config }) => config.filter);
      expect(filters).toContain(`user_id=eq.${id}`);
      if (appointmentFilter) expect(filters).toContain(appointmentFilter);
      else
        expect(
          filters.some((value) => /^(doctor|patient|clinic|organization)_id=eq\./.test(value)),
        ).toBe(false);
      if (recordFilter) expect(filters).toContain(recordFilter);
      cleanup();
    },
  );

  it('does not subscribe when browser auth belongs to another identity or config is absent', async () => {
    realtime.getSession.mockResolvedValue({
      data: { session: { user: { id: 'different-user' }, access_token: realtime.token } },
    });
    const user = {
      id: 'expected-user',
      role: 'patient',
      name: 'Expected',
      email: 'expected@example.test',
    } satisfies User;
    const firstCleanup = startAppDataRevalidation(user, vi.fn().mockResolvedValue(undefined));
    await vi.dynamicImportSettled();
    expect(realtime.createChannel).not.toHaveBeenCalled();
    firstCleanup();

    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    realtime.getSession.mockClear();
    const secondCleanup = startAppDataRevalidation(user, vi.fn().mockResolvedValue(undefined));
    await vi.dynamicImportSettled();
    expect(realtime.getSession).not.toHaveBeenCalled();
    secondCleanup();
  });
});
