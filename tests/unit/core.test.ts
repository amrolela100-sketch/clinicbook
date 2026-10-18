import { describe, it, expect } from 'vitest';
import { getAvailableSlots } from '../../src/lib/services/slots-engine';
import { canTransition } from '../../src/lib/services/appointment-lifecycle';
import { canAccess } from '../../src/lib/auth/guards';
const base = {
  date: '2026-10-15',
  timezone: 'Asia/Damascus',
  shifts: [{ start: '09:00', end: '11:00', duration: 30 }],
  now: new Date('2026-10-14T00:00:00Z'),
  leadMinutes: 60,
  horizonDays: 30,
  bookings: [],
  exceptions: [],
};
describe('slots: half-open intervals and timezones', () => {
  it('converts Damascus local time into UTC', () =>
    expect(getAvailableSlots(base)[0].start).toBe('2026-10-15T06:00:00.000Z'));
  it('slices 30 minute periods', () => expect(getAvailableSlots(base)).toHaveLength(4));
  it('slices 20 minute periods', () =>
    expect(
      getAvailableSlots({ ...base, shifts: [{ start: '09:00', end: '11:00', duration: 20 }] }),
    ).toHaveLength(6));
  it('removes exceptions', () =>
    expect(
      getAvailableSlots({
        ...base,
        exceptions: [{ start: '2026-10-15T06:00:00Z', end: '2026-10-15T07:00:00Z' }],
      }),
    ).toHaveLength(2));
  it('keeps adjacent slots', () =>
    expect(
      getAvailableSlots({
        ...base,
        bookings: [
          { start: '2026-10-15T06:00:00Z', end: '2026-10-15T06:30:00Z', status: 'confirmed' },
        ],
      }),
    ).toHaveLength(3));
  it('ignores expired pending holds', () =>
    expect(
      getAvailableSlots({
        ...base,
        bookings: [
          {
            start: '2026-10-15T06:00:00Z',
            end: '2026-10-15T06:30:00Z',
            status: 'pending',
            expiresAt: '2026-10-13T00:00:00Z',
          },
        ],
      }),
    ).toHaveLength(4));
  it('blocks unexpired pending holds', () =>
    expect(
      getAvailableSlots({
        ...base,
        bookings: [
          {
            start: '2026-10-15T06:00:00Z',
            end: '2026-10-15T06:30:00Z',
            status: 'pending',
            expiresAt: '2026-10-14T12:00:00Z',
          },
        ],
      }),
    ).toHaveLength(3));
  it('enforces lead time', () =>
    expect(getAvailableSlots({ ...base, now: new Date('2026-10-15T06:00:00Z') })).toHaveLength(2));
  it('enforces horizon', () =>
    expect(getAvailableSlots({ ...base, horizonDays: 0 })).toHaveLength(0));
  it('does not create incomplete slots', () =>
    expect(
      getAvailableSlots({ ...base, shifts: [{ start: '09:00', end: '09:50', duration: 30 }] }),
    ).toHaveLength(1));
  it('respects DST in New York', () =>
    expect(
      getAvailableSlots({ ...base, date: '2026-11-02', timezone: 'America/New_York' })[0].start,
    ).toBe('2026-11-02T14:00:00.000Z'));
  it('deduplicates overlapping shifts', () =>
    expect(getAvailableSlots({ ...base, shifts: [...base.shifts, ...base.shifts] })).toHaveLength(
      4,
    ));
});
const appt = { status: 'confirmed', start: '2026-10-15T09:00:00Z' };
describe('appointment lifecycle', () => {
  it('allows doctor confirmation before expiry', () =>
    expect(
      canTransition(
        { ...appt, status: 'pending', expiresAt: '2026-10-15T08:00:00Z' },
        'confirmed',
        'doctor',
        new Date('2026-10-15T06:00:00Z'),
      ).success,
    ).toBe(true));
  it('rejects expired confirmation', () =>
    expect(
      canTransition(
        { ...appt, status: 'pending', expiresAt: '2026-10-15T05:00:00Z' },
        'confirmed',
        'doctor',
        new Date('2026-10-15T06:00:00Z'),
      ).success,
    ).toBe(false));
  it('allows patient cancellation at exactly two hours', () =>
    expect(
      canTransition(appt, 'cancelled', 'patient', new Date('2026-10-15T07:00:00Z')).success,
    ).toBe(true));
  it('denies late patient cancellation', () =>
    expect(
      canTransition(appt, 'cancelled', 'patient', new Date('2026-10-15T08:00:00Z')).success,
    ).toBe(false));
  it('denies early completion', () =>
    expect(
      canTransition(appt, 'completed', 'doctor', new Date('2026-10-15T08:00:00Z')).success,
    ).toBe(false));
  it('allows completion after start', () =>
    expect(
      canTransition(appt, 'completed', 'doctor', new Date('2026-10-15T10:00:00Z')).success,
    ).toBe(true));
  it('reception cannot complete visit', () =>
    expect(
      canTransition(appt, 'completed', 'receptionist', new Date('2026-10-15T10:00:00Z')).success,
    ).toBe(false));
  it('staff cancellation needs reason', () =>
    expect(
      canTransition(appt, 'cancelled', 'doctor', new Date('2026-10-15T06:00:00Z')).success,
    ).toBe(false));
  it('terminal states cannot reopen', () =>
    expect(
      canTransition({ ...appt, status: 'completed' }, 'confirmed', 'doctor', new Date()).success,
    ).toBe(false));
});
describe('tenant isolation', () => {
  const resource = {
    organizationId: 'org-a',
    doctorId: 'doc-a',
    patientId: 'pat-a',
    clinicId: 'clinic-a',
  };
  it('rejects cross tenant access', () =>
    expect(
      canAccess({ id: 'doc-b', role: 'doctor', organizationId: 'org-b' }, resource, 'appointment'),
    ).toBe(false));
  it('patient sees only own appointments', () =>
    expect(canAccess({ id: 'pat-b', role: 'patient' }, resource, 'appointment')).toBe(false));
  it('reception cannot access medical records', () =>
    expect(
      canAccess(
        { id: 'rec', role: 'receptionist', organizationId: 'org-a', clinicId: 'clinic-a' },
        resource,
        'medical',
      ),
    ).toBe(false));
  it('owner cannot read clinical notes by ownership', () =>
    expect(
      canAccess(
        { id: 'owner', role: 'clinic_owner', organizationId: 'org-a' },
        resource,
        'medical',
      ),
    ).toBe(false));
  it('treating doctor can read clinical notes', () =>
    expect(
      canAccess({ id: 'doc-a', role: 'doctor', organizationId: 'org-a' }, resource, 'medical'),
    ).toBe(true));
  it('reception limited to branch', () =>
    expect(
      canAccess(
        { id: 'rec', role: 'receptionist', organizationId: 'org-a', clinicId: 'clinic-b' },
        resource,
        'appointment',
      ),
    ).toBe(false));
});
