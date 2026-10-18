# ⚡ ClinicBook SaaS — خطة التنفيذ الهندسية بمنهجية TDD (`SUPERPOWERS_TDD_EXECUTION_PLAN.md`)

> **منهجية العمل (`using-superpowers`):** تقسيم المشروع إلى مراحل ومهام صغيرة قابلة للتنفيذ والتحقق المستقل (Bite-Sized Tasks)، مع الالتزام الصارم بدورة **RED ➔ GREEN ➔ REFACTOR** (كتابة الاختبار أولاً، التأكد من فشله، كتابة الكود الأدنى لنجاحه، ثم التحسين) وعدم الانتقال لأي مرحلة قبل نجاح أوامر التحقق (`Verification Commands`).

## 1. القواعد الصارمة لسير العمل البرمجي (Superpowers Workflow Rules)

1. **الاختبار يسبق التنفيذ (Test-First Mandate):** لا يُكتب أي منطق لحساب الفترات الزمنية (`Slots Engine`) أو الحجز الذري (`Atomic Booking`) أو صلاحيات المستأجرين (`Multi-Tenant RLS`) قبل كتابة اختبار آلي يثبت السلوك المتوقع.

2. **التحقق الحتمي قبل الإغلاق (Verification Before Completion):** كل مهمة تنتهي بأمر تحقق فعلي في الطرفية (`npm run test:unit`، `npm run test:concurrency`، `npm run typecheck`).

3. **الاستجابة الموحدة (`ActionResult<T>`):** جميع العمليات الخلفية (Server Actions & Service Layer) تلتزم بنمط استجابة موحد لا يسرّب أخطاء قاعدة البيانات الخام للمستخدم:

```
export type ActionResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: string;
      code:
        | 'VALIDATION_ERROR'
        | 'UNAUTHORIZED'
        | 'FORBIDDEN'
        | 'SLOT_CONFLICT'
        | 'SLOT_TOO_SOON'
        | 'MAX_ACTIVE_REACHED'
        | 'SUBSCRIPTION_INACTIVE'
        | 'INTERNAL_ERROR';
    };

```

## 2. خارطة الطريق التنفيذية المقسمة إلى مهام (Bite-Sized TDD Milestones)

### المرحلة 1: تهيئة المشروع، قاعدة البيانات، ونواة منع التداخل (Database & Concurrency Core)

| رقم المهمة | اسم المهمة | المسارات والملفات المستهدفة | خطوات التنفيذ والتحقق (RED ➔ GREEN ➔ VERIFY) | 
| ----- | ----- | ----- | ----- | 
| **Task 1.1** | تهيئة مشروع Next.js 15 وربط Supabase و Vitest | `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/lib/config/constants.ts` | إعداد Next.js App Router مع TypeScript، تثبيت `@supabase/supabase-js`, `@supabase/ssr`, `zod`, `vitest`, `tsx`، وضبط ملف الثوابت الهندسية. **التحقق:** `npm run typecheck`. | 
| **Task 1.2** | بناء مخطط قاعدة البيانات وقيد `btree_gist` ودالة `create_appointment_atomic` | `supabase/migrations/20261013000001_initial_saas_schema.sql` | تنفيذ الجداول الـ 14، تريغر `on_auth_user_created`، قيد `appointment_no_overlap` بحدود `'[)'`، ودالة `create_appointment_atomic` التي تنظف الحجوزات المعلقة المنتهية ذرياً. **التحقق:** `npx supabase db reset`. | 
| **Task 1.3** | كتابة سكربت البذر المتكامل للـ SaaS (`db:seed`) | `scripts/seed.ts` | إنشاء حساب `super_admin`، مركزين طبيين (أحدهما باقة `clinic_pro` والآخر `solo_starter`)، 5 أطباء معتمدين، موظف استقبال، 3 مرضى تجريبيين، وجداول دوام أسبوعية. **التحقق:** `npm run db:seed`. | 
| **Task 1.4** | بناء خدمة الحجز ونقطة النهاية القياسية واختبار التزامن (TDD) | `src/lib/services/booking-service.ts`, `src/app/api/appointments/route.ts`, `scripts/test-concurrency.ts` | **RED:** كتابة `scripts/test-concurrency.ts` لإطلاق 50 طلباً متزامناً (`Promise.all`) لنفس الفترة والتأكد من فشله قبل بناء الخدمة. **GREEN:** تنفيذ `booking-service.ts` وترجمة خطأ PostgreSQL `23P01` إلى `409 Conflict` والنجاح إلى `201 Created`. **التحقق:** `npm run test:concurrency` (النتيجة: `1 Success, 49 Conflicts, Double Booking: 0`). | 

### المرحلة 2: محرك الفترات المتاحة الحية واختبارات الوحدات (Dynamic Slots Engine - TDD)

| رقم المهمة | اسم المهمة | المسارات والملفات المستهدفة | خطوات التنفيذ والتحقق (RED ➔ GREEN ➔ VERIFY) | 
| ----- | ----- | ----- | ----- | 
| **Task 2.1** | كتابة اختبارات شاملة لمحرك الفترات (`Slots Engine Unit Tests`) | `tests/unit/slots-engine.test.ts` | **RED:** كتابة 8 اختبارات تغطي: توليد شرائح 20/30 دقيقة، تحويل توقيت `Asia/Damascus` إلى `UTC`، استبعاد إجازة طارئة، استبعاد حجز `confirmed`، تجاهل حجز `pending` منتهي الصلاحية (`expires_at < now()`)، وتطبيق `min_lead_minutes`. **التحقق:** `npm run test:unit` (يتأكد من فشلها جميعاً). | 
| **Task 2.2** | تنفيذ خوارزمية `getAvailableSlots` النقية | `src/lib/services/slots-engine.ts` | **GREEN:** كتابة الدالة النقية لحساب الفترات المتاحة وتشغيلها مع بيانات PostgreSQL دون تخزين فترات فارغة. **التحقق:** `npm run test:unit` (نجاح 8/8 اختبارات). | 
| **Task 2.3** | اختبار آلة حالات الموعد وقواعد الإلغاء (`State Machine Tests`) | `tests/integration/booking-state.test.ts`, `src/lib/services/appointment-lifecycle.ts` | **RED ➔ GREEN:** اختبار مسارات التحول (`pending -> confirmed`, `confirmed -> cancelled` مع فحص مهلة الساعتين `CANCEL_WINDOW_HOURS`, `confirmed -> completed` بعد بداية الموعد فقط). **التحقق:** `npm run test:unit`. | 

### المرحلة 3: المصادقة، تعدد المستأجرين، وحماية المسارات (Auth, Multi-Tenancy & RBAC)

| رقم المهمة | اسم المهمة | المسارات والملفات المستهدفة | خطوات التنفيذ والتحقق (RED ➔ GREEN ➔ VERIFY) | 
| ----- | ----- | ----- | ----- | 
| **Task 3.1** | إعداد عملاء Supabase (`@supabase/ssr`) ومسار `/auth/callback` | `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/admin.ts`, `src/app/(auth)/auth/callback/route.ts` | إعداد تبادل رمز OAuth بملفات تعريف الارتباط الآمنة، وبناء دالة `getCurrentUserWithOrg()` لجلب دور المستخدم والمؤسسة الطبية التابع لها. **التحقق:** `npm run typecheck`. | 
| **Task 3.2** | بناء حارس المسارات (`middleware.ts`) وفحص الصلاحيات (`Zero IDOR`) | `src/middleware.ts`, `src/lib/auth/guards.ts` | حماية مسارات `/workspace/*` (لأصحاب المراكز والأطباء والاستقبال)، `/admin/*` (لـ `super_admin`)، و`/my-appointments` (للمرضى) مع إعادة التوجيه التلقائي حسب الدور. **التحقق:** اختبار الوصول غير المصرح به. | 
| **Task 3.3** | بناء شاشة الدخول الموحد (`/login`) وتسجيل مركز طبي (`/register-clinic`) | `src/app/(auth)/login/page.tsx`, `src/app/(auth)/register-clinic/page.tsx`, `src/lib/actions/auth-actions.ts` | تنفيذ زر Google OAuth، لوحة الدخول التجريبي السريع للأدوار الخمسة، ومعالج تسجيل مركز طبي جديد بـ 3 خطوات مع إنشاء اشتراك `trialing` لمدة 14 يوماً. **التحقق:** تجربة الدخول والتسجيل كاملة. | 

### المرحلة 4: نظام التصميم وبوابة المرضى والحجز (Patient Marketplace UI)

| رقم المهمة | اسم المهمة | المسارات والملفات المستهدفة | خطوات التنفيذ والتحقق (RED ➔ GREEN ➔ VERIFY) | 
| ----- | ----- | ----- | ----- | 
| **Task 4.1** | تهيئة `shadcn/ui` بدعم RTL والخطوط العربية والألوان الدلالية | `src/app/layout.tsx`, `src/app/globals.css`, `components.json` | تثبيت مكونات `shadcn/ui` عبر CLI، تفعيل `DirectionProvider dir="rtl"`، وتحميل خطي `IBM Plex Sans Arabic` و `Inter` مع كلاس `tabular-nums`. **التحقق:** `npm run build`. | 
| **Task 4.2** | بناء الصفحة الرئيسية (`/`) وشاشة البحث المتقدم (`/search`) | `src/app/(public)/page.tsx`, `src/app/(public)/search/page.tsx`, `src/components/booking/DoctorCard.tsx` | تنفيذ البحث بالتخصص والمدينة والحي، بطاقات الأطباء مع أقرب موعد متاح، الفلاتر، وحالات `Skeleton` و `EmptyState`. | 
| **Task 4.3** | بناء صفحة الطبيب (`/doctors/[id]`) وشبكة الفترات ونافذة التأكيد الذري | `src/app/(public)/doctors/[id]/page.tsx`, `src/components/booking/TimeSlotGrid.tsx`, `src/components/booking/BookingConfirmModal.tsx` | تنفيذ `DaysCarousel` و `TimeSlotGrid` (أزرار `>= 44px`)، نافذة التأكيد مع اختيار نوع الزيارة، والمعالجة البصرية الفورية لحالة `409 Conflict` بإعادة تحديث الشبكة. | 
| **Task 4.4** | بناء لوحة مواعيد المريض والوصفات الطبية والتقييم (`/my-appointments`) | `src/app/(patient)/my-appointments/page.tsx`, `src/components/booking/ReviewModal.tsx` | عرض الحجوزات القادمة مع عداد انتهاء الصلاحية، زر الإلغاء المشروط بـ `cancel_window_hours`، استعراض الوصفة الطبية، ونافذة تقييم الزيارة المكتملة. | 

### المرحلة 5: بوابة عمل العيادة والملف الطبي والفوترة ولوحة المشرف (SaaS Workspace & Admin)

| رقم المهمة | اسم المهمة | المسارات والملفات المستهدفة | خطوات التنفيذ والتحقق (RED ➔ GREEN ➔ VERIFY) | 
| ----- | ----- | ----- | ----- | 
| **Task 5.1** | بناء لوحة طابور العيادة اليومي والحجز المباشر (`/workspace/dashboard`) | `src/app/(workspace)/workspace/dashboard/page.tsx`, `src/components/workspace/LiveQueueBoard.tsx`, `src/components/workspace/WalkInModal.tsx` | عرض الطلبات المعلقة للقبول/الرفض، طابور الانتظار الحي (`Check-in`, `Completed`, `No-Show`)، ونافذة إضافة حجز هاتفي/حضور مباشر لموظف الاستقبال. | 
| **Task 5.2** | بناء محرر الدوام الأسبوعي والإجازات (`/workspace/schedule`) | `src/app/(workspace)/workspace/schedule/page.tsx`, `src/lib/actions/schedule-actions.ts` | محرر أيام الأسبوع بخطوات 15 دقيقة، فحص منع تداخل شفتات الطبيب، وإدارة الإجازات الطارئة مع تنبيه المواعيد المتأثرة. | 
| **Task 5.3** | بناء شاشة المعاينة السريرية والوصفة الطبية (`/workspace/patients/[id]`) | `src/app/(workspace)/workspace/patients/[id]/page.tsx`, `src/components/workspace/PrescriptionForm.tsx` | نموذج كتابة التشخيص وجدول الأدوية الموصوفة وإصدار الوصفة القابلة للطباعة للمريض عند إتمام الزيارة. | 
| **Task 5.4** | بناء شاشات إدارة الفريق والفروع والاشتراك (`/workspace/team` & `/billing`) | `src/app/(workspace)/workspace/team/page.tsx`, `src/app/(workspace)/workspace/billing/page.tsx` | إضافة أطباء وموظفي استقبال ضمن سقف باقة الاشتراك (`max_doctors`, `max_clinics`)، وعرض حالة الاشتراك وترقيته. | 
| **Task 5.5** | بناء لوحة تحكم مالك المنصة (`/admin`) | `src/app/(admin)/admin/page.tsx`, `src/lib/actions/admin-actions.ts` | طابور التحقق من تراخيص الأطباء والمراكز الطبية (`Approve / Reject`)، إدارة المدن والتخصصات، وتفعيل باقات الاشتراك. | 

## 3. الكود الكامل الجاهز للتنفيذ لاختبار التزامن (`scripts/test-concurrency.ts`)

يثبت هذا السكربت عملياً أن قيد `btree_gist` ودالة `create_appointment_atomic` يمنعان الحجز المزدوج بنسبة 100% عند إطلاق 50 طلباً متزامناً في نفس اللحظة:

```
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function runConcurrencyTest() {
  console.log('Starting Real End-to-End 50-Request Concurrency Test...');

  // 1. جلب طبيب معتمد وعيادة نشطة ومرضى اختباريين من قاعدة البيانات
  const { data: doctor, error: docErr } = await supabaseAdmin
    .from('doctors')
    .select('id, organization_id, clinics:organization_id(id)')
    .eq('verification_status', 'approved')
    .limit(1)
    .single();

  if (docErr || !doctor) {
    throw new Error('Failed to load seeded doctor. Run npm run db:seed first.');
  }

  const { data: clinic } = await supabaseAdmin
    .from('clinics')
    .select('id')
    .eq('organization_id', doctor.organization_id)
    .eq('is_active', true)
    .limit(1)
    .single();

  const { data: patients } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('role', 'patient')
    .limit(50);

  if (!clinic || !patients || patients.length === 0) {
    throw new Error('Missing seeded clinic or test patients.');
  }

  // تحديد فترة اختبارية ثابتة بعد 3 أيام الساعة 10:00 صباحاً UTC
  const targetDate = new Date();
  targetDate.setUTCDate(targetDate.getUTCDate() + 3);
  targetDate.setUTCHours(10, 0, 0, 0);
  const startAt = targetDate.toISOString();
  const endAt = new Date(targetDate.getTime() + 30 * 60 * 1000).toISOString();

  // تنظيف أي بيانات اختبار سابقة لنفس الفترة
  await supabaseAdmin
    .from('appointments')
    .delete()
    .eq('doctor_id', doctor.id)
    .eq('start_at', startAt);

  // 2. إطلاق 50 طلب حجز متزامن في نفس اللحظة عبر Promise.all
  const requests = Array.from({ length: 50 }, (_, idx) => {
    const patientId = patients[idx % patients.length].id;
    return fetch(`${APP_URL}/api/appointments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-concurrency-secret': SUPABASE_SERVICE_KEY,
      },
      body: JSON.stringify({
        patient_id: patientId,
        doctor_id: doctor.id,
        clinic_id: clinic.id,
        start_at: startAt,
        end_at: endAt,
        visit_type: 'first_visit',
      }),
    }).then(async (res) => ({
      index: idx + 1,
      status: res.status,
      body: await res.json().catch(() => ({})),
    }));
  });

  const results = await Promise.all(requests);

  // 3. طباعة النتائج الفردية وحساب الإحصائيات
  let successCount = 0;
  let conflictCount = 0;

  for (const r of results) {
    const label = r.status === 201 ? '201 Created' : `${r.status} Conflict`;
    console.log(`[${String(r.index).padStart(2, '0')}] ${label}`);
    if (r.status === 201) successCount++;
    if (r.status === 409) conflictCount++;
  }

  // 4. التحقق المباشر من قاعدة البيانات (Ground Truth Verification)
  const { count: dbCount, error: countErr } = await supabaseAdmin
    .from('appointments')
    .select('*', { count: 'exact', head: true })
    .eq('doctor_id', doctor.id)
    .eq('start_at', startAt)
    .eq('end_at', endAt)
    .in('status', ['pending', 'confirmed', 'checked_in']);

  if (countErr) throw countErr;

  const doubleBookings = Math.max(0, (dbCount ?? 0) - 1);
  const passed = successCount === 1 && conflictCount === 49 && dbCount === 1;

  console.log('\n=========================');
  console.log('CONCURRENCY TEST RESULT');
  console.log('=========================');
  console.log(`Requests:       50`);
  console.log(`Successful:     ${successCount}`);
  console.log(`Conflicts:      ${conflictCount}`);
  console.log(`DB Active Rows: ${dbCount}`);
  console.log(`Double Booking: ${doubleBookings}`);
  console.log(`Result:         ${passed ? 'PASS' : 'FAIL'}`);

  // 5. تنظيف الموعد الاختباري لضمان قابلية التكرار
  await supabaseAdmin
    .from('appointments')
    .delete()
    .eq('doctor_id', doctor.id)
    .eq('start_at', startAt);

  if (!passed) {
    process.exit(1);
  }
}

runConcurrencyTest().catch((err) => {
  console.error('Concurrency Test Failed:', err);
  process.exit(1);
});

```

## 4. قائمة فحص الجاهزية للإنتاج (Production Readiness Checklist)

| الفئة | معيار التحقق الإلزامي | أمر أو طريقة الفحص | 
| ----- | ----- | ----- | 
| **التزامن وسلامة البيانات** | نجاح طلب واحد فقط من أصل 50 طلباً متزامناً لنفس الطبيب والفترة الزمنية. | `npm run test:concurrency` | 
| **اختبارات الوحدات والتكامل** | نجاح جميع اختبارات `Slots Engine` وفروق التوقيت وآلة الحالات. | `npm run test:unit` | 
| **عزل المستأجرين (`RLS`)** | عدم قدرة طبيب أو موظف استقبال في المركز (أ) على قراءة أو تعديل مواعيد المركز (ب). | اختبار تكامل سياسات `RLS` في `tests/integration/rls.test.ts` | 
| **سلامة الأنواع والبناء** | خلو المشروع من أي أخطاء TypeScript أو ESLint وبناء ناجح لـ Next.js. | `npm run typecheck && npm run build` | 
| **معايير الواجهة (`RTL & UX`)** | جميع الأزرار التفاعلية `>= 44px`، الأوقات بخط `tabular-nums`، وعدم وجود أي كلاس اتجاهي غير منطقي. | فحص بصري + مراجعة كلاسات Tailwind | 
