import type { ActionResult } from '../types';
export function canTransition(
  a: { status: string; start: string; expiresAt?: string },
  next: string,
  role: string,
  now: Date,
  cancelHours = 2,
  reason = '',
): ActionResult<true> {
  const fail = (error: string): ActionResult<true> => ({
    success: false,
    error,
    code: 'INVALID_TRANSITION',
  });
  const before = now.getTime() < new Date(a.start).getTime();
  const staff = ['doctor', 'receptionist'].includes(role);
  if (a.status === 'pending') {
    if (next === 'cancelled' && role === 'patient') return { success: true, data: true };
    if (next === 'expired' && role === 'system' && a.expiresAt && new Date(a.expiresAt) <= now)
      return { success: true, data: true };
    if (next === 'confirmed' && staff && before && a.expiresAt && new Date(a.expiresAt) > now)
      return { success: true, data: true };
    if (next === 'rejected' && staff && reason.trim()) return { success: true, data: true };
  }
  if (a.status === 'confirmed') {
    if (
      next === 'cancelled' &&
      role === 'patient' &&
      new Date(a.start).getTime() - now.getTime() >= cancelHours * 3600000
    )
      return { success: true, data: true };
    if (next === 'cancelled' && staff && reason.trim()) return { success: true, data: true };
    if (next === 'checked_in' && staff) return { success: true, data: true };
    if (next === 'no_show' && staff && !before) return { success: true, data: true };
  }
  if (
    ['confirmed', 'checked_in'].includes(a.status) &&
    next === 'completed' &&
    role === 'doctor' &&
    !before
  )
    return { success: true, data: true };
  return fail(
    next === 'cancelled' && role === 'patient'
      ? 'الإلغاء متاح قبل الموعد بساعتين على الأقل.'
      : 'هذا الإجراء غير مسموح لحالة الموعد أو صلاحيتك أو توقيت الزيارة.',
  );
}
