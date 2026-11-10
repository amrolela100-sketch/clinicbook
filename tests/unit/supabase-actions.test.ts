import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/services/supabase-booking-service', () => ({
  transitionSupabaseAppointment: vi.fn().mockResolvedValue({
    success: true,
    data: { id: 'appt-1', status: 'confirmed' },
  }),
}));

import {
  executeSupabaseAction,
  SupabaseActionError,
} from '../../src/lib/services/supabase-actions-service';
import type { User } from '../../src/lib/types';

// Mock Supabase admin & server modules
vi.mock('../../src/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    from: vi.fn().mockImplementation((table: string) => {
      serverFromTables.push(table);
      return createTableBuilder(table);
    }),
    rpc: vi.fn().mockImplementation(async (fn: string, args?: unknown) => {
      serverRpcCalls.push({ fn, args });
      return mockServerRpcResponses[fn] ?? { data: null, error: null };
    }),
  }),
}));

const mockTableData: Record<string, unknown> = {};
const mockTableErrors: Record<string, { message?: string; code?: string } | null> = {};
const mockServerRpcResponses: Record<
  string,
  { data: unknown; error: { message?: string; code?: string } | null }
> = {};
const serverRpcCalls: Array<{ fn: string; args?: unknown }> = [];
const mockAdminRpcResponses: Record<
  string,
  { data: unknown; error: { message?: string; code?: string } | null }
> = {};
const adminRpcCalls: Array<{ fn: string; args?: unknown }> = [];
const serverFromTables: string[] = [];
const mockDeleteUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null });
const mockCreateUser = vi
  .fn()
  .mockResolvedValue({ data: { user: { id: 'new-user-id' } }, error: null });
let mockInviteUserResult: {
  data: { user: { id: string } | null };
  error: { message?: string } | null;
} = { data: { user: { id: 'new-user-id' } }, error: null };
const mockInviteUserByEmail = vi.fn().mockImplementation(async () => mockInviteUserResult);

function createTableBuilder(table: string) {
  let op = 'select';
  const builder: any = {
    hasCount: false,
    select: vi
      .fn()
      .mockImplementation((_cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count === 'exact') {
          builder.hasCount = true;
        }
        return builder;
      }),
    insert: vi.fn().mockImplementation(() => {
      const err = mockTableErrors[`${table}.insert`] ?? mockTableErrors[table] ?? null;
      return Promise.resolve({ error: err, data: null });
    }),
    update: vi.fn().mockImplementation(() => {
      op = 'update';
      return builder;
    }),
    upsert: vi.fn().mockImplementation(() => {
      const err = mockTableErrors[`${table}.upsert`] ?? mockTableErrors[table] ?? null;
      return Promise.resolve({ error: err, data: null });
    }),
    delete: vi.fn().mockImplementation(() => {
      op = 'delete';
      return builder;
    }),
    eq: vi.fn().mockImplementation(() => builder),
    in: vi.fn().mockImplementation(() => builder),
    lt: vi.fn().mockImplementation(() => builder),
    gt: vi.fn().mockImplementation(() => builder),
    or: vi.fn().mockImplementation(() => builder),
    order: vi.fn().mockImplementation(() => builder),
    limit: vi.fn().mockImplementation(() => builder),
    maybeSingle: vi.fn().mockImplementation(() => {
      const custom = mockTableData[table];
      const err = mockTableErrors[`${table}.select`] ?? null;
      if (table === 'reviews' && Array.isArray(custom)) {
        return Promise.resolve({ data: null, error: err });
      }
      return Promise.resolve({ data: custom !== undefined ? custom : null, error: err });
    }),
    single: vi.fn().mockImplementation(() => {
      const custom = mockTableData[table];
      const err = mockTableErrors[`${table}.select`] ?? null;
      return Promise.resolve({ data: custom !== undefined ? custom : null, error: err });
    }),
    then: (resolve: any) => {
      const custom = mockTableData[table];
      const err = mockTableErrors[`${table}.${op}`] ?? mockTableErrors[table] ?? null;
      if (builder.hasCount) {
        return Promise.resolve({
          count: typeof custom === 'number' ? custom : 0,
          data: [],
          error: err,
        }).then(resolve);
      }
      return Promise.resolve({
        data: err ? null : Array.isArray(custom) ? custom : custom ? [custom] : [],
        error: err,
      }).then(resolve);
    },
  };
  return builder;
}

vi.mock('../../src/lib/supabase/admin', () => ({
  createSupabaseAdmin: vi.fn().mockReturnValue({
    from: vi.fn().mockImplementation((table: string) => createTableBuilder(table)),
    auth: {
      admin: {
        inviteUserByEmail: (...args: unknown[]) => mockInviteUserByEmail(...args),
        createUser: (...args: unknown[]) => mockCreateUser(...args),
        deleteUser: (...args: unknown[]) => mockDeleteUser(...args),
      },
    },
    rpc: vi.fn().mockImplementation(async (fn: string, args?: unknown) => {
      adminRpcCalls.push({ fn, args });
      return (
        mockAdminRpcResponses[fn] ??
        (fn === 'provision_team_member_atomic'
          ? { data: 'new-user-id', error: null }
          : { data: null, error: null })
      );
    }),
  }),
}));

describe('Supabase Actions Service Security & Validation', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockTableData)) {
      delete mockTableData[key];
    }
    for (const key of Object.keys(mockTableErrors)) {
      delete mockTableErrors[key];
    }
    for (const key of Object.keys(mockServerRpcResponses)) {
      delete mockServerRpcResponses[key];
    }
    for (const key of Object.keys(mockAdminRpcResponses)) {
      delete mockAdminRpcResponses[key];
    }
    serverRpcCalls.length = 0;
    adminRpcCalls.length = 0;
    serverFromTables.length = 0;
    mockInviteUserResult = { data: { user: { id: 'new-user-id' } }, error: null };
    mockInviteUserByEmail.mockClear();
    mockCreateUser.mockClear();
    mockDeleteUser.mockClear();
  });

  const patientUser: User = {
    id: 'pat-1',
    name: 'المريض عمر',
    email: 'patient@example.com',
    role: 'patient',
  };

  const doctorUser: User = {
    id: 'doc-1',
    name: 'د. سمير',
    email: 'doc@example.com',
    role: 'doctor',
    organizationId: 'org-1',
    clinicId: 'clinic-1',
  };

  const ownerUser: User = {
    id: 'owner-1',
    name: 'د. أحمد',
    email: 'owner@example.com',
    role: 'clinic_owner',
    organizationId: 'org-1',
    clinicId: 'clinic-1',
  };

  const receptionistUser: User = {
    id: 'rec-1',
    name: 'موظف الاستقبال رامي',
    email: 'rec@example.com',
    role: 'receptionist',
    organizationId: 'org-1',
    clinicId: 'clinic-1',
  };

  const superAdminUser: User = {
    id: 'admin-1',
    name: 'مدير المنصة',
    email: 'admin@example.com',
    role: 'super_admin',
  };

  // ─── Guard & Rejection Tests ───────────────────────────────
  it('rejects medical record mutation by non-doctors (e.g. receptionist or owner)', async () => {
    await expect(
      executeSupabaseAction(receptionistUser, 'medical', {
        appointmentId: 'appt-1',
        diagnosis: 'التهاب حاد',
      }),
    ).rejects.toThrowError(SupabaseActionError);

    await expect(
      executeSupabaseAction(ownerUser, 'medical', {
        appointmentId: 'appt-1',
        diagnosis: 'التهاب حاد',
      }),
    ).rejects.toThrowError(SupabaseActionError);
  });

  it('rejects payment collection by unauthorized patients', async () => {
    await expect(
      executeSupabaseAction(patientUser, 'payment', { id: 'appt-1' }),
    ).rejects.toThrowError(SupabaseActionError);
  });

  it('rejects inverted schedule shift times (end <= start)', async () => {
    await expect(
      executeSupabaseAction(doctorUser, 'schedule', {
        doctorId: doctorUser.id,
        shifts: [{ day: 0, start: '14:00', end: '12:00', duration: 30, active: true }],
      }),
    ).rejects.toThrowError('يجب أن تكون نهاية الدوام بعد بدايته');
  });

  it('rejects overlapping active schedule shifts on the same day', async () => {
    await expect(
      executeSupabaseAction(doctorUser, 'schedule', {
        doctorId: doctorUser.id,
        shifts: [
          { day: 1, start: '09:00', end: '13:00', duration: 30, active: true },
          { day: 1, start: '12:00', end: '15:00', duration: 30, active: true },
        ],
      }),
    ).rejects.toThrowError('يوجد تداخل في فترات الدوام');
  });

  it('rejects invalid availability exception range (end <= start)', async () => {
    await expect(
      executeSupabaseAction(doctorUser, 'exception', {
        doctorId: doctorUser.id,
        start: '2026-11-10T12:00:00Z',
        end: '2026-11-10T11:00:00Z',
        reason: 'إجازة شخصية',
      }),
    ).rejects.toThrowError('حدد فترة إجازة صالحة');
  });

  it('rejects team management operations from non-owners', async () => {
    await expect(
      executeSupabaseAction(doctorUser, 'team', {
        name: 'طبيب جديد',
        email: 'newdoc@example.com',
        role: 'doctor',
        specialty: 'الطب العام',
        fee: 30,
        license: 'SY-1234',
      }),
    ).rejects.toThrowError(SupabaseActionError);
  });

  it('rejects branch addition from non-owners', async () => {
    await expect(
      executeSupabaseAction(patientUser, 'branch', {
        name: 'فرع جديد',
        city: 'حلب',
        district: 'الشهباء',
        phone: '021-998877',
      }),
    ).rejects.toThrowError(SupabaseActionError);
  });

  it('rejects reviews submitted by non-patient roles', async () => {
    await expect(
      executeSupabaseAction(doctorUser, 'review', {
        appointmentId: 'appt-1',
        rating: 5,
        comment: 'ممتاز',
      }),
    ).rejects.toThrowError('التقييم متاح للمرضى بعد اكتمال الزيارة فقط');
  });

  it('rejects super_admin operations (verify, subscription, reference) by regular staff', async () => {
    await expect(
      executeSupabaseAction(ownerUser, 'verify', { id: 'org-1', status: 'approved' }),
    ).rejects.toThrowError(SupabaseActionError);

    await expect(
      executeSupabaseAction(ownerUser, 'subscription', { id: 'org-1', tier: 'enterprise' }),
    ).rejects.toThrowError(SupabaseActionError);

    await expect(
      executeSupabaseAction(ownerUser, 'reference', { name: 'طرطوس', type: 'city' }),
    ).rejects.toThrowError(SupabaseActionError);
  });

  it('rejects duplicate onboarding for users who already have an organization', async () => {
    await expect(
      executeSupabaseAction(ownerUser, 'onboard', {
        name: 'مركز جديد',
        city: 'دمشق',
        district: 'الشعلان',
        phone: '011-2233445',
        doctorName: 'د. سمير',
        email: 'doc@example.com',
        license: 'SY-2026',
        tier: 'solo_starter',
      }),
    ).rejects.toThrowError('تم إنشاء المركز مسبقاً');
  });

  it('requires the atomic onboarding migration instead of using compensating writes', async () => {
    mockAdminRpcResponses['onboard_organization_atomic'] = {
      data: null,
      error: { message: 'function not found', code: 'PGRST202' },
    };

    await expect(
      executeSupabaseAction(
        {
          id: 'owner-new',
          name: 'مالك جديد',
          email: 'owner-new@example.com',
          role: 'clinic_owner',
        },
        'onboard',
        {
          name: 'مركز جديد',
          city: 'دمشق',
          district: 'الشعلان',
          phone: '011-2233445',
          doctorName: 'د. سمير',
          email: 'doctor-new@example.com',
          license: 'SY-ONBOARD-MIGRATION',
          tier: 'solo_starter',
        },
      ),
    ).rejects.toMatchObject({ status: 500, code: 'MIGRATION_REQUIRED' });

    expect(mockDeleteUser).toHaveBeenCalledWith('new-user-id');
  });

  it('throws for unknown action types', async () => {
    await expect(executeSupabaseAction(ownerUser, 'non_existent_action', {})).rejects.toThrowError(
      'إجراء غير معروف',
    );
  });

  it('rejects duplicate doctor license numbers in team action', async () => {
    mockTableData['subscriptions'] = { tier: 'clinic_pro', max_doctors: 10 };
    mockTableData['doctors'] = { id: 'doc-existing', license_number: 'SY-EXISTING' };

    await expect(
      executeSupabaseAction(ownerUser, 'team', {
        name: 'طبيب مكرر',
        email: 'docdup@example.com',
        role: 'doctor',
        specialty: 'الطب العام',
        fee: 40,
        license: 'SY-EXISTING',
      }),
    ).rejects.toThrowError('رقم الترخيص الطبي مستخدم مسبقاً');
  });

  it('returns 404 when target doctor does not exist in doctorFee', async () => {
    await expect(
      executeSupabaseAction(ownerUser, 'doctorFee', {
        id: 'non-existent-doc',
        fee: 50,
        followUpFee: 30,
      }),
    ).rejects.toThrowError('الطبيب غير موجود');
  });

  it('returns 404 when appointment does not exist in review action', async () => {
    await expect(
      executeSupabaseAction(patientUser, 'review', {
        appointmentId: 'missing-appt',
        rating: 5,
        comment: 'رائع',
      }),
    ).rejects.toThrowError('الموعد غير موجود');
  });

  it('returns 422 when appointment is not completed in review action', async () => {
    mockTableData['appointments'] = {
      id: 'appt-pending',
      doctor_id: 'doc-1',
      patient_id: patientUser.id,
      status: 'pending',
    };

    await expect(
      executeSupabaseAction(patientUser, 'review', {
        appointmentId: 'appt-pending',
        rating: 5,
        comment: 'رائع',
      }),
    ).rejects.toThrowError('التقييم متاح بعد اكتمال الزيارة فقط');
  });

  // ─── Happy Path Execution Tests ────────────────────────────
  it('executes transition action successfully', async () => {
    const res = await executeSupabaseAction(receptionistUser, 'transition', {
      id: 'appt-1',
      status: 'confirmed',
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toEqual({ id: 'appt-1', status: 'confirmed' });
    }
  });

  it('executes onboard action successfully for unattached user', async () => {
    const unattachedUser: User = {
      id: 'fresh-user-1',
      name: 'د. فادي',
      email: 'fadi@example.com',
      role: 'clinic_owner',
    };

    mockAdminRpcResponses['onboard_organization_atomic'] = {
      data: [{ organization_id: 'org-new-1', clinic_id: 'clinic-new-1' }],
      error: null,
    };

    const res = await executeSupabaseAction(unattachedUser, 'onboard', {
      name: 'مركز الشفاء الطبي',
      city: 'دمشق',
      district: 'المزة',
      phone: '011-6677889',
      doctorName: 'د. فادي',
      email: 'fadi@example.com',
      license: 'SY-DOC-9988',
      tier: 'clinic_pro',
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toHaveProperty('id');
      expect(res.data).toHaveProperty('clinicId');
    }
  });

  it('executes payment action successfully for receptionist', async () => {
    mockTableData['appointments'] = {
      id: 'appt-1',
      organization_id: 'org-1',
      clinic_id: 'clinic-1',
      doctor_id: 'doc-1',
      patient_id: 'pat-1',
      status: 'confirmed',
      payment_status: 'unpaid',
    };

    const res = await executeSupabaseAction(receptionistUser, 'payment', { id: 'appt-1' });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toEqual({ id: 'appt-1', payment: 'paid_cash' });
    }
  });

  it('executes medical action successfully for doctor', async () => {
    mockTableData['appointments'] = {
      id: 'appt-1',
      organization_id: 'org-1',
      clinic_id: 'clinic-1',
      doctor_id: 'doc-1',
      patient_id: 'pat-1',
      status: 'confirmed',
    };

    const res = await executeSupabaseAction(doctorUser, 'medical', {
      appointmentId: 'appt-1',
      diagnosis: 'نزلة برد حادة',
      complaint: 'سعال وحرارة',
      notes: 'راحة تامة لمدة ثلاثة أيام',
      medications: [
        { name: 'باراسيتامول', dose: '500mg', frequency: '3 مرات', duration: '5 أيام' },
      ],
      followUp: '2026-11-15',
      visible: true,
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toEqual({ appointmentId: 'appt-1' });
    }
  });

  it('executes schedule action successfully for doctor self-schedule', async () => {
    const shifts = [
      { day: 0, start: '09:00', end: '13:00', duration: 20 as const, active: true },
      { day: 1, start: '10:00', end: '14:00', duration: 30 as const, active: true },
    ];

    const res = await executeSupabaseAction(doctorUser, 'schedule', {
      doctorId: doctorUser.id,
      shifts,
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toEqual({ doctorId: doctorUser.id, shifts });
    }

    expect(serverRpcCalls).toContainEqual({
      fn: 'replace_availability_atomic',
      args: {
        p_doctor_id: doctorUser.id,
        p_clinic_id: doctorUser.clinicId,
        p_shifts: shifts,
      },
    });
    expect(serverFromTables).not.toContain('availability');
  });

  it.each([
    [{ code: '42501', message: 'FORBIDDEN' }, 403, 'FORBIDDEN'],
    [{ code: '22023', message: 'OVERLAPPING_SHIFTS' }, 422, 'OVERLAP'],
    [{ code: 'PGRST202', message: 'function not found' }, 500, 'MIGRATION_REQUIRED'],
  ] as const)(
    'maps atomic schedule RPC error $0 to status $1 and code $2',
    async (error, status, code) => {
      mockServerRpcResponses['replace_availability_atomic'] = { data: null, error };

      await expect(
        executeSupabaseAction(doctorUser, 'schedule', {
          doctorId: doctorUser.id,
          shifts: [{ day: 0, start: '09:00', end: '13:00', duration: 20, active: true }],
        }),
      ).rejects.toMatchObject({ status, code });

      expect(serverFromTables).not.toContain('availability');
    },
  );

  it('fails closed when the team invitation cannot be delivered', async () => {
    mockTableData['subscriptions'] = { tier: 'clinic_pro', max_doctors: 10 };
    mockTableData['specialties'] = { id: 'spec-1', name_ar: 'الطب العام' };
    mockInviteUserResult = {
      data: { user: null },
      error: { message: 'SMTP provider unavailable' },
    };

    await expect(
      executeSupabaseAction(ownerUser, 'team', {
        name: 'د. مروان الكاتب',
        email: 'invite-failed@example.com',
        role: 'doctor',
        specialty: 'الطب العام',
        fee: 40,
        license: 'SY-MED-INVITE-FAIL',
      }),
    ).rejects.toMatchObject({ status: 502, code: 'INVITE_FAILED' });

    expect(mockInviteUserByEmail).toHaveBeenCalledOnce();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('executes exception action successfully', async () => {
    mockTableData['doctors'] = { id: doctorUser.id };
    mockTableData['appointments'] = [];

    const res = await executeSupabaseAction(doctorUser, 'exception', {
      doctorId: doctorUser.id,
      start: '2026-11-20T08:00:00Z',
      end: '2026-11-20T16:00:00Z',
      reason: 'مؤتمر طبي',
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toHaveProperty('id');
      expect(res.data).toHaveProperty('affected');
    }
  });

  it('executes team member addition successfully by clinic owner', async () => {
    mockTableData['subscriptions'] = { tier: 'clinic_pro', max_doctors: 10 };
    mockTableData['specialties'] = { id: 'spec-1', name_ar: 'الطب العام' };

    const res = await executeSupabaseAction(ownerUser, 'team', {
      name: 'د. مروان الكاتب',
      email: 'marwan@example.com',
      role: 'doctor',
      specialty: 'الطب العام',
      fee: 40,
      license: 'SY-MED-5544',
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toHaveProperty('id');
      expect(res.data).toHaveProperty('email', 'marwan@example.com');
    }
    expect(adminRpcCalls.some((call) => call.fn === 'provision_team_member_atomic')).toBe(true);
  });

  it('executes branch creation successfully by clinic owner', async () => {
    mockTableData['subscriptions'] = { tier: 'clinic_pro', max_clinics: 3 };
    mockTableData['cities'] = { id: 'city-1', name_ar: 'دمشق' };

    const res = await executeSupabaseAction(ownerUser, 'branch', {
      name: 'فرع المزرعة',
      city: 'دمشق',
      district: 'المزرعة',
      phone: '011-3344556',
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toHaveProperty('id');
    }
  });

  it('executes doctorFee update successfully by clinic owner', async () => {
    mockTableData['doctors'] = { id: 'doc-1', organization_id: 'org-1' };

    const res = await executeSupabaseAction(ownerUser, 'doctorFee', {
      id: 'doc-1',
      fee: 35,
      followUpFee: 20,
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toEqual({ id: 'doc-1', fee: 35, followUpFee: 20 });
    }
  });

  it('executes settings update successfully by clinic owner', async () => {
    mockTableData['organizations'] = { id: 'org-1' };
    mockTableData['clinics'] = { id: 'clinic-1' };

    const res = await executeSupabaseAction(ownerUser, 'settings', {
      name: 'مركز النور الطبي',
      phone: '011-8899001',
      address: 'دمشق - القصاع',
      cancelHours: 3,
      leadMinutes: 45,
      autoConfirm: true,
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toEqual({ organizationId: 'org-1' });
    }
  });

  it('rejects settings update from doctors (only clinic_owner matches RLS & UI)', async () => {
    await expect(
      executeSupabaseAction(doctorUser, 'settings', {
        name: 'مركز النور الطبي',
        phone: '011-8899001',
        address: 'دمشق - القصاع',
        cancelHours: 3,
        leadMinutes: 45,
        autoConfirm: true,
      }),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('fails closed with 403 when settings update hits 0 rows under RLS', async () => {
    mockTableData['organizations'] = [];

    await expect(
      executeSupabaseAction(ownerUser, 'settings', {
        name: 'مركز النور الطبي',
        phone: '011-8899001',
        address: 'دمشق - القصاع',
        cancelHours: 3,
        leadMinutes: 45,
        autoConfirm: true,
      }),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('executes review submission successfully by patient', async () => {
    mockTableData['appointments'] = {
      id: 'appt-1',
      organization_id: 'org-1',
      doctor_id: 'doc-1',
      patient_id: 'pat-1',
      status: 'completed',
    };
    mockTableData['reviews'] = [{ rating: 5 }];

    const res = await executeSupabaseAction(patientUser, 'review', {
      appointmentId: 'appt-1',
      rating: 5,
      comment: 'خدمة ممتازة واهتمام كبير',
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toHaveProperty('id');
    }
  });

  it('executes notification read successfully and throws 404 when 0 rows updated', async () => {
    mockTableData['notifications'] = { id: 'notif-1' };
    const res = await executeSupabaseAction(doctorUser, 'notification', { id: 'notif-1' });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toEqual({ id: 'notif-1' });
    }

    mockTableData['notifications'] = [];
    await expect(
      executeSupabaseAction(doctorUser, 'notification', { id: 'missing-notif' }),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('rolls back newly invited auth user when atomic team provisioning fails', async () => {
    mockTableData['subscriptions'] = { tier: 'clinic_pro', max_doctors: 10 };
    mockTableData['specialties'] = { id: 'spec-1', name_ar: 'الطب العام' };
    mockAdminRpcResponses['provision_team_member_atomic'] = {
      data: null,
      error: { message: 'duplicate license_number', code: '23505' },
    };

    await expect(
      executeSupabaseAction(ownerUser, 'team', {
        name: 'د. مروان الكاتب',
        email: 'rollback@example.com',
        role: 'doctor',
        specialty: 'الطب العام',
        fee: 40,
        license: 'SY-MED-9999',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });

    expect(mockDeleteUser).toHaveBeenCalledWith('new-user-id');
  });

  it('requires the atomic team migration instead of falling back to partial writes', async () => {
    mockTableData['subscriptions'] = { tier: 'clinic_pro', max_doctors: 10 };
    mockTableData['specialties'] = { id: 'spec-1', name_ar: 'الطب العام' };
    mockAdminRpcResponses['provision_team_member_atomic'] = {
      data: null,
      error: { message: 'function not found', code: 'PGRST202' },
    };

    await expect(
      executeSupabaseAction(ownerUser, 'team', {
        name: 'د. مروان الكاتب',
        email: 'migration-required@example.com',
        role: 'doctor',
        specialty: 'الطب العام',
        fee: 40,
        license: 'SY-MED-MIGRATION',
      }),
    ).rejects.toMatchObject({ status: 500, code: 'MIGRATION_REQUIRED' });

    expect(mockDeleteUser).toHaveBeenCalledWith('new-user-id');
    expect(adminRpcCalls.some((call) => call.fn === 'provision_team_member_atomic')).toBe(true);
  });

  it('surfaces DB errors instead of returning false 200 on verify, subscription, and reference', async () => {
    mockTableData['organizations'] = { id: 'org-1' };
    mockTableErrors['organizations.update'] = { message: 'write failed' };

    await expect(
      executeSupabaseAction(superAdminUser, 'verify', { id: 'org-1', status: 'approved' }),
    ).rejects.toMatchObject({ status: 500, code: 'DB_ERROR' });

    mockTableErrors['subscriptions.upsert'] = { message: 'upsert failed' };
    await expect(
      executeSupabaseAction(superAdminUser, 'subscription', { id: 'org-1', tier: 'clinic_pro' }),
    ).rejects.toMatchObject({ status: 500, code: 'DB_ERROR' });

    mockTableErrors['cities.insert'] = { message: 'insert failed' };
    await expect(
      executeSupabaseAction(superAdminUser, 'reference', { name: 'الرقة', type: 'city' }),
    ).rejects.toMatchObject({ status: 500, code: 'DB_ERROR' });
  });

  it('executes billingRequest successfully by clinic owner', async () => {
    const res = await executeSupabaseAction(ownerUser, 'billingRequest', { tier: 'enterprise' });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toEqual({ organizationId: 'org-1', tier: 'enterprise' });
    }
  });

  it('executes verify action successfully by super_admin', async () => {
    mockTableData['organizations'] = { id: 'org-1' };

    const res = await executeSupabaseAction(superAdminUser, 'verify', {
      id: 'org-1',
      status: 'approved',
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toEqual({ id: 'org-1', status: 'approved' });
    }
  });

  it('executes subscription activation successfully by super_admin', async () => {
    mockTableData['organizations'] = { id: 'org-1' };

    const res = await executeSupabaseAction(superAdminUser, 'subscription', {
      id: 'org-1',
      tier: 'clinic_pro',
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toEqual({ id: 'org-1', tier: 'clinic_pro' });
    }
  });

  it('executes reference creation successfully by super_admin', async () => {
    const res = await executeSupabaseAction(superAdminUser, 'reference', {
      name: 'السويداء',
      type: 'city',
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toMatchObject({ name: 'السويداء', type: 'city' });
    }
  });
});
