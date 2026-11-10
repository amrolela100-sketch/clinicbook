export interface PublicDoctorDirectoryRow {
  id: string;
  full_name: string;
  title_ar: string;
  bio_ar: string | null;
  specialty_id: string;
  specialty_name: string | null;
  organization_id: string;
  clinic_id: string | null;
  clinic_name: string | null;
  city_name: string | null;
  district: string | null;
  consultation_fee: number;
  follow_up_fee: number;
  years_of_experience: number;
  rating_avg: number;
  reviews_count: number;
  avatar_url: string | null;
  license_number: string;
  booking_horizon_days?: number | null;
  cancel_window_hours?: number | null;
}

export interface TenantDoctorDirectoryRow extends PublicDoctorDirectoryRow {
  verification_status: 'pending' | 'approved' | 'rejected';
  is_listed_publicly: boolean;
}

export interface TenantAppointmentRpcRow {
  id: string;
  organization_id: string;
  clinic_id: string;
  doctor_id: string;
  patient_id: string | null;
  patient_name: string;
  patient_phone: string;
  start_at: string;
  end_at: string;
  status:
    | 'pending'
    | 'confirmed'
    | 'checked_in'
    | 'completed'
    | 'cancelled'
    | 'rejected'
    | 'expired'
    | 'no_show';
  visit_type: string;
  booking_source: string;
  fee_amount: number | null;
  payment_status: string;
  expires_at: string | null;
  patient_notes: string | null;
  cancel_reason: string | null;
  created_at: string;
}

export interface TenantTeamMemberRpcRow {
  id: string;
  full_name: string;
  email: string;
  clinic_id: string | null;
  member_role: 'owner' | 'doctor' | 'receptionist';
}

export interface TenantBillingRequestRpcRow {
  id: string;
  tier: 'solo_starter' | 'clinic_pro' | 'enterprise' | string;
  status: 'pending' | 'approved' | string;
  created_at: string;
}

export interface PublicReviewRpcRow {
  appointment_id: string;
  doctor_id: string;
  rating: number;
  comment: string | null;
  display_name: string;
  created_at?: string;
}

export interface SuperAdminDashboardSnapshot {
  organizations: Array<{
    id: string;
    name: string;
    city: string;
    district: string;
    phone: string;
    license: string;
    tier: 'solo_starter' | 'clinic_pro' | 'enterprise';
    status: 'approved' | 'pending' | 'rejected';
    subscriptionStatus: 'active' | 'trialing' | 'past_due' | 'canceled';
    periodEnd: string;
    cancelHours: number;
    leadMinutes: number;
    pendingHours: number;
    expiryMinutes: number;
    timezone: string;
  }>;
  verifications: Array<{
    id: string;
    name: string;
    type: string;
    city: string;
    license: string;
    status: string;
  }>;
  references: Array<{
    id: string;
    name: string;
    type: string;
  }>;
  audit: Array<{
    id: string;
    action: string;
    created_at: string;
    entity_id: string;
  }>;
}

export interface OnboardOrganizationRpcRow {
  organization_id: string;
  clinic_id: string;
}
