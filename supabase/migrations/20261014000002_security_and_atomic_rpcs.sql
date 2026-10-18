-- Security hardening for the supplied schema. No service-role key is accepted from HTTP clients.
BEGIN;
ALTER TABLE clinics ADD COLUMN expiry_before_start_mins int NOT NULL DEFAULT 60 CHECK(expiry_before_start_mins BETWEEN 0 AND 1440);
ALTER TABLE clinics ADD CONSTRAINT clinics_id_org_unique UNIQUE(id,organization_id);
ALTER TABLE doctors ADD CONSTRAINT doctors_id_org_unique UNIQUE(id,organization_id);
ALTER TABLE appointments ADD CONSTRAINT appointment_clinic_tenant FOREIGN KEY(clinic_id,organization_id) REFERENCES clinics(id,organization_id);
ALTER TABLE appointments ADD CONSTRAINT appointment_doctor_tenant FOREIGN KEY(doctor_id,organization_id) REFERENCES doctors(id,organization_id);
ALTER TABLE appointments ADD CONSTRAINT pending_requires_expiry CHECK(status<>'pending' OR expires_at IS NOT NULL);

CREATE FUNCTION public.current_app_role() RETURNS user_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT role FROM users WHERE id=auth.uid() AND status='active'
$$;
CREATE FUNCTION public.is_org_member(p_org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT current_app_role() IS NOT NULL AND (EXISTS(SELECT 1 FROM organizations WHERE id=p_org AND owner_id=auth.uid()) OR EXISTS(SELECT 1 FROM organization_members WHERE organization_id=p_org AND user_id=auth.uid() AND is_active))
$$;
CREATE FUNCTION public.can_read_appointment(p_org uuid,p_clinic uuid,p_doctor uuid,p_patient uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT current_app_role() IS NOT NULL AND (p_patient=auth.uid() OR
 (current_app_role()='clinic_owner' AND EXISTS(SELECT 1 FROM organizations WHERE id=p_org AND owner_id=auth.uid())) OR
 (current_app_role()='doctor' AND p_doctor=auth.uid() AND is_org_member(p_org)) OR
 (current_app_role()='receptionist' AND EXISTS(SELECT 1 FROM organization_members WHERE organization_id=p_org AND clinic_id=p_clinic AND user_id=auth.uid() AND is_active AND member_role='receptionist')))
$$;
CREATE FUNCTION public.is_clinical_actor(p_org uuid,p_doctor uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT current_app_role()='doctor' AND auth.uid()=p_doctor AND is_org_member(p_org) $$;

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['users','cities','specialties','organizations','subscriptions','clinics','doctors','organization_members','availability','availability_exceptions','appointments','medical_records','reviews','notifications','audit_logs'] LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t); END LOOP; END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon,authenticated;
GRANT SELECT ON cities,specialties,clinics,doctors,availability,reviews TO anon,authenticated;
GRANT SELECT ON users,organizations,subscriptions,organization_members,availability_exceptions,appointments,medical_records,notifications,audit_logs TO authenticated;
GRANT UPDATE(full_name,phone,avatar_url) ON users TO authenticated;
GRANT INSERT,UPDATE ON medical_records TO authenticated;
GRANT INSERT ON reviews TO authenticated;
GRANT UPDATE(is_read) ON notifications TO authenticated;
GRANT UPDATE(name,phone,address,cancel_window_hours,min_lead_minutes,auto_confirm_bookings) ON clinics TO authenticated;

CREATE POLICY users_self ON users FOR SELECT TO authenticated USING(id=auth.uid());
CREATE POLICY users_self_update ON users FOR UPDATE TO authenticated USING(id=auth.uid() AND status='active') WITH CHECK(id=auth.uid());
CREATE POLICY cities_active ON cities FOR SELECT USING(is_active);
CREATE POLICY specialties_active ON specialties FOR SELECT USING(is_active);
CREATE POLICY org_member_read ON organizations FOR SELECT TO authenticated USING(is_org_member(id) OR current_app_role()='super_admin');
CREATE POLICY subscription_member_read ON subscriptions FOR SELECT TO authenticated USING(is_org_member(organization_id) OR current_app_role()='super_admin');
CREATE POLICY membership_read ON organization_members FOR SELECT TO authenticated USING(is_org_member(organization_id));
-- Use a definer helper to avoid recursively filtered joins on the public directory.
CREATE FUNCTION public.org_is_bookable(p_org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM organizations o JOIN subscriptions s ON s.organization_id=o.id WHERE o.id=p_org AND o.is_active AND o.verification_status='approved' AND s.status IN ('trialing','active') AND s.current_period_end>now())
$$;
CREATE POLICY public_clinics ON clinics FOR SELECT USING((is_active AND org_is_bookable(organization_id)) OR is_org_member(organization_id));
CREATE POLICY owner_clinic_settings ON clinics FOR UPDATE TO authenticated USING(current_app_role()='clinic_owner' AND EXISTS(SELECT 1 FROM organizations o WHERE o.id=organization_id AND o.owner_id=auth.uid())) WITH CHECK(current_app_role()='clinic_owner' AND is_org_member(organization_id));
CREATE POLICY public_doctors ON doctors FOR SELECT USING((verification_status='approved' AND is_listed_publicly AND org_is_bookable(organization_id)) OR is_org_member(organization_id));
CREATE POLICY availability_read ON availability FOR SELECT USING(EXISTS(SELECT 1 FROM doctors d WHERE d.id=doctor_id AND d.verification_status='approved' AND d.is_listed_publicly AND org_is_bookable(d.organization_id)));
CREATE POLICY exceptions_read ON availability_exceptions FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM doctors d WHERE d.id=doctor_id AND is_org_member(d.organization_id)));
CREATE POLICY appointment_scoped_read ON appointments FOR SELECT TO authenticated USING(can_read_appointment(organization_id,clinic_id,doctor_id,patient_id));
CREATE POLICY patient_visible_records ON medical_records FOR SELECT TO authenticated USING(patient_id=auth.uid() AND current_app_role()='patient' AND is_visible_to_patient);
CREATE POLICY treating_doctor_read ON medical_records FOR SELECT TO authenticated USING(is_clinical_actor(organization_id,doctor_id));
CREATE POLICY treating_doctor_insert ON medical_records FOR INSERT TO authenticated WITH CHECK(is_clinical_actor(organization_id,doctor_id));
CREATE POLICY treating_doctor_update ON medical_records FOR UPDATE TO authenticated USING(is_clinical_actor(organization_id,doctor_id)) WITH CHECK(is_clinical_actor(organization_id,doctor_id));
CREATE POLICY published_reviews ON reviews FOR SELECT USING(is_published OR patient_id=auth.uid());
CREATE POLICY completed_visit_review ON reviews FOR INSERT TO authenticated WITH CHECK(current_app_role()='patient' AND patient_id=auth.uid() AND EXISTS(SELECT 1 FROM appointments a WHERE a.id=appointment_id AND a.patient_id=auth.uid() AND a.doctor_id=reviews.doctor_id AND a.status='completed'));
CREATE POLICY own_notifications ON notifications FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY read_notifications ON notifications FOR UPDATE TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
CREATE POLICY audit_owner_read ON audit_logs FOR SELECT TO authenticated USING(current_app_role()='super_admin' OR current_app_role()='clinic_owner' AND is_org_member(organization_id));

CREATE FUNCTION public.validate_medical_record() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a appointments; BEGIN
 SELECT * INTO a FROM appointments WHERE id=NEW.appointment_id;
 IF NOT FOUND OR a.organization_id<>NEW.organization_id OR a.doctor_id<>NEW.doctor_id OR a.patient_id IS DISTINCT FROM NEW.patient_id OR a.start_at>now() OR a.status NOT IN ('confirmed','checked_in','completed') THEN RAISE EXCEPTION 'INVALID_MEDICAL_ENCOUNTER' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (OLD.appointment_id<>NEW.appointment_id OR OLD.doctor_id<>NEW.doctor_id OR OLD.organization_id<>NEW.organization_id OR OLD.patient_id IS DISTINCT FROM NEW.patient_id) THEN RAISE EXCEPTION 'IMMUTABLE_MEDICAL_IDENTITY'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER validate_medical BEFORE INSERT OR UPDATE ON medical_records FOR EACH ROW EXECUTE FUNCTION validate_medical_record();

CREATE FUNCTION public.create_appointment_atomic(p_patient_id uuid,p_doctor_id uuid,p_clinic_id uuid,p_start_at timestamptz,p_end_at timestamptz,p_visit_type visit_type DEFAULT 'first_visit',p_patient_notes text DEFAULT NULL)
RETURNS public.appointments LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d doctors; c clinics; s subscriptions; a appointments; v_status appointment_status; expiry timestamptz; v_duration int; local_start timestamp; local_end timestamp;
BEGIN
 IF auth.uid() IS NULL OR p_patient_id IS DISTINCT FROM auth.uid() OR current_app_role()<>'patient' THEN RAISE EXCEPTION 'UNAUTHORIZED_PATIENT' USING ERRCODE='42501'; END IF;
 IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at<=p_start_at OR length(coalesce(p_patient_notes,''))>1000 OR p_visit_type='walk_in' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 -- Patient lock serializes the global three-booking cap; doctor lock serializes schedule validation.
 PERFORM 1 FROM users WHERE id=p_patient_id AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PATIENT_INACTIVE' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_doctor_id::text,0));
 UPDATE appointments SET status='expired',updated_at=now() WHERE status='pending' AND expires_at<=now() AND (doctor_id=p_doctor_id OR patient_id=p_patient_id);
 SELECT * INTO d FROM doctors WHERE id=p_doctor_id AND verification_status='approved' AND is_listed_publicly;
 IF NOT FOUND OR NOT org_is_bookable(d.organization_id) THEN RAISE EXCEPTION 'DOCTOR_OR_ORGANIZATION_UNAVAILABLE' USING ERRCODE='P0002'; END IF;
 SELECT * INTO c FROM clinics WHERE id=p_clinic_id AND organization_id=d.organization_id AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'CLINIC_UNAVAILABLE' USING ERRCODE='P0002'; END IF;
 SELECT * INTO s FROM subscriptions WHERE organization_id=d.organization_id;
 IF p_start_at<now()+make_interval(mins=>c.min_lead_minutes) THEN RAISE EXCEPTION 'SLOT_TOO_SOON' USING ERRCODE='P0004'; END IF;
 IF p_start_at>now()+make_interval(days=>s.booking_horizon_days) THEN RAISE EXCEPTION 'SLOT_BEYOND_HORIZON' USING ERRCODE='P0005'; END IF;
 local_start:=p_start_at AT TIME ZONE c.timezone; local_end:=p_end_at AT TIME ZONE c.timezone;
 SELECT av.slot_duration_minutes INTO v_duration FROM availability av
 WHERE av.doctor_id=p_doctor_id AND av.clinic_id=p_clinic_id AND av.is_active AND av.day_of_week=extract(dow FROM local_start)
 AND local_start::date=local_end::date AND local_start::time>=av.start_time AND local_end::time<=av.end_time
 AND extract(epoch FROM(p_end_at-p_start_at))=av.slot_duration_minutes*60
 AND mod(extract(epoch FROM(local_start::time-av.start_time)),av.slot_duration_minutes*60)=0 LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'SLOT_OUTSIDE_AVAILABILITY' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM availability_exceptions e WHERE e.doctor_id=p_doctor_id AND (e.clinic_id IS NULL OR e.clinic_id=p_clinic_id) AND e.start_at<p_end_at AND e.end_at>p_start_at) THEN RAISE EXCEPTION 'SLOT_IN_EXCEPTION' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM appointments WHERE patient_id=p_patient_id AND status IN ('pending','confirmed','checked_in') AND end_at>now())>=3 THEN RAISE EXCEPTION 'MAX_ACTIVE_BOOKINGS_REACHED' USING ERRCODE='P0006'; END IF;
 v_status:=CASE WHEN c.auto_confirm_bookings THEN 'confirmed'::appointment_status ELSE 'pending'::appointment_status END;
 IF v_status='pending' THEN expiry:=least(now()+make_interval(hours=>c.pending_expiry_hours),p_start_at-make_interval(mins=>c.expiry_before_start_mins)); IF expiry<=now() THEN RAISE EXCEPTION 'HOLD_EXPIRES_IMMEDIATELY' USING ERRCODE='P0004'; END IF; END IF;
 INSERT INTO appointments(organization_id,clinic_id,doctor_id,patient_id,start_at,end_at,status,visit_type,booking_source,fee_amount,expires_at,patient_notes)
 VALUES(d.organization_id,p_clinic_id,p_doctor_id,p_patient_id,p_start_at,p_end_at,v_status,p_visit_type,'patient_portal',CASE WHEN p_visit_type='follow_up' THEN d.follow_up_fee ELSE d.consultation_fee END,expiry,p_patient_notes) RETURNING * INTO a;
 INSERT INTO audit_logs(organization_id,actor_id,action,entity_type,entity_id) VALUES(d.organization_id,auth.uid(),'appointment.created','appointment',a.id);
 RETURN a;
END $$;
REVOKE ALL ON FUNCTION create_appointment_atomic(uuid,uuid,uuid,timestamptz,timestamptz,visit_type,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION create_appointment_atomic(uuid,uuid,uuid,timestamptz,timestamptz,visit_type,text) TO authenticated;

CREATE FUNCTION public.transition_appointment(p_id uuid,p_next appointment_status,p_reason text DEFAULT NULL) RETURNS appointments LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a appointments; c clinics; role user_role; staff boolean; allowed boolean:=false;
BEGIN
 role:=current_app_role(); SELECT * INTO a FROM appointments WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR role IS NULL OR NOT can_read_appointment(a.organization_id,a.clinic_id,a.doctor_id,a.patient_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM clinics WHERE id=a.clinic_id; staff:=role IN ('doctor','receptionist');
 IF a.status='pending' THEN
  allowed:=(p_next='cancelled' AND role='patient' AND a.patient_id=auth.uid()) OR
  (p_next='confirmed' AND staff AND now()<a.start_at AND now()<a.expires_at) OR
  (p_next='rejected' AND staff AND length(trim(coalesce(p_reason,'')))>0);
 ELSIF a.status='confirmed' THEN
  allowed:=(p_next='cancelled' AND ((role='patient' AND a.patient_id=auth.uid() AND a.start_at-now()>=make_interval(hours=>c.cancel_window_hours)) OR (staff AND length(trim(coalesce(p_reason,'')))>0))) OR
  (p_next='checked_in' AND staff) OR (p_next='no_show' AND staff AND now()>=a.start_at) OR (p_next='completed' AND role='doctor' AND a.doctor_id=auth.uid() AND now()>=a.start_at);
 ELSIF a.status='checked_in' THEN allowed:=p_next='completed' AND role='doctor' AND a.doctor_id=auth.uid() AND now()>=a.start_at;
 END IF;
 IF NOT coalesce(allowed,false) THEN RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE='22023'; END IF;
 UPDATE appointments SET status=p_next,cancel_reason=CASE WHEN p_next IN ('cancelled','rejected') THEN p_reason ELSE cancel_reason END,cancelled_by=CASE WHEN p_next IN ('cancelled','rejected') THEN auth.uid() ELSE cancelled_by END,checked_in_at=CASE WHEN p_next='checked_in' THEN now() ELSE checked_in_at END,completed_at=CASE WHEN p_next='completed' THEN now() ELSE completed_at END,updated_at=now() WHERE id=p_id RETURNING * INTO a;
 INSERT INTO audit_logs(organization_id,actor_id,action,entity_type,entity_id) VALUES(a.organization_id,auth.uid(),'appointment.'||p_next::text,'appointment',a.id);
 RETURN a;
END $$;
REVOKE ALL ON FUNCTION transition_appointment(uuid,appointment_status,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION transition_appointment(uuid,appointment_status,text) TO authenticated;

CREATE FUNCTION public.expire_pending_appointments() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE n bigint; BEGIN UPDATE appointments SET status='expired',updated_at=now() WHERE status='pending' AND expires_at<=now(); GET DIAGNOSTICS n=ROW_COUNT; RETURN n; END $$;
REVOKE ALL ON FUNCTION expire_pending_appointments() FROM PUBLIC,anon,authenticated;
-- Run this function via pg_cron/service_role, never via an unauthenticated HTTP route.
CREATE FUNCTION public.update_timestamp() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN NEW.updated_at=now();RETURN NEW;END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['users','organizations','subscriptions','clinics','doctors','availability','appointments','medical_records'] LOOP EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION update_timestamp()',t); END LOOP; END $$;
COMMIT;
