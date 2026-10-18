import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function login(page: Page, role: string) {
  const r = await page.request.post('/api/session', { data: { role } });
  expect(r.ok()).toBeTruthy();
}

async function loaded(page: Page) {
  await expect(page.locator('.loading-screen')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
}

test.describe('ClinicBook Comprehensive Accessibility Audit (axe-core)', () => {
  test.use({ reducedMotion: 'reduce' });

  test('1. Public Home Page (/) meets WCAG AA', async ({ page }) => {
    await page.goto('/');
    await loaded(page);
    await expect(page.locator('.hero')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('2. Public Search Page (/search) meets WCAG AA', async ({ page }) => {
    await page.goto('/search');
    await loaded(page);
    await expect(page.locator('.search-layout')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('3. Doctor Profile Page (/doctors/doctor-1) meets WCAG AA', async ({ page }) => {
    await page.goto('/doctors/doctor-1');
    await loaded(page);
    await expect(page.locator('.profile-card')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('4. Login Page (/login) meets WCAG AA', async ({ page }) => {
    await page.goto('/login');
    await loaded(page);
    await expect(page.locator('.auth-form-wrap')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('5. Clinic Registration Page (/register-clinic) meets WCAG AA', async ({ page }) => {
    await page.goto('/register-clinic');
    await loaded(page);
    await expect(page.locator('.onboarding-page')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('6. Patient Appointments (/my-appointments) meets WCAG AA', async ({ page }) => {
    await login(page, 'patient');
    await page.goto('/my-appointments');
    await loaded(page);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('7. Workspace Dashboard (/workspace/dashboard) meets WCAG AA', async ({ page }) => {
    await login(page, 'clinic_owner');
    await page.goto('/workspace/dashboard');
    await loaded(page);
    await expect(page.locator('.stat-card').first()).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('8. Workspace Appointments Table (/workspace/appointments) meets WCAG AA', async ({ page }) => {
    await login(page, 'receptionist');
    await page.goto('/workspace/appointments');
    await loaded(page);
    await expect(page.locator('.page-heading h1')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('9. Workspace Schedule Week (/workspace/schedule) meets WCAG AA', async ({ page }) => {
    await login(page, 'clinic_owner');
    await page.goto('/workspace/schedule');
    await loaded(page);
    await expect(page.locator('.schedule-week')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('10. Super Admin Queue (/admin) meets WCAG AA', async ({ page }) => {
    await login(page, 'super_admin');
    await page.goto('/admin');
    await loaded(page);
    await expect(page.locator('.page-heading h1')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
