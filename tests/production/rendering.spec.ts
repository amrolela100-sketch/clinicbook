import { expect, test } from '@playwright/test';

test('production public content and doctor metadata are visible without JavaScript', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    const home = await page.goto('http://127.0.0.1:3100/');
    expect(home?.status()).toBe(200);
    expect(home?.headers()['cache-control']).toContain('no-store');
    await expect(page.getByRole('heading', { name: /رعاية أقرب/ })).toBeVisible();
    await expect(page.locator('.doctor-card')).toHaveCount(1);
    const search = await page.goto('http://127.0.0.1:3100/search?city=%D8%AF%D9%85%D8%B4%D9%82');
    expect(search?.status()).toBe(200);
    await expect(page.getByLabel('المدينة', { exact: true })).toHaveValue('دمشق');
    await expect(page.locator('.doctor-card')).toHaveCount(1);
    const doctor = await page.goto(
      'http://127.0.0.1:3100/doctors/11111111-1111-4111-8111-111111111111',
    );
    expect(doctor?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { name: /طبيب اختبار الإنتاج/, level: 1 }),
    ).toBeVisible();
    await expect(page).toHaveTitle(/طبيب اختبار الإنتاج/);
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
  } finally {
    await context.close();
  }
});

test('assistant transport code is downloaded only when the assistant is opened', async ({
  page,
}) => {
  const scripts: Array<Promise<string>> = [];
  const startupSnapshots: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/data') startupSnapshots.push(request.url());
  });
  page.on('response', (response) => {
    if (
      response.request().resourceType() === 'script' &&
      response.url().includes('/_next/static/')
    ) {
      scripts.push(response.text().catch(() => ''));
    }
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /رعاية أقرب/ })).toBeVisible();
  await expect(page.locator('[data-app-ready="true"]')).toBeAttached();
  expect(startupSnapshots).toEqual([]);
  expect((await Promise.all(scripts)).some((script) => script.includes('/api/agent/chat'))).toBe(
    false,
  );
  await page.getByRole('button', { name: 'افتح المساعد الطبي الذكي', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'المساعد الطبي الذكي' })).toBeVisible();
  expect((await Promise.all(scripts)).some((script) => script.includes('/api/agent/chat'))).toBe(
    true,
  );
});
