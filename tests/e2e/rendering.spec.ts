import { expect, test } from '@playwright/test';

test.use({ javaScriptEnabled: false });

test('public care content is visible from server HTML without client hydration', async ({
  page,
}) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: /رعاية أقرب/ })).toBeVisible();
  await expect(page.locator('.doctor-card').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'افتح المساعد الطبي الذكي' })).toBeVisible();
});

test('server-rendered search honors the requested city before hydration', async ({ page }) => {
  const emptySearch = await page.goto('/search?city=%D8%AD%D9%85%D8%B5');
  expect(emptySearch?.status()).toBe(200);
  // The seed has no Homs doctors; an empty result is the correct filtered HTML.
  await expect(page.getByLabel('المدينة', { exact: true })).toHaveValue('حمص');
  await expect(page.getByRole('heading', { name: 'لم نجد طبيبًا بهذه الخيارات' })).toBeVisible();
  const populatedSearch = await page.goto('/search?city=%D8%AD%D9%84%D8%A8');
  expect(populatedSearch?.status()).toBe(200);
  await expect(page.locator('.doctor-card').first()).toBeVisible();
  const locations = await page.locator('.doctor-location').allTextContents();
  expect(locations.length).toBeGreaterThan(0);
  expect(locations.every((location) => location.includes('حلب'))).toBe(true);
});

test('file-based routes retain server authorization without relying on client code', async ({
  page,
}) => {
  await page.goto('/workspace/dashboard');
  await expect(page).toHaveURL(/\/login\?next=/);
  expect(
    (await page.request.post('/api/session', { data: { role: 'patient' } })).ok(),
  ).toBeTruthy();
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/my-appointments$/);
});
