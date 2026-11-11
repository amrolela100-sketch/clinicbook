-- Readiness probe for the public /api/health endpoint. It checks database
-- reachability and essential schema objects, without reading clinical data.
BEGIN;

CREATE OR REPLACE FUNCTION public.healthcheck()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'ok',
      to_regclass('public.appointments') IS NOT NULL
      AND to_regclass('public.medical_records') IS NOT NULL
      AND to_regprocedure('public.save_medical_record_and_complete(uuid,text,text,text,jsonb,date,boolean)') IS NOT NULL
      AND to_regprocedure('public.archive_medical_records()') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.medical_records')
          AND attname = 'retention_until' AND NOT attisdropped
      ),
    'schema', '20261111000012'
  );
$$;

REVOKE ALL ON FUNCTION public.healthcheck() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.healthcheck() TO service_role;

COMMIT;
