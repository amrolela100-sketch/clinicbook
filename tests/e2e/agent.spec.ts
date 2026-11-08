import { test, expect } from '@playwright/test';

test.describe('ClinicBook AI Medical Assistant E2E Verification', () => {
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
