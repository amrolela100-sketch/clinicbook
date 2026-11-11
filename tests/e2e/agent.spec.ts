import { test, expect } from '@playwright/test';

test.describe('ClinicBook AI Medical Assistant E2E Verification', () => {
  test('booking confirmation contains focus and returns it without closing the assistant', async ({
    page,
  }) => {
    const session = await page.request.post('/api/session', { data: { role: 'patient' } });
    expect(session.ok()).toBeTruthy();
    await page.goto('/');
    await page.getByRole('button', { name: 'افتح المساعد الطبي الذكي' }).click();

    const drawer = page.getByRole('complementary', { name: 'المساعد الطبي الذكي' });
    await drawer.getByRole('button', { name: 'عندي ألم في الأسنان', exact: true }).click();
    const slot = drawer.getByRole('button', { name: /[٠-٩\d]{1,2}:[٠-٩\d]{2}\s*[صم]/ }).nth(1);
    await expect(slot).toBeVisible();
    await slot.click();

    const dialog = page.getByRole('dialog', { name: 'تأكيد حجز الموعد الطبي' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toHaveAccessibleDescription(
      'أدخل اسم المريض ورقم الهاتف لتأكيد حجز الموعد المختار.',
    );
    await expect(dialog.getByRole('textbox', { name: 'اسم المريض الكامل' })).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'رقم الهاتف للتأكيد' })).toBeVisible();
    await expect
      .poll(() => dialog.evaluate((el) => el.contains(document.activeElement)))
      .toBe(true);

    for (const key of ['Tab', 'Shift+Tab']) {
      for (let step = 0; step < 8; step += 1) {
        await page.keyboard.press(key);
        await expect
          .poll(() => dialog.evaluate((el) => el.contains(document.activeElement)))
          .toBe(true);
      }
    }

    // The drawer and underlying page are hidden from assistive technology and cannot take focus.
    await expect(page.getByRole('button', { name: 'إغلاق نافذة المساعد' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'افتح المساعد الطبي الذكي' })).toHaveCount(0);
    await page
      .getByPlaceholder('اكتب استفسارك أو الأعراض التي تشعر بها...')
      .evaluate((el) => el.focus());
    await expect
      .poll(() => dialog.evaluate((el) => el.contains(document.activeElement)))
      .toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(drawer).toBeVisible();
    await expect(slot).toBeFocused();

    await slot.click();
    await dialog.getByRole('button', { name: 'إغلاق', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(drawer).toBeVisible();
    await expect(slot).toBeFocused();

    await slot.click();
    await dialog.getByRole('button', { name: 'إلغاء', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(slot).toBeFocused();

    await slot.click();
    await dialog.getByRole('textbox', { name: 'اسم المريض الكامل' }).fill('مريض اختبار الإتاحة');
    await dialog.getByRole('textbox', { name: 'رقم الهاتف للتأكيد' }).fill('0912345678');
    const bookingResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/agent/chat') &&
        response.request().postDataJSON()?.action === 'book_slot',
    );
    await dialog.getByRole('button', { name: 'تأكيد الحجز الفوري', exact: true }).click();
    const response = await bookingResponse;
    expect(response.ok()).toBeTruthy();
    expect((await response.json()).success).toBe(true);
    await expect(dialog).toBeHidden();
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('تم تأكيد حجز موعدك بنجاح!');
    await expect(slot).toBeFocused();
  });

  test('FAB trigger, conversation, emergency detection, and appointment booking flow', async ({
    page,
  }) => {
    // 1. Visit homepage
    await page.goto('/');
    await expect(page.locator('.hero')).toBeVisible();

    // 2. Verify Floating Action Button (FAB)
    const fab = page.locator('.agent-fab');
    await expect(fab).toBeVisible();
    await expect(fab).toContainText('المساعد الطبي');

    // 3. Open Assistant Drawer
    await fab.click();
    const drawer = page.locator('aside[aria-label="المساعد الطبي الذكي"]');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('مساعد ClinicBook');

    // 4. Test quick action suggestion (Dentistry)
    const dentalAction = page.getByRole('button', { name: 'عندي ألم في الأسنان', exact: true });
    await expect(dentalAction).toBeVisible();
    await dentalAction.click();

    // 5. Verify response contains dental doctors and slots
    await expect(page.locator('.whitespace-pre-wrap').last()).toContainText('طب الأسنان');
    const slotButton = page.locator('button:has-text("ص"), button:has-text("م")').first();
    await expect(slotButton).toBeVisible();

    // 6. Test direct chat input for emergency triage
    const input = page.getByPlaceholder('اكتب استفسارك أو الأعراض التي تشعر بها...');
    await input.fill('أشعر بألم حاد في الصدر وضيق تنفس');
    await page.getByLabel('إرسال الرسالة').click();

    // 7. Verify Emergency Triage protocol triggers
    await expect(page.getByText('بروتوكول فرز الطوارئ الطبية')).toBeVisible();
    await expect(page.getByRole('link', { name: /اتصال بالإسعاف/ })).toBeVisible();

    // 8. Test Reset Chat
    await page.getByLabel('بدء محادثة جديدة').click();
    await expect(page.locator('.whitespace-pre-wrap').first()).toContainText(
      'مرحباً بك في المساعد الطبي الذكي',
    );

    // 9. Close Drawer
    await page.getByLabel('إغلاق نافذة المساعد').click();
    await expect(drawer).toBeHidden();
  });
});
