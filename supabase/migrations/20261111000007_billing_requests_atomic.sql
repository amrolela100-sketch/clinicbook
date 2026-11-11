-- Billing is application state, not a conclusion inferred from audit messages.
-- Legacy audit requests are deliberately not imported: they were client-writable.
BEGIN;

CREATE TABLE public.billing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  requested_tier subscription_tier NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK ((status = 'pending' AND resolved_at IS NULL) OR (status = 'approved' AND resolved_at IS NOT NULL))
);

CREATE UNIQUE INDEX billing_requests_one_pending_per_org
  ON public.billing_requests(organization_id) WHERE status = 'pending';
CREATE INDEX billing_requests_org_created
  ON public.billing_requests(organization_id, created_at DESC);

ALTER TABLE public.billing_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.billing_requests FROM anon, authenticated;
GRANT SELECT ON TABLE public.billing_requests TO authenticated;
CREATE POLICY billing_requests_scoped_read ON public.billing_requests
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

CREATE OR REPLACE FUNCTION public.request_billing_upgrade(p_org uuid, p_tier subscription_tier)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL
    OR public.current_app_role() IS DISTINCT FROM 'clinic_owner'
    OR NOT public.is_org_owner(p_org) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_tier IS NULL THEN
    RAISE EXCEPTION 'TIER_REQUIRED' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.organizations o WHERE o.id = p_org FOR UPDATE;
  INSERT INTO public.billing_requests(organization_id, requested_by, requested_tier)
  VALUES (p_org, auth.uid(), p_tier)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.request_billing_upgrade(uuid, subscription_tier) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_billing_upgrade(uuid, subscription_tier) TO authenticated;

CREATE OR REPLACE FUNCTION public.tenant_billing_requests(p_org uuid)
RETURNS TABLE(id uuid, tier text, status text, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT br.id, br.requested_tier::text, br.status, br.created_at
  FROM public.billing_requests br
  WHERE br.organization_id = p_org
  ORDER BY br.created_at DESC
  LIMIT 20;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_billing_requests()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'active' AND NEW.current_period_end > now() THEN
    UPDATE public.billing_requests br
    SET status = 'approved', resolved_at = now()
    WHERE br.organization_id = NEW.organization_id
      AND br.requested_tier = NEW.tier
      AND br.status = 'pending';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_billing_requests() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_resolve_billing_requests
  AFTER INSERT OR UPDATE OF tier, status, current_period_end ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.resolve_billing_requests();

-- The request RPC and mutation triggers now supply all tenant-generated events.
DROP POLICY IF EXISTS authenticated_audit_log_insert ON public.audit_logs;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.audit_logs FROM anon, authenticated;

CREATE TRIGGER trg_audit_billing_requests
  AFTER INSERT OR UPDATE OR DELETE ON public.billing_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('billing_request');

COMMIT;
