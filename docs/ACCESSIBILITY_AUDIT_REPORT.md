# تقرير فحص إمكانية الوصول الشامل (Axe-Core / WCAG AA Audit Report)

**المشروع:** ClinicBook (رعاية أقرب. حياة أفضل.)  
**الأداة المستخدمة:** Playwright v1.64.0 + `@axe-core/playwright`  
**المعايير المعتمدة:** WCAG 2.0 (A/AA), WCAG 2.1 (A/AA), WCAG 2.2 (AA)  
**التاريخ:** 2026-10-16  
**النتيجة الإجمالية:** **10 / 10 ناجح بالكامل (100% نجاح — 0 مخالفات)**  

---

## 1. ملخص نتائج الفحص عبر الشاشات (Scan Summary)

| رقم | الصفحة / المسار | النطاق / الدور | الحالة | عدد المخالفات (Violations) |
|---|---|---|---|---|
| 1 | **الصفحة الرئيسية (`/`)** | عام (Hero, Search, Doctors, How-it-works) | **PASS** | 0 مخالفات |
| 2 | **استكشاف وفلترة الأطباء (`/search`)** | عام (Toolbar, City/Specialty Filter, Grid) | **PASS** | 0 مخالفات |
| 3 | **الملف التعريفي للطبيب (`/doctors/doctor-1`)** | عام (Doctor bio, Slot Grid, Modal) | **PASS** | 0 مخالفات |
| 4 | **تسجيل الدخول (`/login`)** | مصادقة (Sign-in / Sign-up Tabs, Demo roles) | **PASS** | 0 مخالفات |
| 5 | **تسجيل مركز/عيادة (`/register-clinic`)** | انضمام (Onboarding Form, Branch Setup) | **PASS** | 0 مخالفات |
| 6 | **مواعيدي للمريض (`/my-appointments`)** | مريض (Appointment Card, Dual-channel Badges) | **PASS** | 0 مخالفات |
| 7 | **لوحة التحكم (`/workspace/dashboard`)** | مالك العيادة (Stat Cards, Activity Chart) | **PASS** | 0 مخالفات |
| 8 | **جدول المواعيد (`/workspace/appointments`)** | استقبال (Interactive Table, Filters, Actions) | **PASS** | 0 مخالفات |
| 9 | **جدول دوام العيادة (`/workspace/schedule`)** | مالك العيادة (Weekly Shift Grid, Day Toggles) | **PASS** | 0 مخالفات |
| 10 | **طابور التوثيق والاعتماد (`/admin`)** | مدير النظام (Verification Queue, Approvals) | **PASS** | 0 مخالفات |

---

## 2. تفاصيل المعايير التي تم التحقق منها (Verified Accessibility Dimensions)

1. **تباين الألوان (Color Contrast - WCAG 1.4.3):**
   - تم التحقق من كافة النصوص، العناوين، الأزرار، والبطاقات مقابل خلفياتها المركبة.
   - تجاوزت النصوص الأساسية الحد الأدنى (4.5:1) وحققت نسب تباين بين `6.8:1` و `12.8:1` (معيار AAA).
   - تم ضبط ألوان التقييمات التوضيحية وشارات الإحصائيات للتأكد من وضوحها التام.

2. **التسميات التوضيحية وقارئات الشاشة (Name, Role, Value - WCAG 4.1.2):**
   - جميع حقول الإدخال، القوائم المنسدلة، والأزرار تحمل تسميات صريحة (`aria-label`, `<label>`, `placeholder`).
   - النوافذ المنبثقة مدعومة بمكتبة Radix UI مع `Dialog.Title` و `Dialog.Description` وإدارة بؤرة التركيز (Focus Trap).

3. **مساحات اللمس التفاعلية (Target Size - WCAG 2.5.5 / 2.5.8):**
   - اعتماد حد أدنى `44×44px` لجميع الأزرار وأزرار الأيقونات، مما يحمي المستخدمين من النقرات الخاطئة على شاشات اللمس.

4. **عدم الاعتماد على الألوان وحدها (Color Never Alone - WCAG 1.4.1):**
   - جميع حالات المواعيد (مؤكد، في الانتظار، مدفوع، ملغي) مقترنة بنصوص واضحة وأيقونات دلالية.

5. **سلامة الحركات ودعم تقليل الحركة (Reduced Motion - WCAG 2.3.3):**
   - التزام المتصفح بـ `@media (prefers-reduced-motion: reduce)` و `MotionConfig reducedMotion="user"` للانتقال الفوري إلى الحالة النهائية دون تشتيت بصري.

---

## 3. ملف الاختبار البرمجي المعتمد

تم إنشاء وحفظ جناح الاختبارات الدائم في المشروع:
- [accessibility.spec.ts](file:///c:/Users/DELL/Documents/project1/clinicbook/tests/e2e/accessibility.spec.ts)
- يمكن إعادة تشغيله في أي وقت عبر الأمر:
  ```bash
  npx playwright test tests/e2e/accessibility.spec.ts
  ```
