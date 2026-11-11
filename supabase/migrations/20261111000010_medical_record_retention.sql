-- Preserve clinical records, archive them after their retention window, and
-- require an explicit database-owner maintenance override for any hard purge.
BEGIN;

ALTER TABLE public.medical_records
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN archive_reason text,
  ADD COLUMN legal_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN retention_until date;

UPDATE public.medical_records
SET retention_until = (COALESCE(updated_at, created_at) + interval '10 years')::date
WHERE retention_until IS NULL;

ALTER TABLE public.medical_records
  ALTER COLUMN retention_until SET DEFAULT ((current_date + interval '10 years')::date),
  ALTER COLUMN retention_until SET NOT NULL,
  ADD CONSTRAINT medical_records_archive_state_check CHECK (
    (archived_at IS NULL AND archived_by IS NULL AND archive_reason IS NULL)
    OR (archived_at IS NOT NULL AND archive_reason IS NOT NULL)
  );

ALTER TABLE public.medical_records
  DROP CONSTRAINT IF EXISTS medical_records_appointment_id_fkey,
  ADD CONSTRAINT medical_records_appointment_id_fkey
    FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE RESTRICT,
  DROP CONSTRAINT IF EXISTS medical_records_organization_id_fkey,
  ADD CONSTRAINT medical_records_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;

REVOKE DELETE ON TABLE public.medical_records FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_medical_record_retention()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_minimum_retention date := (current_date + interval '10 years')::date;
  v_clinical_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
      NEW.archived_at := NULL;
      NEW.archived_by := NULL;
      NEW.archive_reason := NULL;
      NEW.legal_hold := false;
    END IF;
    NEW.retention_until := GREATEST(
      COALESCE(NEW.retention_until, v_minimum_retention),
      v_minimum_retention
    );
    RETURN NEW;
  END IF;

  v_clinical_changed :=
    OLD.chief_complaint IS DISTINCT FROM NEW.chief_complaint
    OR OLD.diagnosis IS DISTINCT FROM NEW.diagnosis
    OR OLD.prescription_items IS DISTINCT FROM NEW.prescription_items
    OR OLD.doctor_notes IS DISTINCT FROM NEW.doctor_notes
    OR OLD.follow_up_recommended_date IS DISTINCT FROM NEW.follow_up_recommended_date
    OR OLD.is_visible_to_patient IS DISTINCT FROM NEW.is_visible_to_patient;

  IF OLD.archived_at IS NOT NULL AND v_clinical_changed THEN
    RAISE EXCEPTION 'ARCHIVED_MEDICAL_RECORD_IMMUTABLE' USING ERRCODE = '55000';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role' AND (
    OLD.archived_at IS DISTINCT FROM NEW.archived_at
    OR OLD.archived_by IS DISTINCT FROM NEW.archived_by
    OR OLD.archive_reason IS DISTINCT FROM NEW.archive_reason
    OR OLD.legal_hold IS DISTINCT FROM NEW.legal_hold
    OR OLD.retention_until IS DISTINCT FROM NEW.retention_until
  ) THEN
    RAISE EXCEPTION 'MEDICAL_RETENTION_METADATA_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF v_clinical_changed THEN
    NEW.retention_until := GREATEST(OLD.retention_until, v_minimum_retention);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_medical_record_retention()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS enforce_medical_record_retention ON public.medical_records;
CREATE TRIGGER enforce_medical_record_retention
  BEFORE INSERT OR UPDATE ON public.medical_records
  FOR EACH ROW EXECUTE FUNCTION public.enforce_medical_record_retention();

CREATE OR REPLACE FUNCTION public.prevent_medical_record_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('clinicbook.allow_medical_purge', true) = 'on'
    AND pg_has_role(session_user, 'pg_database_owner', 'USAGE') THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'MEDICAL_RECORD_HARD_DELETE_FORBIDDEN' USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_medical_record_hard_delete()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS prevent_medical_record_hard_delete ON public.medical_records;
CREATE TRIGGER prevent_medical_record_hard_delete
  BEFORE DELETE ON public.medical_records
  FOR EACH ROW EXECUTE FUNCTION public.prevent_medical_record_hard_delete();

CREATE OR REPLACE FUNCTION public.archive_medical_records()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_archived bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  UPDATE public.medical_records
  SET archived_at = now(),
      archived_by = NULL,
      archive_reason = 'retention_period_elapsed'
  WHERE archived_at IS NULL
    AND legal_hold = false
    AND retention_until <= current_date;

  GET DIAGNOSTICS v_archived = ROW_COUNT;
  RETURN v_archived;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_medical_records()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_medical_records() TO service_role;

CREATE INDEX idx_medical_records_retention_archive
  ON public.medical_records(retention_until)
  WHERE archived_at IS NULL AND legal_hold = false;

COMMIT;
