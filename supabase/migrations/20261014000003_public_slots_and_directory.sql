BEGIN;
CREATE FUNCTION public.get_available_slots(p_doctor_id uuid,p_clinic_id uuid,p_date date)
RETURNS TABLE(start_at timestamptz,end_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH eligible AS (
 SELECT c.*,s.booking_horizon_days FROM clinics c JOIN doctors d ON d.organization_id=c.organization_id AND d.id=p_doctor_id JOIN subscriptions s ON s.organization_id=c.organization_id
 WHERE c.id=p_clinic_id AND c.is_active AND d.verification_status='approved' AND d.is_listed_publicly AND org_is_bookable(c.organization_id)
 ), generated AS (
 SELECT DISTINCT slot AS start_at,slot+make_interval(mins=>a.slot_duration_minutes) AS end_at,e.min_lead_minutes,e.booking_horizon_days FROM eligible e
 JOIN availability a ON a.clinic_id=e.id AND a.doctor_id=p_doctor_id AND a.is_active AND a.day_of_week=extract(dow FROM p_date)
 CROSS JOIN LATERAL generate_series((p_date+a.start_time) AT TIME ZONE e.timezone,((p_date+a.end_time) AT TIME ZONE e.timezone)-make_interval(mins=>a.slot_duration_minutes),make_interval(mins=>a.slot_duration_minutes)) slot
 )
 SELECT g.start_at,g.end_at FROM generated g WHERE g.start_at>=now()+make_interval(mins=>g.min_lead_minutes) AND g.start_at<=now()+make_interval(days=>g.booking_horizon_days)
 AND NOT EXISTS(SELECT 1 FROM appointments a WHERE a.doctor_id=p_doctor_id AND a.start_at<g.end_at AND a.end_at>g.start_at AND (a.status IN ('confirmed','checked_in') OR a.status='pending' AND a.expires_at>now()))
 AND NOT EXISTS(SELECT 1 FROM availability_exceptions x WHERE x.doctor_id=p_doctor_id AND (x.clinic_id IS NULL OR x.clinic_id=p_clinic_id) AND x.start_at<g.end_at AND x.end_at>g.start_at)
 ORDER BY g.start_at
$$;
REVOKE ALL ON FUNCTION get_available_slots(uuid,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_available_slots(uuid,uuid,date) TO anon,authenticated;
CREATE FUNCTION public.public_doctor_directory()
RETURNS TABLE(id uuid,full_name text,title_ar text,bio_ar text,specialty_id uuid,organization_id uuid,consultation_fee numeric,follow_up_fee numeric,years_of_experience int,rating_avg numeric,reviews_count int,avatar_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT d.id,u.full_name,d.title_ar,d.bio_ar,d.specialty_id,d.organization_id,d.consultation_fee,d.follow_up_fee,d.years_of_experience,d.rating_avg,d.reviews_count,u.avatar_url
 FROM doctors d JOIN users u ON u.id=d.id WHERE d.verification_status='approved' AND d.is_listed_publicly AND u.status='active' AND org_is_bookable(d.organization_id)
$$;
REVOKE ALL ON FUNCTION public_doctor_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_doctor_directory() TO anon,authenticated;
-- Intentionally no public view into auth/users or clinical notes.
COMMIT;
