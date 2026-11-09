-- =========================================================================
-- 🩺 ClinicBook SaaS — ملف الترقية والتهيئة الشاملة لقاعدة بيانات Supabase
-- شغّل هذا الملف في Supabase Dashboard -> SQL Editor
-- =========================================================================

-- 1. تفعيل امتداد الاستبعاد الذري لمنع التعارض المزدوج (Zero Double-Booking)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2. إزالة قيد الإلزام عن مهلة الانتهاء للمواعيد المؤكدة
ALTER TABLE public.appointments ALTER COLUMN expires_at DROP NOT NULL;

-- 3. إضافة قيد الاستبعاد الذري لمنع أي تداخل في مواعيد نفس الطبيب
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appointment_no_overlap'
  ) THEN
    ALTER TABLE public.appointments
    ADD CONSTRAINT appointment_no_overlap
    EXCLUDE USING gist (
      doctor_id WITH =,
      tstzrange(start_at, end_at, '[)') WITH &&
    )
    WHERE (status IN ('pending', 'confirmed', 'checked_in'));
  END IF;
END $$;

-- =========================================================================
-- 4. الدوال الذرية وسياسات RLS (create_appointment_atomic,
--    create_staff_appointment_atomic, transition_appointment)
--
-- [تنبيه أمني]: لا تُعرِّف أو تستبدل دوال SECURITY DEFINER هنا بدون فحص auth.uid()
-- ولا تمنح EXECUTE لـ anon على دوال الحجز/الانتقال.
-- المرجع المعتمد والوحيد لتطبيق الدوال الذرية وصلاحيات RLS هو ملفات الترحيل المرتبة:
--   1. supabase/migrations/20261013000001_initial_saas_schema.sql
--   2. supabase/migrations/20261014000002_security_and_atomic_rpcs.sql
--   3. supabase/migrations/20261014000003_public_slots_and_directory.sql
--   4. supabase/migrations/20261014000004_review_aggregate.sql
--   5. supabase/migrations/20261015000005_staff_atomic_and_directory_hardening.sql
-- =========================================================================
