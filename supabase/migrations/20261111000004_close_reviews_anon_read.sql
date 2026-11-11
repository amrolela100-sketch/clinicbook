-- Anonymous visitors must use public_reviews(uuid), never the raw reviews table.
BEGIN;

REVOKE ALL ON TABLE public.reviews FROM anon;

DROP POLICY IF EXISTS published_reviews ON public.reviews;
CREATE POLICY published_reviews ON public.reviews
  FOR SELECT TO authenticated
  USING (is_published OR patient_id = auth.uid());

COMMIT;
