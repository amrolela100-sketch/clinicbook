import { test, expect, type Locator, type Page } from '@playwright/test';

async function loaded(page: Page) {
  await expect(page.locator('.loading-screen')).toHaveCount(0, { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
}

async function switchThumb(toggle: Locator) {
  return toggle.evaluate((element) => {
    const track = element.getBoundingClientRect();
    const thumb = getComputedStyle(element, '::after');
    const transform = new DOMMatrixReadOnly(
      thumb.transform === 'none' ? undefined : thumb.transform,
    );
    return {
      trackWidth: track.width,
      trackHeight: track.height,
      left: Number.parseFloat(thumb.left) + transform.m41,
      top: Number.parseFloat(thumb.top) + transform.m42,
      width: Number.parseFloat(thumb.width),
      height: Number.parseFloat(thumb.height),
    };
  });
}

function expectThumbInsideTrack(thumb: Awaited<ReturnType<typeof switchThumb>>) {
  expect(thumb.left).toBeGreaterThanOrEqual(2);
  expect(thumb.left + thumb.width).toBeLessThanOrEqual(thumb.trackWidth - 2);
  expect(thumb.top).toBeGreaterThanOrEqual(2);
  expect(thumb.top + thumb.height).toBeLessThanOrEqual(thumb.trackHeight - 2);
}

test.describe('Focused UI accessibility regressions', () => {
  test.use({ reducedMotion: 'reduce' });

  for (const direction of ['rtl', 'ltr']) {
    test(`availability switch stays inside its track and moves toward inline end (${direction})`, async ({
      page,
    }) => {
      await page.goto('/search');
      await loaded(page);
      await page.evaluate((dir) => (document.documentElement.dir = dir), direction);
      const toggle = page.getByRole('switch', { name: 'متاح اليوم', exact: true });
      await expect(toggle).toBeVisible();
      await toggle.uncheck();
      const off = await switchThumb(toggle);
      expectThumbInsideTrack(off);

      await toggle.check();
      await expect(toggle).toBeChecked();
      const checkedLeft = direction === 'ltr' ? off.trackWidth - off.width - 3 : 3;
      await expect.poll(async () => (await switchThumb(toggle)).left).toBeCloseTo(checkedLeft, 1);
      const on = await switchThumb(toggle);
      expectThumbInsideTrack(on);
      expect(Math.abs(on.left - off.left)).toBeCloseTo(off.trackWidth - off.width - 6, 1);

      await toggle.uncheck();
      await expect.poll(async () => (await switchThumb(toggle)).left).toBeCloseTo(off.left, 1);
      expectThumbInsideTrack(await switchThumb(toggle));
    });
  }
});
