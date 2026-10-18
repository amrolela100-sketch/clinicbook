# اختبار PostgreSQL مستقل

تم التحقق على **PostgreSQL 17.11 محلي**. ملف Supabase يطلب PostgreSQL 16 حسب المواصفات، لكن النسخة 16 وخدمات Auth/Storage/Realtime المستضافة لم تُختبر هنا.

## تحذير
استخدم قاعدة اختبار جديدة يمكن حذفها. **لا تشغّل `tests/postgres/bootstrap.sql` على مشروع Supabase أو قاعدة إنتاج.** ينشئ محاكاة بسيطة لمخطط Auth وأدوار authenticated/anon و`auth.uid()` لأغراض فحص السياسات، لا مصادقة فعلية.

```bash
# عبر مستخدم PostgreSQL إداري محلي:
psql -c "CREATE ROLE clinicbook_test LOGIN SUPERUSER PASSWORD 'local-test-only';"
psql -c 'CREATE DATABASE clinicbook_verify OWNER clinicbook_test;'
export TEST_DATABASE_URL='postgresql://clinicbook_test:local-test-only@127.0.0.1:5432/clinicbook_verify'
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/postgres/bootstrap.sql
for migration in supabase/migrations/*.sql; do
  psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done
npm run test:postgres
```

سر الدخول أعلاه محلي للاختبار فقط، وليس سر إنتاج. مستخدم الاختبار الإداري يجهّز fixtures ويحذفها. **كل استدعاء اختباري فعلي** يعمل داخل معاملة، مع `SET LOCAL ROLE authenticated` وهوية `auth.uid()` منفصلة؛ لا تُجرى عمليات العزل بدور superuser.

## ما يختبره السكربت

- 50 طلب RPC بمرضى مختلفين وبوصلات متزامنة: نجاح واحد، 49 خطأ `23P01`، صف نشط واحد في قاعدة البيانات.
- المريض لا يستطيع تمرير patient_id لمريض آخر.
- الفترات المتجاورة `[start,end)` مسموحة.
- المدة المصطنعة أو البداية خارج شبكة الدوام مرفوضتان.
- `get_available_slots` لا يكشف هوية المرضى ويستبعد الحجوزات النشطة.
- الطبيب يرى مواعيده، وطبيب المؤسسة الأخرى لا يراها.
- الطبيب المعالج والمريض يريان السجل المسموح؛ المالك والاستقبال لا يريانه.
- مستخدم عادي لا يستطيع ترقية دوره.
- تغيير الحالات مقيد بالدور.
- التقييم مرتبط بزيارة مكتملة يملكها المريض.
- سقف 3 حجوزات نشطة يُفرض داخل RPC.

## استخدام المخطط في Supabase لاحقًا

```bash
npx supabase start
npx supabase db reset
```

هذا يتطلب Docker وSupabase CLI. لم يُشغّل هذا الأمر في بيئة التسليم. تطبيق migrations على القاعدة المحلية أعلاه واختبارها بـ psql هو التحقق المنفذ فعليًا.

- `supabase/seed.sql` ينشئ بيانات مرجعية فقط، دون حسابات Auth.
- ثبّت موعد Cron لدالة `expire_pending_appointments()` عبر مشغّل موثوق؛ لا تمنحها للعامة. الحجز الذري ينظف الحجوزات المنتهية فورًا للطبيب/المريض المعنيين.
- لا تُفعّل خدمة ببيانات حقيقية قبل مراجعة سياسات القراءة العامة والأدوار وبيانات العرض.
