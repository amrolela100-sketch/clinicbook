import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const adapters = vi.hoisted(() => ({
  createClient: vi.fn(),
  createBrowserClient: vi.fn(),
  createServerClient: vi.fn(),
  cookieGetAll: vi.fn(),
  cookieSet: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient: adapters.createClient }));
vi.mock('@supabase/ssr', () => ({
  createBrowserClient: adapters.createBrowserClient,
  createServerClient: adapters.createServerClient,
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: adapters.cookieGetAll, set: adapters.cookieSet }),
}));

import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseBrowser } from '@/lib/supabase/browser';
import { createSupabaseServer } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';

describe('Supabase adapter configuration', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.test');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'synthetic-anon');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service');
    adapters.createClient.mockReset().mockReturnValue({ kind: 'admin' });
    adapters.createBrowserClient.mockReset().mockReturnValue({ kind: 'browser' });
    adapters.createServerClient.mockReset().mockReturnValue({ kind: 'server' });
    adapters.cookieGetAll.mockReset().mockReturnValue([{ name: 'session', value: 'value' }]);
    adapters.cookieSet.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('reports only complete public configuration', () => {
    expect(isSupabaseConfigured()).toBe(true);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    expect(isSupabaseConfigured()).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'synthetic-anon');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect(isSupabaseConfigured()).toBe(false);
  });

  it('constructs admin and browser clients with their intended credentials', () => {
    expect(createSupabaseAdmin()).toEqual({ kind: 'admin' });
    expect(adapters.createClient).toHaveBeenCalledWith(
      'https://example.supabase.test',
      'synthetic-service',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    expect(createSupabaseBrowser()).toEqual({ kind: 'browser' });
    expect(adapters.createBrowserClient).toHaveBeenCalledWith(
      'https://example.supabase.test',
      'synthetic-anon',
    );
  });

  it.each([
    ['admin', 'SUPABASE_SERVICE_ROLE_KEY', createSupabaseAdmin],
    ['browser', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', createSupabaseBrowser],
  ] as const)('fails closed when the %s credential is missing', (_name, key, create) => {
    vi.stubEnv(key, '');
    expect(() => create()).toThrow(/not configured|configuration is missing/);
  });

  it('adapts server cookies in writable and read-only rendering contexts', async () => {
    expect(await createSupabaseServer()).toEqual({ kind: 'server' });
    const options = adapters.createServerClient.mock.calls[0][2] as {
      cookies: {
        getAll: () => unknown[];
        setAll: (values: Array<{ name: string; value: string; options?: unknown }>) => void;
      };
    };
    expect(options.cookies.getAll()).toEqual([{ name: 'session', value: 'value' }]);
    options.cookies.setAll([{ name: 'next', value: 'cookie', options: { secure: true } }]);
    expect(adapters.cookieSet).toHaveBeenCalledWith('next', 'cookie', { secure: true });

    adapters.cookieSet.mockImplementation(() => {
      throw new Error('read-only');
    });
    expect(() => options.cookies.setAll([{ name: 'ignored', value: 'value' }])).not.toThrow();
  });

  it('fails closed before creating a server client when public config is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    await expect(createSupabaseServer()).rejects.toThrow('Supabase is not configured');
    expect(adapters.createServerClient).not.toHaveBeenCalled();
  });
});
