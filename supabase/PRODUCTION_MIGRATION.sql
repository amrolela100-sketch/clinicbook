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
      tstzrange(start_at, end_at, '[)') WITH =
    )
    WHERE (status IN ('confirmed', 'checked_in') OR (status = 'pending' AND expires_at > now()));
  END IF;
END $$;

-- 4. دالة الحجز الذري المحدثة (create_appointment_atomic)
CREATE OR REPLACE FUNCTION public.create_appointment_atomic(
  p_patient_id uuid,
  p_doctor_id uuid,
  p_clinic_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_visit_type text DEFAULT 'first_visit',
  p_patient_notes text DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_appt public.appointments;
  v_active_count int;
  v_expires_at timestamptz;
BEGIN
  -- التحقق من صحة المدخلات
  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'INVALID_TIME_RANGE' USING ERRCODE = '22023';
  END IF;

  -- تنظيف الحجوزات المعلقة المنتهية الصلاحية لنفس الطبيب أو المريض
  UPDATE public.appointments
  SET status = 'expired', updated_at = now()
  WHERE status = 'pending' AND expires_at <= now() AND (doctor_id = p_doctor_id OR patient_id = p_patient_id);

  -- فحص سقف الحجوزات النشطة للمريض (الحد الأقصى 3)
  SELECT count(*) INTO v_active_count
  FROM public.appointments
  WHERE patient_id = p_patient_id
    AND status IN ('pending', 'confirmed', 'checked_in')
    AND end_at > now();

  IF v_active_count >= 3 THEN
    RAISE EXCEPTION 'MAX_ACTIVE_BOOKINGS_REACHED' USING ERRCODE = 'P0006';
  END IF;

  -- حساب مهلة انتهاء افتراضية لحماية الجدول
  v_expires_at := least(now() + interval '12 hours', p_start_at - interval '1 hour');

  -- إدراج الموعد ذرياً ومحمياً بقيد btree_gist
  INSERT INTO public.appointments (
    id,
    patient_id,
    doctor_id,
    clinic_id,
    start_at,
    end_at,
    status,
    visit_type,
    expires_at
  )
  VALUES (
    gen_random_uuid(),
    p_patient_id,
    p_doctor_id,
    p_clinic_id,
    p_start_at,
    p_end_at,
    'confirmed',
    p_visit_type,
    v_expires_at
  )
  RETURNING * INTO v_appt;

  RETURN v_appt;
END $$;

GRANT EXECUTE ON FUNCTION public.create_appointment_atomic(uuid, uuid, uuid, timestamptz, timestamptz, text, text) TO authenticated, anon;

-- 5. دالة تغيير حالة الموعد (transition_appointment)
CREATE OR REPLACE FUNCTION public.transition_appointment(
  p_id uuid,
  p_next text,
  p_reason text DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_appt public.appointments;
BEGIN
  SELECT * INTO v_appt FROM public.appointments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPOINTMENT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.appointments
  SET
    status = p_next,
    cancel_reason = CASE WHEN p_next IN ('cancelled', 'rejected') THEN p_reason ELSE cancel_reason END,
    cancelled_by = CASE WHEN p_next IN ('cancelled', 'rejected') THEN auth.uid() ELSE cancelled_by END,
    updated_at = now()
  WHERE id = p_id
  RETURNING * INTO v_appt;

  RETURN v_appt;
END $$;

GRANT EXECUTE ON FUNCTION public.transition_appointment(uuid, text, text) TO authenticated, anon;
