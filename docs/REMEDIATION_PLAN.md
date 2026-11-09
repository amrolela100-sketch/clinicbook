# خطة الإصلاح الهندسي الشاملة — مشروع ClinicBook SaaS

**معرّف الوثيقة:** `CB-REM-2026-01`  
**تاريخ الإعداد:** 2026-11-09  
**المستودع المستهدف:** `amrolela100-sketch/clinicbook`  
**الخط المرجعي الحالي (Baseline):** `main @ f49616b` (`145/145` Vitest، `0` أخطاء TypeScript، بناء Next.js 15.5 ناجح)  
**الهدف الهندسي:** رفع الجاهزية الإنتاجية السحابية من **78% إلى +96%** ودرجة التحكيم الهندسي من **91/100 إلى 98/100** مع ضمان **صفر تراجع (Zero Regressions)** في كافة الاختبارات الحالية.

---

## 1. فلسفة التنفيذ وعقد عدم التراجع (Zero-Regression Contract)

تُنفَّذ كافة الإصلاحات وفق منهجية **الاختبار أولاً (TDD: Red $\rightarrow$ Green $\rightarrow$ Refactor)** على فرع عمل معزول (`fix/fullstack-audit-remediation`)، مع الالتزام الصارم بالقواعد التالية:

1. **عدم كسر التوافق مع الوضع التجريبي (`CLINICBOOK_MODE=demo`):** تبقى كافة شاشات العرض السريع، اختبارات Playwright E2E، ومحرك SQLite تعمل بذات الكفاءة والحتمية.
2. **الحفاظ على العزل السريري الصارم (Zero-Trust PHI Isolation):** يظل `super_admin` و`clinic_owner` و`receptionist` ممنوعين قطعياً من قراءة جدول `medical_records` على مستويي التطبيق وقاعدة البيانات (RLS).
3. **انعدام تسريب صلاحية `service_role` للمسارات الاعتيادية:** تُنفَّذ قراءات وتعديلات المستأجرين عبر دوال PostgreSQL `SECURITY DEFINER` محصنة (`SET search_path = public, pg_temp`) مع تحقق صريح من `auth.uid()` ودور المستخدم.
4. **نظافة سجل المستودع:** لا يُحفظ أي رمز وصول (Token) أو سر بيئي داخل الملفات المتتبعة أو سجل التزامات Git.

---

## 2. مصفوفة الفجوات المرصودة وتصنيف الأولويات

| المعرّف | الأولوية | الطبقة | الخلل المرصود في الشيفرة المصدرية | الملفات والأسطر المتأثرة | المرحلة |
| :--- | :---: | :--- | :--- | :--- | :---: |
| **REM-01** | **P0 حرجة** | Backend / DB | إرجاع `admin: null` و`billingRequests: []` بشكل ثابت في وضع Supabase، وغياب الأطباء قيد المراجعة (`pending`) عن لوحة مالك المركز، مع تنفيذ 9–11 استعلاماً متسلسلاً بدلاً من التوازي | `src/lib/services/supabase-data-service.ts:90-120, 285-487` | المرحلة 1 |
| **REM-02** | **P0 حرجة** | Backend / DB | غياب الذرية في إجراء تسجيل المركز (`onboard`) على Supabase (بقاء دور `clinic_owner` عند فشل الخطوات اللاحقة) ودمج هوية الطبيب الأول بهوية المالك (`id: user.id`) خلافاً لمحرك SQLite | `src/lib/services/supabase-actions-service.ts:68-312` | المرحلة 1 |
| **REM-03** | **P0 حرجة** | Backend / Auth | إنشاء أعضاء الفريق (`team`) بكلمة مرور عشوائية `randomUUID()` دون آلية دعوة بريدية أو رابط تعيين كلمة مرور، وتنفيذ الإدراجات خارج معاملة ذرية موحدة | `src/lib/services/supabase-actions-service.ts:760-1015` | المرحلة 1 |
| **REM-04** | **P1 عالية** | Security / Auth | الاعتماد الاحتياطي على `authUser.user_metadata?.intent_role` (القابل للتعديل من جهة العميل في Supabase) لتعيين دور `clinic_owner` | `src/lib/auth/session.ts:53-60`<br>`src/app/api/session/route.ts:95-145` | المرحلة 2 |
| **REM-05** | **P1 عالية** | Security / Edge | ثقة غير مقيدة بأول عنوان في `x-forwarded-for` داخل `getClientIp()`، وبقاء سياسة CSP في وضع `Report-Only` فقط مع `X-Frame-Options: SAMEORIGIN` متعارض مع `frame-ancestors 'none'` | `src/lib/rate-limit.ts:103-112`<br>`src/middleware.ts:144-160` | المرحلة 2 |
| **REM-06** | **P1 عالية** | AI Agent | تعطّل أداتي المساعد الذكي `get_clinic_summary` و`handle_patient_response` في بيئة الإنتاج السحابية (`UNSUPPORTED_IN_PROD_TOOL`) | `agent/tools/get_clinic_summary.ts:39-53`<br>`agent/tools/handle_patient_response.ts:24-30` | المرحلة 2 |
| **REM-07** | **P1 عالية** | Frontend / Time | تثبيت الإزاحة الزمنية يدوياً `+03:00` عند حساب المواعيد المتأثرة بالإجازات ونقص تبعية `data?.schedules` في خطاف `useEffect` | `src/components/clinical-pages.tsx:50-71` | المرحلة 2 |
| **REM-08** | **P2 متوسطة** | Type Safety | وجود 7 تحويلات نوعية قسرية `as unknown as` نتيجة غياب عقود الأنواع الصريحة لمخطط Supabase ودوال RPC | `src/lib/services/supabase-data-service.ts:93-341`<br>`src/lib/supabase/database.types.ts` (جديد) | المرحلة 3 |
| **REM-09** | **P2 متوسطة** | SEO / SSR | غياب البيانات الوصفية الديناميكية (`generateMetadata`) والبيانات المنظمة (`JSON-LD`) لصفحات الأطباء والبحث العام بسبب مسار `[[...path]]` الموحد | `src/app/[[...path]]/page.tsx:1-81` | المرحلة 3 |
| **REM-10** | **P2 متوسطة** | Maintainability | تضخم ملف `src/app/globals.css` إلى `6,950` سطراً (يولّد تحذير ذاكرة في Webpack أثناء البناء) | `src/app/globals.css`<br>`src/styles/*.css` (جديد) | المرحلة 3 |

---

## 3. التفصيل الهندسي لحزم العمل (Work Packages)

---

### المرحلة الأولى (`Phase 1 — P0`): إغلاق الفجوات السحابية والمعاملات الذرية في Supabase

#### حزمة العمل `REM-01`: استكمال طبقة القراءة السحابية والتوازي في `supabase-data-service.ts`

1. **إضافة ملف ترحيل جديد محصن:** `supabase/migrations/20261109000006_admin_and_tenant_atomic_rpcs.sql` يتضمن:
   - **`public.tenant_doctors_directory(p_org uuid)`:**
     - دالة `SECURITY DEFINER` مع `SET search_path = public, pg_temp`.
     - تتحقق من `auth.uid() IS NOT NULL AND is_org_member(p_org)` وإلا ترفع استثناء `42501 FORBIDDEN`.
     - تُرجع جميع أطباء المؤسسة (بما فيهم ذوو الحالة `pending` أو `rejected`) ليتمكن مالك المركز من إدارة كادره وجداول دوامهم ورسومهم فور إضافتهم.
   - **`public.super_admin_dashboard_data()`:**
     - دالة `SECURITY DEFINER` تتحقق بصرامة من `current_app_role() = 'super_admin'`.
     - تُرجع كائناً مهيكلاً (`JSONB`) يحتوي على:
       1. قائمة المؤسسات الطبية وحالة اشتراكاتها (`organizations` + `subscriptions`).
       2. طابور طلبات التوثيق للمراكز والأطباء (`verifications`).
       3. سجل التدقيق الإداري لآخر 50 عملية (`audit_logs`) **دون أي وصول لجدولي `appointments` أو `medical_records`**.
   - **`public.tenant_billing_requests(p_org uuid)`:**
     - تسترجع طلبات ترقية الباقة المسجلة في `audit_logs` (`action = 'billing.requested'`) للمؤسسة المعنية، مع حساب حالتها (`pending` أو `approved` بناءً على تفعيل الاشتراك اللاحق).
2. **إعادة هيكلة `fetchSupabaseAppData()` في `src/lib/services/supabase-data-service.ts`:**
   - تمرير المستخدم الحالي أو جلبه مرة واحدة فقط لتفادي تكرار استعلامات الجلسة.
   - دمج الاستعلامات المستقلة (`public_doctor_directory`، `cities`، `specialties`، `availability`، `public_reviews`) داخل `Promise.all()` لخفض زمن الاستجابة بأكثر من **60%**.
   - دمج نتائج `tenant_doctors_directory` لأعضاء المؤسسة بحيث تظهر حالة التوثيق الحقيقية (`verified: d.verification_status === 'approved'`).
   - تعبئة حقلي `admin` (عندما `user.role === 'super_admin'`) و`billingRequests` بدلاً من القيم الفارغة الثابتة.

---

#### حزمة العمل `REM-02`: ذرية تسجيل المركز الطبي (`onboard`) ومطابقة السلوك

1. **إنشاء دالة PostgreSQL ذرية `public.onboard_organization_atomic(...)` في ملف الترحيل السادس:**
   - تجمع في معاملة قاعدة بيانات واحدة (Single ACID Transaction):
     1. التحقق من عدم امتلاك المستخدم لمؤسسة مسبقة.
     2. إيجاد أو إنشاء المدينة والتخصص المرجعي بأمان.
     3. ترقية دور المستخدم في `public.users` إلى `clinic_owner`.
     4. إنشاء صفوف `organizations`، `subscriptions`، `clinics`، و`organization_members` (`member_role = 'owner'`).
     5. إذا كان البريد/الهوية للطبيب الأول مطابقاً للمالك يُسجَّل كطبيب مالك، وإذا كان طبيباً مستقلاً يُربط بحسابه المخصص دون طمس اسم مدير المركز.
     6. تدوين الحدث `organization.created` في `audit_logs`.
   - في حال فشل أي خطوة، تتراجع قاعدة البيانات تلقائياً (`ROLLBACK`) عن جميع التغييرات بما فيها ترقية دور المستخدم.
2. **تحديث فرع `case 'onboard'` في `src/lib/services/supabase-actions-service.ts`:**
   - استبدال سلسلة الـ 6 استدعاءات اليدوية ودالة `cleanupOrg()` باستدعاء نظيف وموحد للدالة الذرية مع معالجة أخطاء القيم المكررة (`23505` للبريد أو رقم الترخيص الطبي $\rightarrow$ `409 Conflict`).

---

#### حزمة العمل `REM-03`: تدفق دعوة الكادر الطبي (`team`) الذري

1. **تحديث إنشاء الهوية في `case 'team'` (`src/lib/services/supabase-actions-service.ts`):**
   - استخدام `adminClient.auth.admin.inviteUserByEmail(b.email, { data: { full_name: b.name } })` لإرسال دعوة رسمية لتعيين كلمة المرور عند توفر إعدادات البريد في Supabase، مع مسار احتياطي آمن (`createUser` عند العمل في بيئة اختبار معزولة بدون SMTP).
2. **إنشاء دالة ذرية `public.provision_team_member_atomic(...)`:**
   - تنفذ فحص سقف الباقة (`max_doctors` وقيود `solo_starter`) وإدراج `public.users` و`organization_members` و`doctors` و`audit_logs` في معاملة واحدة مغلقة بقفل على المؤسسة (`FOR UPDATE` على صف `subscriptions`) لمنع تجاوز سقف الأطباء عبر طلبين متزامنين!
   - في حال فشل المعاملة، يُحذف مستخدم `auth.users` المنشأ للتو فقط.

---

### المرحلة الثانية (`Phase 2 — P1`): التصلب الأمني واستكمال الوكيل الذكي في الإنتاج

#### حزمة العمل `REM-04`: سد ثغرة تصعيد الدور عبر `user_metadata.intent_role`

1. **في `src/lib/auth/session.ts` (الأسطر `53–60`):**
   - حذف الاعتماد على `authUser.user_metadata?.intent_role` نهائياً عند استنتاج الدور في `currentUser()`.
   - قراءة الدور حصرياً من جدول `public.users.role`، أو من `authUser.app_metadata?.role` (الذي لا يملك العميل صلاحية تعديله إطلاقاً)، مع افتراض `'patient'` كحد أدنى آمن عند غياب السجل.
2. **في `src/app/api/session/route.ts` (مسار `signup`):**
   - عند التسجيل بنية إنشاء مركز (`intent === 'clinic_owner'`)، يُثبَّت الدور عبر `adminClient` في `public.users` و`app_metadata` خادمياً، أو يُوجَّه المستخدم بعد تأكيد بريده إلى معالج `/register-clinic` الذي يرقّيه رسمياً عبر إجراء `onboard` الذري.
3. **اختبار انحدار أمني جديد:**
   - إضافة اختبار في `tests/unit/security-hardening.test.ts` يحاكي مستخدماً يحمل `user_metadata: { intent_role: 'clinic_owner', role: 'super_admin' }` بينما سجله في `public.users` هو `'patient'`، والتحقق من أن `currentUser()` تُرجع `'patient'` دائماً.

---

#### حزمة العمل `REM-05`: تحصين `getClientIp()` ورؤوس الحماية في `middleware.ts`

1. **في `src/lib/rate-limit.ts`:**
   - تحديث `getClientIp(request)` لفحص الترويسات الموثوقة غير القابلة للتزوير أولاً (`cf-connecting-ip`، `x-vercel-forwarded-for`، `x-real-ip`)، وعند قراءة `x-forwarded-for` يتم أخذ العنوان الموافق لعدد القفزات الموثوقة (`TRUSTED_PROXY_HOPS`، افتراضياً آخر قفزة موثوقة من اليمين أو أول قفزة محققة) مع التحقق من صحة تنسيق العنوان لمنع حقن سلاسل عشوائية لتجاوز Rate Limiter.
2. **في `src/middleware.ts`:**
   - توحيد `X-Frame-Options: DENY` ليتطابق مع `frame-ancestors 'none'`.
   - دعم تفعيل `Content-Security-Policy` الإلزامية في الإنتاج (مع خيار متغير بيئي `CSP_REPORT_ONLY=true` للتشخيص عند الحاجة)، وضبط توجيهات `script-src` و`style-src` بما يتوافق تماماً مع Next.js 15 دون كسر اختبارات Playwright.

---

#### حزمة العمل `REM-06`: تفعيل أدوات المساعد الذكي "Eve" في وضع Supabase

1. **في `agent/tools/get_clinic_summary.ts`:**
   - عند `!demoEnabled()` و`isSupabaseConfigured()`، تستدعي الأداة عميل الخادم `createSupabaseServer()` وتجلب مواعيد المركز عبر `get_tenant_appointments` والأطباء عبر `tenant_doctors_directory` لحساب الإحصائيات اليومية وإيرادات العيادة المتوقعة وتوزيع الضغط على الأطباء بدقة ومع احترام كامل لـ RLS.
2. **في `agent/tools/handle_patient_response.ts`:**
   - عند `!demoEnabled()` و`isSupabaseConfigured()`، تستدعي الأداة `transitionSupabaseAppointment(appointmentId, nextStatus, reason)` لتنفيذ تأكيد الحضور أو الإلغاء عبر دالة `transition_appointment` الذرية في PostgreSQL، بدلاً من إرجاع `UNSUPPORTED_IN_PROD_TOOL`.
3. **تحديث اختبارات الوكيل:**
   - إضافة اختبارات وحدات في `tests/unit/agent-tools.test.ts` تغطي مسار الإنتاج السحابي لكلا الأداتين.

---

#### حزمة العمل `REM-07`: ضبط التوقيت الزمني الديناميكي في `clinical-pages.tsx`

1. **في `src/components/clinical-pages.tsx`:**
   - استبدال `new Date(exStart + '+03:00')` و`new Date(exEnd + '+03:00')` بدالة `fromZonedTime(exStart, timezone)` من مكتبة `date-fns-tz` باستخدام المنطقة الزمنية الفعلية للمركز (`data?.organization?.timezone ?? 'Asia/Damascus'`).
   - تصحيح مصفوفة التبعيات في `useEffect` لضمان تزامن جدول الدوام فور تحديث بيانات التطبيق.

---

### المرحلة الثالثة (`Phase 3 — P2`): الأمان النوعي، تحسين محركات البحث (SEO)، وتفكيك الأنماط

#### حزمة العمل `REM-08`: عقود الأنواع الصريحة لـ Supabase (`database.types.ts`)

1. إنشاء `src/lib/supabase/database.types.ts` يعرّف مخطط الجداول ودوال الـ RPC المعتمدة في المشروع بدقة متناهية.
2. ربط النوع العام `<Database>` بكل من `createSupabaseServer()` و`createSupabaseAdmin()` و`createSupabaseBrowser()`.
3. إزالة التحويلات القسرية `as unknown as` في `src/lib/services/supabase-data-service.ts`.

---

#### حزمة العمل `REM-09`: البيانات الوصفية الديناميكية (`generateMetadata`) وبيانات `JSON-LD` الطبية

1. إضافة دالة `export async function generateMetadata({ params })` في `src/app/[[...path]]/page.tsx`:
   - تخصيص عنوان ووصف الصفحة ووسوم OpenGraph لكل مسار عام (`/search`، `/register-clinic`، `/login`).
   - عند زيارة صفحة طبيب `/doctors/[id]`، يجلب الخادم بيانات الطبيب العامة ويولّد عنواناً ديناميكياً (`د. [الاسم] — [التخصص] في [المدينة] | ClinicBook`) مع وسم `<script type="application/ld+json">` متوافق مع معيار `Schema.org/Physician` لدعم الفهرسة الفورية في محركات البحث.

---

#### حزمة العمل `REM-10`: تفكيك `globals.css` إلى طبقات معيارية نظيفة

1. تقسيم ملف `src/app/globals.css` (6,950 سطراً) إلى وحدات منظمة داخل `src/styles/`:
   - `src/styles/tokens-and-base.css`: المتغيرات اللونية، الخطوط المحلية `@font-face`، والقواعد الأساسية.
   - `src/styles/public-portal.css`: أنماط الصفحة الرئيسية، البحث، وملف الطبيب.
   - `src/styles/workspace-and-clinical.css`: أنماط لوحة المركز، الجداول، السجل الطبي، والطباعة `@media print`.
   - `src/styles/agent-drawer.css`: أنماط المساعد الطبي الذكي والنوافذ المنبثقة.
   - `src/styles/responsive.css`: استعلامات الوسائط `@media` ودعم `prefers-reduced-motion`.
2. استيراد هذه الملفات بالترتيب ذاته داخل `src/app/globals.css` لضمان **تطابق بصري 100%** دون تغيير أي اسم صنف (Class Name) تعتمد عليه المكونات أو اختبارات Playwright.

---

## 4. بوابات التحقق والقبول الإلزامية قبل الرفع (Pre-Push Quality Gates)

لن يتم عمل `git push` لأي التزام إلا بعد اجتياز جميع البوابات الست محلياً بنسبة نجاح **100%**:

```bash
# البوابة 1: فحص تنسيق الشيفرة المصدرية
npx prettier --check .

# البوابة 2: الفحص الساكن الصارم للأنواع (صفر أخطاء)
npm run typecheck

# البوابة 3: اختبارات الوحدات والتكامل والانحدار الأمني (+160 اختباراً)
npm run test:unit

# البوابة 4: بناء الإنتاج المحسّن لـ Next.js 15
npm run build

# البوابة 5: اختبارات النهاية للنهاية والوصولية WCAG 2.1 AA (Playwright + axe-core)
CLINICBOOK_MODE=demo COOKIE_SECURE=false npx playwright test

# البوابة 6: اختبار الترحيلات وسياسات RLS والتزامن على محرك PostgreSQL فعلي (في CI / محلياً)
npm run test:postgres
```

---

## 5. استراتيجية الفروع والالتزامات والرفع الآمن إلى GitHub

### 5.1 تنظيم الالتزامات (Atomic Conventional Commits)
تُقسَّم التعديلات على فرع `fix/fullstack-audit-remediation` إلى التزامات ذرية واضحة يسهل على لجنة التحكيم والمراجعين تتبعها:

1. `feat(supabase): add atomic onboarding/team RPCs and super-admin/tenant read RPCs`
2. `fix(services): wire Supabase admin/billing reads, parallel queries, and atomic actions`
3. `fix(security): drop client-mutable intent_role trust and harden IP/CSP middleware`
4. `feat(agent): enable clinic summary and patient response tools in Supabase mode`
5. `refactor(ui,types): add Supabase Database types, dynamic SEO metadata, and modular CSS`
6. `test(audit): add regression suite for P0/P1 full-stack audit remediations`
7. `docs(plan): add comprehensive full-stack remediation plan`

### 5.2 إرشادات الأمان الخاصة برمز الوصول (GitHub PAT Security Protocol)
عند تزويدنا برمز الوصول لرفع الإصلاحات، يُوصى أمنياً باتباع الممارسة القياسية التالية:

- **نوع الرمز:** `Fine-grained personal access token` من إعدادات GitHub Developer Settings.
- **نطاق المستودعات (Repository Access):** مقيد حصرياً بمستودع `amrolela100-sketch/clinicbook` فقط (`Only select repositories`).
- **الصلاحيات المطلوبة (Repository Permissions):**
  - `Contents`: **Read and write** (لرفع الفرع والالتزامات).
  - `Pull requests`: **Read and write** (لفتح طلب سحب Pull Request رسمي لتشغيل فحوصات GitHub Actions تلقائياً).
  - *(ملاحظة: لا نحتاج صلاحية `Workflows` لأننا لن نمس ملف `.github/workflows/ci.yml` القائم).*
- **مدة الصلاحية:** أقصر مدة متاحة (مثلاً 7 أيام)، مع **إلغاء الرمز (Revoke)** فور إتمام عملية الرفع والدمج بنجاح.
