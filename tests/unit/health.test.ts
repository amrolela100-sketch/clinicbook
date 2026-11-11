import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock, rpcResponseMock, abortSignalMock, createSupabaseAdminMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  rpcResponseMock: vi.fn(),
  abortSignalMock: vi.fn(),
  createSupabaseAdminMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdmin: createSupabaseAdminMock,
}));

import { GET as healthGet } from '@/app/api/health/route';

function productionMode() {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('CLINICBOOK_MODE', 'production');
  vi.stubEnv('FORCE_SUPABASE', undefined);
}

async function expectHealthResponse(response: Response, database: boolean) {
  expect(response.status).toBe(database ? 200 : 503);
  expect(response.headers.get('Cache-Control')).toBe('no-store, max-age=0');
  expect(response.headers.get('content-type')).toContain('application/json');
  const body = await response.json();
  expect(body).toEqual({
    status: database ? 'ok' : 'degraded',
    service: 'clinicbook-saas',
    timestamp: expect.any(String),
    checks: { database },
  });
  expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  return body;
}

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('CLINICBOOK_MODE', 'demo');
    vi.stubEnv('FORCE_SUPABASE', undefined);
    rpcMock.mockReset();
    rpcResponseMock.mockReset();
    abortSignalMock.mockReset();
    createSupabaseAdminMock.mockReset();
    createSupabaseAdminMock.mockReturnValue({ rpc: rpcMock });
    rpcMock.mockImplementation(() => {
      const response = Promise.resolve(rpcResponseMock());
      return {
        abortSignal(signal: AbortSignal) {
          abortSignalMock(signal);
          return this;
        },
        then: response.then.bind(response),
      };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('reports healthy in demo mode without querying Supabase', async () => {
    vi.stubEnv('CLINICBOOK_MODE', 'demo');

    const res = await healthGet();

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store, max-age=0');
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'ok',
      service: 'clinicbook-saas',
      checks: { database: true },
    });
    expect(typeof body.timestamp).toBe('string');
    expect(createSupabaseAdminMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('reports healthy when the healthcheck RPC succeeds', async () => {
    productionMode();
    rpcResponseMock.mockResolvedValue({
      data: { ok: true, schema: '20261111000012' },
      error: null,
    });

    const res = await healthGet();

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store, max-age=0');
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.checks).toEqual({ database: true });
    expect(rpcMock).toHaveBeenCalledWith('healthcheck');
  });

  it('reports degraded when the healthcheck RPC reports the wrong migration', async () => {
    productionMode();
    rpcResponseMock.mockResolvedValue({
      data: { ok: true, schema: '20261111000008' },
      error: null,
    });

    const res = await healthGet();

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      status: 'degraded',
      checks: { database: false },
    });
  });

  it('reports degraded when the healthcheck migration is not installed', async () => {
    productionMode();
    rpcResponseMock.mockResolvedValue({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find public.healthcheck in the schema cache: secret-dsn',
        details: '20261111000012 is not deployed',
      },
    });

    await expectHealthResponse(await healthGet(), false);
  });

  it('reports degraded when the healthcheck RPC returns an error', async () => {
    productionMode();
    rpcResponseMock.mockResolvedValue({
      data: null,
      error: { message: 'connection refused: secret-dsn' },
    });

    const res = await healthGet();

    expect(res.status).toBe(503);
    const raw = await res.text();
    expect(JSON.parse(raw)).toMatchObject({
      status: 'degraded',
      checks: { database: false },
    });
    expect(raw).not.toContain('secret-dsn');
  });

  it.each([
    ['null data', { data: null, error: null }],
    ['missing ok flag', { data: { schema: '20261111000012' }, error: null }],
    ['non-boolean ok flag', { data: { ok: 'true' }, error: null }],
    ['non-object payload', { data: 'ok', error: null }],
  ])('reports degraded for an invalid healthcheck payload (%s)', async (_label, response) => {
    productionMode();
    rpcResponseMock.mockResolvedValue(response);

    const res = await healthGet();

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'degraded', checks: { database: false } });
  });

  it('aborts the database request and reports degraded within two seconds', async () => {
    productionMode();
    vi.useFakeTimers();
    let transportActive = true;
    let transportSignal: AbortSignal | undefined;
    rpcResponseMock.mockReturnValue(
      new Promise<never>((_, reject) => {
        abortSignalMock.mockImplementation((signal: AbortSignal) => {
          transportSignal = signal;
          signal.addEventListener(
            'abort',
            () => {
              transportActive = false;
              reject(new DOMException('aborted secret-dsn', 'AbortError'));
            },
            { once: true },
          );
        });
      }),
    );

    let settled = false;
    const pending = healthGet().then((response) => {
      settled = true;
      return response;
    });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(settled).toBe(false);
    expect(transportActive).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    const res = await pending;

    expect(transportActive).toBe(false);
    expect(transportSignal?.aborted).toBe(true);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'degraded', checks: { database: false } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns a degraded JSON response when production mode is missing instead of throwing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CLINICBOOK_MODE', undefined);
    vi.stubEnv('FORCE_SUPABASE', undefined);

    const res = await healthGet();

    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'degraded',
      service: 'clinicbook-saas',
      checks: { database: false },
    });
  });

  it('returns a degraded JSON response when the admin client cannot be created', async () => {
    productionMode();
    createSupabaseAdminMock.mockImplementation(() => {
      throw new Error('Supabase admin is not configured: secret-key');
    });

    const res = await healthGet();

    expect(res.status).toBe(503);
    const raw = await res.text();
    expect(JSON.parse(raw)).toMatchObject({
      status: 'degraded',
      checks: { database: false },
    });
    expect(raw).not.toContain('secret-key');
  });

  it('never exposes mode, AI configuration, schema details, or latency', async () => {
    vi.stubEnv('CLINICBOOK_MODE', 'demo');

    const body = await (await healthGet()).json();
    const raw = JSON.stringify(body);

    expect(Object.keys(body).sort()).toEqual(['checks', 'service', 'status', 'timestamp']);
    expect(Object.keys(body.checks)).toEqual(['database']);
    expect(raw).not.toContain('mode');
    expect(raw).not.toContain('aiAssistantMode');
    expect(raw).not.toContain('schema');
    expect(raw).not.toContain('latency');
    expect(raw).not.toContain('databaseConfigured');
  });
});
