import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1050 },
  deviceScaleFactor: 1,
});
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE', m.text());
});
await page.goto('http://localhost:3000/');
await page.locator('.hero-photo').waitFor();
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(900);
await page.screenshot({ path: 'docs/screenshots/home-desktop.png', fullPage: true });
await page.request.post('http://localhost:3000/api/session', { data: { role: 'clinic_owner' } });
await page.goto('http://localhost:3000/workspace/dashboard');
await page.locator('.stat-card').first().waitFor();
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(900);
await page.screenshot({ path: 'docs/screenshots/dashboard-desktop.png', fullPage: true });
console.log('Dashboard', await page.locator('.stat-middle strong').allTextContents());
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(600);
await page.screenshot({ path: 'docs/screenshots/dashboard-mobile.png', fullPage: true });
console.log(
  'Mobile widths',
  await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth })),
);
await page.goto('http://localhost:3000/');
await page.locator('.hero-photo').waitFor();
await page.waitForTimeout(900);
await page.screenshot({ path: 'docs/screenshots/home-mobile.png', fullPage: true });
console.log(
  'Home mobile widths',
  await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth })),
);
await browser.close();
