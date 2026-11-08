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
import { roles, appointments, get, put } from '../../src/lib/demo-db';

describe('Integration: Actions API Route (/api/actions)', () => {
  const originalEnv = process.env.FORCE_SUPABASE;

  beforeEach(() => {
    mockCookieStore.clear();
  });

  afterEach(() => {
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
    await createSession(doc.id, 'doctor');

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

  it('routes to Supabase action execution when user has active session and Supabase is forced', async () => {
    process.env.FORCE_SUPABASE = 'true';
    const owner = roles.find((r) => r.role === 'clinic_owner')!;
    await createSession(owner.id, 'clinic_owner');

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
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.tier).toBe('enterprise');
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

  it('completes onboarding for logged-in clinic owner in demo mode without email rejection, preserving manager name', async () => {
    delete process.env.FORCE_SUPABASE;
    const managerId = `manager-${Date.now()}`;
    const managerEmail = `${managerId}@clinic.demo`;
    const managerName = 'الأستاذ سامر العلي (مدير المركز)';

    put('user', managerId, {
      id: managerId,
      name: managerName,
      email: managerEmail,
      role: 'clinic_owner',
    });
    await createSession(managerId, 'clinic_owner');

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
    const updatedManager = get<{ id: string; name: string; role: string; organizationId: string }>(
      'user',
      managerId,
    );
    expect(updatedManager).toBeDefined();
    expect(updatedManager!.name).toBe(managerName);
    expect(updatedManager!.role).toBe('clinic_owner');
    expect(updatedManager!.organizationId).toBe(json.data.id);

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
});
