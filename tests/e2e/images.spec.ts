import { test, expect, type Locator, type Response } from '@playwright/test';

const oversizedOriginals = [
  '/images/doctor-4.jpg',
  '/images/doctor-5.jpg',
  '/images/doctor-6.jpg',
  '/images/doctor-samir.jpg',
];

async function expectResponsivePortrait(
  image: Locator,
  responses: Map<string, Response>,
  expected: { source: string; width: number; height: number },
) {
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('loading', 'lazy');
  await expect(image).toHaveAttribute('width', String(expected.width));
  await expect(image).toHaveAttribute('height', String(expected.height));
  await expect(image).toHaveAttribute('sizes', /\S/);
  await expect(image).toHaveAttribute('srcset', /\d+w.*\d+w/);

  const reservedSize = await image.evaluate((element) => ({
    width: element.clientWidth,
    height: element.clientHeight,
  }));
  expect(reservedSize.width).toBeGreaterThan(0);
  expect(reservedSize.height).toBeGreaterThan(0);

  await image.scrollIntoViewIfNeeded();
  await expect(image).toHaveJSProperty('complete', true, { timeout: 15000 });
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth), {
      timeout: 15000,
    })
    .toBeGreaterThan(0);

  const loaded = await image.evaluate((element: HTMLImageElement) => ({
    currentSrc: element.currentSrc,
    origin: window.location.origin,
    pixelRatio: window.devicePixelRatio,
    size: { width: element.clientWidth, height: element.clientHeight },
    container: {
      width: element.parentElement?.clientWidth,
      height: element.parentElement?.clientHeight,
    },
    objectFit: getComputedStyle(element).objectFit,
  }));
  expect(loaded.size).toEqual(reservedSize);
  expect(loaded.size).toEqual(loaded.container);
  expect(loaded.objectFit).toBe('cover');

  const url = new URL(loaded.currentSrc);
  expect(url.origin).toBe(loaded.origin);
  expect(url.pathname).toBe('/_next/image');
  expect(url.searchParams.get('url')).toBe(expected.source);
  const selectedWidth = Number(url.searchParams.get('w'));
  const displayPixels = loaded.size.width * loaded.pixelRatio;
  expect(selectedWidth).toBeGreaterThanOrEqual(Math.ceil(displayPixels));
  // Allow the next available responsive candidate, but not a full-screen download for a thumbnail.
  expect(selectedWidth).toBeLessThanOrEqual(Math.ceil(displayPixels * 1.6));

  const response = responses.get(loaded.currentSrc);
  expect(response, `Browser response for ${loaded.currentSrc}`).toBeDefined();
  if (!response) throw new Error('The portrait did not produce a browser image response');
  expect(response.ok()).toBeTruthy();
  expect(response.headers()['content-type']).toMatch(/^image\//);
  expect((await response.body()).byteLength).toBeLessThan(150_000);
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test.describe(`Public doctor images (${viewport.name})`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.name === 'mobile' ? 2 : 1,
      reducedMotion: 'reduce',
    });

    test('portraits load responsively in reserved slots without downloading oversized originals', async ({
      page,
    }) => {
      const responses = new Map<string, Response>();
      const requestedImages: string[] = [];
      page.on('response', (response) => {
        if (response.request().resourceType() === 'image') responses.set(response.url(), response);
      });
      page.on('request', (request) => {
        if (request.resourceType() !== 'image') return;
        const url = new URL(request.url());
        requestedImages.push(url.searchParams.get('url') ?? url.pathname);
      });

      await page.goto('/search');
      for (const doctor of [
        { name: 'د. رنا الشامي', source: '/images/doctor-4.webp' },
        { name: 'د. وسيم الجراح', source: '/images/doctor-5.webp' },
        { name: 'د. أمل الفايز', source: '/images/doctor-6.webp' },
      ]) {
        const card = page.locator('.doctor-card').filter({
          has: page.getByRole('heading', { name: doctor.name, exact: true }),
        });
        await expectResponsivePortrait(
          card.getByRole('img', { name: doctor.name, exact: true }),
          responses,
          { source: doctor.source, width: 300, height: 205 },
        );
      }

      await page.goto('/doctors/doctor-4');
      await expectResponsivePortrait(
        page.locator('.profile-main').getByRole('img', { name: 'رنا الشامي', exact: true }),
        responses,
        { source: '/images/doctor-4.webp', width: 112, height: 112 },
      );

      await page.goto('/');
      for (let i = 0; i < 3; i++) {
        await expectResponsivePortrait(
          page.locator('.avatar-stack').getByRole('img', { name: `طبيب ${i}`, exact: true }),
          responses,
          { source: `/images/doctor-${i + 1}.jpg`, width: 32, height: 32 },
        );
      }

      expect(requestedImages.filter((source) => oversizedOriginals.includes(source))).toEqual([]);
    });
  });
}
