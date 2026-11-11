-- Add only the missing indexes for schedule, clinical-record, audit, and expiry hot paths.
BEGIN;

-- Supports branch-scoped schedule replacement and doctor/clinic/day slot lookups.
CREATE INDEX idx_availability_doctor_clinic_day
  ON public.availability (doctor_id, clinic_id, day_of_week);

-- Both patient and treating-doctor record reads filter on these leading keys.
-- A backward scan also supports newest-updated-first reads within either scope.
CREATE INDEX idx_medical_records_patient_updated_at
  ON public.medical_records (patient_id, updated_at);
CREATE INDEX idx_medical_records_doctor_updated_at
  ON public.medical_records (doctor_id, updated_at);

-- Tenant history and the unscoped super-admin newest-30 feed need different leading keys.
CREATE INDEX idx_audit_logs_org_created_at
  ON public.audit_logs (organization_id, created_at DESC);
CREATE INDEX idx_audit_logs_created_at
  ON public.audit_logs (created_at DESC);

-- The global expiry cron has no doctor filter. Preserve idx_appointments_pending_expiry
-- (doctor_id, expires_at), which still serves doctor-specific cleanup during staff booking.
CREATE INDEX idx_appointments_pending_expiry_global
  ON public.appointments (expires_at)
  WHERE status = 'pending';

COMMIT;
