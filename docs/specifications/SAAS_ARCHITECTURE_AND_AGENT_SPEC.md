# 🩺 ClinicBook SaaS — المعمارية الهندسية والدليل المرجعي الشامل (`SAAS_ARCHITECTURE_AND_AGENT_SPEC.md`)

> **نوع النظام:** منصة سحابية متعددة المستأجرين (Multi-Tenant Healthcare & Clinic Management SaaS + Patient Marketplace)
> **المكدس التقني (Tech Stack):** Next.js 15 (App Router, TypeScript) + Supabase (PostgreSQL 16, Auth, RLS, Storage, Edge Functions, Realtime) + Tailwind CSS + shadcn/ui + Vitest

## 1. الرؤية الهندسية ونموذج عمل الـ SaaS (SaaS Business & Technical Model)

صُممت منصة **ClinicBook SaaS** لتجمع بين نموذجين متكاملين في منظومة واحدة:

1. **نظام إدارة العيادات والمراكز الطبية السحابي (B2B Multi-Tenant SaaS):** تشترك فيه العيادات الفردية أو المراكز الطبية متعددة الأطباء (Polyclinics) عبر باقات شهرية أو سنوية لإدارة جدول الأطباء، موظفي الاستقبال (Receptionists)، طابور الانتظار الحي، الملف الطبي الإلكتروني المبسط (EMR)، والفوترة.
2. **سوق الحجز المباشر للمرضى (B2C Patient Marketplace):** بوابة عامة تتيح للمرضى البحث عن الأطباء المعتمدين حسب المدينة والحي والتخصص، وحجز المواعيد في **6 نقرات أو أقل** مع ضمان **صفر تعارض في المواعيد (Zero Double-Booking)** على مستوى محرك قاعدة البيانات.

### الثوابت الهندسية الافتراضية (`src/lib/config/constants.ts`)

| الثابت البرمجي | القيمة الافتراضية | قابلية التخصيص لكل عيادة (Tenant Override) | الوصف الهندسي |
| :--- | :--- | :--- | :--- |
| `DEFAULT_CANCEL_WINDOW_HOURS` | `2` ساعة | نعم (`clinics.cancel_window_hours`) | أقل فارق زمني مسموح به للمريض لإلغاء الموعد ذاتياً قبل بدايته. |
| `DEFAULT_PENDING_EXPIRY_HOURS` | `12` ساعة | نعم (`clinics.pending_expiry_hours`) | مهلة تأكيد العيادة/الطبيب للحجز المعلق قبل تحوله تلقائياً إلى `expired`. |
| `DEFAULT_MIN_LEAD_MINUTES` | `60` دقيقة | نعم (`clinics.min_lead_minutes`) | أقل فارق زمني بين لحظة طلب الحجز وبداية الموعد. |
| `PENDING_EXPIRY_BEFORE_START_MINUTES` | `60` دقيقة | نعم (`clinics.expiry_before_start_mins`) | الحد الأدنى قبل بداية الموعد الذي يجب أن ينتهي عنده الحجز المعلق. |
| `DEFAULT_BOOKING_HORIZON_DAYS` | `30` يوماً | نعم (حسب باقة الاشتراك: 30 / 90 / 180 يوماً) | أقصى مدى مستقبلي مسموح به لحجز المواعيد. |
| `MAX_ACTIVE_PER_PATIENT` | `3` حجوزات | ثابت على مستوى المنصة | أقصى عدد حجوزات نشطة (`pending` أو `confirmed`) للمريض الواحد لمنع إغراق الجداول. |
| `DEFAULT_TIMEZONE` | `'Asia/Damascus'` | نعم (`clinics.timezone`) | تُخزن جميع الأوقات في PostgreSQL بصيغة `TIMESTAMPTZ (UTC)` وتُعرض بالتوقيت المحلي للعيادة. |

## 2. معمارية تعدد المستأجرين والصلاحيات (Multi-Tenancy & RBAC Architecture)

تعتمد المنصة نموذج **Shared Database, Shared Schema with Row-Level Security (RLS)** المدعوم بمعرّف المؤسسة الطبية (`organization_id`) لعزل بيانات العيادات والمراكز الطبية بشكل صارم مع إتاحة البحث العام للمرضى في الجداول المسموح بها.

### مصفوفة الأدوار والصلاحيات (Role-Based Access Control)

| الدور (`Role`) | النطاق (`Scope`) | الصلاحيات الأساسية في النظام |
| :--- | :--- | :--- |
| `super_admin` | المنصة بالكامل (Platform Plane) | اعتماد المؤسسات الطبية والأطباء (KYC/License Verification)، إدارة خطط الاشتراك والفوترة، إدارة المدن والأحياء والتخصصات، مراقبة سجل التدقيق العام. |
| `clinic_owner` | المؤسسة الطبية (`organization_id`) | إدارة بيانات المركز/العيادة والفروع، إدارة الاشتراك والفواتير، دعوة الأطباء وموظفي الاستقبال، الاطلاع على التقارير المالية والإحصائية للمركز. |
| `doctor` | العيادة والطبيب (`doctor_id`) | إدارة جدوله الأسبوعي وإجازاته الاستثنائية، قبول/رفض المواعيد، تحديث حالة الزيارة (`completed` / `no_show`)، كتابة الملاحظات الطبية والوصفة (`EMR`). |
| `receptionist` | عيادة محددة (`clinic_id`) | إدارة طابور اليوم، تأكيد/إلغاء حجوزات المرضى، إضافة حجوزات الحضور المباشر أو الهاتف (`Walk-in / Phone Booking`)، تسجيل تحصيل الكشفية النقدية. |
| `patient` | الحساب الشخصي (`patient_id`) | البحث عن الأطباء، حجز المواعيد، إلغاء الموعد ضمن المهلة، استعراض سجل الزيارات والوصفات الطبية، وتقييم الطبيب بعد إتمام الزيارة. |

### باقات الاشتراك للمراكز والعيادات (SaaS Subscription Tiers)

| الباقة | الحد الأقصى للأطباء | الحد الأقصى للفروع | الميزات المتاحة |
| :--- | :--- | :--- | :--- |
| **باقة العيادة الفردية (Solo Starter)** | طبيب واحد | فرع واحد | حجز إلكتروني ذري، محرر دوام أسبوعي، لوحة مواعيد يومية، إشعارات بريد إلكتروني، حتى 30 يوماً أفق حجز. |
| **باقة المركز الطبي (Clinic Pro)** | حتى 10 أطباء | حتى 3 فروع | جميع ميزات Starter + حسابات موظفي استقبال، حجوزات الهاتف/الحضور المباشر، ملف طبي إلكتروني مبسط (EMR & PDF Prescription)، إشعارات WhatsApp/SMS، تقارير مالية. |
| **باقة المستشفيات والمجمعات (Enterprise)** | غير محدود | غير محدود | جميع ميزات Pro + صلاحيات مخصصة، سجل تدقيق متقدم (Audit Logs)، ربط API/Webhooks، دعم فني مخصص. |

## 3. آلة الحالات وقيد منع التداخل الذري (State Machine & Zero Double-Booking)

### 3.1 آلة حالات الموعد (Appointment Finite State Machine)

| الحالة الحالية | الحالة التالية | المنفّذ المسموح له | الشروط الهندسية الصارمة |
| :--- | :--- | :--- | :--- |
| `[*]` (إنشاء جديد) | `pending` | `patient` | الحجز عبر البوابة العامة؛ يحجز الفترة فوراً ويُحسب له `expires_at`. |
| `[*]` (إنشاء مباشر) | `confirmed` | `doctor`, `receptionist` | حجز مباشر من داخل العيادة (`walk_in` أو هاتف) أو عند تفعيل خيار التأكيد التلقائي للعيادة. |
| `pending` | `confirmed` | `doctor`, `receptionist` | قبل حلول وقت `expires_at` وقبل بداية الموعد. |
| `pending` | `rejected` | `doctor`, `receptionist` | يتطلب إدخال سبب الرفض (`cancel_reason`)، ويحرر الفترة فوراً. |
| `pending` | `expired` | `system` (RPC / Cron) | تلقائياً عند تجاوز `expires_at` دون رد؛ يحرر الفترة فوراً. |
| `pending` | `cancelled` | `patient` | متاح في أي وقت قبل تحول الحجز إلى مؤكد؛ يحرر الفترة فوراً. |
| `confirmed` | `cancelled` | `patient`, `doctor`, `receptionist` | للمريض: يشترط أن يكون الوقت المتبقي `>= cancel_window_hours`. للطبيب/الاستقبال: متاح مع ذكر السبب وإشعار المريض. |
| `confirmed` | `checked_in` | `receptionist`, `doctor` | عند وصول المريض فعلياً للعيادة ودخوله طابور الانتظار الحي. |
| `confirmed` / `checked_in` | `completed` | `doctor` | يُسجل بعد وقت بداية الموعد (`now() >= start_at`) حصراً، ويفتح إمكانية التقييم وإصدار الوصفة. |
| `confirmed` | `no_show` | `doctor`, `receptionist` | يُسجل بعد مرور وقت بداية الموعد دون حضور المريض. |

### 3.2 معادلة انتهاء الصلاحية (`expires_at`)

```sql
expires_at = LEAST(
  created_at + (v_pending_expiry_hours || ' hours')::INTERVAL,
  start_at - (v_expiry_before_start_mins || ' minutes')::INTERVAL
)
```

### 3.3 الحل الهندسي الحاسم لمنع الحجز المزدوج (PostgreSQL Exclusion Constraint + Atomic RPC)

لمنع أي ثغرة تزامن (Race Condition) أو تعارض ناتج عن بقاء حجز `pending` منتهي الصلاحية في الجدول، يُعتمد **قيد الاستبعاد الذري `btree_gist`** مقترناً بدالة معاملة ذرية (`create_appointment_atomic`) تنظف الحجوزات المنتهية وتفحص سقف حجوزات المريض داخل نفس الـ Transaction:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.appointments
ADD CONSTRAINT appointment_no_overlap
EXCLUDE USING gist (
  doctor_id WITH =,
  tstzrange(start_at, end_at, '[)') WITH &&
) WHERE (status IN ('pending', 'confirmed', 'checked_in'));
```

> **ملاحظة هندسية مهمة:** استخدام الفترة نصف المفتوحة `'[)'` يضمن أن موعداً ينتهي الساعة `09:30` وموعداً يبدأ الساعة `09:30` لا يُعتبران متداخلين، بينما أي تقاطع فعلي ولو بثانية واحدة لنفس الطبيب يُرفض قطعياً على مستوى نواة PostgreSQL برمز خطأ `23P01` (`exclusion_violation`).

## 4. المخطط الكامل لقاعدة البيانات (Complete Production SQL Schema)

يوضع هذا المخطط في `supabase/migrations/20261013000001_initial_saas_schema.sql`:

```sql
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
```

## 5. الدوال الذرية والتريغرز في قاعدة البيانات (Database Functions & Triggers)

### 5.1 تريغر مزامنة المستخدمين (`on_auth_user_created`)

```sql
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
```

### 5.2 الدالة الذرية لإنشاء الحجز (`create_appointment_atomic`)

تحل هذه الدالة ثلاث مشكلات حرجة داخل معاملة (Transaction) واحدة في PostgreSQL:
1. تحرير أي حجز `pending` انتهت صلاحيته (`expires_at <= now()`) لنفس الطبيب قبل محاولة الإدخال حتى لا يفشل قيد `btree_gist` بالخطأ.
2. قفل صف المريض (`FOR UPDATE`) وفحص عدم تجاوز `MAX_ACTIVE_PER_PATIENT = 3` لمنع تجاوز الحد بطلبات متزامنة.
3. إدراج الموعد الذري والاعتماد على قيد `appointment_no_overlap` لحسم التزامن.

```sql
CREATE OR REPLACE FUNCTION public.create_appointment_atomic(
  p_patient_id UUID,
  p_doctor_id UUID,
  p_clinic_id UUID,
  p_start_at TIMESTAMPTZ,
  p_end_at TIMESTAMPTZ,
  p_visit_type visit_type DEFAULT 'first_visit',
  p_patient_notes TEXT DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_clinic public.clinics%ROWTYPE;
  v_doctor public.doctors%ROWTYPE;
  v_sub public.subscriptions%ROWTYPE;
  v_active_count INT;
  v_fee NUMERIC(10,2);
  v_initial_status appointment_status;
  v_expires_at TIMESTAMPTZ;
  v_new_appointment public.appointments%ROWTYPE;
BEGIN
  -- 1. تنظيف ذري فوري لأي حجز معلق منتهي الصلاحية لنفس الطبيب
  UPDATE public.appointments
  SET status = 'expired', updated_at = now()
  WHERE doctor_id = p_doctor_id
    AND status = 'pending'
    AND expires_at IS NOT NULL
    AND expires_at <= now();

  -- 2. التحقق من صلاحية الطبيب والعيادة واشتراك الـ SaaS
  SELECT * INTO v_doctor FROM public.doctors
  WHERE id = p_doctor_id AND verification_status = 'approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DOCTOR_NOT_AVAILABLE' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_clinic FROM public.clinics
  WHERE id = p_clinic_id AND organization_id = v_doctor.organization_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLINIC_NOT_ACTIVE' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions
  WHERE organization_id = v_doctor.organization_id AND status IN ('trialing', 'active');
  IF NOT FOUND OR v_sub.current_period_end < now() THEN
    RAISE EXCEPTION 'ORGANIZATION_SUBSCRIPTION_INACTIVE' USING ERRCODE = 'P0003';
  END IF;

  -- 3. التحقق من النطاق الزمني المسموح للحجز
  IF p_start_at < (now() + (v_clinic.min_lead_minutes || ' minutes')::INTERVAL) THEN
    RAISE EXCEPTION 'SLOT_TOO_SOON' USING ERRCODE = 'P0004';
  END IF;

  IF p_start_at > (now() + (v_sub.booking_horizon_days || ' days')::INTERVAL) THEN
    RAISE EXCEPTION 'SLOT_BEYOND_HORIZON' USING ERRCODE = 'P0005';
  END IF;

  -- 4. قفل سجل المريض لمنع تخطي سقف الحجوزات النشطة بالتزامن
  PERFORM 1 FROM public.users WHERE id = p_patient_id FOR UPDATE;

  SELECT COUNT(*) INTO v_active_count
  FROM public.appointments
  WHERE patient_id = p_patient_id
    AND status IN ('pending', 'confirmed', 'checked_in')
    AND end_at > now();

  IF v_active_count >= 3 THEN
    RAISE EXCEPTION 'MAX_ACTIVE_BOOKINGS_REACHED' USING ERRCODE = 'P0006';
  END IF;

  -- 5. حساب الرسوم والحالة الابتدائية ومهلة الانتهاء
  v_fee := CASE WHEN p_visit_type = 'follow_up' THEN v_doctor.follow_up_fee ELSE v_doctor.consultation_fee END;
  v_initial_status := CASE WHEN v_clinic.auto_confirm_bookings THEN 'confirmed'::appointment_status ELSE 'pending'::appointment_status END;

  IF v_initial_status = 'pending' THEN
    v_expires_at := LEAST(
      now() + (v_clinic.pending_expiry_hours || ' hours')::INTERVAL,
      p_start_at - INTERVAL '60 minutes'
    );
  ELSE
    v_expires_at := NULL;
  END IF;

  -- 6. الإدراج الذري (يحسم قيد appointment_no_overlap أي تداخل برمز 23P01)
  INSERT INTO public.appointments (
    organization_id, clinic_id, doctor_id, patient_id,
    start_at, end_at, status, visit_type, booking_source,
    fee_amount, expires_at, patient_notes
  )
  VALUES (
    v_doctor.organization_id, p_clinic_id, p_doctor_id, p_patient_id,
    p_start_at, p_end_at, v_initial_status, p_visit_type, 'patient_portal',
    v_fee, v_expires_at, p_patient_notes
  )
  RETURNING * INTO v_new_appointment;

  RETURN v_new_appointment;
END;
$$;
```

## 6. سياسات أمن الصفوف وعزل المستأجرين (Row-Level Security Policies)

```sql
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_records ENABLE ROW LEVEL SECURITY;

-- دالة مساعدة لفحص انتماء المستخدم للمؤسسة الطبية
CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = p_org_id AND user_id = auth.uid() AND is_active = true
  ) OR EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = p_org_id AND owner_id = auth.uid()
  );
$$;

-- قراءة الأطباء والعيادات المعتمدة متاحة للجميع (سوق المرضى)
CREATE POLICY "Public can view approved doctors" ON public.doctors
  FOR SELECT USING (verification_status = 'approved' AND is_listed_publicly = true);

CREATE POLICY "Public can view active clinics" ON public.clinics
  FOR SELECT USING (is_active = true);

-- سياسات المواعيد: المريض يرى مواعيده، وأعضاء المؤسسة الطبية يرون مواعيد مؤسستهم
CREATE POLICY "Patients view own appointments" ON public.appointments
  FOR SELECT USING (patient_id = auth.uid());

CREATE POLICY "Org members view org appointments" ON public.appointments
  FOR SELECT USING (public.is_org_member(organization_id));

-- سياسات السجلات الطبية: الطبيب المعالج أو المريض نفسه فقط
CREATE POLICY "Patients view own visible medical records" ON public.medical_records
  FOR SELECT USING (patient_id = auth.uid() AND is_visible_to_patient = true);

CREATE POLICY "Doctors manage org medical records" ON public.medical_records
  FOR ALL USING (public.is_org_member(organization_id));
```

## 7. خوارزمية محرك الفترات المتاحة الحية (`src/lib/services/slots-engine.ts`)

لا تُخزن أي فترات فارغة في قاعدة البيانات؛ بل تُحسب لحظياً لكل طبيب وتاريخ وفق الخطوات الخمس التالية:

1. **التحويل الزمني الدقيق (`Timezone Normalization`):** تحويل التاريخ المطلوب (`YYYY-MM-DD`) مع `start_time` و `end_time` من جدول `availability` باستخدام المنطقة الزمنية للعيادة (`clinics.timezone` مثل `Asia/Damascus`) إلى طوابع زمنية `UTC` دقيقة.
2. **توليد الشرائح (`Slot Slicing`):** تقسيم فترة الدوام إلى شرائح بطول `slot_duration_minutes` (مثلاً 20 دقيقة) بحيث تكون كل شريحة `[slotStart, slotEnd)`.
3. **استبعاد الإجازات الاستثنائية (`Exception Filtering`):** حذف أي شريحة تتقاطع (`slotStart < ex.end_at && slotEnd > ex.start_at`) مع سجل في `availability_exceptions`.
4. **استبعاد الحجوزات الفعالة (`Active Bookings Filtering`):** استبعاد أي شريحة تتقاطع مع حجز في `appointments` يحمل حالة `confirmed` أو `checked_in`، أو حالة `pending` بشرط `expires_at > now()`.
5. **تطبيق قيود الأفق الزمني (`Lead Time & Horizon`):** استبعاد أي شريحة تبدأ قبل `now() + min_lead_minutes` أو بعد `now() + booking_horizon_days`.

## 8. هيكل مجلدات المشروع القياسي (Next.js 15 App Router Structure)

```text
clinicbook-saas/
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   │   └── 20261013000001_initial_saas_schema.sql
│   └── seed.sql
├── scripts/
│   ├── seed.ts                        # تهيئة بيانات الـ SaaS (مشرف، مراكز طبية، أطباء، مرضى)
│   └── test-concurrency.ts            # اختبار التزامن الفعلي (50 طلب متزامن -> 1 نجاح و49 تعارض)
├── src/
│   ├── app/
│   │   ├── (public)/                  # بوابة المرضى العامة (SSR + ISR)
│   │   │   ├── page.tsx               # الصفحة الرئيسية ومحرك البحث السريع
│   │   │   ├── search/page.tsx        # البحث المتقدم والتصفية
│   │   │   └── doctors/[id]/page.tsx  # ملف الطبيب وشبكة الفترات التفاعلية
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx         # Google OAuth + الدخول السريع التجريبي
│   │   │   ├── register-clinic/page.tsx # تسجيل مركز طبي جديد في الـ SaaS (Onboarding)
│   │   │   └── auth/callback/route.ts # تبادل رمز OAuth وتثبيت الجلسة
│   │   ├── (patient)/
│   │   │   └── my-appointments/page.tsx # مواعيد المريض، الإلغاء، الوصفات الطبية، التقييم
│   │   ├── (workspace)/               # بوابة الـ SaaS للعيادات (Owner / Doctor / Receptionist)
│   │   │   ├── workspace/dashboard/page.tsx   # طابور اليوم والطلبات المعلقة والإحصائيات
│   │   │   ├── workspace/schedule/page.tsx    # محرر الدوام الأسبوعي والإجازات الاستثنائية
│   │   │   ├── workspace/patients/[id]/page.tsx # السجل الطبي والوصفة الإلكترونية (EMR)
│   │   │   ├── workspace/team/page.tsx        # إدارة الأطباء وموظفي الاستقبال والفروع
│   │   │   └── workspace/billing/page.tsx     # إدارة باقة الاشتراك والفواتير
│   │   ├── (admin)/
│   │   │   └── admin/page.tsx         # لوحة مالك المنصة (اعتماد المراكز والأطباء، إدارة الاشتراكات)
│   │   └── api/
│   │       ├── appointments/route.ts  # نقطة النهاية القياسية للحجز (تُرجع 201 و 409)
│   │       └── webhooks/stripe/route.ts # معالجة تجديد الاشتراكات تلقائياً
│   ├── components/
│   │   ├── ui/                        # مكونات shadcn/ui مضبوطة لدعم RTL
│   │   ├── booking/                   # TimeSlotGrid, BookingModal, DaysCarousel
│   │   ├── workspace/                 # QueueBoard, ScheduleEditor, PrescriptionForm
│   │   └── layout/                    # Navbar, Sidebar, EmptyState, ErrorState
│   ├── lib/
│   │   ├── config/constants.ts
│   │   ├── supabase/                  # client.ts, server.ts, admin.ts, middleware.ts
│   │   ├── services/                  # slots-engine.ts, booking-service.ts, billing-service.ts
│   │   └── validations/               # Zod schemas لجميع المدخلات
│   └── types/
│       └── database.types.ts          # الأنواع المولدة من Supabase
└── tests/
    ├── unit/slots-engine.test.ts      # اختبارات خوارزمية الفترات وفروق التوقيت
    └── integration/booking.test.ts    # اختبارات آلة الحالات والقيود
```
