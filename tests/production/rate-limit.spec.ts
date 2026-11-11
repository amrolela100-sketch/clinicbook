import { test, expect } from '@playwright/test';

const fixture = 'http://127.0.0.1:4191';
const apps = ['http://127.0.0.1:3100', 'http://127.0.0.1:3101'];

test.beforeEach(async ({ request }) => {
  await request.post(`${fixture}/test-control`, { data: { reset: true, mode: 'healthy' } });
});

test('login rate limits are global across two production instances', async ({ request }) => {
  for (let i = 0; i < 10; i++) {
    const response = await request.post(`${apps[i % 2]}/api/session`, {
      data: { email: `rate-user-${i}@example.test`, password: 'invalid-password' },
    });
    expect(response.status()).toBe(401);
  }
  const blocked = await request.post(`${apps[0]}/api/session`, {
    data: { email: 'rate-user-11@example.test', password: 'invalid-password' },
  });
  expect(blocked.status()).toBe(429);
  expect((await blocked.json()).code).toBe('RATE_LIMITED');
  expect(Number(blocked.headers()['retry-after'])).toBeGreaterThan(0);
});

test('fails closed with 503 instead of authorizing logins when shared Redis errors', async ({
  request,
}) => {
  await request.post(`${fixture}/test-control`, { data: { mode: 'fail' } });
  for (let i = 0; i < 2; i++) {
    const response = await request.post(`${apps[0]}/api/session`, {
      data: { email: 'redis-down@example.test', password: 'invalid-password' },
    });
    expect(response.status()).toBe(503);
    expect((await response.json()).code).toBe('RATE_LIMIT_UNAVAILABLE');
  }
});

test('fails closed with 503 when shared Redis exceeds the transport deadline', async ({
  request,
}) => {
  await request.post(`${fixture}/test-control`, { data: { mode: 'timeout' } });
  const startedAt = Date.now();
  const response = await request.post(`${apps[0]}/api/session`, {
    data: { email: 'redis-slow@example.test', password: 'invalid-password' },
  });
  expect(response.status()).toBe(503);
  expect((await response.json()).code).toBe('RATE_LIMIT_UNAVAILABLE');
  expect(Date.now() - startedAt).toBeLessThan(3400);
});

test('client-supplied proxy headers cannot rotate a production login bucket', async ({
  request,
}) => {
  for (let i = 0; i < 11; i++) {
    const response = await request.post(`${apps[i % 2]}/api/session`, {
      headers: {
        'cf-connecting-ip': `198.51.100.${i + 1}`,
        'x-vercel-forwarded-for': `198.51.100.${i + 1}`,
        'x-forwarded-for': `198.51.100.${i + 1}`,
        'x-real-ip': `198.51.100.${i + 1}`,
        'cf-ray': 'client-controlled',
        'x-vercel-id': 'client-controlled',
      },
      data: { email: `spoof-user-${i}@example.test`, password: 'invalid-password' },
    });
    expect(response.status()).toBe(i < 10 ? 401 : 429);
  }
});
