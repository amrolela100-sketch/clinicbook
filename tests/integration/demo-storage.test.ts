import { it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db, saveAppointment, appointments } from '../../src/lib/demo-db';
import type { Appointment } from '../../src/lib/types';
const id = randomUUID(),
  doctorId = randomUUID();
const a: Appointment = {
  id,
  doctorId,
  organizationId: 'test-storage',
  clinicId: 'test-branch',
  patientName: 'Synthetic test',
  phone: '0000000',
  start: '2030-01-01T09:00:00.000Z',
  end: '2030-01-01T09:30:00.000Z',
  status: 'confirmed',
  visitType: 'walk_in',
  source: 'reception_desk',
  fee: 25,
  payment: 'unpaid',
  createdAt: new Date().toISOString(),
};
afterEach(() => db.prepare('DELETE FROM appointments WHERE organization_id=?').run('test-storage'));
it('updating the same active appointment does not conflict with itself', () => {
  saveAppointment(a);
  expect(() => saveAppointment({ ...a, status: 'checked_in' })).not.toThrow();
  expect(appointments().find((v) => v.id === id)?.status).toBe('checked_in');
});
it('a different appointment cannot overlap the same doctor', () => {
  saveAppointment(a);
  expect(() => saveAppointment({ ...a, id: randomUUID() })).toThrow('SLOT_CONFLICT');
});
