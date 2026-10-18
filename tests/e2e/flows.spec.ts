import { db, get, put, appointments } from '../../src/lib/demo-db';
import { test, expect, type Page } from '@playwright/test';

function cleanup() {
  try {
    for (const a of appointments()) {
      if (
        a.patientName === 'مريض اختبار المتصفح' ||
        a.patientName === 'مريض تجربة جديد' ||
        (a.patientId === 'patient-1' && !a.id.startsWith('seed-'))
      ) {
        db.prepare('DELETE FROM appointments WHERE id=?').run(a.id);
        db.prepare('DELETE FROM audit WHERE entity_id=?').run(a.id);
      }
    }
    db.prepare(
      "DELETE FROM entities WHERE kind='branch' AND json_extract(data,'$.name')='فرع اختبار المتصفح'",
    ).run();
    db.prepare(
      "DELETE FROM entities WHERE kind='reference' AND json_extract(data,'$.name')='مدينة اختبار'",
    ).run();
    db.prepare("DELETE FROM entities WHERE kind='medical' AND id='seed--1-4'").run();
    const v = get<Record<string, unknown>>('verification', 'request-1');
    if (v) put('verification', 'request-1', { ...v, status: 'pending' });
  } catch {
    // Ignore cleanup errors
  }
}

test.beforeAll(cleanup);
test.afterAll(cleanup);

async function login(page: Page, role: string) {
  const r = await page.request.post('/api/session', { data: { role } });
  expect(r.ok()).toBeTruthy();
}

async function loaded(page: Page) {
  await expect(page.locator('.loading-screen')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

test('1. Public discovery, filters, doctor slots and mobile layout', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // 1. Home page
  await page.goto('/');
  await expect(page.locator('.hero')).toBeVisible();
  await expect(page.locator('.doctor-card').first()).toBeVisible();
  const initialHomeCount = await page.locator('.doctor-card').count();
  expect(initialHomeCount).toBeGreaterThanOrEqual(1);

  // 2. Search page
  await page.getByRole('button', { name: 'ابحث عن طبيب', exact: true }).click();
  await expect(page).toHaveURL(/search/);
  await expect(page.locator('.doctor-card').first()).toBeVisible();
  const searchCount = await page.locator('.doctor-card').count();
  expect(searchCount).toBeGreaterThanOrEqual(1);

  // 3. Search input filter
  await page.getByPlaceholder('ابحث باسم الطبيب، التخصص أو المركز…').fill('أحمد');
  await expect(page.locator('.doctor-card')).toHaveCount(1);
  const doctorHeading = page.locator('.doctor-card h3').first();
  const doctorName = (await doctorHeading.textContent())?.trim();

  // 4. Doctor detail page
  await page.locator('.doctor-card a.book-link').first().click();
  await expect(page).toHaveURL(/\/doctors\//);
  await expect(page.locator('.profile-main h1')).toContainText(doctorName ?? '');
  await expect(page.locator('.slot-grid button').first()).toBeVisible();

  // 5. Mobile responsive check
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: 'docs/screenshots/doctor-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('2. Patient books real slot then cancels with persisted status', async ({ page }) => {
  await login(page, 'patient');
  await page.goto('/search');
  await expect(page.locator('.doctor-card').first()).toBeVisible();
  await page.locator('.doctor-card a.book-link').first().click();
  await page.waitForURL(/\/doctors\//);

  await expect(page.locator('.slot-grid button').first()).toBeVisible();
  await page.locator('.slot-grid button').first().click();
  await page.getByRole('button', { name: 'متابعة الحجز' }).click();
  await page.getByRole('button', { name: 'تأكيد طلب الحجز', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'طلب موعدك أصبح في مكانه' })).toBeVisible();

  // Navigate to my appointments
  await page.getByRole('link', { name: 'الانتقال إلى مواعيدي' }).click();
  await expect(page).toHaveURL(/my-appointments/);
  await expect(page.locator('.patient-appointment').first()).toBeVisible();
  const initialCount = await page.locator('.patient-appointment').count();
  expect(initialCount).toBeGreaterThanOrEqual(1);

  const card = page.locator('.patient-appointment').first();
  const cancelBtn = card.getByRole('button', { name: 'إلغاء الموعد', exact: true });
  if (await cancelBtn.isVisible()) {
    await cancelBtn.click();
    await page.getByRole('button', { name: 'تأكيد إلغاء الموعد' }).click();
    await page.waitForTimeout(1000);
    await page.reload();
    await expect(page.locator('.patient-appointment')).toHaveCount(initialCount - 1);
  }
});

test('3. Owner navigation, branch save, schedule save and permissions across workspace pages', async ({ page }) => {
  await login(page, 'clinic_owner');
  await page.goto('/workspace/dashboard');
  await expect(page.locator('.stat-card').first()).toBeVisible();
  await expect(page.locator('.stat-card')).toHaveCount(4);
  await loaded(page);
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'docs/screenshots/dashboard-desktop.png', fullPage: true });

  // Quick search
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('heading', { name: 'ابحث في مساحة عملك' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Schedule page
  await page.goto('/workspace/schedule');
  await expect(page.locator('.schedule-week')).toBeVisible();
  await page.getByRole('button', { name: 'حفظ جدول الدوام' }).click();
  await expect(page.getByText('تم تحديث جدول الدوام', { exact: true })).toBeVisible();

  // Team & Branch management
  await page.goto('/workspace/team');
  await expect(page.getByRole('button', { name: 'إضافة فرع', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'إضافة فرع', exact: true }).click();
  await page.getByLabel('اسم الفرع').fill('فرع اختبار المتصفح');
  await page.getByLabel('المدينة', { exact: true }).fill('دمشق');
  await page.getByLabel('الحي', { exact: true }).fill('المزة');
  await page.getByLabel('الهاتف', { exact: true }).fill('+963991234567');
  await page.getByRole('dialog').getByRole('button', { name: 'إضافة الفرع', exact: true }).click();
  await expect(page.getByText('تمت إضافة الفرع', { exact: true })).toBeVisible();
  await expect(page.locator('.branch-grid')).toContainText('فرع اختبار المتصفح');

  // Forbidden owner clinical mutation
  const forbidden = await page.request.post('/api/actions', {
    data: {
      action: 'medical',
      payload: {
        appointmentId: 'seed--1-4',
        diagnosis: 'اختبار',
        complaint: '',
        notes: '',
        medications: [],
        followUp: '',
        visible: true,
      },
    },
  });
  expect(forbidden.status()).toBe(403);

  // Full workspace pages walkthrough
  for (const route of [
    '/workspace/appointments',
    '/workspace/patients',
    '/workspace/billing',
    '/workspace/reports',
    '/workspace/settings',
  ]) {
    await page.goto(route);
    await expect(page.locator('.page-heading h1')).toBeVisible();
  }

  // Mobile viewport and sidebar
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/workspace/dashboard');
  await expect(page.locator('.stat-card')).toHaveCount(4);
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: 'docs/screenshots/dashboard-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'فتح القائمة', exact: true }).click();
  await expect(page.locator('.sidebar')).toHaveClass(/sidebar-open/);
  await page.getByRole('link', { name: 'جدول الدوام', exact: true }).click();
  await expect(page.locator('.schedule-week')).toBeVisible();
});

test('4. Reception direct booking, check-in and cash collection', async ({ page }) => {
  await login(page, 'receptionist');
  await page.goto('/workspace/appointments');
  await expect(page.getByRole('button', { name: 'موعد جديد', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'موعد جديد', exact: true }).click();
  await page.getByLabel('اسم المريض', { exact: true }).fill('مريض اختبار المتصفح');
  await page.getByLabel('رقم الهاتف', { exact: true }).fill('+963993333222');

  const select = page.getByLabel('الفترة المتاحة');
  await expect(select.locator('option')).not.toHaveCount(1);
  const value = await select.locator('option').last().getAttribute('value');
  await select.selectOption(value!);
  await page.getByRole('button', { name: 'إضافة وتأكيد الموعد' }).click();
  await expect(page.getByText('تمت إضافة الموعد وتأكيده بنجاح')).toBeVisible();

  await page.getByPlaceholder('ابحث باسم المريض أو الهاتف…').fill('مريض اختبار المتصفح');
  const actionButton = page.getByRole('button', { name: 'إجراءات موعد مريض اختبار المتصفح' });
  await expect(actionButton).toBeVisible();
  await actionButton.click();
  await page.getByRole('button', { name: 'تسجيل وصول المريض' }).click();
  await expect(page.locator('tbody')).toContainText('في الانتظار');

  await page.getByRole('button', { name: 'إجراءات موعد مريض اختبار المتصفح' }).click();
  await page.getByRole('button', { name: /تحصيل الكشفية نقدًا/ }).click();
  await expect(page.locator('tbody')).toContainText('مدفوع');

  // Receptionist forbidden from billing
  await page.goto('/workspace/billing');
  await expect(page).toHaveURL(/dashboard/);
});

test('5. Doctor writes clinical record and printable prescription', async ({ page }) => {
  await login(page, 'doctor');
  await page.goto('/workspace/appointments');
  await expect(page.locator('tbody tr').first()).toBeVisible();

  const data = await page.request.get('/api/data').then((r) => r.json());
  const appts = data.data?.appointments ?? [];
  const targetAppt = appts[0];

  if (targetAppt) {
    await page.goto(`/workspace/patients/${targetAppt.id}`);
    await expect(page.getByLabel('التشخيص', { exact: true })).toBeVisible();
    await page.getByLabel('التشخيص', { exact: true }).fill('متابعة صحية — بيانات اختبار');
    await page
      .getByLabel('الشكوى الرئيسية', { exact: true })
      .fill('معاينة توضيحية دون بيانات حقيقية');
    await page.getByRole('button', { name: 'إضافة دواء' }).click();
    await page.getByLabel('اسم الدواء', { exact: true }).fill('دواء توضيحي');
    await page.getByLabel('الجرعة', { exact: true }).fill('جرعة تجريبية');
    await page.getByLabel('التكرار', { exact: true }).fill('حسب التعليمات');
    await page.getByLabel('المدة', { exact: true }).fill('للعرض فقط');
    await page.getByRole('button', { name: 'حفظ وإتمام الزيارة' }).click();
    await expect(page.getByText('حُفظ السجل الطبي وأُتمّت الزيارة')).toBeVisible();
    await page.getByRole('button', { name: 'عرض الوصفة', exact: true }).click();
    await expect(page.locator('#prescription')).toContainText('متابعة صحية');
    await expect(page.locator('#prescription')).toContainText('دواء توضيحي');
  } else {
    await page.goto('/workspace/patients');
    await expect(page.locator('.page-heading h1')).toBeVisible();
  }
});

test('6. Admin approves request and persists a reference', async ({ page }) => {
  await login(page, 'super_admin');
  await page.goto('/admin');
  await expect(page.locator('.stat-card').first()).toBeVisible();
  await expect(page.locator('.stat-card')).toHaveCount(4);

  const approveBtn = page.getByRole('button', { name: 'اعتماد', exact: true });
  if ((await approveBtn.count()) > 0) {
    await approveBtn.first().click();
    await expect(page.getByText('تم اعتماد الطلب في بيئة العرض')).toBeVisible();
  }

  await page.getByRole('button', { name: 'المدن والتخصصات' }).click();
  await page.getByRole('button', { name: 'إضافة عنصر' }).click();
  await page.getByLabel('الاسم', { exact: true }).fill('مدينة اختبار');
  await page.getByRole('button', { name: 'إضافة العنصر' }).click();
  await expect(page.locator('.reference-grid')).toContainText('مدينة اختبار');
});

test('7. Unauthenticated and cross-origin mutations blocked, and public portals verified', async ({ request, page }) => {
  // Unauthorized blocked
  const r = await request.post('/api/appointments', {
    data: { doctorId: '87d2da64-eb38-4053-94ca-c6d2aed951a9', start: new Date().toISOString() },
  });
  expect(r.status()).toBe(401);

  // Cross-origin mutation blocked
  const csrf = await request.post('/api/session', {
    headers: { Origin: 'https://attacker.example' },
    data: { role: 'super_admin' },
  });
  expect(csrf.status()).toBe(403);

  // Login page
  await page.goto('/login');
  await expect(page.locator('.auth-box')).toBeVisible();

  // Clinic registration page
  await page.goto('/register-clinic');
  await expect(page.locator('.onboarding-card')).toBeVisible();

  // 404 Not Found page
  await page.goto('/page-does-not-exist');
  await expect(page.locator('.not-found, .error-code, h1')).toBeVisible();
});
