import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SCREENSHOT_DIR = path.resolve('docs/screenshots/showcase');
const ROOT_COPY_DIR = path.resolve('../showcase_screenshots');

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
fs.mkdirSync(ROOT_COPY_DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
});

const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  deviceScaleFactor: 1.5,
  locale: 'ar-SY',
});

const page = await context.newPage();

async function snap(filename, fullPage = false) {
  const localPath = path.join(SCREENSHOT_DIR, filename);
  const rootPath = path.join(ROOT_COPY_DIR, filename);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  await page.screenshot({ path: localPath, fullPage });
  fs.copyFileSync(localPath, rootPath);
  console.log(`Saved screenshot: ${filename}`);
}

async function setRole(role) {
  await page.request.post('http://localhost:3000/api/session', { data: { role } });
  await page.waitForTimeout(300);
}

try {
  console.log('--- 1. Home / Landing Page ---');
  await page.goto('http://localhost:3000/');
  await page.waitForTimeout(1000);
  await snap('01-landing-page.png', true);

  console.log('--- 2. Search & Doctors Directory ---');
  await page.goto('http://localhost:3000/search');
  await page.waitForTimeout(800);
  await snap('02-search-and-filters.png', true);

  console.log('--- 3. Doctor Profile & Booking Slots ---');
  // Navigate to first doctor
  const firstDocCard = page.locator('.doctor-card a, a[href*="/doctors/"]').first();
  if (await firstDocCard.count() > 0) {
    await firstDocCard.click();
    await page.waitForTimeout(800);
  } else {
    await page.goto('http://localhost:3000/doctors/doc-1');
  }
  await page.waitForTimeout(800);
  await snap('03-doctor-profile-slots.png', false);

  console.log('--- 4. AI Assistant Eve (Triage Chat) ---');
  await page.goto('http://localhost:3000/');
  const eveButton = page.locator('button:has-text("Eve"), button:has-text("المساعد"), [aria-label*="Eve"]').first();
  if (await eveButton.count() > 0) {
    await eveButton.click();
    await page.waitForTimeout(600);
    const chatInput = page.locator('input[placeholder*="اكتب"], textarea').first();
    if (await chatInput.count() > 0) {
      await chatInput.fill('أشعر بألم متقطع وضيق في الصدر مع دوخة خفيفة');
      const sendBtn = page.locator('button[type="submit"], button:has-text("إرسال"), button:has(svg)').last();
      await sendBtn.click();
      await page.waitForTimeout(2000);
    }
    await snap('04-ai-assistant-eve.png', false);
    // close drawer if open
    const closeBtn = page.locator('[aria-label="Close"], button:has-text("إغلاق")').first();
    if (await closeBtn.count() > 0) await closeBtn.click();
  }

  console.log('--- 5. Multi-Role Login ---');
  await page.goto('http://localhost:3000/login');
  await page.waitForTimeout(800);
  await snap('05-multi-role-login.png', true);

  console.log('--- 6. Patient Portal: My Appointments ---');
  await setRole('patient');
  await page.goto('http://localhost:3000/my-appointments');
  await page.waitForTimeout(800);
  await snap('06-patient-appointments.png', true);

  console.log('--- 7. Clinic Owner Dashboard ---');
  await setRole('clinic_owner');
  await page.goto('http://localhost:3000/workspace/dashboard');
  await page.waitForTimeout(1000);
  await snap('07-clinic-owner-dashboard.png', true);

  console.log('--- 8. Reception Workspace: Appointments Queue & Check-In ---');
  await setRole('receptionist');
  await page.goto('http://localhost:3000/workspace/appointments');
  await page.waitForTimeout(800);
  await snap('08-reception-appointments.png', true);

  console.log('--- 9. Doctor Clinical & EMR ---');
  await setRole('doctor');
  await page.goto('http://localhost:3000/workspace/patients');
  await page.waitForTimeout(800);
  await snap('09-doctor-clinical-emr.png', true);

  console.log('--- 10. Doctor Schedule Management ---');
  await page.goto('http://localhost:3000/workspace/schedule');
  await page.waitForTimeout(800);
  await snap('10-doctor-schedule.png', true);

  console.log('--- 11. Clinic Registration Wizard ---');
  await page.goto('http://localhost:3000/register-clinic');
  await page.waitForTimeout(800);
  await snap('11-clinic-registration-wizard.png', true);

  console.log('--- 12. Super Admin Management Console ---');
  await setRole('super_admin');
  await page.goto('http://localhost:3000/admin');
  await page.waitForTimeout(800);
  await snap('12-super-admin-console.png', true);

  console.log('--- 13. Mobile Responsive Viewports ---');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://localhost:3000/');
  await page.waitForTimeout(800);
  await snap('mobile-01-home.png', false);

  await page.goto('http://localhost:3000/search');
  await page.waitForTimeout(800);
  await snap('mobile-02-search.png', false);

  await setRole('clinic_owner');
  await page.goto('http://localhost:3000/workspace/dashboard');
  await page.waitForTimeout(800);
  await snap('mobile-03-dashboard.png', false);

  console.log('All screenshots captured successfully!');
} catch (err) {
  console.error('Error during screenshot capture:', err);
} finally {
  await browser.close();
}
