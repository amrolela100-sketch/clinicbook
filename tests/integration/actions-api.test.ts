import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockCookieStore = new Map<string, string>();
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(async () => ({
    get: (name: string) =>
      mockCookieStore.has(name) ? { value: mockCookieStore.get(name) } : undefined,
    set: (name: string, value: string) => mockCookieStore.set(name, value),
    delete: (name: string) => mockCookieStore.delete(name),
    getAll: () => Array.from(mockCookieStore.entries()).map(([name, value]) => ({ name, value })),
  })),
}));
vi.mock('../../src/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn().mockResolvedValue({
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }),
  }),
}));

vi.mock('../../src/lib/supabase/admin', () => ({
  createSupabaseAdmin: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }),
  }),
}));

import { POST } from '../../src/app/api/actions/route';
import { POST as sessionPOST } from '../../src/app/api/session/route';
import { createSession } from '../../src/lib/auth/session';
import { roles, appointments, get, put, all, db, saveAppointment } from '../../src/lib/demo-db';
import { _resetRateLimitStore } from '../../src/lib/rate-limit';
import { hashPassword } from '../../src/lib/auth/password';

describe('Integration: Actions API Route (/api/actions)', () => {
  const originalEnv = process.env.FORCE_SUPABASE;

  beforeEach(() => {
    mockCookieStore.clear();
    _resetRateLimitStore();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (originalEnv === undefined) {
      delete process.env.FORCE_SUPABASE;
    } else {
      process.env.FORCE_SUPABASE = originalEnv;
    }
  });

  it('rejects invalid envelope payloads with 422', async () => {
    const req = new Request('http://localhost:3000/api/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invalid: 'body' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('executes actions in demo mode when user is logged in', async () => {
    delete process.env.FORCE_SUPABASE;
    const doc = roles.find((r) => r.role === 'doctor')!;
    await createSession(doc.id);

    const appt = appointments().find((a) => a.doctorId === doc.id);
    expect(appt).toBeDefined();
    if (appt) {
      const { saveAppointment } = await import('../../src/lib/demo-db');
      saveAppointment({ ...appt, status: 'checked_in' });

      const req = new Request('http://localhost:3000/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'medical',
          payload: {
            appointmentId: appt.id,
            diagnosis: 'تشخيص تجريبي',
            complaint: 'شكوى تجريبية',
            notes: 'ملاحظات',
            medications: [],
            followUp: '',
            visible: true,
          },
        }),
      });

      const res = await POST(req);
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
    }
  });

  it('returns 401 when unauthenticated in Supabase mode', async () => {
    process.env.FORCE_SUPABASE = 'true';

    const req = new Request('http://localhost:3000/api/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'settings',
        payload: {
          name: 'عيادة',
          phone: '011-1234567',
          address: 'دمشق',
          cancelHours: 2,
          leadMinutes: 60,
          autoConfirm: true,
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.code).toBe('UNAUTHORIZED');
  });

  it.each(['doctor', 'super_admin'])(
    'denies organization settings to %s in demo too',
    async (role) => {
      vi.stubEnv('CLINICBOOK_MODE', 'demo');
      vi.stubEnv('FORCE_SUPABASE', 'false');
      const actor = roles.find((candidate) => candidate.role === role)!;
      const actorId = `settings-role-test-${role}`;
      put('user', actorId, { ...actor, id: actorId, organizationId: 'org-1' });
      const before = get<Record<string, unknown>>('organization', 'org-1')!;
      await createSession(actorId);
      try {
        const response = await POST(
          new Request('http://localhost:3000/api/actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'settings',
              payload: {
                name: 'not authorized to rename',
                phone: '011-1234567',
                address: 'test address',
                cancelHours: 2,
                leadMinutes: 60,
                autoConfirm: false,
              },
            }),
          }),
        );
        expect(response.status).toBe(403);
        expect(get('organization', 'org-1')).toEqual(before);
      } finally {
        put('organization', 'org-1', before);
      }
    },
  );

  it('bounds authenticated actions by the verified actor even when client IPs change', async () => {
    delete process.env.FORCE_SUPABASE;
    vi.stubEnv('VERCEL', '0');
    vi.stubEnv('TRUSTED_PROXY_HOPS', '1');
    const owner = roles.find((user) => user.role === 'clinic_owner')!;
    await createSession(owner.id);

    for (let i = 0; i < 61; i++) {
      const response = await POST(
        new Request('http://localhost:3000/api/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `192.0.2.${i + 1}` },
          body: JSON.stringify({ action: 'unsupported-test-action', payload: {} }),
        }),
      );
      expect(response.status).toBe(i < 60 ? 400 : 429);
    }
  });

  it('bounds credential attempts by account even when trusted client IPs change', async () => {
    delete process.env.FORCE_SUPABASE;
    vi.stubEnv('VERCEL', '0');
    vi.stubEnv('TRUSTED_PROXY_HOPS', '1');
    const accountId = `rate-account-${Date.now()}`;
    const accountEmail = `${accountId}@example.test`;
    put('user', accountId, {
      id: accountId,
      name: 'حساب اختبار',
      role: 'patient',
      email: accountEmail,
      passwordHash: await hashPassword('valid-fixture-password'),
    });

    for (let i = 0; i < 11; i++) {
      const response = await sessionPOST(
        new Request('http://localhost:3000/api/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `192.0.2.${i + 1}` },
          body: JSON.stringify({ email: accountEmail, password: 'wrong-fixture-password' }),
        }),
      );
      expect(response.status).toBe(i < 10 ? 401 : 429);
    }
  });

  it('rejects unauthenticated demo onboarding without adopting an existing account', async () => {
    delete process.env.FORCE_SUPABASE;
    const victimId = 'unauthenticated-onboarding-victim';
    const victimEmail = 'onboarding-victim@clinicbook.demo';
    put('user', victimId, {
      id: victimId,
      name: 'مستخدم محفوظ',
      email: victimEmail,
      role: 'patient',
      passwordHash: 'sentinel-password-hash',
    });

    const req = new Request('http://localhost:3000/api/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'onboard',
        payload: {
          name: 'مركز غير مصرح',
          city: 'دمشق',
          district: 'الشعلان',
          phone: '0111111111',
          doctorName: 'د. مهاجم',
          email: victimEmail,
          license: 'SY-ATTACK-1',
          tier: 'solo_starter',
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ success: false });
    expect(
      get<{ role: string; organizationId?: string; passwordHash?: string }>('user', victimId),
    ).toMatchObject({
      role: 'patient',
      passwordHash: 'sentinel-password-hash',
    });
    expect(get<{ organizationId?: string }>('user', victimId)?.organizationId).toBeUndefined();
  });

  it('rejects quick role preview with 403 when Supabase is forced', async () => {
    process.env.FORCE_SUPABASE = 'true';

    const req = new Request('http://localhost:3000/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'super_admin' }),
    });

    const res = await sessionPOST(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.code).toBe('FORBIDDEN');
  });

  it('does not route a SQLite demo actor into Supabase actions when Supabase is forced', async () => {
    process.env.FORCE_SUPABASE = 'true';
    const owner = roles.find((r) => r.role === 'clinic_owner')!;
    await createSession(owner.id);

    const req = new Request('http://localhost:3000/api/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'billingRequest',
        payload: { tier: 'enterprise' },
      }),
    });

    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
    expect(json.code).toBe('UNAUTHORIZED');
  });

  it('rejects signin with non-existent email with 401 without creating random user', async () => {
    delete process.env.FORCE_SUPABASE;
    const req = new Request('http://localhost:3000/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'nonexistent-user-test-random@test.com',
        password: 'password123',
      }),
    });
    const res = await sessionPOST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('البريد الإلكتروني أو كلمة المرور غير صحيحة');
  });

  it('signs up user in demo mode, hashes password, rejects duplicate email, and authenticates with password', async () => {
    delete process.env.FORCE_SUPABASE;
    const testEmail = `test-user-${Date.now()}@example.com`;

    // 1. Sign up
    const signupReq = new Request('http://localhost:3000/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'signup',
        fullName: 'طبيب تجريبي',
        email: testEmail,
        password: 'securePassword123',
        intent: 'clinic_owner',
      }),
    });
    const signupRes = await sessionPOST(signupReq);
    expect(signupRes.status).toBe(200);
    const signupJson = await signupRes.json();
    expect(signupJson.success).toBe(true);
    expect(signupJson.data.email).toBe(testEmail);

    // 2. Reject duplicate email on signup
    const dupSignupReq = new Request('http://localhost:3000/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'signup',
        fullName: 'مستخدم آخر',
        email: testEmail,
        password: 'anotherPassword123',
      }),
    });
    const dupRes = await sessionPOST(dupSignupReq);
    expect(dupRes.status).toBe(409);
    const dupJson = await dupRes.json();
    expect(dupJson.success).toBe(false);

    // 3. Reject wrong password
    const wrongPassReq = new Request('http://localhost:3000/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'wrongPassword999',
      }),
    });
    const wrongPassRes = await sessionPOST(wrongPassReq);
    expect(wrongPassRes.status).toBe(401);

    // 4. Accept correct password
    const loginReq = new Request('http://localhost:3000/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'securePassword123',
      }),
    });
    const loginRes = await sessionPOST(loginReq);
    expect(loginRes.status).toBe(200);
    const loginJson = await loginRes.json();
    expect(loginJson.success).toBe(true);
    expect(loginJson.data.email).toBe(testEmail);
  });

  it('completes authenticated demo onboarding while preserving the manager name and persisted credentials', async () => {
    delete process.env.FORCE_SUPABASE;
    const managerId = `manager-${Date.now()}`;
    const managerEmail = `${managerId}@clinic.demo`;
    const managerName = 'الأستاذ سامر العلي (مدير المركز)';

    put('user', managerId, {
      id: managerId,
      name: managerName,
      email: managerEmail,
      role: 'clinic_owner',
      passwordHash: 'existing-credential-hash',
    });
    await createSession(managerId);

    const onboardReq = new Request('http://localhost:3000/api/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'onboard',
        payload: {
          name: 'مركز النور الطبي الجديد',
          city: 'دمشق',
          district: 'القصاع',
          phone: '+963 11 444 5566',
          doctorName: 'د. وسيم الجراح',
          email: managerEmail,
          license: 'SY-LIC-2026-TEST',
          tier: 'clinic_pro',
        },
      }),
    });

    const res = await POST(onboardReq);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.id).toBeDefined();

    // Verify manager's user record: name should NOT have been replaced by doctorName!
    const updatedManager = get<{
      id: string;
      name: string;
      role: string;
      organizationId: string;
      passwordHash?: string;
    }>('user', managerId);
    expect(updatedManager).toBeDefined();
    expect(updatedManager!.name).toBe(managerName);
    expect(updatedManager!.role).toBe('clinic_owner');
    expect(updatedManager!.organizationId).toBe(json.data.id);
    expect(updatedManager!.passwordHash).toBe('existing-credential-hash');
    expect(JSON.stringify(json)).not.toContain('existing-credential-hash');

    // Verify doctor record has clean doctorName
    const doctorRecord =
      get<{ id: string; name: string; license: string }>(
        'doctor',
        updatedManager!.organizationId,
      ) ??
      (await import('../../src/lib/demo-db'))
        .all<{ id: string; name: string; license: string }>('doctor')
        .find((d) => d.license === 'SY-LIC-2026-TEST');
    expect(doctorRecord).toBeDefined();
    expect(doctorRecord!.name).toContain('وسيم');

    // Verify rejecting second onboarding attempt for same user (already has org)
    const secondReq = new Request('http://localhost:3000/api/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'onboard',
        payload: {
          name: 'مركز مكرر',
          city: 'دمشق',
          district: 'القصاع',
          phone: '+963 11 444 5566',
          doctorName: 'د. وسيم الجراح',
          email: managerEmail,
          license: 'SY-LIC-2026-TEST2',
          tier: 'clinic_pro',
        },
      }),
    });
    const secondRes = await POST(secondReq);
    expect(secondRes.status).toBe(409);
  });

  it('rejects wrong password on seeded demo account with 401 and accepts valid demo password', async () => {
    delete process.env.FORCE_SUPABASE;

    // Wrong password for seeded admin account
    const wrongAdminReq = new Request('http://localhost:3000/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@clinicbook.demo',
        password: 'completelyWrongPassword999',
      }),
    });
    const wrongRes = await sessionPOST(wrongAdminReq);
    expect(wrongRes.status).toBe(401);
    const wrongJson = await wrongRes.json();
    expect(wrongJson.success).toBe(false);

    // Correct demo password for seeded admin account
    const validAdminReq = new Request('http://localhost:3000/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@clinicbook.demo',
        password: 'demo1234',
      }),
    });
    const validRes = await sessionPOST(validAdminReq);
    expect(validRes.status).toBe(200);
    const validJson = await validRes.json();
    expect(validJson.success).toBe(true);
    expect(validJson.data.role).toBe('super_admin');
    expect(validJson.redirectTo).toBe('/admin');
  });

  it('executes the complete demo mutation surface through authenticated HTTP roles', async () => {
    vi.stubEnv('CLINICBOOK_MODE', 'demo');
    vi.stubEnv('FORCE_SUPABASE', 'false');
    const prefix = `action-surface-${Date.now()}`;
    const orgId = `${prefix}-org`;
    const clinicId = `${prefix}-clinic`;
    const ownerId = `${prefix}-owner`;
    const doctorId = `${prefix}-doctor`;
    const patientId = `${prefix}-patient`;
    const transitionId = `${prefix}-transition`;
    const paymentId = `${prefix}-payment`;
    const medicalId = `${prefix}-medical`;
    const reviewId = `${prefix}-review`;
    const notificationId = `${prefix}-notification`;
    const verificationId = `${prefix}-verification`;
    const existingAuditIds = new Set(
      (db.prepare('SELECT id FROM audit').all() as Array<{ id: string }>).map(({ id }) => id),
    );

    const call = async (actorId: string, action: string, payload: unknown) => {
      await createSession(actorId);
      return POST(
        new Request('http://localhost:3000/api/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, payload }),
        }),
      );
    };
    const expectSuccess = async (actorId: string, action: string, payload: unknown) => {
      const response = await call(actorId, action, payload);
      expect(response.status, `${action}: ${await response.clone().text()}`).toBe(200);
      expect(await response.json()).toMatchObject({ success: true });
    };

    put('organization', orgId, {
      id: orgId,
      name: prefix,
      city: 'دمشق',
      district: 'المزة',
      phone: '0111234567',
      license: `${prefix}-license`,
      tier: 'enterprise',
      status: 'approved',
      subscriptionStatus: 'active',
      periodEnd: '2036-01-01T00:00:00.000Z',
      cancelHours: 2,
      leadMinutes: 60,
      pendingHours: 12,
      expiryMinutes: 60,
      timezone: 'Asia/Damascus',
    });
    put('branch', clinicId, {
      id: clinicId,
      organizationId: orgId,
      name: prefix,
      city: 'دمشق',
      district: 'المزة',
      phone: '0111234567',
    });
    put('user', ownerId, {
      id: ownerId,
      name: 'مالك التغطية',
      email: `${ownerId}@example.test`,
      role: 'clinic_owner',
      organizationId: orgId,
      clinicId,
    });
    put('user', doctorId, {
      id: doctorId,
      name: 'طبيب التغطية',
      email: `${doctorId}@example.test`,
      role: 'doctor',
      organizationId: orgId,
      clinicId,
    });
    put('user', patientId, {
      id: patientId,
      name: 'مريض التغطية',
      email: `${patientId}@example.test`,
      role: 'patient',
    });
    put('doctor', doctorId, {
      id: doctorId,
      name: 'طبيب التغطية',
      organizationId: orgId,
      clinicId,
      clinic: prefix,
      city: 'دمشق',
      district: 'المزة',
      specialty: 'الطب العام',
      fee: 25,
      followUpFee: 15,
      rating: 4,
      reviews: 1,
      experience: 5,
      bio: 'طبيب اختبار',
      color: '#ffffff',
      image: 'doctor-1.jpg',
      verified: true,
      license: `${prefix}-doctor-license`,
    });
    put('notification', notificationId, {
      id: notificationId,
      userId: ownerId,
      title: prefix,
      body: prefix,
      read: false,
      createdAt: new Date().toISOString(),
    });

    const appointmentBase = {
      organizationId: orgId,
      clinicId,
      doctorId,
      patientName: 'مريض التغطية',
      phone: '0999999999',
      visitType: 'first_visit' as const,
      source: 'patient_portal' as const,
      fee: 25,
      payment: 'unpaid' as const,
      createdAt: '2026-11-12T00:00:00.000Z',
    };
    saveAppointment({
      ...appointmentBase,
      id: transitionId,
      patientId,
      start: '2035-01-10T10:00:00.000Z',
      end: '2035-01-10T10:30:00.000Z',
      status: 'pending',
      expiresAt: '2035-01-09T10:00:00.000Z',
    });
    saveAppointment({
      ...appointmentBase,
      id: paymentId,
      patientId,
      start: '2035-01-11T10:00:00.000Z',
      end: '2035-01-11T10:30:00.000Z',
      status: 'confirmed',
    });
    saveAppointment({
      ...appointmentBase,
      id: medicalId,
      patientId,
      start: '2026-01-10T10:00:00.000Z',
      end: '2026-01-10T10:30:00.000Z',
      status: 'checked_in',
    });
    saveAppointment({
      ...appointmentBase,
      id: reviewId,
      patientId,
      start: '2026-01-11T10:00:00.000Z',
      end: '2026-01-11T10:30:00.000Z',
      status: 'completed',
    });

    try {
      await expectSuccess(ownerId, 'settings', {
        name: prefix,
        phone: '0117654321',
        address: 'دمشق',
        cancelHours: 3,
        leadMinutes: 45,
        autoConfirm: false,
      });
      await expectSuccess(ownerId, 'doctorFee', { id: doctorId, fee: 30, followUpFee: 20 });
      await expectSuccess(ownerId, 'schedule', {
        doctorId,
        shifts: [{ day: 1, start: '09:00', end: '12:00', duration: 30, active: true }],
      });
      expect(
        (
          await call(ownerId, 'schedule', {
            doctorId,
            shifts: [
              { day: 1, start: '09:00', end: '12:00', duration: 30, active: true },
              { day: 1, start: '11:00', end: '13:00', duration: 30, active: true },
            ],
          })
        ).status,
      ).toBe(422);
      await expectSuccess(ownerId, 'exception', {
        doctorId,
        start: '2035-02-01T09:00:00.000Z',
        end: '2035-02-01T12:00:00.000Z',
        reason: 'إجازة اختبار',
      });
      await expectSuccess(ownerId, 'team', {
        name: 'موظف استقبال تغطية',
        email: `${prefix}-reception@example.test`,
        role: 'receptionist',
        specialty: 'الاستقبال',
        fee: 0,
        license: '',
        clinicId,
      });
      await expectSuccess(ownerId, 'team', {
        name: 'د. طبيب فريق تغطية',
        email: `${prefix}-team-doctor@example.test`,
        role: 'doctor',
        specialty: 'الطب العام',
        fee: 35,
        license: `${prefix}-team-license`,
        clinicId,
      });
      await expectSuccess(ownerId, 'branch', {
        name: 'فرع تغطية',
        city: 'دمشق',
        district: 'القصاع',
        phone: '0115555555',
      });
      await expectSuccess(ownerId, 'billingRequest', { tier: 'clinic_pro' });
      expect((await call(ownerId, 'billingRequest', { tier: 'enterprise' })).status).toBe(422);
      await expectSuccess(ownerId, 'notification', { id: notificationId });
      await expectSuccess(ownerId, 'payment', { id: paymentId });
      await expectSuccess(ownerId, 'transition', { id: transitionId, status: 'confirmed' });

      await expectSuccess(doctorId, 'medical', {
        appointmentId: medicalId,
        diagnosis: 'تشخيص تغطية',
        complaint: 'شكوى تغطية',
        notes: 'ملاحظات',
        medications: [
          {
            name: 'دواء اختبار',
            dose: 'جرعة',
            frequency: 'مرة يومياً',
            duration: 'أسبوع',
          },
        ],
        followUp: '',
        visible: true,
      });
      await expectSuccess(patientId, 'review', {
        appointmentId: reviewId,
        rating: 5,
        comment: 'زيارة جيدة',
      });
      expect(
        (
          await call(patientId, 'review', {
            appointmentId: reviewId,
            rating: 4,
            comment: 'تقييم مكرر',
          })
        ).status,
      ).toBe(422);

      put('verification', verificationId, {
        id: verificationId,
        organizationId: orgId,
        doctorId,
        license: `${prefix}-verified-license`,
        status: 'pending',
      });
      const admin = roles.find((candidate) => candidate.role === 'super_admin')!;
      await expectSuccess(admin.id, 'verify', { id: verificationId, status: 'approved' });
      await expectSuccess(admin.id, 'subscription', { id: orgId, tier: 'enterprise' });
      await expectSuccess(admin.id, 'reference', { name: prefix, type: 'city' });

      expect(get<{ read: boolean }>('notification', notificationId)?.read).toBe(true);
      expect(appointments().find(({ id }) => id === paymentId)?.payment).toBe('paid_cash');
      expect(appointments().find(({ id }) => id === medicalId)?.status).toBe('completed');
      expect(get('review', reviewId)).toBeDefined();
      expect(all<{ name: string }>('reference').some(({ name }) => name === prefix)).toBe(true);
    } finally {
      db.prepare('DELETE FROM appointments WHERE id LIKE ?').run(`${prefix}%`);
      db.prepare('DELETE FROM sessions WHERE user_id LIKE ?').run(`${prefix}%`);
      db.prepare('DELETE FROM entities WHERE id LIKE ? OR data LIKE ?').run(
        `${prefix}%`,
        `%${prefix}%`,
      );
      for (const { id } of db.prepare('SELECT id FROM audit').all() as Array<{ id: string }>) {
        if (!existingAuditIds.has(id)) db.prepare('DELETE FROM audit WHERE id=?').run(id);
      }
    }
  });
});
