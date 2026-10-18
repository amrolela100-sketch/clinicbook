import { describe, it, expect, beforeEach } from 'vitest';
import findSlotsTool from '../../agent/tools/find_available_slots';
import bookAppointmentTool from '../../agent/tools/book_appointment';
import handlePatientResponseTool from '../../agent/tools/handle_patient_response';
import { checkUpcomingAppointmentsRetention } from '../../agent/schedules/appointment_retention';
import { all, appointments, saveAppointment } from '../../src/lib/demo-db';
import type { Doctor, Appointment } from '../../src/lib/types';

describe('ClinicBook Eve AI Agent Tools & Schedules', () => {
  it('find_available_slots returns doctors and available slots', async () => {
    const doctors = all<Doctor>('doctor');
    expect(doctors.length).toBeGreaterThan(0);

    const firstDoctor = doctors[0];
    const result = (await findSlotsTool.execute({
      doctorId: firstDoctor.id,
      date: '2026-10-25',
    })) as { success: boolean; doctors: Array<{ doctorId: string; specialty: string }> };

    expect(result.success).toBe(true);
    expect(result.doctors).toHaveLength(1);
    expect(result.doctors[0].doctorId).toBe(firstDoctor.id);
  });

  it('find_available_slots filters by specialty', async () => {
    const result = (await findSlotsTool.execute({
      specialty: 'القلب',
      date: '2026-10-25',
    })) as { success: boolean; doctors: Array<{ doctorId: string; specialty: string }> };

    expect(result.success).toBe(true);
    expect(result.doctors.length).toBeGreaterThan(0);
    expect(result.doctors[0].specialty).toContain('القلب');
  });

  it('book_appointment rejects invalid phone number or parameters via Zod', async () => {
    const doctors = all<Doctor>('doctor');
    const firstDoctor = doctors[0];

    // Invalid ISO datetime
    await expect(
      bookAppointmentTool.inputSchema.parseAsync({
        doctorId: firstDoctor.id,
        start: 'invalid-date',
        patientName: 'أحمد علي',
        phone: '0501234567',
      }),
    ).rejects.toThrow();
  });

  it('handle_patient_response gracefully handles non-existent appointment', async () => {
    const result = (await handlePatientResponseTool.execute({
      appointmentId: 'non-existent-uuid',
      action: 'confirm_attendance',
      reason: '',
    })) as { success: boolean; code?: string };

    expect(result.success).toBe(false);
    expect(result.code).toBe('NOT_FOUND');
  });

  it('checkUpcomingAppointmentsRetention computes upcoming candidates correctly', async () => {
    const result = await checkUpcomingAppointmentsRetention(48, new Date('2026-10-18T00:00:00Z'));
    expect(result).toHaveProperty('checkedCount');
    expect(result).toHaveProperty('upcomingCount');
    expect(Array.isArray(result.candidatesForConfirmation)).toBe(true);
  });

  it('get_clinic_summary computes daily operational metrics', async () => {
    const { default: getClinicSummaryTool } = await import('../../agent/tools/get_clinic_summary');
    const result = await getClinicSummaryTool.execute({
      date: '2026-10-18',
    });

    expect(result.success).toBe(true);
    expect(result.summary).toHaveProperty('totalAppointments');
    expect(result.summary).toHaveProperty('totalEstimatedRevenue');
    expect(Array.isArray(result.summary.doctorLoad)).toBe(true);
  });
});
