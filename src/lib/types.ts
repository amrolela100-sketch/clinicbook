export type Role = 'super_admin' | 'clinic_owner' | 'doctor' | 'receptionist' | 'patient';
export type Status =
  | 'pending'
  | 'confirmed'
  | 'checked_in'
  | 'completed'
  | 'cancelled'
  | 'rejected'
  | 'expired'
  | 'no_show';
export type ActionResult<T> =
  { success: true; data: T } | { success: false; error: string; code: string };
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  organizationId?: string;
  clinicId?: string;
}
export interface Doctor {
  id: string;
  name: string;
  specialty: string;
  organizationId: string;
  clinicId: string;
  clinic: string;
  city: string;
  district: string;
  fee: number;
  followUpFee: number;
  rating: number;
  reviews: number;
  experience: number;
  bio: string;
  color: string;
  image: string;
  verified: boolean;
  license: string;
  bookingHorizonDays?: number;
  cancelHours?: number;
}
export interface Appointment {
  id: string;
  organizationId: string;
  clinicId: string;
  doctorId: string;
  patientId?: string;
  patientName: string;
  phone: string;
  start: string;
  end: string;
  status: Status;
  visitType: string;
  source: string;
  fee: number;
  payment: string;
  expiresAt?: string;
  notes?: string;
  reason?: string;
  createdAt: string;
}
export interface Shift {
  day: number;
  start: string;
  end: string;
  duration: number;
  active: boolean;
}
export interface MedicalRecord {
  appointmentId: string;
  diagnosis: string;
  complaint: string;
  notes: string;
  medications: { name: string; dose: string; frequency: string; duration: string }[];
  followUp: string;
  visible: boolean;
}
