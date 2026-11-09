import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockCookieStore = new Map<string, string>();
const adminCalls: Array<{ fn: string; args?: unknown }> = [];
const rpcCalls: Array<{ fn: string; args?: unknown }> = [];
const fromTables: string[] = [];

let mockAuthUser: {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
} | null = null;

const mockTableResponses: Record<string, unknown> = {};
const mockRpcResponses: Record<
  string,
  { data: unknown; error: { code?: string; message?: string } | null }
> = {};
const mockAdminRpcResponses: Record<
  string,
  { data: unknown; error: { code?: string; message?: string } | null }
> = {};

let mockInviteUserResult: {
  data: { user: { id: string } | null };
  error: { message?: string } | null;
} = { data: { user: { id: 'invited-user-1' } }, error: null };

const mockDeleteAuthUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null });

function createSimpleBuilder(table: string) {
  fromTables.push(table);
  const builder: Record<string, unknown> = {
    select: vi.fn().mockImplementation(() => builder),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    update: vi.fn().mockImplementation(() => builder),
    upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
    delete: vi.fn().mockImplementation(() => builder),
    eq: vi.fn().mockImplementation(() => builder),
    in: vi.fn().mockImplementation(() => builder),
    order: vi.fn().mockImplementation(() => builder),
    limit: vi.fn().mockImplementation(() => builder),
    maybeSingle: vi.fn().mockImplementation(async () => ({
      data: mockTableResponses[table] ?? null,
      error: null,
    })),
    then: (resolve: (val: { data: unknown; error: null; count?: number }) => unknown) => {
      const val = mockTableResponses[table];
      return Promise.resolve({
        count: typeof val === 'number' ? val : Array.isArray(val) ? val.length : 0,
        data: Array.isArray(val) ? val : val ? [val] : [],
        error: null,
      }).then(resolve);
    },
  };
  return builder;
}

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
  createSupabaseServer: vi.fn().mockImplementation(async () => ({
    auth: {
      getUser: vi
        .fn()
        .mockImplementation(async () => ({ data: { user: mockAuthUser }, error: null })),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn().mockImplementation((table: string) => createSimpleBuilder(table)),
    rpc: vi.fn().mockImplementation(async (fn: string, args?: unknown) => {
      rpcCalls.push({ fn, args });
      return mockRpcResponses[fn] ?? { data: [], error: null };
    }),
  })),
}));

vi.mock('../../src/lib/supabase/admin', () => ({
  createSupabaseAdmin: vi.fn().mockImplementation(() => {
    adminCalls.push({ fn: 'createSupabaseAdmin' });
    return {
      from: vi.fn().mockImplementation((table: string) => createSimpleBuilder(`admin.${table}`)),
      auth: {
        admin: {
          inviteUserByEmail: vi.fn().mockImplementation(async (email: string, opts?: unknown) => {
            adminCalls.push({ fn: 'inviteUserByEmail', args: { email, opts } });
            return mockInviteUserResult;
          }),
          createUser: vi.fn().mockImplementation(async (attrs: unknown) => {
            adminCalls.push({ fn: 'createUser', args: attrs });
            return { data: { user: { id: 'created-doc-auth-id' } }, error: null };
          }),
          deleteUser: (...args: unknown[]) => mockDeleteAuthUser(...args),
          updateUserById: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
        },
      },
      rpc: vi.fn().mockImplementation(async (fn: string, args?: unknown) => {
        adminCalls.push({ fn: `rpc.${fn}`, args });
        return mockAdminRpcResponses[fn] ?? { data: null, error: null };
      }),
    };
  }),
}));

import { currentUser } from '../../src/lib/auth/session';
import { getClientIp } from '../../src/lib/rate-limit';
import { middleware } from '../../src/middleware';
import { fetchSupabaseAppData } from '../../src/lib/services/supabase-data-service';
import { executeSupabaseAction } from '../../src/lib/services/supabase-actions-service';
import getClinicSummaryTool from '../../agent/tools/get_clinic_summary';
import handlePatientResponseTool from '../../agent/tools/handle_patient_response';
import { generateMetadata } from '../../src/app/[[...path]]/page';
import { ensureSeed, all } from '../../src/lib/demo-db';
import type { Doctor, User } from '../../src/lib/types';

describe('Full-Stack Audit Remediations Suite (REM-01 through REM-09)', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...savedEnv,
      CLINICBOOK_MODE: 'production',
      NEXT_PUBLIC_SUPABASE_URL: 'https://clinicbook.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-test-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
    };
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
    mockCookieStore.clear();
    adminCalls.length = 0;
    rpcCalls.length = 0;
    fromTables.length = 0;
    mockAuthUser = null;
    mockInviteUserResult = { data: { user: { id: 'invited-user-1' } }, error: null };
    mockDeleteAuthUser.mockClear();
    for (const k of Object.keys(mockTableResponses)) delete mockTableResponses[k];
    for (const k of Object.keys(mockRpcResponses)) delete mockRpcResponses[k];
    for (const k of Object.keys(mockAdminRpcResponses)) delete mockAdminRpcResponses[k];
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('REM-01: populates super_admin governance console via super_admin_dashboard_data RPC without service_role or PHI queries', async () => {
    mockAuthUser = { id: 'sa-1', email: 'admin@clinicbook.sy' };
    mockTableResponses['users'] = {
      id: 'sa-1',
      full_name: 'مدير المنصة',
      email: 'admin@clinicbook.sy',
      role: 'super_admin',
    };
    mockRpcResponses['super_admin_dashboard_data'] = {
      data: {
        organizations: [
          {
            id: 'org-1',
            name: 'مركز الشفاء',
            city: 'دمشق',
            district: 'المزة',
            phone: '011-123456',
            license: 'SY-100',
            tier: 'clinic_pro',
            status: 'approved',
            subscriptionStatus: 'active',
            periodEnd: '2026-12-01T00:00:00Z',
            cancelHours: 2,
            leadMinutes: 60,
            pendingHours: 12,
            expiryMinutes: 60,
            timezone: 'Asia/Damascus',
          },
        ],
        verifications: [
          {
            id: 'doc-pending-1',
            name: 'د. ريم الحسن',
            type: 'طبيب اختصاصي',
            city: 'دمشق',
            license: 'SY-DOC-88',
            status: 'pending',
          },
        ],
        references: [{ id: 'city-1', name: 'دمشق', type: 'city' }],
        audit: [
          {
            id: 'aud-1',
            action: 'organization.created',
            created_at: '2026-11-09T10:00:00Z',
            entity_id: 'org-1',
          },
        ],
      },
      error: null,
    };

    const appData = await fetchSupabaseAppData();

    expect(adminCalls).toHaveLength(0);
    expect(fromTables).not.toContain('medical_records');
    expect(fromTables).not.toContain('appointments');
    expect(appData.admin).not.toBeNull();
    expect(appData.admin?.organizations).toHaveLength(1);
    expect(appData.admin?.verifications[0].id).toBe('doc-pending-1');
    expect(appData.admin?.audit[0].action).toBe('organization.created');
  });

  it('REM-01: merges pending tenant doctors and billing requests for clinic_owner in Supabase mode', async () => {
    mockAuthUser = { id: 'owner-1', email: 'owner@clinic.sy' };
    mockTableResponses['users'] = {
      id: 'owner-1',
      full_name: 'عمر الكيلاني',
      email: 'owner@clinic.sy',
      role: 'clinic_owner',
    };
    mockTableResponses['organizations'] = {
      id: 'org-1',
      name: 'مركز النور',
      verification_status: 'approved',
      subscriptions: [{ tier: 'clinic_pro', status: 'active' }],
      clinics: [{ id: 'cl-1', name: 'الفرع الرئيسي', district: 'الشعلان', phone: '011-998877' }],
    };
    mockTableResponses['clinics'] = [
      {
        id: 'cl-1',
        organization_id: 'org-1',
        name: 'الفرع الرئيسي',
        district: 'الشعلان',
        phone: '011-998877',
        cities: { name_ar: 'دمشق' },
      },
    ];
    mockRpcResponses['tenant_doctors_directory'] = {
      data: [
        {
          id: 'doc-pending-99',
          full_name: 'د. لينا قاسم',
          title_ar: 'طبيب اختصاصي',
          bio_ar: 'طب أطفال',
          specialty_id: 'sp-1',
          specialty_name: 'طب الأطفال',
          organization_id: 'org-1',
          clinic_id: 'cl-1',
          clinic_name: 'الفرع الرئيسي',
          city_name: 'دمشق',
          district: 'الشعلان',
          consultation_fee: 30,
          follow_up_fee: 15,
          years_of_experience: 7,
          rating_avg: 0,
          reviews_count: 0,
          avatar_url: null,
          license_number: 'SY-PED-99',
          verification_status: 'pending',
          is_listed_publicly: false,
        },
      ],
      error: null,
    };
    mockRpcResponses['tenant_billing_requests'] = {
      data: [
        {
          id: 'req-1',
          tier: 'enterprise',
          status: 'pending',
          created_at: '2026-11-09T09:00:00Z',
        },
      ],
      error: null,
    };

    const appData = await fetchSupabaseAppData();

    const pendingDoc = appData.doctors.find((d) => d.id === 'doc-pending-99');
    expect(pendingDoc).toBeDefined();
    expect(pendingDoc?.verified).toBe(false);
    expect(pendingDoc?.bookingHorizonDays).toBe(90);
    expect(appData.billingRequests).toEqual([
      { id: 'req-1', tier: 'enterprise', status: 'pending', createdAt: '2026-11-09T09:00:00Z' },
    ]);
  });

  it('REM-02 & REM-03: executes atomic onboard & team RPCs with separate doctor identity, email invite, and rollback on conflict', async () => {
    const newOwner: User = {
      id: 'owner-fresh',
      name: 'أنس المالح',
      email: 'owner@almaleh.sy',
      role: 'clinic_owner',
    };

    mockAdminRpcResponses['onboard_organization_atomic'] = {
      data: [{ organization_id: 'org-atomic-1', clinic_id: 'clinic-atomic-1' }],
      error: null,
    };

    const onboardRes = await executeSupabaseAction(newOwner, 'onboard', {
      name: 'مركز المالح الطبي',
      city: 'دمشق',
      district: 'أبو رمانة',
      phone: '011-3322110',
      doctorName: 'د. حسام المالح',
      email: 'dr.hussam@almaleh.sy',
      license: 'SY-LIC-2026',
      tier: 'clinic_pro',
    });

    expect(onboardRes.success).toBe(true);
    if (onboardRes.success) {
      expect(onboardRes.data).toEqual({ id: 'org-atomic-1', clinicId: 'clinic-atomic-1' });
    }
    const onboardRpcCall = adminCalls.find((c) => c.fn === 'rpc.onboard_organization_atomic');
    expect(onboardRpcCall).toBeDefined();
    expect((onboardRpcCall?.args as Record<string, unknown>).p_doctor_user_id).toBe(
      'created-doc-auth-id',
    );

    // Onboard conflict (23505) cleans up dedicated doctor auth user
    mockAdminRpcResponses['onboard_organization_atomic'] = {
      data: null,
      error: { code: '23505', message: 'duplicate license' },
    };
    await expect(
      executeSupabaseAction(newOwner, 'onboard', {
        name: 'مركز مكرر',
        city: 'دمشق',
        district: 'أبو رمانة',
        phone: '011-3322110',
        doctorName: 'د. حسام',
        email: 'dr2@almaleh.sy',
        license: 'SY-LIC-2026',
        tier: 'solo_starter',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'ALREADY_EXISTS' });
    expect(mockDeleteAuthUser).toHaveBeenCalledWith('created-doc-auth-id');

    // Team invitation + atomic provisioning RPC
    const activeOwner: User = {
      ...newOwner,
      organizationId: 'org-atomic-1',
      clinicId: 'clinic-atomic-1',
    };
    mockTableResponses['subscriptions'] = { tier: 'clinic_pro', max_doctors: 10 };
    mockTableResponses['doctors'] = 1;
    mockAdminRpcResponses['provision_team_member_atomic'] = {
      data: 'invited-user-1',
      error: null,
    };

    const teamRes = await executeSupabaseAction(activeOwner, 'team', {
      name: 'د. ناديا خوري',
      email: 'nadia@almaleh.sy',
      role: 'doctor',
      specialty: 'طب العيون',
      fee: 45,
      license: 'SY-EYE-404',
    });
    expect(teamRes.success).toBe(true);
    expect(adminCalls.some((c) => c.fn === 'inviteUserByEmail')).toBe(true);
    expect(adminCalls.some((c) => c.fn === 'rpc.provision_team_member_atomic')).toBe(true);
  });

  it('REM-04: ignores forged client-writable user_metadata.intent_role in currentUser() while trusting server app_metadata', async () => {
    mockAuthUser = {
      id: 'forged-user-1',
      email: 'attacker@example.com',
      user_metadata: { intent_role: 'clinic_owner', role: 'super_admin' },
      app_metadata: {},
    };
    mockTableResponses['users'] = null;

    const resolvedForged = await currentUser();
    expect(resolvedForged?.role).toBe('patient');

    mockAuthUser = {
      id: 'legit-owner-1',
      email: 'owner@example.com',
      user_metadata: {},
      app_metadata: { role: 'clinic_owner' },
    };
    const resolvedServerMeta = await currentUser();
    expect(resolvedServerMeta?.role).toBe('clinic_owner');
  });

  it('REM-05: resists X-Forwarded-For spoofing via platform headers & TRUSTED_PROXY_HOPS, sets DENY & optional enforcing CSP', async () => {
    const cfReq = new Request('http://localhost:3000/api/session', {
      headers: {
        'cf-connecting-ip': '198.51.100.77',
        'x-forwarded-for': '1.2.3.4, 5.6.7.8',
      },
    });
    expect(getClientIp(cfReq)).toBe('198.51.100.77');

    process.env.TRUSTED_PROXY_HOPS = '1';
    const spoofedXffReq = new Request('http://localhost:3000/api/session', {
      headers: {
        'x-forwarded-for': '10.0.0.99, 203.0.113.42',
      },
    });
    expect(getClientIp(spoofedXffReq)).toBe('203.0.113.42');

    const pollutedIpReq = new Request('http://localhost:3000/api/session', {
      headers: {
        'x-forwarded-for': 'DROP TABLE users;--',
      },
    });
    expect(getClientIp(pollutedIpReq)).toBe('127.0.0.1');

    process.env.CSP_ENFORCE = 'true';
    const mwRes = await middleware(
      new NextRequest('http://localhost:3000/', { headers: { host: 'localhost:3000' } }),
    );
    expect(mwRes.headers.get('X-Frame-Options')).toBe('DENY');
    expect(mwRes.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
  });

  it('REM-06: executes get_clinic_summary and handle_patient_response in Supabase production mode', async () => {
    mockAuthUser = { id: 'doc-prod-1', email: 'doc@clinic.sy' };
    mockTableResponses['users'] = {
      id: 'doc-prod-1',
      full_name: 'د. باسل',
      email: 'doc@clinic.sy',
      role: 'doctor',
    };
    mockTableResponses['doctors'] = { organization_id: 'org-prod-1' };
    mockTableResponses['organization_members'] = { clinic_id: 'cl-prod-1' };
    mockRpcResponses['get_tenant_appointments'] = {
      data: [
        {
          id: 'appt-p1',
          organization_id: 'org-prod-1',
          clinic_id: 'cl-prod-1',
          doctor_id: 'doc-prod-1',
          patient_id: 'pat-1',
          patient_name: 'سليم',
          patient_phone: '+963991112233',
          start_at: '2026-11-10T08:00:00.000Z',
          end_at: '2026-11-10T08:30:00.000Z',
          status: 'confirmed',
          visit_type: 'first_visit',
          booking_source: 'patient_portal',
          fee_amount: 35,
          payment_status: 'unpaid',
          expires_at: null,
          patient_notes: null,
          cancel_reason: null,
          created_at: '2026-11-09T10:00:00.000Z',
        },
      ],
      error: null,
    };
    mockRpcResponses['tenant_doctors_directory'] = {
      data: [
        {
          id: 'doc-prod-1',
          full_name: 'د. باسل',
          specialty_name: 'القلب والأوعية',
        },
      ],
      error: null,
    };

    const summaryRes = await getClinicSummaryTool.execute({ date: '2026-11-10' });
    expect(summaryRes.success).toBe(true);
    expect(summaryRes.summary.totalAppointments).toBe(1);
    expect(summaryRes.summary.confirmedCount).toBe(1);
    expect(summaryRes.summary.totalEstimatedRevenue).toBe(35);

    mockRpcResponses['transition_appointment'] = {
      data: { id: 'appt-p1', status: 'cancelled' },
      error: null,
    };
    const respToolOut = (await handlePatientResponseTool.execute({
      appointmentId: 'appt-p1',
      action: 'cancel_appointment',
      reason: 'سفر طارئ',
    })) as { success: boolean; status?: string };
    expect(respToolOut.success).toBe(true);
    expect(respToolOut.status).toBe('cancelled');
  });

  it('REM-09: generates dynamic SEO metadata for search and verified doctor profiles', async () => {
    process.env.CLINICBOOK_MODE = 'demo';
    ensureSeed();
    const verifiedDoc = all<Doctor>('doctor').find((d) => d.verified)!;

    const searchMeta = await generateMetadata({ params: Promise.resolve({ path: ['search'] }) });
    expect(String(searchMeta.title)).toContain('ابحث عن طبيب');

    const docMeta = await generateMetadata({
      params: Promise.resolve({ path: ['doctors', verifiedDoc.id] }),
    });
    expect(String(docMeta.title)).toContain(verifiedDoc.name);
    expect(String(docMeta.title)).toContain(verifiedDoc.specialty);
  });
});
