BEGIN;
REVOKE CREATE ON SCHEMA public FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.aggregate_doctor_reviews() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d uuid; BEGIN d:=CASE WHEN TG_OP='DELETE' THEN OLD.doctor_id ELSE NEW.doctor_id END;
 UPDATE doctors SET rating_avg=coalesce((SELECT avg(rating) FROM reviews WHERE doctor_id=d AND is_published),0),reviews_count=(SELECT count(*) FROM reviews WHERE doctor_id=d AND is_published) WHERE id=d;
 RETURN NULL; END $$;
CREATE TRIGGER aggregate_reviews AFTER INSERT OR UPDATE OR DELETE ON reviews FOR EACH ROW EXECUTE FUNCTION aggregate_doctor_reviews();
COMMIT;
