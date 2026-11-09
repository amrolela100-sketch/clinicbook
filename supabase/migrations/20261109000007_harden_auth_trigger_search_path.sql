-- =============================================================================
-- Migration: 20261109000007_harden_auth_trigger_search_path.sql
-- Full-Stack Audit Remediation V2 (REM-V2-05):
-- Standardize handle_new_user() SECURITY DEFINER search_path to `public, pg_temp`
-- to prevent pg_temp object shadowing across all 100% of SECURITY DEFINER routines.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, avatar_url, role, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.raw_user_meta_data->>'avatar_url',
    'patient',
    'active'
  )
  ON CONFLICT (id) DO UPDATE
  SET full_name = COALESCE(EXCLUDED.full_name, public.users.full_name),
      email = EXCLUDED.email,
      avatar_url = COALESCE(EXCLUDED.avatar_url, public.users.avatar_url),
      updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

COMMIT;
