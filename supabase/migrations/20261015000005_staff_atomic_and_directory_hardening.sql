-- =============================================================================
-- Migration: 20261015000005_staff_atomic_and_directory_hardening.sql
-- Hardens booking and public data surfaces:
-- 1. create_staff_appointment_atomic: atomic staff booking with walk-in support
-- 2. public_doctor_directory: expanded public view without user table leakage
-- 3. team_directory: scoped organization member directory for authenticated staff
-- 4. public_reviews: published reviews with masked patient display names
-- =============================================================================

BEGIN;

-- 1. Shared Internal Slot & Tenant Booking Validation Helper (never directly callable via PostgREST)
CREATE OR REPLACE FUNCTION public._validate_booking_slot(
  p_doctor_id uuid,
  p_clinic_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz
)
RETURNS TABLE(
  out_organization_id uuid,
  out_consultation_fee numeric,
  out_follow_up_fee numeric,
  out_auto_confirm_bookings boolean,
  out_pending_expiry_hours int,
  out_expiry_before_start_mins int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  d doctors;
  c clinics;
  s subscriptions;
  v_duration int;
  local_start timestamp;
  local_end timestamp;
BEGIN
  SELECT * INTO d FROM doctors doc
  WHERE doc.id = p_doctor_id AND doc.verification_status = 'approved' AND doc.is_listed_publicly = true;
  IF NOT FOUND OR NOT org_is_bookable(d.organization_id) THEN
    RAISE EXCEPTION 'DOCTOR_OR_ORGANIZATION_UNAVAILABLE' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO c FROM clinics cl
  WHERE cl.id = p_clinic_id AND cl.organization_id = d.organization_id AND cl.is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLINIC_UNAVAILABLE' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO s FROM subscriptions sub WHERE sub.organization_id = d.organization_id;
  IF p_start_at < now() + make_interval(mins => c.min_lead_minutes) THEN
    RAISE EXCEPTION 'SLOT_TOO_SOON' USING ERRCODE = 'P0004';
  END IF;
  IF p_start_at > now() + make_interval(days => s.booking_horizon_days) THEN
    RAISE EXCEPTION 'SLOT_BEYOND_HORIZON' USING ERRCODE = 'P0005';
  END IF;

  local_start := p_start_at AT TIME ZONE c.timezone;
  local_end := p_end_at AT TIME ZONE c.timezone;

  SELECT av.slot_duration_minutes INTO v_duration FROM availability av
  WHERE av.doctor_id = p_doctor_id
    AND av.clinic_id = p_clinic_id
    AND av.is_active = true
    AND av.day_of_week = extract(dow FROM local_start)
    AND local_start::date = local_end::date
    AND local_start::time >= av.start_time
    AND local_end::time <= av.end_time
    AND extract(epoch FROM (p_end_at - p_start_at)) = av.slot_duration_minutes * 60
    AND mod(extract(epoch FROM (local_start::time - av.start_time)), av.slot_duration_minutes * 60) = 0
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SLOT_OUTSIDE_AVAILABILITY' USING ERRCODE = '22023';
  END IF;

  IF EXISTS(
    SELECT 1 FROM availability_exceptions e
    WHERE e.doctor_id = p_doctor_id
      AND (e.clinic_id IS NULL OR e.clinic_id = p_clinic_id)
      AND e.start_at < p_end_at
      AND e.end_at > p_start_at
  ) THEN
    RAISE EXCEPTION 'SLOT_IN_EXCEPTION' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY SELECT
    d.organization_id,
    d.consultation_fee,
    d.follow_up_fee,
    c.auto_confirm_bookings,
    c.pending_expiry_hours,
    c.expiry_before_start_mins;
END;
$$;

REVOKE ALL ON FUNCTION public._validate_booking_slot(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

-- 2. Patient Atomic Booking RPC refactored to use _validate_booking_slot
CREATE OR REPLACE FUNCTION public.create_appointment_atomic(
  p_patient_id uuid,
  p_doctor_id uuid,
  p_clinic_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_visit_type visit_type DEFAULT 'first_visit',
  p_patient_notes text DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slot record;
  a appointments;
  v_status appointment_status;
  expiry timestamptz;
BEGIN
  IF auth.uid() IS NULL OR p_patient_id IS DISTINCT FROM auth.uid() OR current_app_role() <> 'patient' THEN
    RAISE EXCEPTION 'UNAUTHORIZED_PATIENT' USING ERRCODE = '42501';
  END IF;
  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at <= p_start_at OR length(coalesce(p_patient_notes, '')) > 1000 OR p_visit_type = 'walk_in' THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE = '22023';
  END IF;

  -- Patient lock serializes the global three-booking cap; doctor lock serializes schedule validation.
  PERFORM 1 FROM users WHERE id = p_patient_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PATIENT_INACTIVE' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_doctor_id::text, 0));
  UPDATE appointments
  SET status = 'expired', updated_at = now()
  WHERE status = 'pending' AND expires_at <= now() AND (doctor_id = p_doctor_id OR patient_id = p_patient_id);

  SELECT * INTO v_slot FROM public._validate_booking_slot(p_doctor_id, p_clinic_id, p_start_at, p_end_at);

  IF (SELECT count(*) FROM appointments WHERE patient_id = p_patient_id AND status IN ('pending', 'confirmed', 'checked_in') AND end_at > now()) >= 3 THEN
    RAISE EXCEPTION 'MAX_ACTIVE_BOOKINGS_REACHED' USING ERRCODE = 'P0006';
  END IF;

  v_status := CASE WHEN v_slot.out_auto_confirm_bookings THEN 'confirmed'::appointment_status ELSE 'pending'::appointment_status END;
  IF v_status = 'pending' THEN
    expiry := least(
      now() + make_interval(hours => v_slot.out_pending_expiry_hours),
      p_start_at - make_interval(mins => v_slot.out_expiry_before_start_mins)
    );
    IF expiry <= now() THEN
      RAISE EXCEPTION 'HOLD_EXPIRES_IMMEDIATELY' USING ERRCODE = 'P0004';
    END IF;
  END IF;

  INSERT INTO appointments(organization_id, clinic_id, doctor_id, patient_id, start_at, end_at, status, visit_type, booking_source, fee_amount, expires_at, patient_notes)
  VALUES(
    v_slot.out_organization_id,
    p_clinic_id,
    p_doctor_id,
    p_patient_id,
    p_start_at,
    p_end_at,
    v_status,
    p_visit_type,
    'patient_portal',
    CASE WHEN p_visit_type = 'follow_up' THEN v_slot.out_follow_up_fee ELSE v_slot.out_consultation_fee END,
    expiry,
    p_patient_notes
  )
  RETURNING * INTO a;

  INSERT INTO audit_logs(organization_id, actor_id, action, entity_type, entity_id)
  VALUES(v_slot.out_organization_id, auth.uid(), 'appointment.created', 'appointment', a.id);

  RETURN a;
END;
$$;

REVOKE ALL ON FUNCTION public.create_appointment_atomic(uuid, uuid, uuid, timestamptz, timestamptz, visit_type, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_appointment_atomic(uuid, uuid, uuid, timestamptz, timestamptz, visit_type, text) TO authenticated;

-- 3. Staff Atomic Booking RPC (reception desk & doctor direct)
CREATE OR REPLACE FUNCTION public.create_staff_appointment_atomic(
  p_doctor_id uuid,
  p_clinic_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_visit_type visit_type DEFAULT 'first_visit',
  p_patient_id uuid DEFAULT NULL,
  p_walk_in_name text DEFAULT NULL,
  p_walk_in_phone text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role user_role;
  v_doc_org_id uuid;
  v_slot record;
  a appointments;
  p_user users;
  v_resolved_patient_id uuid;
  v_phone_match_count int;
  v_booking_source booking_source;
  v_fee numeric;
BEGIN
  -- Authenticated caller required
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  v_caller_role := current_app_role();
  IF v_caller_role NOT IN ('doctor', 'receptionist', 'clinic_owner') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  -- Validate time range and notes length
  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at <= p_start_at OR length(coalesce(p_notes, '')) > 1000 THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE = '22023';
  END IF;

  -- Look up doctor's organization and verify caller tenant authorization before slot/patient inspection
  SELECT doc.organization_id INTO v_doc_org_id FROM doctors doc WHERE doc.id = p_doctor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DOCTOR_OR_ORGANIZATION_UNAVAILABLE' USING ERRCODE = 'P0002';
  END IF;

  IF v_caller_role = 'clinic_owner' THEN
    IF NOT EXISTS(SELECT 1 FROM organizations o WHERE o.id = v_doc_org_id AND o.owner_id = auth.uid()) THEN
      RAISE EXCEPTION 'TENANT_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  ELSIF v_caller_role = 'doctor' THEN
    IF p_doctor_id <> auth.uid() OR NOT is_org_member(v_doc_org_id) THEN
      RAISE EXCEPTION 'DOCTOR_MISMATCH' USING ERRCODE = '42501';
    END IF;
  ELSIF v_caller_role = 'receptionist' THEN
    IF NOT EXISTS(
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = v_doc_org_id
        AND om.clinic_id = p_clinic_id
        AND om.user_id = auth.uid()
        AND om.is_active = true
        AND om.member_role = 'receptionist'
    ) THEN
      RAISE EXCEPTION 'RECEPTIONIST_CLINIC_MISMATCH' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Validate patient identity safely inside SECURITY DEFINER (users_self RLS hides other users on client):
  -- Match by unique active patient phone ONLY, never by full_name, and never create auth.users rows.
  v_resolved_patient_id := p_patient_id;
  IF v_resolved_patient_id IS NOT NULL THEN
    SELECT * INTO p_user FROM users u WHERE u.id = v_resolved_patient_id AND u.status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PATIENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    IF p_walk_in_phone IS NOT NULL AND length(trim(p_walk_in_phone)) >= 7 THEN
      SELECT count(*)::int, min(u.id::text)::uuid
        INTO v_phone_match_count, v_resolved_patient_id
      FROM users u
      WHERE u.role = 'patient'
        AND u.status = 'active'
        AND u.phone = trim(p_walk_in_phone);
      IF v_phone_match_count <> 1 THEN
        v_resolved_patient_id := NULL;
      END IF;
    END IF;

    IF v_resolved_patient_id IS NULL THEN
      IF p_walk_in_name IS NULL OR length(trim(p_walk_in_name)) < 2 OR p_walk_in_phone IS NULL OR length(trim(p_walk_in_phone)) < 7 THEN
        RAISE EXCEPTION 'WALK_IN_NAME_AND_PHONE_REQUIRED' USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  -- Advisory lock on doctor ID prevents race conditions on schedule slots
  PERFORM pg_advisory_xact_lock(hashtextextended(p_doctor_id::text, 0));

  -- Expire pending holds for this doctor
  UPDATE appointments
  SET status = 'expired', updated_at = now()
  WHERE status = 'pending' AND expires_at <= now() AND doctor_id = p_doctor_id;

  -- Validate organization/doctor/clinic/subscription/lead-time/horizon/working-hours/exceptions via shared helper
  SELECT * INTO v_slot FROM public._validate_booking_slot(p_doctor_id, p_clinic_id, p_start_at, p_end_at);

  v_booking_source := CASE WHEN v_caller_role = 'doctor' THEN 'doctor_direct'::booking_source ELSE 'reception_desk'::booking_source END;
  v_fee := CASE WHEN p_visit_type = 'follow_up' THEN v_slot.out_follow_up_fee ELSE v_slot.out_consultation_fee END;

  -- Insert appointment atomically
  INSERT INTO appointments(
    organization_id,
    clinic_id,
    doctor_id,
    patient_id,
    walk_in_patient_name,
    walk_in_patient_phone,
    start_at,
    end_at,
    status,
    visit_type,
    booking_source,
    fee_amount,
    expires_at,
    patient_notes
  )
  VALUES (
    v_slot.out_organization_id,
    p_clinic_id,
    p_doctor_id,
    v_resolved_patient_id,
    CASE WHEN v_resolved_patient_id IS NULL THEN trim(p_walk_in_name) ELSE NULL END,
    CASE WHEN v_resolved_patient_id IS NULL THEN trim(p_walk_in_phone) ELSE NULL END,
    p_start_at,
    p_end_at,
    'confirmed',
    p_visit_type,
    v_booking_source,
    v_fee,
    NULL,
    p_notes
  )
  RETURNING * INTO a;

  -- Audit log entry
  INSERT INTO audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_slot.out_organization_id,
    auth.uid(),
    'appointment.created',
    'appointment',
    a.id,
    jsonb_build_object('source', v_booking_source, 'staff_role', v_caller_role)
  );

  RETURN a;
END;
$$;

REVOKE ALL ON FUNCTION public.create_staff_appointment_atomic(uuid, uuid, timestamptz, timestamptz, visit_type, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_staff_appointment_atomic(uuid, uuid, timestamptz, timestamptz, visit_type, uuid, text, text, text) TO authenticated;

-- 4. Enhanced Public Doctor Directory (Includes Clinic & Specialty info, ZERO sensitive user columns)
DROP FUNCTION IF EXISTS public.public_doctor_directory();

CREATE OR REPLACE FUNCTION public.public_doctor_directory()
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
  license_number text
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
    d.license_number
  FROM doctors d
  JOIN users u ON u.id = d.id
  JOIN specialties s ON s.id = d.specialty_id
  JOIN organizations o ON o.id = d.organization_id
  LEFT JOIN clinics c ON c.organization_id = d.organization_id AND c.is_active = true
  LEFT JOIN cities ci ON ci.id = c.city_id
  WHERE d.verification_status = 'approved'
    AND d.is_listed_publicly = true
    AND u.status = 'active'
    AND org_is_bookable(d.organization_id)
  ORDER BY d.id, c.created_at ASC;
$$;

REVOKE ALL ON FUNCTION public.public_doctor_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_doctor_directory() TO anon, authenticated;

-- 5. Scoped Organization Team Directory RPC
CREATE OR REPLACE FUNCTION public.team_directory(p_org uuid)
RETURNS TABLE(
  id uuid,
  full_name text,
  email text,
  clinic_id uuid,
  member_role org_role
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT is_org_member(p_org) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.full_name,
    u.email,
    om.clinic_id,
    om.member_role
  FROM organization_members om
  JOIN users u ON u.id = om.user_id
  WHERE om.organization_id = p_org
    AND om.is_active = true;
END;
$$;

REVOKE ALL ON FUNCTION public.team_directory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_directory(uuid) TO authenticated;

-- 6. Public Reviews RPC with Masked Patient Names
CREATE OR REPLACE FUNCTION public.public_reviews(p_doctor_id uuid DEFAULT NULL)
RETURNS TABLE(
  appointment_id uuid,
  doctor_id uuid,
  rating smallint,
  comment text,
  display_name text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    r.appointment_id,
    r.doctor_id,
    r.rating,
    r.comment,
    CASE
      WHEN length(trim(u.full_name)) > 0 THEN
        trim(
          split_part(regexp_replace(trim(u.full_name), '\s+', ' ', 'g'), ' ', 1) ||
          CASE
            WHEN length(split_part(regexp_replace(trim(u.full_name), '\s+', ' ', 'g'), ' ', 2)) > 0 THEN
              ' ' || substr(split_part(regexp_replace(trim(u.full_name), '\s+', ' ', 'g'), ' ', 2), 1, 1) || '.'
            ELSE ''
          END
        )
      ELSE 'مريض'
    END AS display_name,
    r.created_at
  FROM reviews r
  JOIN users u ON u.id = r.patient_id
  JOIN doctors d ON d.id = r.doctor_id
  WHERE r.is_published = true
    AND d.verification_status = 'approved'
    AND d.is_listed_publicly = true
    AND org_is_bookable(d.organization_id)
    AND (p_doctor_id IS NULL OR r.doctor_id = p_doctor_id)
  ORDER BY r.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.public_reviews(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_reviews(uuid) TO anon, authenticated;

-- 7. Tenant Appointments RPC for Authorized Staff (eliminates need for service-role in data path)
CREATE OR REPLACE FUNCTION public.get_tenant_appointments(p_org uuid)
RETURNS TABLE(
  id uuid,
  organization_id uuid,
  clinic_id uuid,
  doctor_id uuid,
  patient_id uuid,
  patient_name text,
  patient_phone text,
  start_at timestamptz,
  end_at timestamptz,
  status appointment_status,
  visit_type visit_type,
  booking_source booking_source,
  fee_amount numeric,
  payment_status payment_status,
  expires_at timestamptz,
  patient_notes text,
  cancel_reason text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT is_org_member(p_org) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.organization_id,
    a.clinic_id,
    a.doctor_id,
    a.patient_id,
    COALESCE(a.walk_in_patient_name, u.full_name, 'مريض') AS patient_name,
    COALESCE(a.walk_in_patient_phone, u.phone, '') AS patient_phone,
    a.start_at,
    a.end_at,
    a.status,
    a.visit_type,
    a.booking_source,
    a.fee_amount,
    a.payment_status,
    a.expires_at,
    a.patient_notes,
    a.cancel_reason,
    a.created_at
  FROM appointments a
  LEFT JOIN users u ON u.id = a.patient_id
  WHERE a.organization_id = p_org
    AND can_read_appointment(a.organization_id, a.clinic_id, a.doctor_id, a.patient_id)
  ORDER BY a.start_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_tenant_appointments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_appointments(uuid) TO authenticated;

-- 8. Authenticated Grants and RLS Policies for Staff Actions (eliminates service-role in runtime requests)
-- Column-level restriction: status & completed_at transitions MUST go through transition_appointment RPC.
GRANT UPDATE(payment_status) ON appointments TO authenticated;
DROP POLICY IF EXISTS staff_appointment_update ON appointments;
CREATE POLICY staff_appointment_update ON appointments
  FOR UPDATE TO authenticated
  USING (
    can_read_appointment(organization_id, clinic_id, doctor_id, patient_id)
    AND current_app_role() IN ('doctor', 'receptionist', 'clinic_owner')
  )
  WITH CHECK (
    can_read_appointment(organization_id, clinic_id, doctor_id, patient_id)
  );

GRANT INSERT ON audit_logs TO authenticated;
DROP POLICY IF EXISTS authenticated_audit_log_insert ON audit_logs;
CREATE POLICY authenticated_audit_log_insert ON audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND organization_id IS NOT NULL
    AND (
      is_org_member(organization_id)
      OR (
        action = 'review.created'
        AND entity_type = 'review'
        AND EXISTS(
          SELECT 1 FROM reviews r
          JOIN appointments a ON a.id = r.appointment_id
          WHERE r.id = entity_id
            AND r.patient_id = auth.uid()
            AND a.organization_id = audit_logs.organization_id
        )
      )
    )
  );

GRANT UPDATE(name) ON organizations TO authenticated;
DROP POLICY IF EXISTS owner_org_settings ON organizations;
CREATE POLICY owner_org_settings ON organizations
  FOR UPDATE TO authenticated
  USING (current_app_role() = 'clinic_owner' AND owner_id = auth.uid())
  WITH CHECK (current_app_role() = 'clinic_owner' AND owner_id = auth.uid());

GRANT INSERT, UPDATE, DELETE ON availability TO authenticated;
DROP POLICY IF EXISTS doctor_owner_availability_all ON availability;
CREATE POLICY doctor_owner_availability_all ON availability
  FOR ALL TO authenticated
  USING (
    EXISTS(
      SELECT 1 FROM doctors d
      WHERE d.id = doctor_id
        AND ((d.id = auth.uid() AND current_app_role() = 'doctor') OR (current_app_role() = 'clinic_owner' AND is_org_member(d.organization_id)))
    )
  )
  WITH CHECK (
    EXISTS(
      SELECT 1 FROM doctors d
      WHERE d.id = doctor_id
        AND ((d.id = auth.uid() AND current_app_role() = 'doctor') OR (current_app_role() = 'clinic_owner' AND is_org_member(d.organization_id)))
    )
  );

GRANT INSERT, DELETE ON availability_exceptions TO authenticated;
DROP POLICY IF EXISTS doctor_owner_exception_all ON availability_exceptions;
CREATE POLICY doctor_owner_exception_all ON availability_exceptions
  FOR ALL TO authenticated
  USING (
    EXISTS(
      SELECT 1 FROM doctors d
      WHERE d.id = doctor_id
        AND ((d.id = auth.uid() AND current_app_role() = 'doctor') OR (current_app_role() = 'clinic_owner' AND is_org_member(d.organization_id)))
    )
  )
  WITH CHECK (
    EXISTS(
      SELECT 1 FROM doctors d
      WHERE d.id = doctor_id
        AND ((d.id = auth.uid() AND current_app_role() = 'doctor') OR (current_app_role() = 'clinic_owner' AND is_org_member(d.organization_id)))
    )
  );

GRANT UPDATE(consultation_fee, follow_up_fee) ON doctors TO authenticated;
DROP POLICY IF EXISTS owner_doctor_fee ON doctors;
CREATE POLICY owner_doctor_fee ON doctors
  FOR UPDATE TO authenticated
  USING (current_app_role() = 'clinic_owner' AND is_org_member(organization_id))
  WITH CHECK (current_app_role() = 'clinic_owner' AND is_org_member(organization_id));

GRANT INSERT ON clinics TO authenticated;
DROP POLICY IF EXISTS owner_clinic_insert ON clinics;
CREATE POLICY owner_clinic_insert ON clinics
  FOR INSERT TO authenticated
  WITH CHECK (current_app_role() = 'clinic_owner' AND is_org_member(organization_id));

COMMIT;


