import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const cronAdmin = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ fn: string; args: unknown }>,
  tables: [] as string[],
  inserts: [] as Array<{ table: string; payload: unknown }>,
  upcoming: [] as Array<{ id: string; start_at: string }>,
  expiredCount: 0 as number | null,
  counts: {
    expiredCount: 0,
    noShowCount: 0,
    reminderCount: 0,
    subscriptionExpiredCount: 0,
    archivedCount: 0,
  },
  rpcError: null as { message: string } | null,
  upcomingError: null as { message: string } | null,
  pending: false,
  signal: null as AbortSignal | null,
}));

vi.mock('../../src/lib/supabase/admin', () => {
  const createBuilder = (table: string) => {
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: vi.fn(() => builder),
      in: vi.fn(() => builder),
      gt: vi.fn(() => builder),
      lte: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      insert: vi.fn((payload: unknown) => {
        cronAdmin.inserts.push({ table, payload });
        return Promise.resolve({ data: null, error: null });
      }),
      then: (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
        Promise.resolve({
          data: cronAdmin.upcomingError ? null : cronAdmin.upcoming,
          error: cronAdmin.upcomingError,
        }).then(resolve),
    });
    return builder;
  };

  return {
    createSupabaseAdmin: vi.fn(() => ({
      from: vi.fn((table: string) => {
        cronAdmin.tables.push(table);
        return createBuilder(table);
      }),
      rpc: vi.fn((fn: string, args?: unknown) => {
        cronAdmin.rpcCalls.push({ fn, args });
        const result = cronAdmin.pending
          ? new Promise<never>(() => {})
          : Promise.resolve({
              data: fn === 'run_retention_jobs' ? cronAdmin.counts : cronAdmin.expiredCount,
              error: cronAdmin.rpcError,
            });
        return {
          abortSignal(signal: AbortSignal) {
            cronAdmin.signal = signal;
            return this;
          },
          then: result.then.bind(result),
        };
      }),
    })),
  };
});

import { POST, GET } from '../../src/app/api/cron/retention/route';

const savedEnv = { ...process.env };

function cronRequest(method: 'GET' | 'POST', secret?: string): Request {
  return new Request('http://localhost:3000/api/cron/retention', {
    method,
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

function resetAdminState() {
  cronAdmin.rpcCalls.length = 0;
  cronAdmin.tables.length = 0;
  cronAdmin.inserts.length = 0;
  cronAdmin.upcoming = [];
  cronAdmin.expiredCount = 0;
  cronAdmin.counts = {
    expiredCount: 0,
    noShowCount: 0,
    reminderCount: 0,
    subscriptionExpiredCount: 0,
    archivedCount: 0,
  };
  cronAdmin.rpcError = null;
  cronAdmin.upcomingError = null;
  cronAdmin.pending = false;
  cronAdmin.signal = null;
}

describe('Integration: Retention Cron Endpoint (/api/cron/retention)', () => {
  beforeEach(() => {
    process.env = { ...savedEnv };
    process.env.CLINICBOOK_MODE = 'demo';
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
    delete process.env.CRON_SECRET;
    resetAdminState();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...savedEnv };
  });

  it('fails closed with 500 CRON_NOT_CONFIGURED when CRON_SECRET is missing, even in development', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    delete process.env.CRON_SECRET;

    // The retired built-in fallback must no longer authenticate anything.
    const res = await POST(cronRequest('POST', 'clinicbook-internal-cron-secret'));

    expect(res.status).toBe(500);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({
      success: false,
      code: 'CRON_NOT_CONFIGURED',
    });
    expect(cronAdmin.rpcCalls).toHaveLength(0);
  });

  it('rejects unauthorized requests with 401 without invoking the expiry RPC', async () => {
    const validSecret = randomUUID();
    process.env.CRON_SECRET = validSecret;

    const res = await POST(cronRequest('POST', 'wrong-secret'));

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      success: false,
      code: 'UNAUTHORIZED',
    });
    expect(cronAdmin.rpcCalls).toHaveLength(0);
  });

  it('authorizes GET requests with the valid secret and returns a retention summary', async () => {
    const validSecret = randomUUID();
    process.env.CRON_SECRET = validSecret;

    const res = await GET(cronRequest('GET', validSecret));

    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      success: boolean;
      data: {
        checkedCount: number;
        upcomingCount: number;
      };
    };
    expect(json.success).toBe(true);
    expect(typeof json.data.checkedCount).toBe('number');
    expect(typeof json.data.upcomingCount).toBe('number');
    expect(Object.values(json.data).every((count) => Number.isSafeInteger(count))).toBe(true);
    expect(JSON.stringify(json)).not.toMatch(/patientName|phone|doctorName|appointmentId/);
  });

  it('runs operational jobs once and returns only committed counts without patient PHI', async () => {
    const validSecret = randomUUID();
    process.env.CRON_SECRET = validSecret;
    process.env.CLINICBOOK_MODE = 'production';
    cronAdmin.expiredCount = 4;
    cronAdmin.counts = {
      expiredCount: 4,
      noShowCount: 1,
      reminderCount: 2,
      subscriptionExpiredCount: 3,
      archivedCount: 1,
    };
    cronAdmin.upcoming = [
      { id: 'appointment-1', start_at: new Date(Date.now() + 3600000).toISOString() },
      { id: 'appointment-2', start_at: new Date(Date.now() + 7200000).toISOString() },
    ];

    const res = await POST(cronRequest('POST', validSecret));

    expect(res.status).toBe(200);
    expect(cronAdmin.rpcCalls).toEqual([{ fn: 'run_retention_jobs', args: undefined }]);

    const json = (await res.json()) as { success: boolean; data: Record<string, unknown> };
    expect(json.success).toBe(true);
    expect(json.data).toEqual(cronAdmin.counts);

    const serialized = JSON.stringify(json);
    expect(serialized).not.toMatch(/patientName|patient_name|phone/i);
    expect(cronAdmin.inserts).toHaveLength(0);
    expect(cronAdmin.tables).toHaveLength(0);
  });

  it('stays idempotent across repeated invocations without duplicate writes', async () => {
    const validSecret = randomUUID();
    process.env.CRON_SECRET = validSecret;
    process.env.CLINICBOOK_MODE = 'production';
    cronAdmin.expiredCount = 1;
    cronAdmin.counts.expiredCount = 1;
    cronAdmin.upcoming = [
      { id: 'appointment-retry', start_at: new Date(Date.now() + 3600000).toISOString() },
    ];

    const first = await POST(cronRequest('POST', validSecret));
    cronAdmin.counts = {
      expiredCount: 0,
      noShowCount: 0,
      reminderCount: 0,
      subscriptionExpiredCount: 0,
      archivedCount: 0,
    };
    const second = await GET(cronRequest('GET', validSecret));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const firstJson = (await first.json()) as { data: Record<string, unknown> };
    const secondJson = (await second.json()) as { data: Record<string, unknown> };
    expect(firstJson.data.expiredCount).toBe(1);
    expect(secondJson.data).toEqual({
      expiredCount: 0,
      noShowCount: 0,
      reminderCount: 0,
      subscriptionExpiredCount: 0,
      archivedCount: 0,
    });

    // One expiry pass per invocation; retries must not multiply side effects.
    expect(cronAdmin.rpcCalls.filter((call) => call.fn === 'run_retention_jobs')).toHaveLength(2);
    expect(cronAdmin.inserts).toHaveLength(0);
    expect(cronAdmin.tables).toHaveLength(0);
  });

  it('aborts a stalled operational RPC and never hangs the scheduler indefinitely', async () => {
    process.env.CRON_SECRET = randomUUID();
    process.env.CLINICBOOK_MODE = 'production';
    cronAdmin.pending = true;
    vi.useFakeTimers();
    let response: Response | undefined;
    const pending = POST(cronRequest('POST', process.env.CRON_SECRET)).then((value) => {
      response = value;
      return value;
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(response).toBeDefined();
    expect((await pending).status).toBe(500);
    expect(cronAdmin.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not reflect extra database payload fields into the public cron response', async () => {
    process.env.CRON_SECRET = randomUUID();
    process.env.CLINICBOOK_MODE = 'production';
    Object.assign(cronAdmin.counts, { patientName: 'private patient', phone: 'private phone' });
    const response = await POST(cronRequest('POST', process.env.CRON_SECRET));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body.data).sort()).toEqual([
      'archivedCount',
      'expiredCount',
      'noShowCount',
      'reminderCount',
      'subscriptionExpiredCount',
    ]);
    expect(JSON.stringify(body)).not.toMatch(/private patient|private phone/);
  });

  it('fails closed when the operational RPC reports a missing migration', async () => {
    process.env.CRON_SECRET = randomUUID();
    process.env.CLINICBOOK_MODE = 'production';
    cronAdmin.rpcError = { message: 'private connection details' };
    const response = await POST(cronRequest('POST', process.env.CRON_SECRET));
    expect(response.status).toBe(500);
    const raw = await response.text();
    expect(JSON.parse(raw).code).toBe('INTERNAL_ERROR');
    expect(raw).not.toContain('private connection details');
  });
});
