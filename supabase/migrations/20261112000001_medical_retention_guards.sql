-- Row DELETE guards do not cover TRUNCATE. Protect both, with an explicit
-- override available only to a direct database-owner maintenance session.
BEGIN;

CREATE OR REPLACE FUNCTION public.prevent_medical_record_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('clinicbook.allow_medical_purge', true) = 'on'
    AND current_user = session_user
    AND pg_has_role(current_user, 'pg_database_owner', 'USAGE') THEN
    IF TG_OP = 'TRUNCATE' THEN RETURN NULL; END IF;
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'MEDICAL_RECORD_HARD_DELETE_FORBIDDEN' USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_medical_record_hard_delete()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE TRUNCATE ON TABLE public.medical_records FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER prevent_medical_record_truncate
  BEFORE TRUNCATE ON public.medical_records
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_medical_record_hard_delete();

-- Archival metadata is not a new clinical encounter. Old two-step writes may
-- have left records whose appointment was later cancelled; preserve and archive
-- that history without allowing a new clinical amendment in an invalid state.
CREATE OR REPLACE FUNCTION public.validate_medical_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_appointment public.appointments;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.appointment_id IS DISTINCT FROM NEW.appointment_id
      OR OLD.doctor_id IS DISTINCT FROM NEW.doctor_id
      OR OLD.organization_id IS DISTINCT FROM NEW.organization_id
      OR OLD.patient_id IS DISTINCT FROM NEW.patient_id THEN
      RAISE EXCEPTION 'IMMUTABLE_MEDICAL_IDENTITY' USING ERRCODE = '23514';
    END IF;

    IF ROW(OLD.chief_complaint, OLD.diagnosis, OLD.doctor_notes,
      OLD.prescription_items, OLD.follow_up_recommended_date, OLD.is_visible_to_patient)
      IS NOT DISTINCT FROM
      ROW(NEW.chief_complaint, NEW.diagnosis, NEW.doctor_notes,
      NEW.prescription_items, NEW.follow_up_recommended_date, NEW.is_visible_to_patient) THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT * INTO v_appointment FROM public.appointments WHERE id = NEW.appointment_id;
  IF NOT FOUND
    OR v_appointment.organization_id IS DISTINCT FROM NEW.organization_id
    OR v_appointment.doctor_id IS DISTINCT FROM NEW.doctor_id
    OR v_appointment.patient_id IS DISTINCT FROM NEW.patient_id
    OR v_appointment.start_at > now()
    OR v_appointment.status NOT IN ('confirmed', 'checked_in', 'completed') THEN
    RAISE EXCEPTION 'INVALID_MEDICAL_ENCOUNTER' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_medical_record()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
