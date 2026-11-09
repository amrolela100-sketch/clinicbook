# خطة المعالجة الهندسية — المرحلة الثانية (CB-REM-2026-02)

> **تقرير متابعة لجنة التحكيم الأكاديمي وهندسة النظم السحابية (Full-Stack Audit Pass #2)**
> **المستودع:** `amrolela100-sketch/clinicbook`
> **النطاق:** إغلاق الفجوات السريرية والأمنية والبصرية والتشغيلية المكتشفة في الفحص العميق الثاني عبر الوكلاء الأربعة (`REM-V2-01` حتى `REM-V2-06`).

---

## ملخص البنود التنفيذية

| الرمز | الأولوية | المحور الهندسي | التوصيف الفني الدقيق |
| :--- | :---: | :--- | :--- |
| **`REM-V2-01`** | **P0** | السلامة السريرية وبوابة الذكاء الاصطناعي متعددة المزودات | 1. توسيع كاشف الطوارئ `detectEmergency()` بتطبيع صرفي عربي شامل لالتقاط عبارات الاستغاثة الفصحى والعامية (`أنا عم موت`، `ما عم أقدر أتنفس`، `قلبي عم يوجعني`، `اسعفوني`، إلخ) فوراً دون اعتماد على الشبكة.<br>2. ترقية `agentrouter-client.ts` لاكتشاف صفحات حجب `Aliyun WAF` (`<!doctype html>`) بأمان، ودعم بروتوكول `/v1/chat/completions` القياسي (`Groq`، `Gemini`، `OpenRouter`، `OpenAI`) إلى جانب `/v1/responses`.<br>3. بناء محرك فهم محلي ذكي (`buildSmartLocalReply`) يجيب بديناميكية من قاعدة البيانات على أسئلة الهوية، الكشفيات والأسعار، المدن والفروع، وطريقة الحجز، والأعراض بالعامية بدلاً من تكرار رسالة الترحيب الجامدة. |
| **`REM-V2-02`** | **P1** | عزل المستأجرين وتفعيل أدوات الوكيل الذكي | تمرير `organizationId` الخاص بطاقم العيادة إلى `getClinicSummaryTool` (ومطابقته تلقائياً من الجلسة في الوضع التجريبي والإنتاجي لمنع اختلاط إحصائيات المراكز)، وتفعيل أداة `handlePatientResponseTool` لتأكيد أو إلغاء الموعد مباشرة من المحادثة عند ذكر معرّف الموعد. |
| **`REM-V2-03`** | **P1** | طبقات CSS والوصولية البصرية في الوضع الداكن (WCAG 2.1 AA) | معالجة طغيان قواعد العناصر العامة غير المطبّقة (`button`, `input`) في `tokens-and-base.css` على أصناف Tailwind داخل `AgentChatDrawer` عبر نطاق `.agent-drawer-scope` عالي التباين، وإضافة فحص آلي في `tests/e2e/accessibility.spec.ts` تحت `colorScheme: 'dark'`. |
| **`REM-V2-04`** | **P1** | إحكام دفاعات CSRF وتوثيق نطاق روابط البريد | في `src/middleware.ts`: ربط الوثوق بترويسة `x-forwarded-host` بوجود بروكسي موثوق فقط، والتحقق من مطابقة مضيف `Referer` عند غياب `Origin`. وفي `src/app/api/session/route.ts`: اعتماد النطاق الموثوق `NEXT_PUBLIC_APP_URL` أو `request.url` بدلاً من ترويسة `Origin` الخام في `emailRedirectTo`. |
| **`REM-V2-05`** | **P2** | تحصين زناد قاعدة البيانات ونقاط الجاهزية والـ SEO | إضافة الترحيل السابع `20261109000007_harden_auth_trigger_search_path.sql` لضبط `SET search_path = public, pg_temp` على `handle_new_user()`، وإنشاء نقطة الجاهزية التشغيلية `GET /api/health`، وملفَّي الفهرسة القياسيين `src/app/sitemap.ts` و`src/app/robots.ts`. |
| **`REM-V2-06`** | **P2** | حزمة اختبارات الانحدار الشاملة وتوثيق البيئة | تحديث `.env.example` بتوثيق واضح للمفاتيح القياسية الاختيارية (`GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`)، وإضافة حزمة الاختبارات `tests/unit/audit-v2-remediation.test.ts`. |

---

## معايير القبول النهائية (Definition of Done)

1. `npx prettier --check .` بدون أي مخالفة تنسيق.
2. `npm run typecheck` بصفر أخطاء TypeScript.
3. نجاح كامل اختبارات `Vitest` (شاملةً الحزمة الجديدة `audit-v2-remediation.test.ts`).
4. نجاح بناء الإنتاج `npm run build` وتوليد `/api/health` و`/sitemap.xml` و`/robots.txt`.
5. نجاح خطَي GitHub Actions (`Release-Blocking Quality Gates` بما فيه اختبار الوصولية الليلي الجديد + `PostgreSQL 17 RLS & Atomic RPC Verification` شاملاً الترحيل السابع) ثم الدمج الرسمي في `main`.
