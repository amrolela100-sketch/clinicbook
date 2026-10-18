-- Adapted from supplied spec. Apply all migrations together.
-- 1. الإضافات الأساسية
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- 2. الأنواع المخصصة (ENUMs)
CREATE TYPE user_role AS ENUM ('super_admin', 'clinic_owner', 'doctor', 'receptionist', 'patient');
CREATE TYPE account_status AS ENUM ('active', 'suspended', 'pending_onboarding');
CREATE TYPE org_Role AS ENUM ('owner', 'doctor', 'receptionist');
CREATE TYPE subscription_tier AS ENUM ('solo_starter', 'clinic_pro', 'enterprise');
CREATE TYPE subscription_status AS ENUM ('trialing', 'active', 'past_due', 'canceled', 'expired');
CREATE TYPE verification_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE appointment_status AS ENUM ('pending', 'confirmed', 'checked_in', 'completed', 'cancelled', 'rejected', 'expired', 'no_show');
CREATE TYPE visit_type AS ENUM ('first_visit', 'follow_up', 'consultation', 'walk_in');
CREATE TYPE booking_source AS ENUM ('patient_portal', 'reception_desk', 'doctor_direct');
CREATE TYPE payment_status AS ENUM ('unpaid', 'paid_cash', 'paid_online', 'refunded');

-- 3. جدول المستخدمين الأساسي (مرتبط مع auth.users)
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  avatar_url TEXT,
  role user_role NOT NULL DEFAULT 'patient',
  status account_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. جدول المدن والتخصصات (البيانات المرجعية للمنصة)
CREATE TABLE public.cities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar TEXT UNIQUE NOT NULL,
  name_en TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Damascus',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.specialties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar TEXT UNIQUE NOT NULL,
  name_en TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  icon_name TEXT NOT NULL DEFAULT 'Stethoscope',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. جدول المؤسسات الطبية (Multi-Tenant Organizations)
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  tax_or_license_number TEXT UNIQUE,
  verification_status verification_status NOT NULL DEFAULT 'pending',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. جدول اشتراكات الـ SaaS (Subscriptions & Billing)
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID UNIQUE NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tier subscription_tier NOT NULL DEFAULT 'solo_starter',
  status subscription_status NOT NULL DEFAULT 'trialing',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  max_doctors INT NOT NULL DEFAULT 1 CHECK (max_doctors >= 1),
  max_clinics INT NOT NULL DEFAULT 1 CHECK (max_clinics >= 1),
  booking_horizon_days INT NOT NULL DEFAULT 30 CHECK (booking_horizon_days BETWEEN 7 AND 365),
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_end TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '14 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. جدول الفروع والعيادات (Clinics)
CREATE TABLE public.clinics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  city_id UUID NOT NULL REFERENCES public.cities(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  district TEXT NOT NULL,
  address TEXT NOT NULL,
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  phone TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Damascus',
  cancel_window_hours INT NOT NULL DEFAULT 2 CHECK (cancel_window_hours BETWEEN 0 AND 72),
  pending_expiry_hours INT NOT NULL DEFAULT 12 CHECK (pending_expiry_hours BETWEEN 1 AND 72),
  min_lead_minutes INT NOT NULL DEFAULT 60 CHECK (min_lead_minutes BETWEEN 15 AND 1440),
  auto_confirm_bookings BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. جدول الأطباء (Doctors)
CREATE TABLE public.doctors (
  id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  specialty_id UUID NOT NULL REFERENCES public.specialties(id) ON DELETE RESTRICT,
  license_number TEXT UNIQUE NOT NULL,
  title_ar TEXT NOT NULL DEFAULT 'طبيب اختصاصي',
  bio_ar TEXT,
  years_of_experience INT NOT NULL DEFAULT 1 CHECK (years_of_experience >= 0),
  consultation_fee NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (consultation_fee >= 0),
  follow_up_fee NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (follow_up_fee >= 0),
  verification_status verification_status NOT NULL DEFAULT 'pending',
  rejection_reason TEXT,
  rating_avg NUMERIC(3,2) NOT NULL DEFAULT 0.00 CHECK (rating_avg BETWEEN 0 AND 5),
  reviews_count INT NOT NULL DEFAULT 0 CHECK (reviews_count >= 0),
  is_listed_publicly BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. جدول أعضاء المؤسسة الطبية وموظفي الاستقبال (Organization Members)
CREATE TABLE public.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  clinic_id UUID REFERENCES public.clinics(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  member_role org_role NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

-- 10. جدول الدوام الأسبوعي للأطباء (Weekly Availability)
CREATE TABLE public.availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  slot_duration_minutes SMALLINT NOT NULL DEFAULT 20 CHECK (slot_duration_minutes IN (10, 15, 20, 30, 45, 60)),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

-- 11. جدول الإجازات والفترات الاستثنائية (Availability Exceptions)
CREATE TABLE public.availability_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  clinic_id UUID REFERENCES public.clinics(id) ON DELETE CASCADE,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);

-- 12. جدول المواعيد والحجوزات (Appointments) مع قيد الاستبعاد الذري
CREATE TABLE public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE RESTRICT,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  patient_id UUID REFERENCES public.users(id) ON DELETE RESTRICT,
  walk_in_patient_name TEXT,
  walk_in_patient_phone TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status appointment_status NOT NULL DEFAULT 'pending',
  visit_type visit_type NOT NULL DEFAULT 'first_visit',
  booking_source booking_source NOT NULL DEFAULT 'patient_portal',
  fee_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  payment_status payment_status NOT NULL DEFAULT 'unpaid',
  expires_at TIMESTAMPTZ,
  patient_notes TEXT,
  cancelled_by UUID REFERENCES public.users(id),
  cancel_reason TEXT,
  checked_in_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_at > start_at),
  CHECK (
    (patient_id IS NOT NULL) OR
    (booking_source IN ('reception_desk', 'doctor_direct') AND walk_in_patient_name IS NOT NULL AND walk_in_patient_phone IS NOT NULL)
  )
);

-- قيد الاستبعاد الذري لمنع الحجز المزدوج نهائياً
ALTER TABLE public.appointments
ADD CONSTRAINT appointment_no_overlap
EXCLUDE USING gist (
  doctor_id WITH =,
  tstzrange(start_at, end_at, '[)') WITH &&
) WHERE (status IN ('pending', 'confirmed', 'checked_in'));

-- 13. جدول السجل الطبي والوصفات المبسط (Clinical Encounter & Prescription EMR)
CREATE TABLE public.medical_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID UNIQUE NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  patient_id UUID REFERENCES public.users(id) ON DELETE RESTRICT,
  chief_complaint TEXT,
  diagnosis TEXT NOT NULL,
  prescription_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  doctor_notes TEXT,
  follow_up_recommended_date DATE,
  is_visible_to_patient BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 14. جدول التقييمات والمراجعات الموثقة (Verified Reviews)
CREATE TABLE public.reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID UNIQUE NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  is_published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 15. جدول الإشعارات وسجل التدقيق (Notifications & Audit Logs)
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  action_url TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 16. الفهارس عالية الأداء (Performance Indexes)
CREATE INDEX idx_appointments_doctor_time ON public.appointments(doctor_id, start_at, end_at);
CREATE INDEX idx_appointments_org_status_time ON public.appointments(organization_id, status, start_at);
CREATE INDEX idx_appointments_patient_active ON public.appointments(patient_id, status, start_at);
CREATE INDEX idx_appointments_pending_expiry ON public.appointments(doctor_id, expires_at) WHERE status = 'pending';
CREATE INDEX idx_doctors_public_search ON public.doctors(specialty_id, verification_status, is_listed_publicly) WHERE verification_status = 'approved' AND is_listed_publicly = true;
CREATE INDEX idx_clinics_city_district ON public.clinics(city_id, district) WHERE is_active = true;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, avatar_url, role, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    'patient',
    'active'
  )
  ON CONFLICT (id) DO UPDATE
  SET full_name = COALESCE(EXCLUDED.full_name, public.users.full_name),
      email = EXCLUDED.email,
      avatar_url = COALESCE(EXCLUDED.avatar_url, public.users.avatar_url),
      updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
