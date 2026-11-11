import { expect, test, type Locator } from '@playwright/test';

function luminance(cssColor: string) {
  const channels = cssColor
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Unexpected computed color: ${cssColor}`);
  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

async function keyboardFocus(control: Locator) {
  await control.focus();
  await control.press('Tab');
  await control.page().keyboard.press('Shift+Tab');
  await expect(control).toBeFocused();
  const outline = await control.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      color: style.outlineColor,
      width: Number.parseFloat(style.outlineWidth),
      kind: style.outlineStyle,
    };
  });
  expect(outline.width).toBeGreaterThanOrEqual(2);
  expect(outline.kind).toBe('solid');
  return outline;
}

test('public controls retain a measured high-contrast keyboard outline', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.hero')).toBeVisible();
  const background = await page
    .locator('.public-shell')
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  for (const control of [
    page.locator('.hero-search select').first(),
    page.getByRole('button', { name: 'افتح المساعد الطبي الذكي', exact: true }),
  ]) {
    const outline = await keyboardFocus(control);
    expect(contrast(outline.color, 'rgb(255,255,255)')).toBeGreaterThanOrEqual(3);
    expect(contrast(outline.color, background)).toBeGreaterThanOrEqual(3);
  }
});

test('rendered small status badges meet 4.5:1 against their actual background', async ({
  page,
}) => {
  expect(
    (await page.request.post('/api/session', { data: { role: 'clinic_owner' } })).ok(),
  ).toBeTruthy();
  await page.goto('/workspace/appointments');
  await expect(page.locator('.badge').first()).toBeVisible();
  const badges = await page.locator('.badge').evaluateAll((elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element);
      return {
        text: element.textContent,
        foreground: style.color,
        background: style.backgroundColor,
      };
    }),
  );
  expect(badges.length).toBeGreaterThan(0);
  for (const badge of badges) {
    expect(contrast(badge.foreground, badge.background), `${badge.text}`).toBeGreaterThanOrEqual(
      4.5,
    );
  }
});
