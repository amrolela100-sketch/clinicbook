import { expect, test } from '@playwright/test';

test('idle pages do not reload the full snapshot every twenty seconds; focus bursts revalidate once', async ({
  page,
}) => {
  let requests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/data') requests += 1;
  });
  await page.clock.install();
  await page.goto('/search');
  await expect(page.locator('.doctor-card').first()).toBeVisible();
  const initialRequests = requests;
  await page.clock.runFor(25_000);
  await page.waitForTimeout(100);
  expect(requests).toBe(initialRequests);

  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(500);
  await expect.poll(() => requests).toBe(initialRequests + 1);
});
