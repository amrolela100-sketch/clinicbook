# 🩺 ClinicBook SaaS — فهرس ملفات خطة المشروع الكاملة (Next.js 15 + Supabase)

تحتوي هذه الحزمة على التوثيق الهندسي والتنفيذي الكامل لمنصة **ClinicBook SaaS**:

1. **`SAAS_ARCHITECTURE_AND_AGENT_SPEC.md` (`agent.md`):**
   - الرؤية الهندسية ونموذج تعدد المستأجرين (Multi-Tenant Organizations & Clinics).
   - مصفوفة الصلاحيات (`super_admin`, `clinic_owner`, `doctor`, `receptionist`, `patient`) وباقات الاشتراك.
   - آلة حالات الموعد وقيد منع التداخل الذري `btree_gist` بحدود `'[)'`.
   - مخطط قاعدة البيانات الكامل (14 جدولاً بـ SQL جاهز للتنفيذ) + الدالة الذرية `create_appointment_atomic` + سياسات `RLS`.
   - خوارزمية محرك الفترات الحية (`Dynamic Slots Engine`) وهيكل مجلدات المشروع.

2. **`SAAS_UI_UX_AND_SCREENS_PLAN.md` (`WORK_PLAN.md`):**
   - نظام التصميم الموحد (Design System)، لوحة الألوان الدلالية، وخطوط `IBM Plex Sans Arabic` و `Inter tabular-nums`.
   - قواعد `shadcn/ui` لدعم الاتجاه العربي (`RTL First`).
   - التوصيف التفصيلي لـ 13 شاشة موزعة على 4 بوابات (بوابة المرضى، مساحة عمل العيادة والملف الطبي EMR، بوابة الاشتراكات والفوترة، ولوحة مالك المنصة).

3. **`SUPERPOWERS_TDD_EXECUTION_PLAN.md` (`IMPLEMENTATION_PLAN.md`):**
   - خطة التنفيذ الهندسية المقسمة إلى 5 مراحل و15 مهمة برمجية صغيرة وفق منهجية `using-superpowers` (`RED ➔ GREEN ➔ REFACTOR`).
   - الكود الكامل الجاهز للتشغيل لسكربت اختبار التزامن الفعلي (`scripts/test-concurrency.ts` لإطلاق 50 طلباً متزامناً).
   - قائمة فحص الجاهزية للإنتاج (Production Readiness Checklist).
