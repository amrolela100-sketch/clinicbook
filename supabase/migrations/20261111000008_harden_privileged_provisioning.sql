-- Auth provisioning is a trusted-server operation, not a tenant-callable RPC.
BEGIN;

REVOKE ALL ON FUNCTION public.onboard_organization_atomic(
  uuid, text, text, text, text, text, text, text, subscription_tier, uuid, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.onboard_organization_atomic(
  uuid, text, text, text, text, text, text, text, subscription_tier, uuid, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.provision_team_member_atomic(
  uuid, uuid, uuid, uuid, text, text, user_role, text, numeric, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_team_member_atomic(
  uuid, uuid, uuid, uuid, text, text, user_role, text, numeric, text
) TO service_role;

DROP TRIGGER IF EXISTS trg_audit_user_roles ON public.users;
CREATE TRIGGER trg_audit_user_roles
  AFTER UPDATE OF role, status ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('user');

-- Auth automatically creates a patient profile for a new invitation. Such a
-- profile can only be claimed while the invitation is unused and belongs to
-- this server-verified actor and purpose. Existing accounts are never revived.
CREATE OR REPLACE FUNCTION public.require_pending_invitation(
  p_user_id uuid,
  p_email text,
  p_actor_id uuid,
  p_purpose text,
  p_org uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user public.users;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_user FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITED_PROFILE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF v_user.role <> 'patient' OR v_user.status <> 'active'
    OR EXISTS (SELECT 1 FROM public.doctors d WHERE d.id = p_user_id)
    OR EXISTS (SELECT 1 FROM public.organizations o WHERE o.owner_id = p_user_id)
    OR EXISTS (SELECT 1 FROM public.organization_members om WHERE om.user_id = p_user_id) THEN
    RAISE EXCEPTION 'USER_ID_ALREADY_CLAIMED' USING ERRCODE = '23505';
  END IF;

  PERFORM 1 FROM auth.users au
  WHERE au.id = p_user_id
    AND lower(au.email) = lower(trim(p_email))
    AND lower(v_user.email) = lower(trim(p_email))
    AND au.invited_at IS NOT NULL
    AND au.last_sign_in_at IS NULL
    AND au.raw_user_meta_data->>'invited_by' = p_actor_id::text
    AND au.raw_user_meta_data->>'invitation_purpose' = p_purpose
    AND (p_org IS NULL OR au.raw_user_meta_data->>'organization_id' = p_org::text)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_MISMATCH' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.require_pending_invitation(uuid, text, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.discard_pending_invitation(
  p_user_id uuid,
  p_email text,
  p_actor_id uuid,
  p_purpose text,
  p_org uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  BEGIN
    PERFORM public.require_pending_invitation(p_user_id, p_email, p_actor_id, p_purpose, p_org);
  EXCEPTION WHEN insufficient_privilege OR unique_violation THEN
    RETURN false;
  END;
  -- The helper locks both profile and Auth rows. Concurrent claiming/sign-in
  -- cannot race this deletion, and established identities never reach it.
  DELETE FROM auth.users WHERE id = p_user_id;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.discard_pending_invitation(uuid, text, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.discard_pending_invitation(uuid, text, uuid, text, uuid)
  TO service_role;

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
  v_sub public.subscriptions;
  v_doc_count int;
  v_spec_id uuid;
  v_target_clinic uuid := p_clinic_id;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR NOT EXISTS (
    SELECT 1 FROM public.organizations o
    JOIN public.users u ON u.id = o.owner_id
    WHERE o.id = p_org_id AND o.owner_id = p_actor_id AND o.is_active
      AND u.role = 'clinic_owner' AND u.status = 'active'
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('doctor', 'receptionist') THEN
    RAISE EXCEPTION 'INVALID_MEMBER_ROLE' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions s
  WHERE s.organization_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_sub.status NOT IN ('active', 'trialing') OR v_sub.current_period_end <= now() THEN
    RAISE EXCEPTION 'SUBSCRIPTION_INACTIVE' USING ERRCODE = 'P0008';
  END IF;
  IF p_role = 'receptionist' AND v_sub.tier = 'solo_starter' THEN
    RAISE EXCEPTION 'TIER_RESTRICTION' USING ERRCODE = 'P0008';
  END IF;

  IF v_target_clinic IS NULL THEN
    SELECT c.id INTO v_target_clinic FROM public.clinics c
    WHERE c.organization_id = p_org_id ORDER BY c.created_at LIMIT 1;
  END IF;
  IF v_target_clinic IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.clinics c
    WHERE c.id = v_target_clinic AND c.organization_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF p_role = 'doctor' THEN
    IF p_license IS NULL OR length(trim(p_license)) < 2
      OR p_fee IS NULL OR p_fee NOT BETWEEN 0 AND 10000 THEN
      RAISE EXCEPTION 'INVALID_DOCTOR_DETAILS' USING ERRCODE = '22023';
    END IF;
    SELECT count(*)::int INTO v_doc_count FROM public.doctors d
    WHERE d.organization_id = p_org_id;
    IF v_doc_count >= v_sub.max_doctors THEN
      RAISE EXCEPTION 'LIMIT_REACHED' USING ERRCODE = 'P0009';
    END IF;
  END IF;

  PERFORM public.require_pending_invitation(
    p_new_user_id, p_email, p_actor_id, 'team_member', p_org_id
  );
  UPDATE public.users SET full_name = trim(p_full_name), role = p_role, updated_at = now()
  WHERE id = p_new_user_id;
  INSERT INTO public.organization_members(organization_id, clinic_id, user_id, member_role, is_active)
  VALUES (
    p_org_id, v_target_clinic, p_new_user_id,
    CASE WHEN p_role = 'doctor' THEN 'doctor'::org_role ELSE 'receptionist'::org_role END,
    true
  );

  IF p_role = 'doctor' THEN
    SELECT sp.id INTO v_spec_id FROM public.specialties sp
    WHERE sp.name_ar = trim(p_specialty_name) OR lower(sp.name_en) = lower(trim(p_specialty_name))
    LIMIT 1;
    IF v_spec_id IS NULL THEN
      SELECT sp.id INTO v_spec_id FROM public.specialties sp ORDER BY sp.id LIMIT 1;
    END IF;
    IF v_spec_id IS NULL THEN
      v_spec_id := gen_random_uuid();
      INSERT INTO public.specialties(id, name_ar, name_en, slug, icon_name, is_active)
      VALUES (
        v_spec_id, trim(p_specialty_name), trim(p_specialty_name) || '-' || substr(v_spec_id::text, 1, 6),
        'spec-' || substr(v_spec_id::text, 1, 8), 'Stethoscope', true
      );
    END IF;
    INSERT INTO public.doctors(
      id, organization_id, specialty_id, license_number, title_ar, consultation_fee,
      follow_up_fee, verification_status, is_listed_publicly
    ) VALUES (
      p_new_user_id, p_org_id, v_spec_id, trim(p_license), 'طبيب اختصاصي', p_fee,
      round(p_fee * 0.6), 'pending', false
    );
  END IF;
  RETURN p_new_user_id;
END;
$$;

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
DECLARE
  v_owner public.users;
  v_city_id uuid;
  v_spec_id uuid;
  v_org_id uuid := gen_random_uuid();
  v_clinic_id uuid := gen_random_uuid();
  v_doc_id uuid := COALESCE(p_doctor_user_id, p_owner_id);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_owner FROM public.users u WHERE u.id = p_owner_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OWNER_PROFILE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF v_owner.status <> 'active' OR v_owner.role NOT IN ('patient', 'clinic_owner')
    OR lower(v_owner.email) IS DISTINCT FROM lower(trim(p_owner_email)) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organizations o WHERE o.owner_id = p_owner_id)
    OR EXISTS (SELECT 1 FROM public.organization_members om WHERE om.user_id = p_owner_id) THEN
    RAISE EXCEPTION 'ALREADY_ONBOARDED' USING ERRCODE = '23505';
  END IF;
  IF p_tier IS DISTINCT FROM 'solo_starter' THEN
    RAISE EXCEPTION 'TIER_REQUIRES_APPROVAL' USING ERRCODE = 'P0008';
  END IF;

  IF v_doc_id <> p_owner_id THEN
    PERFORM public.require_pending_invitation(
      v_doc_id, p_doctor_email, p_owner_id, 'clinic_onboarding'
    );
  END IF;

  SELECT c.id INTO v_city_id FROM public.cities c
  WHERE c.name_ar = trim(p_city_name) OR lower(c.name_en) = lower(trim(p_city_name)) LIMIT 1;
  IF v_city_id IS NULL THEN
    v_city_id := gen_random_uuid();
    INSERT INTO public.cities(id, name_ar, name_en, slug, timezone, is_active)
    VALUES (
      v_city_id, trim(p_city_name), trim(p_city_name) || '-' || substr(v_city_id::text, 1, 6),
      'city-' || substr(v_city_id::text, 1, 8), 'Asia/Damascus', true
    );
  END IF;

  SELECT sp.id INTO v_spec_id FROM public.specialties sp
  WHERE sp.name_ar = 'الطب العام' OR sp.slug = 'general' LIMIT 1;
  IF v_spec_id IS NULL THEN
    SELECT sp.id INTO v_spec_id FROM public.specialties sp ORDER BY sp.id LIMIT 1;
  END IF;
  IF v_spec_id IS NULL THEN
    v_spec_id := gen_random_uuid();
    INSERT INTO public.specialties(id, name_ar, name_en, slug, icon_name, is_active)
    VALUES (
      v_spec_id, 'الطب العام', 'General Medicine ' || substr(v_spec_id::text, 1, 6),
      'general-' || substr(v_spec_id::text, 1, 8), 'Stethoscope', true
    );
  END IF;

  UPDATE public.users SET role = 'clinic_owner',
    full_name = COALESCE(NULLIF(trim(p_owner_name), ''), full_name),
    phone = COALESCE(NULLIF(trim(p_phone), ''), phone), updated_at = now()
  WHERE id = p_owner_id;

  INSERT INTO public.organizations(id, name, slug, owner_id, tax_or_license_number, verification_status, is_active)
  VALUES (v_org_id, trim(p_org_name), 'org-' || substr(v_org_id::text, 1, 12), p_owner_id, trim(p_license), 'pending', true);
  INSERT INTO public.subscriptions(
    organization_id, tier, status, max_doctors, max_clinics, booking_horizon_days,
    current_period_start, current_period_end
  ) VALUES (
    v_org_id, 'solo_starter', 'trialing', 1, 1, 30, now(), now() + interval '14 days'
  );
  INSERT INTO public.clinics(
    id, organization_id, city_id, name, slug, district, address, phone, timezone,
    cancel_window_hours, pending_expiry_hours, min_lead_minutes, auto_confirm_bookings, is_active
  ) VALUES (
    v_clinic_id, v_org_id, v_city_id, 'الفرع الرئيسي', 'clinic-' || substr(v_clinic_id::text, 1, 12),
    trim(p_district), trim(p_district), trim(p_phone), 'Asia/Damascus', 2, 12, 60, false, true
  );
  INSERT INTO public.organization_members(organization_id, clinic_id, user_id, member_role, is_active)
  VALUES (v_org_id, v_clinic_id, p_owner_id, 'owner', true);

  IF v_doc_id <> p_owner_id THEN
    UPDATE public.users SET role = 'doctor',
      full_name = COALESCE(NULLIF(trim(p_doctor_name), ''), full_name), updated_at = now()
    WHERE id = v_doc_id;
    INSERT INTO public.organization_members(organization_id, clinic_id, user_id, member_role, is_active)
    VALUES (v_org_id, v_clinic_id, v_doc_id, 'doctor', true);
  END IF;
  INSERT INTO public.doctors(
    id, organization_id, specialty_id, license_number, title_ar, bio_ar,
    consultation_fee, follow_up_fee, verification_status, is_listed_publicly
  ) VALUES (
    v_doc_id, v_org_id, v_spec_id, trim(p_license), 'طبيب عام',
    'رعاية أولية واستشارات طبية شاملة.', 25, 15, 'pending', false
  );
  RETURN QUERY SELECT v_org_id, v_clinic_id;
END;
$$;

COMMIT;
