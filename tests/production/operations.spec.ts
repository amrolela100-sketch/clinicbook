import { expect, test } from '@playwright/test';

const fixture = 'http://127.0.0.1:4191';

test.beforeEach(async ({ request }) => {
  await request.post(`${fixture}/test-control`, {
    data: { databaseMode: 'healthy', resetJobs: true },
  });
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

const cronHeaders = {
  authorization: 'Bearer local-production-test-cron-secret-not-for-deployment',
};

test('production scheduler rejects unknown secrets and returns only committed job counts', async ({
  request,
}) => {
  const denied = await request.get('/api/cron/retention', {
    headers: { authorization: 'Bearer clinicbook-internal-cron-secret' },
  });
  expect(denied.status()).toBe(401);
  const first = await request.get('/api/cron/retention', { headers: cronHeaders });
  expect(first.status()).toBe(200);
  expect(first.headers()['cache-control']).toBe('no-store');
  const result = await first.json();
  expect(result.data).toEqual({
    expiredCount: 1,
    noShowCount: 1,
    reminderCount: 1,
    subscriptionExpiredCount: 1,
    archivedCount: 1,
  });
  expect(JSON.stringify(result)).not.toMatch(/patientName|phone|private-dsn/);
  const retry = await request.get('/api/cron/retention', { headers: cronHeaders });
  expect(retry.status()).toBe(200);
  expect((await retry.json()).data).toEqual({
    expiredCount: 0,
    noShowCount: 0,
    reminderCount: 0,
    subscriptionExpiredCount: 0,
    archivedCount: 0,
  });
});

test('production scheduler fails closed on database and invalid-payload errors', async ({
  request,
}) => {
  for (const databaseMode of ['fail', 'malformed']) {
    await request.post(`${fixture}/test-control`, { data: { databaseMode } });
    const response = await request.get('/api/cron/retention', { headers: cronHeaders });
    expect(response.status()).toBe(500);
    const body = await response.json();
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toMatch(/private-dsn|service-key/);
  }
});

test('production scheduler aborts a stalled database transport within ten seconds', async ({
  request,
}) => {
  await request.post(`${fixture}/test-control`, { data: { databaseMode: 'cron-timeout' } });
  const startedAt = Date.now();
  const response = await request.get('/api/cron/retention', { headers: cronHeaders });
  expect(response.status()).toBe(500);
  expect((await response.json()).code).toBe('INTERNAL_ERROR');
  expect(Date.now() - startedAt).toBeLessThan(12_000);
});
