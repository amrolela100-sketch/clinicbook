-- Trusted, atomic operational jobs. Retries must not duplicate reminders or
-- delete clinical history. These are in-app reminders, not SMS/email delivery.
BEGIN;

ALTER TABLE public.notifications
  ADD COLUMN reminder_appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  ADD COLUMN reminder_kind text CHECK (reminder_kind IN ('upcoming_24h'));

CREATE UNIQUE INDEX notifications_appointment_reminder_unique
  ON public.notifications(reminder_appointment_id, reminder_kind)
  WHERE reminder_appointment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.run_retention_jobs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expired bigint;
  v_no_show bigint;
  v_reminders bigint;
  v_subscriptions bigint;
  v_archived bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  -- Serialize scheduler retries across all application instances.
  PERFORM pg_advisory_xact_lock(hashtextextended('clinicbook:retention-jobs', 0));

  -- Pending appointments are the application's expiring slot holds.
  v_expired := public.expire_pending_appointments();

  UPDATE public.appointments a
  SET status = 'no_show', updated_at = now()
  WHERE a.status = 'confirmed'
    AND a.checked_in_at IS NULL
    AND a.end_at <= now() - interval '60 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM public.medical_records m WHERE m.appointment_id = a.id
    );
  GET DIAGNOSTICS v_no_show = ROW_COUNT;

  UPDATE public.subscriptions
  SET status = 'expired', updated_at = now()
  WHERE status IN ('active', 'trialing') AND current_period_end <= now();
  GET DIAGNOSTICS v_subscriptions = ROW_COUNT;

  WITH upcoming AS MATERIALIZED (
    SELECT a.id, a.patient_id
    FROM public.appointments a
    JOIN public.users u ON u.id = a.patient_id
    WHERE a.status = 'confirmed'
      AND a.start_at > now() AND a.start_at <= now() + interval '24 hours'
      AND u.status = 'active' AND u.role = 'patient'
    FOR UPDATE OF a
  )
  INSERT INTO public.notifications(
    user_id, title, body, action_url, reminder_appointment_id, reminder_kind
  )
  SELECT patient_id,
    'تذكير بموعدك الطبي',
    'لديك موعد طبي خلال الأربع والعشرين ساعة القادمة. راجع تفاصيله من صفحة مواعيدي.',
    '/my-appointments', id, 'upcoming_24h'
  FROM upcoming
  ON CONFLICT (reminder_appointment_id, reminder_kind)
    WHERE reminder_appointment_id IS NOT NULL
  DO NOTHING;
  GET DIAGNOSTICS v_reminders = ROW_COUNT;

  v_archived := public.archive_medical_records();

  -- Existing database triggers audit committed state changes without PHI.
  RETURN jsonb_build_object(
    'expiredCount', v_expired,
    'noShowCount', v_no_show,
    'reminderCount', v_reminders,
    'subscriptionExpiredCount', v_subscriptions,
    'archivedCount', v_archived
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_retention_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_retention_jobs() TO service_role;

COMMIT;
