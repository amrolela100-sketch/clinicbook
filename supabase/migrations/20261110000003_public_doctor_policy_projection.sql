-- Publish the booking policy with each public doctor so anonymous/patient views do not
-- fall back to hard-coded 30-day / 2-hour values for doctors outside their own tenant.
BEGIN;

DROP FUNCTION IF EXISTS public.public_doctor_directory();

CREATE FUNCTION public.public_doctor_directory()
RETURNS TABLE(
  id uuid,
  full_name text,
  title_ar text,
  bio_ar text,
  specialty_id uuid,
  specialty_name text,
  organization_id uuid,
  clinic_id uuid,
  clinic_name text,
  city_name text,
  district text,
  consultation_fee numeric,
  follow_up_fee numeric,
  years_of_experience int,
  rating_avg numeric,
  reviews_count int,
  avatar_url text,
  license_number text,
  booking_horizon_days int,
  cancel_window_hours int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT ON (d.id)
    d.id,
    u.full_name,
    d.title_ar,
    d.bio_ar,
    d.specialty_id,
    s.name_ar AS specialty_name,
    d.organization_id,
    c.id AS clinic_id,
    c.name AS clinic_name,
    ci.name_ar AS city_name,
    c.district,
    d.consultation_fee,
    d.follow_up_fee,
    d.years_of_experience,
    d.rating_avg,
    d.reviews_count,
    u.avatar_url,
    d.license_number,
    sub.booking_horizon_days,
    c.cancel_window_hours
  FROM doctors d
  JOIN users u ON u.id = d.id
  JOIN specialties s ON s.id = d.specialty_id
  JOIN organizations o ON o.id = d.organization_id
  JOIN subscriptions sub ON sub.organization_id = d.organization_id
  LEFT JOIN organization_members om
    ON om.organization_id = d.organization_id
   AND om.user_id = d.id
   AND om.is_active = true
  LEFT JOIN clinics c
    ON c.organization_id = d.organization_id
   AND c.is_active = true
   AND (om.clinic_id IS NULL OR c.id = om.clinic_id)
  LEFT JOIN cities ci ON ci.id = c.city_id
  WHERE d.verification_status = 'approved'
    AND d.is_listed_publicly = true
    AND u.status = 'active'
    AND org_is_bookable(d.organization_id)
  ORDER BY d.id, c.created_at ASC;
$$;

REVOKE ALL ON FUNCTION public.public_doctor_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_doctor_directory() TO anon, authenticated;

COMMIT;
