-- Keep the PostgreSQL lifecycle rules aligned with appointment-lifecycle.ts.
BEGIN;

CREATE OR REPLACE FUNCTION public.transition_appointment(
  p_id uuid,
  p_next appointment_status,
  p_reason text DEFAULT NULL
)
RETURNS appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  a appointments;
  c clinics;
  v_role user_role;
  v_administrative_staff boolean;
  v_clinical_staff boolean;
  v_allowed boolean := false;
BEGIN
  v_role := current_app_role();

  SELECT *
    INTO a
  FROM appointments
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_role IS NULL
    OR NOT can_read_appointment(a.organization_id, a.clinic_id, a.doctor_id, a.patient_id)
  THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO c FROM clinics WHERE id = a.clinic_id;
  v_administrative_staff := v_role IN ('doctor', 'receptionist', 'clinic_owner');
  v_clinical_staff := v_role IN ('doctor', 'receptionist');

  IF a.status = 'pending' THEN
    v_allowed :=
      (p_next = 'cancelled' AND v_role = 'patient' AND a.patient_id = auth.uid())
      OR (
        p_next = 'confirmed'
        AND v_administrative_staff
        AND now() < a.start_at
        AND now() < a.expires_at
      )
      OR (
        p_next = 'rejected'
        AND v_administrative_staff
        AND length(trim(coalesce(p_reason, ''))) > 0
      );
  ELSIF a.status = 'confirmed' THEN
    v_allowed :=
      (
        p_next = 'cancelled'
        AND (
          (
            v_role = 'patient'
            AND a.patient_id = auth.uid()
            AND a.start_at - now() >= make_interval(hours => c.cancel_window_hours)
          )
          OR (
            v_administrative_staff
            AND length(trim(coalesce(p_reason, ''))) > 0
          )
        )
      )
      OR (p_next = 'checked_in' AND v_clinical_staff)
      OR (p_next = 'no_show' AND v_clinical_staff AND now() >= a.start_at)
      OR (
        p_next = 'completed'
        AND v_role = 'doctor'
        AND a.doctor_id = auth.uid()
        AND now() >= a.start_at
      );
  ELSIF a.status = 'checked_in' THEN
    v_allowed :=
      p_next = 'completed'
      AND v_role = 'doctor'
      AND a.doctor_id = auth.uid()
      AND now() >= a.start_at;
  END IF;

  IF NOT coalesce(v_allowed, false) THEN
    RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = '22023';
  END IF;

  UPDATE appointments
  SET
    status = p_next,
    cancel_reason = CASE
      WHEN p_next IN ('cancelled', 'rejected') THEN p_reason
      ELSE cancel_reason
    END,
    cancelled_by = CASE
      WHEN p_next IN ('cancelled', 'rejected') THEN auth.uid()
      ELSE cancelled_by
    END,
    checked_in_at = CASE WHEN p_next = 'checked_in' THEN now() ELSE checked_in_at END,
    completed_at = CASE WHEN p_next = 'completed' THEN now() ELSE completed_at END,
    updated_at = now()
  WHERE id = p_id
  RETURNING * INTO a;

  INSERT INTO audit_logs(organization_id, actor_id, action, entity_type, entity_id)
  VALUES(a.organization_id, auth.uid(), 'appointment.' || p_next::text, 'appointment', a.id);

  RETURN a;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_appointment(uuid, appointment_status, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_appointment(uuid, appointment_status, text)
  TO authenticated;

COMMIT;
