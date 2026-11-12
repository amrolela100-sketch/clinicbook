import { expect, test } from '@playwright/test';

for (const width of [360, 390]) {
  test(`mobile hero captions remain legible without horizontal overflow (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.locator('.hero')).toBeVisible();
    const sizes = await page
      .locator('.hero-assurance span, .hero-search label small')
      .evaluateAll((elements) =>
        elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
      );
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(11);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}
