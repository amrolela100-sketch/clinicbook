-- Operational audit events are emitted by the database, not asserted by clients.
BEGIN;

DROP POLICY IF EXISTS authenticated_audit_log_insert ON public.audit_logs;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.audit_logs FROM anon, authenticated;

-- Old rows may have been supplied by clients. Preserve them without treating
-- them as authoritative evidence or using them to approve subscriptions.
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'legacy'
  CHECK (source IN ('legacy', 'database', 'server'));

CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
  v_row jsonb;
  v_fields jsonb;
  v_org uuid;
  v_action text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old := to_jsonb(OLD);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new := to_jsonb(NEW);
  END IF;
  IF TG_OP = 'UPDATE' AND (v_old - 'updated_at') = (v_new - 'updated_at') THEN
    RETURN NULL;
  END IF;

  v_row := CASE WHEN TG_OP = 'DELETE' THEN v_old ELSE v_new END;
  v_org := (v_row->>'organization_id')::uuid;
  IF TG_TABLE_NAME = 'organizations' THEN
    v_org := (v_row->>'id')::uuid;
  ELSIF TG_TABLE_NAME IN ('availability', 'availability_exceptions', 'reviews') THEN
    SELECT d.organization_id INTO v_org
    FROM public.doctors d WHERE d.id = (v_row->>'doctor_id')::uuid;
  END IF;
  -- A cascading deletion may have already removed the parent organization.
  IF v_org IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.organizations o WHERE o.id = v_org
  ) THEN
    v_org := NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(n.key ORDER BY n.key), '[]'::jsonb)
  INTO v_fields
  FROM jsonb_each(v_row) n
  WHERE n.key <> 'updated_at'
    AND (TG_OP <> 'UPDATE' OR n.value IS DISTINCT FROM (v_old->n.key));

  v_action := TG_ARGV[0] || '.' || lower(TG_OP);
  IF TG_TABLE_NAME = 'doctors' AND TG_OP = 'UPDATE'
    AND (v_old->'consultation_fee' IS DISTINCT FROM v_new->'consultation_fee'
      OR v_old->'follow_up_fee' IS DISTINCT FROM v_new->'follow_up_fee') THEN
    v_action := 'doctor.fee_updated';
  ELSIF TG_TABLE_NAME = 'clinics' THEN
    v_action := CASE TG_OP
      WHEN 'INSERT' THEN 'branch.created'
      WHEN 'UPDATE' THEN 'clinic.updated'
      ELSE 'clinic.deleted' END;
  ELSIF TG_TABLE_NAME = 'appointments' THEN
    IF TG_OP = 'UPDATE' AND v_old->'payment_status' IS DISTINCT FROM v_new->'payment_status'
      AND v_new->>'payment_status' = 'paid_cash' THEN
      v_action := 'payment.cash';
    ELSIF TG_OP = 'UPDATE' AND v_old->'status' IS DISTINCT FROM v_new->'status' THEN
      v_action := 'appointment.' || (v_new->>'status');
    ELSE
      v_action := 'appointment.' || CASE TG_OP
        WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'updated' ELSE 'deleted' END;
    END IF;
  ELSIF TG_TABLE_NAME = 'medical_records' THEN
    v_action := CASE WHEN TG_OP = 'DELETE' THEN 'medical.deleted' ELSE 'medical.saved' END;
  ELSIF TG_TABLE_NAME = 'organizations' THEN
    v_action := 'organization.' || CASE TG_OP
      WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'updated' ELSE 'deleted' END;
  ELSIF TG_TABLE_NAME = 'organization_members' THEN
    v_action := CASE TG_OP
      WHEN 'INSERT' THEN 'team.member_added'
      WHEN 'UPDATE' THEN 'team.member_updated'
      ELSE 'team.member_removed' END;
  ELSIF TG_TABLE_NAME = 'availability_exceptions' THEN
    v_action := 'exception.' || CASE TG_OP
      WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'updated' ELSE 'deleted' END;
  ELSIF TG_TABLE_NAME = 'reviews' THEN
    v_action := 'review.' || CASE TG_OP
      WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'updated' ELSE 'deleted' END;
  ELSIF TG_TABLE_NAME = 'subscriptions' THEN
    IF TG_OP <> 'DELETE' AND v_new->>'status' = 'active'
      AND (TG_OP = 'INSERT'
        OR v_old->'tier' IS DISTINCT FROM v_new->'tier'
        OR v_old->'status' IS DISTINCT FROM v_new->'status'
        OR v_old->'current_period_end' IS DISTINCT FROM v_new->'current_period_end') THEN
      v_action := 'subscription.activated';
    ELSE
      v_action := 'subscription.' || CASE TG_OP
        WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'updated' ELSE 'deleted' END;
    END IF;
  ELSIF TG_TABLE_NAME = 'billing_requests' THEN
    v_action := CASE TG_OP
      WHEN 'INSERT' THEN 'billing.requested'
      WHEN 'UPDATE' THEN 'billing.' || (v_new->>'status')
      ELSE 'billing.deleted' END;
  END IF;

  -- Only field names are stored, never diagnoses, prescriptions, notes, phones
  -- or other before/after values from a clinical or identity row.
  INSERT INTO public.audit_logs(
    organization_id, actor_id, action, entity_type, entity_id, metadata, source
  ) VALUES (
    v_org, auth.uid(), v_action, TG_ARGV[0], (v_row->>'id')::uuid,
    jsonb_build_object('operation', TG_OP, 'changed_fields', v_fields), 'database'
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_row_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit_doctors ON public.doctors;
CREATE TRIGGER trg_audit_doctors
  AFTER INSERT OR UPDATE OR DELETE ON public.doctors
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('doctor');

DROP TRIGGER IF EXISTS trg_audit_clinics ON public.clinics;
CREATE TRIGGER trg_audit_clinics
  AFTER INSERT OR UPDATE OR DELETE ON public.clinics
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('clinic');

DROP TRIGGER IF EXISTS trg_audit_appointments ON public.appointments;
CREATE TRIGGER trg_audit_appointments
  AFTER INSERT OR UPDATE OR DELETE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('appointment');

DROP TRIGGER IF EXISTS trg_audit_medical_records ON public.medical_records;
CREATE TRIGGER trg_audit_medical_records
  AFTER INSERT OR UPDATE OR DELETE ON public.medical_records
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('medical_record');

DO $$
DECLARE
  v_table text;
  v_entity text;
BEGIN
  FOR v_table, v_entity IN
    SELECT * FROM (VALUES
      ('organizations', 'organization'),
      ('subscriptions', 'subscription'),
      ('organization_members', 'organization_member'),
      ('availability', 'availability'),
      ('availability_exceptions', 'availability_exception'),
      ('reviews', 'review')
    ) AS targets(table_name, entity_type)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_audit_' || v_table, v_table);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change(%L)',
      'trg_audit_' || v_table, v_table, v_entity
    );
  END LOOP;
END;
$$;

COMMIT;
