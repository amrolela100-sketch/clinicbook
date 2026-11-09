import type { User } from '../types';

type Actor = Pick<User, 'id' | 'role' | 'organizationId' | 'clinicId'>;

/**
 * Authorization guard for appointments and clinical EMR medical records.
 * Aligns strictly with Supabase RLS policies (can_read_appointment & treating_doctor_read):
 * - super_admin is strictly platform-level (organizations, verifications, platform audit)
 *   and has ZERO access to medical encounters and tenant appointments.
 * - treating doctor only for clinical medical encounters.
 * - patient reads only own records/appointments.
 * - receptionist bounded to assigned clinic branch.
 */
export function canAccess(
  user: Actor,
  resource: { organizationId: string; patientId?: string; doctorId: string; clinicId?: string },
  kind: 'appointment' | 'medical',
): boolean {
  // 1. Super admin is strictly barred from clinical medical records and tenant appointments
  if (user.role === 'super_admin') {
    return false;
  }
  // 2. Patient access: own records/appointments only
  if (user.role === 'patient') {
    return user.id === resource.patientId;
  }
  // 3. Clinical records: treating doctor within the same organization only
  if (kind === 'medical') {
    return (
      user.role === 'doctor' &&
      user.id === resource.doctorId &&
      user.organizationId === resource.organizationId
    );
  }
  // 4. Appointments: tenant isolation check
  if (user.organizationId !== resource.organizationId) {
    return false;
  }
  if (user.role === 'doctor') {
    return user.id === resource.doctorId;
  }
  if (user.role === 'clinic_owner') {
    return true;
  }
  if (user.role === 'receptionist') {
    return user.clinicId === resource.clinicId;
  }
  return false;
}
