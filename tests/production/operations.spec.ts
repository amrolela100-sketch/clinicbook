import { expect, test } from '@playwright/test';

const fixture = 'http://127.0.0.1:4191';

test.beforeEach(async ({ request }) => {
  await request.post(`${fixture}/test-control`, { data: { databaseMode: 'healthy' } });
});

test.afterEach(async ({ request }) => {
  await request.post(`${fixture}/test-control`, { data: { databaseMode: 'healthy' } });
});

test('production readiness verifies the database without revealing deployment details', async ({
  request,
}) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store, max-age=0');
  expect(await response.json()).toEqual({
    status: 'ok',
    service: 'clinicbook-saas',
    timestamp: expect.any(String),
    checks: { database: true },
  });
});

for (const mode of ['fail', 'missing', 'malformed']) {
  test(`production readiness returns 503 when the database is ${mode}`, async ({ request }) => {
    await request.post(`${fixture}/test-control`, { data: { databaseMode: mode } });
    const response = await request.get('/api/health');
    expect(response.status()).toBe(503);
    const body = await response.json();
    expect(body).toEqual({
      status: 'degraded',
      service: 'clinicbook-saas',
      timestamp: expect.any(String),
      checks: { database: false },
    });
    expect(JSON.stringify(body)).not.toMatch(/private-dsn|schema|aiAssistantMode|service-key/);
  });
}

test('production readiness aborts a stalled database transport within two seconds', async ({
  request,
}) => {
  await request.post(`${fixture}/test-control`, { data: { databaseMode: 'timeout' } });
  const startedAt = Date.now();
  const response = await request.get('/api/health');
  expect(response.status()).toBe(503);
  expect((await response.json()).checks.database).toBe(false);
  expect(Date.now() - startedAt).toBeLessThan(3_400);
});
