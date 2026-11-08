import { test, expect, type Page } from '@playwright/test';
import { db } from '../../src/lib/demo-db';

async function loaded(page: Page) {
  await expect(page.locator('.loading-screen')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

test.describe('Auth Flow, Role Grid, Password Toggles & Navigation Redirection', () => {
  test.beforeEach(async ({ page }) => {
    // Clear cookies to start unauthenticated
    await page.context().clearCookies();
  });

  test('1. Symmetrical role grid, password visibility toggles and mismatch validation', async ({
    page,
  }) => {
    await page.goto('/login');
    await loaded(page);

    // Verify Sign In view elements
    await expect(page.getByRole('tab', { name: 'تسجيل الدخول' })).toHaveClass(/active/);
    await expect(page.getByLabel('البريد الإلكتروني')).toBeVisible();

    // Verify password visibility toggle on Sign In
    const signInPasswordInput = page.locator('input[type="password"]').first();
    await signInPasswordInput.fill('secret123');
    await expect(signInPasswordInput).toHaveAttribute('type', 'password');

    const toggleBtn = page.getByRole('button', { name: 'إظهار كلمة المرور' }).first();
    await toggleBtn.click();
    await expect(page.locator('input[placeholder="••••••••"]').first()).toHaveAttribute(
      'type',
      'text',
    );
    await page.getByRole('button', { name: 'إخفاء كلمة المرور' }).first().click();
    await expect(page.locator('input[placeholder="••••••••"]').first()).toHaveAttribute(
      'type',
      'password',
    );

    // Switch to Sign Up tab
    await page.getByRole('tab', { name: 'حساب جديد' }).click();
    await expect(page.getByRole('tab', { name: 'حساب جديد' })).toHaveClass(/active/);

    // Verify direct patient signup form without role selector
    await expect(page.getByLabel('الاسم الكامل')).toBeVisible();
    await expect(page.getByLabel('البريد الإلكتروني')).toBeVisible();

    // Fill signup form with mismatching passwords
    await page.getByLabel('الاسم الكامل').fill('مريض اختبار جديد');
    await page.getByLabel('البريد الإلكتروني').fill('test-mismatch@clinicbook.demo');
    const passwordInputs = page.locator('form input[placeholder="••••••••"]');
    await passwordInputs.nth(0).fill('password123');
    await passwordInputs.nth(1).fill('differentPassword123');
    await page.getByRole('button', { name: 'إنشاء حساب' }).click();

    // Verify error toast
    await expect(page.getByText('كلمتا المرور غير متطابقتين')).toBeVisible();
  });

  test('3. Clinic owner signup creates account and redirects directly to onboarding with prefilled email', async ({
    page,
  }) => {
    await page.goto('/login');
    await loaded(page);

    // Switch to Sign Up tab
    await page.getByRole('tab', { name: 'حساب جديد' }).click();

    // Select clinic owner role
    const clinicBtn = page.getByRole('radio', { name: 'عيادة أو مركز طبي' });
    await clinicBtn.click();
    await expect(clinicBtn).toHaveAttribute('aria-checked', 'true');
    await expect(clinicBtn).toHaveClass(/selected/);

    // Fill form with valid credentials
    const ownerEmail = `owner-${Date.now()}@clinicbook.demo`;
    await page.getByLabel('الاسم الكامل').fill('د. غياث البكري');
    await page.getByLabel('البريد الإلكتروني').fill(ownerEmail);
    await page.getByLabel('رقم الهاتف (اختياري)').fill('0933112233');

    const passwordInputs = page.locator('form input[placeholder="••••••••"]');
    await passwordInputs.nth(0).fill('ownerSecret123');
    await passwordInputs.nth(1).fill('ownerSecret123');

    // Submit
    await page.getByRole('button', { name: 'إنشاء حساب' }).click();

    // Wait for redirect to /register-clinic?onboarding=1
    await page.waitForURL(
      (url) => url.pathname === '/register-clinic' && url.searchParams.get('onboarding') === '1',
    );
    await expect(page).toHaveURL(/\/register-clinic\?onboarding=1/);

    // Verify onboarding form loaded and prefilled email
    await expect(page.locator('.onboarding-intro')).toBeVisible();
    await expect(page.getByLabel('اسم المركز أو العيادة')).toBeVisible();

    // Fill Step 1
    await page.getByLabel('اسم المركز أو العيادة').fill('مركز الأمل الطبي');
    await page.getByLabel('الحي').fill('القصاع');
    await page.getByLabel('هاتف المركز').fill('+963 11 223 3445');
    await page.getByRole('button', { name: 'الخطوة التالية' }).click();

    // Step 2 shows manager email prefilled from authenticated session and locked
    const adminEmailField = page.getByLabel('البريد الإلكتروني للمدير');
    await expect(adminEmailField).toBeVisible();
    await expect(adminEmailField).toHaveValue(ownerEmail);
    await expect(adminEmailField).toHaveAttribute('readonly', '');
  });

  test('2. Rejects invalid credentials and succeeds with valid credentials using next return parameter', async ({
    page,
  }) => {
    // Navigate to login with ?next=/search
    await page.goto('/login?next=/search');
    await loaded(page);

    // Attempt sign in with wrong password for seed user
    await page.getByLabel('البريد الإلكتروني').fill('patient@clinicbook.demo');
    await page.locator('input[type="password"]').first().fill('completelyWrongPassword!');
    await page.getByRole('button', { name: 'تسجيل الدخول' }).click();

    // Verify rejection toast
    await expect(page.getByText('البريد الإلكتروني أو كلمة المرور غير صحيحة')).toBeVisible();

    // Enter correct demo password
    await page.locator('input[type="password"]').first().fill('demo1234');
    await page.getByRole('button', { name: 'تسجيل الدخول' }).click();

    // Should redirect to ?next destination (/search)
    await page.waitForURL(/\/search/);
    await expect(page).toHaveURL(/\/search/);

    // Verify patient header shows "مواعيدي" and logout button
    await expect(page.locator('.public-nav-actions').getByText('مواعيدي')).toBeVisible();
    const logoutBtn = page.locator('.public-nav-actions button[title="تسجيل الخروج"]');
    await expect(logoutBtn).toBeVisible();

    // Click logout
    await logoutBtn.click();
    await page.waitForURL('http://localhost:3000/');
    await expect(page.locator('.public-nav-actions').getByText('تسجيل الدخول')).toBeVisible();
  });
});
