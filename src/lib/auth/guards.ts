import type { User } from '../types';
type Actor = Pick<User, 'id' | 'role' | 'organizationId' | 'clinicId'>;
export function canAccess(
  user: Actor,
  resource: { organizationId: string; patientId?: string; doctorId: string; clinicId?: string },
  kind: 'appointment' | 'medical',
) {
  if (user.role === 'super_admin') return true;
  if (user.role === 'patient') return user.id === resource.patientId;
  if (kind === 'medical')
    return user.role === 'doctor' && user.id === resource.doctorId;
  if (user.organizationId !== resource.organizationId) return false;
  if (user.role === 'doctor') return user.id === resource.doctorId;
  if (user.role === 'clinic_owner') return true;
  if (user.role === 'receptionist') return user.clinicId === resource.clinicId;
  return false;
}
