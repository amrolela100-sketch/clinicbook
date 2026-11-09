-- =============================================================================
-- Migration: 20261109000006_admin_and_tenant_atomic_rpcs.sql
-- Full-Stack Audit Remediations (REM-01, REM-02, REM-03):
-- 1. tenant_doctors_directory: returns all tenant doctors (including pending) for org members
-- 2. tenant_billing_requests: returns tenant tier upgrade requests from audit_logs
-- 3. super_admin_dashboard_data: returns governance snapshot with ZERO PHI/EMR/appointment access
-- 4. onboard_organization_atomic: single-transaction tenant, clinic, subscription & doctor setup
-- 5. provision_team_member_atomic: serialized subscription-locked staff provisioning
-- =============================================================================

BEGIN;

-- 1. Scoped Tenant Doctors Directory (includes pending/rejected doctors for clinic management)
CREATE OR REPLACE FUNCTION public.tenant_doctors_directory(p_org uuid)
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
  verification_status verification_status,
  is_listed_publicly boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL OR NOT is_org_member(p_org) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
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
    d.verification_status,
    d.is_listed_publicly
  FROM doctors d
  JOIN users u ON u.id = d.id
  JOIN specialties s ON s.id = d.specialty_id
  LEFT JOIN organization_members om
    ON om.organization_id = d.organization_id
   AND om.user_id = d.id
   AND om.is_active = true
  LEFT JOIN clinics c
    ON c.organization_id = d.organization_id
   AND (om.clinic_id IS NULL OR c.id = om.clinic_id)
  LEFT JOIN cities ci ON ci.id = c.city_id
  WHERE d.organization_id = p_org
  ORDER BY d.id, c.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.tenant_doctors_directory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_doctors_directory(uuid) TO authenticated;

-- 2. Scoped Tenant Billing Requests RPC
CREATE OR REPLACE FUNCTION public.tenant_billing_requests(p_org uuid)
RETURNS TABLE(
  id uuid,
  tier text,
  status text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL OR NOT is_org_member(p_org) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    al.id,
    COALESCE(al.metadata->>'requested_tier', 'clinic_pro') AS tier,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM audit_logs act
        WHERE act.organization_id = p_org
          AND act.action = 'subscription.activated'
          AND act.created_at >= al.created_at
      ) THEN 'approved'
      ELSE 'pending'
    END AS status,
    al.created_at
  FROM audit_logs al
  WHERE al.organization_id = p_org
    AND al.action = 'billing.requested'
  ORDER BY al.created_at DESC
  LIMIT 20;
END;
$$;

REVOKE ALL ON FUNCTION public.tenant_billing_requests(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_billing_requests(uuid) TO authenticated;

-- 3. Super Admin Governance Snapshot RPC (Strictly zero PHI / EMR / Appointment access)
CREATE OR REPLACE FUNCTION public.super_admin_dashboard_data()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_orgs jsonb;
  v_verifications jsonb;
  v_references jsonb;
  v_audit jsonb;
BEGIN
  IF auth.uid() IS NULL OR current_app_role() <> 'super_admin' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(org_row)), '[]'::jsonb)
  INTO v_orgs
  FROM (
    SELECT
      o.id,
      o.name,
      COALESCE(ci.name_ar, 'دمشق') AS city,
      COALESCE(cl.district, 'وسط المدينة') AS district,
      COALESCE(cl.phone, '—') AS phone,
      COALESCE(o.tax_or_license_number, '—') AS license,
      COALESCE(s.tier::text, 'solo_starter') AS tier,
      o.verification_status::text AS status,
      COALESCE(s.status::text, 'trialing') AS "subscriptionStatus",
      COALESCE(s.current_period_end, now() + interval '14 days') AS "periodEnd",
      COALESCE(cl.cancel_window_hours, 2) AS "cancelHours",
      COALESCE(cl.min_lead_minutes, 60) AS "leadMinutes",
      COALESCE(cl.pending_expiry_hours, 12) AS "pendingHours",
      COALESCE(cl.expiry_before_start_mins, 60) AS "expiryMinutes",
      COALESCE(cl.timezone, 'Asia/Damascus') AS timezone
    FROM organizations o
    LEFT JOIN subscriptions s ON s.organization_id = o.id
    LEFT JOIN LATERAL (
      SELECT c.*
      FROM clinics c
      WHERE c.organization_id = o.id
      ORDER BY c.created_at ASC
      LIMIT 1
    ) cl ON true
    LEFT JOIN cities ci ON ci.id = cl.city_id
    ORDER BY o.created_at DESC
  ) org_row;

  SELECT COALESCE(jsonb_agg(row_to_json(ver_row)), '[]'::jsonb)
  INTO v_verifications
  FROM (
    SELECT
      o.id,
      o.name,
      'مركز طبي'::text AS type,
      COALESCE(ci.name_ar, 'دمشق') AS city,
      COALESCE(o.tax_or_license_number, '—') AS license,
      o.verification_status::text AS status,
      o.created_at
    FROM organizations o
    LEFT JOIN LATERAL (
      SELECT c.city_id
      FROM clinics c
      WHERE c.organization_id = o.id
      ORDER BY c.created_at ASC
      LIMIT 1
    ) cl ON true
    LEFT JOIN cities ci ON ci.id = cl.city_id
    UNION ALL
    SELECT
      d.id,
      u.full_name AS name,
      d.title_ar AS type,
      COALESCE(ci2.name_ar, 'دمشق') AS city,
      d.license_number AS license,
      d.verification_status::text AS status,
      d.created_at
    FROM doctors d
    JOIN users u ON u.id = d.id
    LEFT JOIN LATERAL (
      SELECT c2.city_id
      FROM clinics c2
      WHERE c2.organization_id = d.organization_id
      ORDER BY c2.created_at ASC
      LIMIT 1
    ) cl2 ON true
    LEFT JOIN cities ci2 ON ci2.id = cl2.city_id
    ORDER BY created_at DESC
  ) ver_row;

  SELECT COALESCE(jsonb_agg(row_to_json(ref_row)), '[]'::jsonb)
  INTO v_references
  FROM (
    SELECT c.id, c.name_ar AS name, 'city'::text AS type
    FROM cities c
    WHERE c.is_active = true
    UNION ALL
    SELECT sp.id, sp.name_ar AS name, 'specialty'::text AS type
    FROM specialties sp
    WHERE sp.is_active = true
  ) ref_row;

  SELECT COALESCE(jsonb_agg(row_to_json(aud_row)), '[]'::jsonb)
  INTO v_audit
  FROM (
    SELECT
      al.id,
      al.action,
      al.created_at,
      COALESCE(al.entity_id::text, '') AS entity_id
    FROM audit_logs al
    ORDER BY al.created_at DESC
    LIMIT 30
  ) aud_row;

  RETURN jsonb_build_object(
    'organizations', v_orgs,
    'verifications', v_verifications,
    'references', v_references,
    'audit', v_audit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.super_admin_dashboard_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.super_admin_dashboard_data() TO authenticated;

-- 4. Atomic Organization Onboarding RPC
CREATE OR REPLACE FUNCTION public.onboard_organization_atomic(
  p_owner_id uuid,
  p_owner_email text,
  p_owner_name text,
  p_org_name text,
  p_city_name text,
  p_district text,
  p_phone text,
  p_license text,
  p_tier subscription_tier,
  p_doctor_user_id uuid DEFAULT NULL,
  p_doctor_email text DEFAULT NULL,
  p_doctor_name text DEFAULT NULL
)
RETURNS TABLE(organization_id uuid, clinic_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_city_id uuid;
  v_spec_id uuid;
  v_org_id uuid := gen_random_uuid();
  v_clinic_id uuid := gen_random_uuid();
  v_doc_id uuid := COALESCE(p_doctor_user_id, p_owner_id);
  v_org_slug text;
  v_clinic_slug text;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_owner_id THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM organizations o WHERE o.owner_id = p_owner_id
    UNION ALL
    SELECT 1 FROM organization_members om WHERE om.user_id = p_owner_id AND om.is_active = true
  ) THEN
    RAISE EXCEPTION 'ALREADY_ONBOARDED' USING ERRCODE = '23505';
  END IF;

  -- Resolve or create city
  SELECT c.id INTO v_city_id
  FROM cities c
  WHERE c.name_ar = trim(p_city_name) OR lower(c.name_en) = lower(trim(p_city_name))
  LIMIT 1;

  IF v_city_id IS NULL THEN
    v_city_id := gen_random_uuid();
    INSERT INTO cities(id, name_ar, name_en, slug, timezone, is_active)
    VALUES (
      v_city_id,
      trim(p_city_name),
      trim(p_city_name) || '-' || substr(v_city_id::text, 1, 6),
      'city-' || substr(v_city_id::text, 1, 8),
      'Asia/Damascus',
      true
    );
  END IF;

  -- Resolve or create default specialty (General Medicine)
  SELECT sp.id INTO v_spec_id
  FROM specialties sp
  WHERE sp.name_ar = 'الطب العام' OR sp.slug = 'general'
  LIMIT 1;

  IF v_spec_id IS NULL THEN
    SELECT sp.id INTO v_spec_id FROM specialties sp LIMIT 1;
  END IF;

  IF v_spec_id IS NULL THEN
    v_spec_id := gen_random_uuid();
    INSERT INTO specialties(id, name_ar, name_en, slug, icon_name, is_active)
    VALUES (
      v_spec_id,
      'الطب العام',
      'General Medicine ' || substr(v_spec_id::text, 1, 6),
      'general-' || substr(v_spec_id::text, 1, 8),
      'Stethoscope',
      true
    );
  END IF;

  -- Upsert owner profile atomically
  INSERT INTO users(id, email, full_name, phone, role, status, updated_at)
  VALUES (p_owner_id, trim(p_owner_email), trim(p_owner_name), trim(p_phone), 'clinic_owner', 'active', now())
  ON CONFLICT (id) DO UPDATE
  SET role = 'clinic_owner',
      full_name = COALESCE(NULLIF(trim(p_owner_name), ''), users.full_name),
      phone = COALESCE(NULLIF(trim(p_phone), ''), users.phone),
      status = 'active',
      updated_at = now();

  v_org_slug := 'org-' || substr(v_org_id::text, 1, 12);
  v_clinic_slug := 'clinic-' || substr(v_clinic_id::text, 1, 12);

  INSERT INTO organizations(id, name, slug, owner_id, tax_or_license_number, verification_status, is_active)
  VALUES (v_org_id, trim(p_org_name), v_org_slug, p_owner_id, trim(p_license), 'pending', true);

  INSERT INTO subscriptions(
    organization_id,
    tier,
    status,
    max_doctors,
    max_clinics,
    booking_horizon_days,
    current_period_start,
    current_period_end
  )
  VALUES (
    v_org_id,
    p_tier,
    'trialing',
    CASE WHEN p_tier = 'clinic_pro' THEN 10 ELSE 1 END,
    CASE WHEN p_tier = 'clinic_pro' THEN 3 ELSE 1 END,
    CASE WHEN p_tier = 'clinic_pro' THEN 90 ELSE 30 END,
    now(),
    now() + interval '14 days'
  );

  INSERT INTO clinics(
    id,
    organization_id,
    city_id,
    name,
    slug,
    district,
    address,
    phone,
    timezone,
    cancel_window_hours,
    pending_expiry_hours,
    min_lead_minutes,
    auto_confirm_bookings,
    is_active
  )
  VALUES (
    v_clinic_id,
    v_org_id,
    v_city_id,
    'الفرع الرئيسي',
    v_clinic_slug,
    trim(p_district),
    trim(p_district),
    trim(p_phone),
    'Asia/Damascus',
    2,
    12,
    60,
    false,
    true
  );

  INSERT INTO organization_members(organization_id, clinic_id, user_id, member_role, is_active)
  VALUES (v_org_id, v_clinic_id, p_owner_id, 'owner', true);

  -- If an independent initial doctor account was supplied, upsert its user & membership cleanly
  IF v_doc_id <> p_owner_id THEN
    INSERT INTO users(id, email, full_name, role, status, updated_at)
    VALUES (
      v_doc_id,
      COALESCE(NULLIF(trim(p_doctor_email), ''), v_doc_id::text || '@clinicbook.local'),
      COALESCE(NULLIF(trim(p_doctor_name), ''), trim(p_owner_name)),
      'doctor',
      'active',
      now()
    )
    ON CONFLICT (id) DO UPDATE
    SET role = 'doctor',
        full_name = COALESCE(NULLIF(trim(p_doctor_name), ''), users.full_name),
        status = 'active',
        updated_at = now();

    INSERT INTO organization_members(organization_id, clinic_id, user_id, member_role, is_active)
    VALUES (v_org_id, v_clinic_id, v_doc_id, 'doctor', true)
    ON CONFLICT (organization_id, user_id) DO NOTHING;
  END IF;

  INSERT INTO doctors(
    id,
    organization_id,
    specialty_id,
    license_number,
    title_ar,
    bio_ar,
    consultation_fee,
    follow_up_fee,
    verification_status,
    is_listed_publicly
  )
  VALUES (
    v_doc_id,
    v_org_id,
    v_spec_id,
    trim(p_license),
    'طبيب عام',
    'طبيب معتمد، رعاية أولية واستشارات طبية شاملة.',
    25,
    15,
    'pending',
    false
  );

  INSERT INTO audit_logs(organization_id, actor_id, action, entity_type, entity_id)
  VALUES (v_org_id, p_owner_id, 'organization.created', 'organization', v_org_id);

  RETURN QUERY SELECT v_org_id, v_clinic_id;
END;
$$;

REVOKE ALL ON FUNCTION public.onboard_organization_atomic(uuid, text, text, text, text, text, text, text, subscription_tier, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.onboard_organization_atomic(uuid, text, text, text, text, text, text, text, subscription_tier, uuid, text, text) TO authenticated;

-- 5. Atomic Subscription-Locked Team Member Provisioning RPC
CREATE OR REPLACE FUNCTION public.provision_team_member_atomic(
  p_actor_id uuid,
  p_org_id uuid,
  p_clinic_id uuid,
  p_new_user_id uuid,
  p_email text,
  p_full_name text,
  p_role user_role,
  p_specialty_name text DEFAULT 'الطب العام',
  p_fee numeric DEFAULT 25,
  p_license text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sub subscriptions;
  v_doc_count int;
  v_spec_id uuid;
  v_target_clinic uuid := p_clinic_id;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organizations o WHERE o.id = p_org_id AND o.owner_id = p_actor_id
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF p_role NOT IN ('doctor', 'receptionist') THEN
    RAISE EXCEPTION 'INVALID_MEMBER_ROLE' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM organization_members om
    WHERE om.organization_id = p_org_id
      AND om.user_id = p_new_user_id
      AND om.is_active = true
  ) THEN
    RAISE EXCEPTION 'ALREADY_MEMBER' USING ERRCODE = '23505';
  END IF;

  -- Lock subscription row to serialize concurrent doctor additions against tier limits
  SELECT * INTO v_sub
  FROM subscriptions s
  WHERE s.organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF p_role = 'receptionist' AND v_sub.tier = 'solo_starter' THEN
    RAISE EXCEPTION 'TIER_RESTRICTION' USING ERRCODE = 'P0008';
  END IF;

  IF v_target_clinic IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM clinics c WHERE c.id = v_target_clinic AND c.organization_id = p_org_id
    ) THEN
      RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT c.id INTO v_target_clinic
    FROM clinics c
    WHERE c.organization_id = p_org_id
    ORDER BY c.created_at ASC
    LIMIT 1;
  END IF;

  IF p_role = 'doctor' THEN
    IF p_license IS NULL OR length(trim(p_license)) < 2 THEN
      RAISE EXCEPTION 'LICENSE_REQUIRED' USING ERRCODE = '22023';
    END IF;

    SELECT count(*)::int INTO v_doc_count
    FROM doctors d
    WHERE d.organization_id = p_org_id;

    IF v_doc_count >= v_sub.max_doctors THEN
      RAISE EXCEPTION 'LIMIT_REACHED' USING ERRCODE = 'P0009';
    END IF;
  END IF;

  INSERT INTO users(id, email, full_name, role, status, updated_at)
  VALUES (p_new_user_id, trim(p_email), trim(p_full_name), p_role, 'active', now())
  ON CONFLICT (id) DO UPDATE
  SET email = trim(p_email),
      full_name = trim(p_full_name),
      role = CASE
        WHEN users.role IN ('super_admin', 'clinic_owner') THEN users.role
        ELSE p_role
      END,
      status = 'active',
      updated_at = now();

  INSERT INTO organization_members(organization_id, clinic_id, user_id, member_role, is_active)
  VALUES (
    p_org_id,
    v_target_clinic,
    p_new_user_id,
    CASE WHEN p_role = 'doctor' THEN 'doctor'::org_role ELSE 'receptionist'::org_role END,
    true
  )
  ON CONFLICT (organization_id, user_id) DO UPDATE
  SET clinic_id = EXCLUDED.clinic_id,
      member_role = EXCLUDED.member_role,
      is_active = true;

  IF p_role = 'doctor' THEN
    SELECT sp.id INTO v_spec_id
    FROM specialties sp
    WHERE sp.name_ar = trim(p_specialty_name) OR lower(sp.name_en) = lower(trim(p_specialty_name))
    LIMIT 1;

    IF v_spec_id IS NULL THEN
      SELECT sp.id INTO v_spec_id FROM specialties sp LIMIT 1;
    END IF;

    IF v_spec_id IS NULL THEN
      v_spec_id := gen_random_uuid();
      INSERT INTO specialties(id, name_ar, name_en, slug, icon_name, is_active)
      VALUES (
        v_spec_id,
        trim(p_specialty_name),
        trim(p_specialty_name) || '-' || substr(v_spec_id::text, 1, 6),
        'spec-' || substr(v_spec_id::text, 1, 8),
        'Stethoscope',
        true
      );
    END IF;

    INSERT INTO doctors(
      id,
      organization_id,
      specialty_id,
      license_number,
      title_ar,
      consultation_fee,
      follow_up_fee,
      verification_status,
      is_listed_publicly
    )
    VALUES (
      p_new_user_id,
      p_org_id,
      v_spec_id,
      trim(p_license),
      'طبيب اختصاصي',
      p_fee,
      round(p_fee * 0.6),
      'pending',
      false
    );
  END IF;

  INSERT INTO audit_logs(organization_id, actor_id, action, entity_type, entity_id)
  VALUES (p_org_id, p_actor_id, 'team.member_added', 'user', p_new_user_id);

  RETURN p_new_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.provision_team_member_atomic(uuid, uuid, uuid, uuid, text, text, user_role, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_team_member_atomic(uuid, uuid, uuid, uuid, text, text, user_role, text, numeric, text) TO authenticated;

COMMIT;
