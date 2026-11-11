-- Saving an encounter and completing its appointment are one transaction.
BEGIN;

CREATE OR REPLACE FUNCTION public.save_medical_record_and_complete(
  p_appointment_id uuid,
  p_diagnosis text,
  p_complaint text,
  p_notes text,
  p_prescription jsonb,
  p_follow_up date,
  p_visible boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_appointment public.appointments;
  v_medication jsonb;
BEGIN
  SELECT * INTO v_appointment
  FROM public.appointments
  WHERE id = p_appointment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPOINTMENT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF public.current_app_role() IS DISTINCT FROM 'doctor'
    OR auth.uid() IS DISTINCT FROM v_appointment.doctor_id
    OR public.is_clinical_actor(
      v_appointment.organization_id, v_appointment.doctor_id
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF v_appointment.status NOT IN ('confirmed', 'checked_in', 'completed')
    OR v_appointment.start_at > now() THEN
    RAISE EXCEPTION 'INVALID_ENCOUNTER_STATE' USING ERRCODE = '22023';
  END IF;

  IF p_diagnosis IS NULL OR length(trim(p_diagnosis)) NOT BETWEEN 1 AND 200
    OR length(COALESCE(p_complaint, '')) > 1000
    OR length(COALESCE(p_notes, '')) > 3000
    OR p_visible IS NULL
    OR p_prescription IS NULL
    OR jsonb_typeof(p_prescription) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_ENCOUNTER_INPUT' USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_prescription) > 20 THEN
    RAISE EXCEPTION 'TOO_MANY_MEDICATIONS' USING ERRCODE = '22023';
  END IF;

  FOR v_medication IN SELECT value FROM jsonb_array_elements(p_prescription)
  LOOP
    IF jsonb_typeof(v_medication) IS DISTINCT FROM 'object'
      OR NOT (v_medication ?& ARRAY['name', 'dose', 'frequency', 'duration'])
      OR jsonb_typeof(v_medication->'name') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_medication->'dose') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_medication->'frequency') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_medication->'duration') IS DISTINCT FROM 'string'
      OR length(trim(v_medication->>'name')) NOT BETWEEN 1 AND 200
      OR length(trim(v_medication->>'dose')) NOT BETWEEN 1 AND 200
      OR length(trim(v_medication->>'frequency')) NOT BETWEEN 1 AND 200
      OR length(trim(v_medication->>'duration')) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'INVALID_MEDICATION' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF v_appointment.status <> 'completed' THEN
    -- Preserve the central role/state/time rules. Any later constraint or
    -- retention failure rolls this transition and its audit events back too.
    PERFORM public.transition_appointment(p_appointment_id, 'completed', NULL);
  END IF;

  INSERT INTO public.medical_records(
    appointment_id, organization_id, doctor_id, patient_id,
    chief_complaint, diagnosis, doctor_notes, prescription_items,
    follow_up_recommended_date, is_visible_to_patient
  ) VALUES (
    v_appointment.id, v_appointment.organization_id,
    v_appointment.doctor_id, v_appointment.patient_id,
    COALESCE(p_complaint, ''), trim(p_diagnosis), COALESCE(p_notes, ''), p_prescription,
    p_follow_up, p_visible
  )
  ON CONFLICT (appointment_id) DO UPDATE SET
    chief_complaint = EXCLUDED.chief_complaint,
    diagnosis = EXCLUDED.diagnosis,
    doctor_notes = EXCLUDED.doctor_notes,
    prescription_items = EXCLUDED.prescription_items,
    follow_up_recommended_date = EXCLUDED.follow_up_recommended_date,
    is_visible_to_patient = EXCLUDED.is_visible_to_patient;
END;
$$;

REVOKE ALL ON FUNCTION public.save_medical_record_and_complete(
  uuid, text, text, text, jsonb, date, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_medical_record_and_complete(
  uuid, text, text, text, jsonb, date, boolean
) TO authenticated;

-- Direct client writes would bypass the atomic encounter contract.
REVOKE INSERT, UPDATE ON TABLE public.medical_records FROM anon, authenticated;

COMMIT;
