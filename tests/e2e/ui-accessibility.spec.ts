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

  test('public search fields have labels and navigation announces the current page', async ({
    page,
  }) => {
    await page.goto('/search');
    await loaded(page);
    await expect(
      page.getByLabel('ابحث باسم الطبيب أو التخصص أو المركز', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'اكتشف الأطباء', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('workspace search fields have labels and navigation announces the current page', async ({
    page,
  }) => {
    expect(
      (await page.request.post('/api/session', { data: { role: 'clinic_owner' } })).ok(),
    ).toBeTruthy();
    await page.goto('/workspace/appointments');
    await loaded(page);
    await expect(page.getByLabel('ابحث باسم المريض أو الهاتف', { exact: true })).toBeVisible();
    await expect(page.locator('.sidebar-link[href="/workspace/appointments"]')).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.keyboard.press('Control+k');
    await expect(
      page.getByRole('dialog').getByLabel('ابحث عن مريض أو قسم', { exact: true }),
    ).toBeVisible();
  });

  test('chosen appointment day and slot expose their selected state', async ({ page }) => {
    await page.goto('/doctors/doctor-1');
    await loaded(page);
    const days = page.locator('.days-carousel button');
    const initialDate = await page.getByLabel('تاريخ الحجز').inputValue();
    await expect(days.first()).toHaveAttribute('aria-pressed', 'true');
    // Find an actually open working day; tomorrow may be a weekend.
    for (let index = 1; index <= 7; index += 1) {
      const day = new Date(`${initialDate}T12:00:00Z`);
      day.setUTCDate(day.getUTCDate() + index);
      const targetDate = day.toISOString().slice(0, 10);
      const response = page.waitForResponse((value) => {
        const url = new URL(value.url());
        return url.pathname === '/api/slots' && url.searchParams.get('date') === targetDate;
      });
      await days.nth(index).click();
      const result = await (await response).json();
      await expect(days.nth(index)).toHaveAttribute('aria-pressed', 'true');
      if (result.data?.length) break;
    }
    await expect(days.first()).toHaveAttribute('aria-pressed', 'false');
    const slot = page.locator('.slot-grid button').first();
    await expect(slot).toBeVisible();
    await expect(slot).toHaveAttribute('aria-pressed', 'false');
    await slot.click();
    await expect(slot).toHaveAttribute('aria-pressed', 'true');
  });

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
