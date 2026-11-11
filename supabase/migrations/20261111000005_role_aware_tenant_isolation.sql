-- Keep tenant membership separate from tenant ownership for privileged writes.
BEGIN;

CREATE OR REPLACE FUNCTION public.is_org_owner(p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.organizations o
      WHERE o.id = p_org
        AND o.owner_id = auth.uid()
    )
$$;

REVOKE ALL ON FUNCTION public.is_org_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_org_owner(uuid) TO authenticated;

DROP POLICY IF EXISTS owner_doctor_fee ON public.doctors;
CREATE POLICY owner_doctor_fee ON public.doctors
  FOR UPDATE TO authenticated
  USING (public.current_app_role() = 'clinic_owner' AND public.is_org_owner(organization_id))
  WITH CHECK (public.current_app_role() = 'clinic_owner' AND public.is_org_owner(organization_id));

DROP POLICY IF EXISTS owner_clinic_insert ON public.clinics;
CREATE POLICY owner_clinic_insert ON public.clinics
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_app_role() = 'clinic_owner'
    AND public.is_org_owner(organization_id)
  );

DROP POLICY IF EXISTS owner_clinic_settings ON public.clinics;
CREATE POLICY owner_clinic_settings ON public.clinics
  FOR UPDATE TO authenticated
  USING (
    public.current_app_role() = 'clinic_owner'
    AND public.is_org_owner(organization_id)
  )
  WITH CHECK (
    public.current_app_role() = 'clinic_owner'
    AND public.is_org_owner(organization_id)
  );

DROP POLICY IF EXISTS doctor_owner_availability_all ON public.availability;
CREATE POLICY doctor_owner_availability_all ON public.availability
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.doctors d
      WHERE d.id = doctor_id
        AND (
          (d.id = auth.uid() AND public.current_app_role() = 'doctor')
          OR (
            public.current_app_role() = 'clinic_owner'
            AND public.is_org_owner(d.organization_id)
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.doctors d
      WHERE d.id = doctor_id
        AND (
          (d.id = auth.uid() AND public.current_app_role() = 'doctor')
          OR (
            public.current_app_role() = 'clinic_owner'
            AND public.is_org_owner(d.organization_id)
          )
        )
    )
  );

DROP POLICY IF EXISTS doctor_owner_exception_all ON public.availability_exceptions;
CREATE POLICY doctor_owner_exception_all ON public.availability_exceptions
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.doctors d
      WHERE d.id = doctor_id
        AND (
          (d.id = auth.uid() AND public.current_app_role() = 'doctor')
          OR (
            public.current_app_role() = 'clinic_owner'
            AND public.is_org_owner(d.organization_id)
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.doctors d
      WHERE d.id = doctor_id
        AND (
          (d.id = auth.uid() AND public.current_app_role() = 'doctor')
          OR (
            public.current_app_role() = 'clinic_owner'
            AND public.is_org_owner(d.organization_id)
          )
        )
    )
  );

DROP POLICY IF EXISTS audit_owner_read ON public.audit_logs;
CREATE POLICY audit_owner_read ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR (
      public.current_app_role() = 'clinic_owner'
      AND public.is_org_owner(organization_id)
    )
  );

CREATE OR REPLACE FUNCTION public.replace_availability_atomic(
  p_doctor_id uuid,
  p_clinic_id uuid,
  p_shifts jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_role user_role;
  v_shift jsonb;
BEGIN
  SELECT d.organization_id
    INTO v_org
  FROM doctors d
  WHERE d.id = p_doctor_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DOCTOR_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  v_role := current_app_role();
  IF v_role IS NULL OR NOT (
    (
      v_role = 'doctor'
      AND auth.uid() = p_doctor_id
      AND EXISTS (
        SELECT 1
        FROM organization_members om
        WHERE om.organization_id = v_org
          AND om.clinic_id = p_clinic_id
          AND om.user_id = auth.uid()
          AND om.is_active = true
      )
    )
    OR (v_role = 'clinic_owner' AND is_org_owner(v_org))
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM clinics c
    WHERE c.id = p_clinic_id
      AND c.organization_id = v_org
  ) THEN
    RAISE EXCEPTION 'INVALID_CLINIC' USING ERRCODE = '22023';
  END IF;

  IF p_shifts IS NULL OR jsonb_typeof(p_shifts) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_SHIFTS_ARRAY' USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_shifts) > 21 THEN
    RAISE EXCEPTION 'TOO_MANY_SHIFTS' USING ERRCODE = '22023';
  END IF;

  FOR v_shift IN SELECT value FROM jsonb_array_elements(p_shifts)
  LOOP
    IF jsonb_typeof(v_shift) IS DISTINCT FROM 'object'
      OR NOT (v_shift ?& ARRAY['day', 'start', 'end', 'duration', 'active'])
      OR jsonb_typeof(v_shift->'day') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v_shift->'start') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_shift->'end') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_shift->'duration') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v_shift->'active') IS DISTINCT FROM 'boolean'
      OR (v_shift->>'day') !~ '^[0-6]$'
      OR (v_shift->>'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      OR (v_shift->>'end') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      OR (v_shift->>'duration') !~ '^(10|15|20|30|45|60)$'
    THEN
      RAISE EXCEPTION 'INVALID_SHIFT' USING ERRCODE = '22023';
    END IF;

    IF (v_shift->>'end')::time <= (v_shift->>'start')::time THEN
      RAISE EXCEPTION 'INVALID_SHIFT_RANGE' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_shifts) WITH ORDINALITY AS a(shift, ord)
    JOIN jsonb_array_elements(p_shifts) WITH ORDINALITY AS b(shift, ord)
      ON a.ord < b.ord
    WHERE (a.shift->>'active')::boolean
      AND (b.shift->>'active')::boolean
      AND (a.shift->>'day')::smallint = (b.shift->>'day')::smallint
      AND (a.shift->>'start')::time < (b.shift->>'end')::time
      AND (a.shift->>'end')::time > (b.shift->>'start')::time
  ) THEN
    RAISE EXCEPTION 'OVERLAPPING_SHIFTS' USING ERRCODE = '22023';
  END IF;

  DELETE FROM availability
  WHERE doctor_id = p_doctor_id;

  INSERT INTO availability(
    doctor_id,
    clinic_id,
    day_of_week,
    start_time,
    end_time,
    slot_duration_minutes,
    is_active
  )
  SELECT
    p_doctor_id,
    p_clinic_id,
    (shift->>'day')::smallint,
    (shift->>'start')::time,
    (shift->>'end')::time,
    (shift->>'duration')::smallint,
    true
  FROM jsonb_array_elements(p_shifts) AS entries(shift)
  WHERE (shift->>'active')::boolean;

  INSERT INTO audit_logs(organization_id, actor_id, action, entity_type, entity_id)
  VALUES(v_org, auth.uid(), 'availability.updated', 'availability', p_doctor_id);
END;
$$;

COMMIT;
