import { test, expect } from '@playwright/test';

test('production CSP permits hydration and interactive authentication tabs', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /Content Security Policy|script-src|Refused to execute/i.test(message.text())
    ) {
      violations.push(message.text());
    }
  });

  const response = await page.goto('/login');
  const policy = response?.headers()['content-security-policy'] ?? '';
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
  expect(nonce).toBeTruthy();
  expect(policy).not.toContain("'unsafe-eval'");
  expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");

  await page.getByRole('tab', { name: 'حساب جديد' }).click();
  await expect(page.getByLabel('الاسم الكامل', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'حساب جديد' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const scriptNonces = await page
    .locator('script:not([src]):not([type="application/ld+json"])')
    .evaluateAll((scripts) => scripts.map((script) => (script as HTMLScriptElement).nonce));
  expect(scriptNonces.length).toBeGreaterThan(0);
  expect(scriptNonces.every((value) => value === nonce)).toBe(true);
  expect(violations).toEqual([]);
});

test('doctor JSON-LD uses the same per-request nonce as the production CSP', async ({ page }) => {
  const response = await page.goto('/doctors/11111111-1111-4111-8111-111111111111');
  expect(response?.status()).toBe(200);
  const policy = response?.headers()['content-security-policy'] ?? '';
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
  expect(nonce).toBeTruthy();

  const script = page.locator('script[type="application/ld+json"]');
  await expect(script).toHaveCount(1);
  expect(await script.evaluate((element) => (element as HTMLScriptElement).nonce)).toBe(nonce);
  const data = JSON.parse((await script.textContent()) ?? 'null');
  expect(data['@type']).toBe('Physician');
});
