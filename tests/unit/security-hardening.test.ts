import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';

const mockCookieStore = new Map<string, string>();
const adminCalls: Array<{ fn: string; table?: string; args?: unknown }> = [];
const rpcCalls: Array<{ fn: string; args: unknown }> = [];
const fromCalls: Array<{ table: string; op: string; filters: Array<[string, unknown]> }> = [];
const writePayloads: Array<{ table: string; op: string; data: unknown }> = [];

let mockAuthUser: {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
} | null = null;
let mockSignUpResult: {
  data: { user: { id: string; email?: string } | null; session: Record<string, unknown> | null };
  error: { message: string } | null;
} = { data: { user: null, session: null }, error: null };
const mockTableResponses: Record<string, unknown> = {};
const mockTableErrors: Record<string, { code?: string; message?: string } | null> = {};
const mockRpcResponses: Record<
  string,
  { data: unknown; error: { code?: string; message?: string } | null }
> = {};

function createMockBuilder(table: string, isAdmin: boolean) {
  const filters: Array<[string, unknown]> = [];
  let hasCount = false;
  let op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  const resolveResponse = () =>
    (isAdmin ? mockTableResponses[`admin.${table}`] : undefined) ?? mockTableResponses[table];
  const resolveError = () =>
    (isAdmin
      ? (mockTableErrors[`admin.${table}.${op}`] ?? mockTableErrors[`admin.${table}`])
      : undefined) ??
    mockTableErrors[`${table}.${op}`] ??
    mockTableErrors[table] ??
    null;

  const builder: Record<string, unknown> = {
    select: vi
      .fn()
      .mockImplementation((_cols?: string, opts?: { count?: string; head?: boolean }) => {
        op = 'select';
        if (opts?.count === 'exact') hasCount = true;
        if (isAdmin) adminCalls.push({ fn: 'from.select', table });
        fromCalls.push({ table, op: 'select', filters });
        return builder;
      }),
    insert: vi.fn().mockImplementation((payload: unknown) => {
      op = 'insert';
      if (isAdmin) adminCalls.push({ fn: 'from.insert', table });
      fromCalls.push({ table, op: 'insert', filters });
      writePayloads.push({ table, op: 'insert', data: payload });
      return Promise.resolve({ data: null, error: resolveError() });
    }),
    update: vi.fn().mockImplementation((payload: unknown) => {
      op = 'update';
      if (isAdmin) adminCalls.push({ fn: 'from.update', table });
      fromCalls.push({ table, op: 'update', filters });
      writePayloads.push({ table, op: 'update', data: payload });
      return builder;
    }),
    upsert: vi.fn().mockImplementation((payload: unknown) => {
      op = 'upsert';
      if (isAdmin) adminCalls.push({ fn: 'from.upsert', table });
      fromCalls.push({ table, op: 'upsert', filters });
      writePayloads.push({ table, op: 'upsert', data: payload });
      return Promise.resolve({ data: null, error: resolveError() });
    }),
    delete: vi.fn().mockImplementation(() => {
      op = 'delete';
      if (isAdmin) adminCalls.push({ fn: 'from.delete', table });
      fromCalls.push({ table, op: 'delete', filters });
      return builder;
    }),
    eq: vi.fn().mockImplementation((col: string, val: unknown) => {
      filters.push([col, val]);
      return builder;
    }),
    in: vi.fn().mockImplementation(() => builder),
    lt: vi.fn().mockImplementation(() => builder),
    gt: vi.fn().mockImplementation(() => builder),
    lte: vi.fn().mockImplementation(() => builder),
    order: vi.fn().mockImplementation(() => builder),
    limit: vi.fn().mockImplementation(() => builder),
    maybeSingle: vi.fn().mockImplementation(() => {
      const entry = resolveResponse();
      const err = resolveError();
      const val =
        typeof entry === 'function'
          ? (entry as (f: Array<[string, unknown]>) => unknown)(filters)
          : entry;
      return Promise.resolve({ data: err ? null : (val ?? null), error: err });
    }),
    then: (resolve: (value: { data: unknown; error: unknown; count?: number }) => unknown) => {
      const entry = resolveResponse();
      const err = resolveError();
      const val =
        typeof entry === 'function'
          ? (entry as (f: Array<[string, unknown]>) => unknown)(filters)
          : entry;
      if (hasCount) {
        return Promise.resolve({
          count: typeof val === 'number' ? val : Array.isArray(val) ? val.length : 0,
          data: [],
          error: err,
        }).then(resolve);
      }
      return Promise.resolve({
        data: err ? null : Array.isArray(val) ? val : val ? [val] : [],
        error: err,
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
      signUp: vi.fn().mockImplementation(async () => mockSignUpResult),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn().mockImplementation((table: string) => createMockBuilder(table, false)),
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
      from: vi.fn().mockImplementation((table: string) => createMockBuilder(table, true)),
      auth: {
        admin: {
          inviteUserByEmail: vi
            .fn()
            .mockResolvedValue({ data: { user: { id: 'admin-new-id' } }, error: null }),
          createUser: vi
            .fn()
            .mockResolvedValue({ data: { user: { id: 'admin-new-id' } }, error: null }),
          deleteUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
        },
      },
      rpc: vi.fn().mockImplementation(async (fn: string, args?: unknown) => {
        adminCalls.push({ fn: `rpc.${fn}`, args });
        return fn === 'provision_team_member_atomic'
          ? { data: 'admin-new-id', error: null }
          : { data: null, error: null };
      }),
    };
  }),
}));

import { createSupabaseServer } from '../../src/lib/supabase/server';
import {
  demoEnabled,
  createSession,
  currentUser,
  getSessionCookieName,
} from '../../src/lib/auth/session';
import { hashPassword, verifyPassword } from '../../src/lib/auth/password';
import { canAccess } from '../../src/lib/auth/guards';
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMIT_CONFIGS,
  _resetRateLimitStore,
} from '../../src/lib/rate-limit';
import { POST as sessionPOST } from '../../src/app/api/session/route';
import { POST as chatPOST } from '../../src/app/api/agent/chat/route';
import { POST as appointmentsPOST } from '../../src/app/api/appointments/route';
import { POST as actionsPOST } from '../../src/app/api/actions/route';
import { POST as retentionPOST } from '../../src/app/api/cron/retention/route';
import { GET as dataGET } from '../../src/app/api/data/route';
import { callAgentRouter } from '../../src/lib/services/agentrouter-client';
import { processAgentMessage } from '../../src/lib/services/agent-service';
import bookAppointmentTool from '../../agent/tools/book_appointment';
import {
  createSupabaseBooking,
  getSupabaseSlots,
  transitionSupabaseAppointment,
  translatePostgresBookingError,
} from '../../src/lib/services/supabase-booking-service';
import { fetchSupabaseAppData } from '../../src/lib/services/supabase-data-service';
import { executeSupabaseAction } from '../../src/lib/services/supabase-actions-service';
import { middleware } from '../../src/middleware';
import { db, put, roles, ensureSeed } from '../../src/lib/demo-db';
import type { User } from '../../src/lib/types';

describe('Security & Production Hardening Regression Suite', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...savedEnv, CLINICBOOK_MODE: 'demo' };
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
    mockCookieStore.clear();
    adminCalls.length = 0;
    rpcCalls.length = 0;
    fromCalls.length = 0;
    writePayloads.length = 0;
    mockAuthUser = null;
    mockSignUpResult = { data: { user: null, session: null }, error: null };
    for (const k of Object.keys(mockTableResponses)) delete mockTableResponses[k];
    for (const k of Object.keys(mockTableErrors)) delete mockTableErrors[k];
    for (const k of Object.keys(mockRpcResponses)) delete mockRpcResponses[k];
    _resetRateLimitStore();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...savedEnv };
  });

  // ─── P0-1: Fail-Closed Operational Mode & Role Isolation ────────────────────
  describe('P0-1: Operational Mode & Session Role Trust', () => {
    it('returns false for demoEnabled when CLINICBOOK_MODE is unset outside production', () => {
      delete process.env.CLINICBOOK_MODE;
      delete process.env.FORCE_SUPABASE;
      expect(demoEnabled()).toBe(false);
    });

    it('throws explicit FATAL startup error when NODE_ENV=production and CLINICBOOK_MODE is unset or invalid', () => {
      delete process.env.FORCE_SUPABASE;
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      delete process.env.CLINICBOOK_MODE;
      expect(() => demoEnabled()).toThrow(/FATAL: CLINICBOOK_MODE/);

      process.env.CLINICBOOK_MODE = 'staging';
      expect(() => demoEnabled()).toThrow(/FATAL: CLINICBOOK_MODE/);
    });

    it('returns true strictly when CLINICBOOK_MODE=demo', () => {
      process.env.CLINICBOOK_MODE = 'demo';
      expect(demoEnabled()).toBe(true);
    });

    it('refuses demo mode in production even when an opt-in variable is present', () => {
      delete process.env.FORCE_SUPABASE;
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      process.env.CLINICBOOK_MODE = 'demo';
      process.env.ALLOW_DEMO_IN_PRODUCTION = 'true';

      expect(() => demoEnabled()).toThrow(/demo mode is forbidden in production/i);
    });

    it('rejects POST /api/session quick role preview with 403 when NODE_ENV=production without demo mode', async () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      delete process.env.CLINICBOOK_MODE;

      const reqUnset = new Request('http://localhost:3000/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'super_admin' }),
      });
      const resUnset = await sessionPOST(reqUnset);
      expect(resUnset.status).toBe(403);
      expect((await resUnset.json()).code).toBe('FORBIDDEN');

      process.env.CLINICBOOK_MODE = 'production';
      const reqProd = new Request('http://localhost:3000/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'super_admin' }),
      });
      const resProd = await sessionPOST(reqProd);
      expect(resProd.status).toBe(403);
      expect((await resProd.json()).code).toBe('FORBIDDEN');
    });

    it('rejects createSession outside explicit demo mode', async () => {
      process.env.CLINICBOOK_MODE = 'production';
      await expect(createSession('patient-1')).rejects.toThrow(/FORBIDDEN/);

      delete process.env.CLINICBOOK_MODE;
      await expect(createSession('patient-1')).rejects.toThrow(/FORBIDDEN/);
    });

    it('ignores tampered sessions.role column and always reads role from stored user record', async () => {
      ensureSeed();
      const patient = roles.find((r) => r.role === 'patient')!;
      const token = await createSession(patient.id);
      const tokenHash = createHash('sha256').update(token).digest('hex');

      // Simulate DB tamper / stale role in sessions table
      db.prepare('UPDATE sessions SET role=? WHERE token=?').run('super_admin', tokenHash);

      const loaded = await currentUser();
      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe(patient.id);
      expect(loaded?.role).toBe('patient');
      expect(loaded).not.toHaveProperty('passwordHash');
    });

    it('returns a safe identity projection from the demo quick-role endpoint', async () => {
      const response = await sessionPOST(
        new Request('http://localhost:3000/api/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'doctor' }),
        }),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as { success: boolean; data: User };
      expect(body.success).toBe(true);
      expect(body.data.role).toBe('doctor');
      expect(body.data).not.toHaveProperty('passwordHash');
    });

    it('rejects a suspended Supabase profile as an authenticated application actor', async () => {
      process.env.CLINICBOOK_MODE = 'production';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
      mockAuthUser = {
        id: 'suspended-user',
        email: 'suspended@example.com',
        user_metadata: { full_name: 'Suspended User' },
      };
      mockTableResponses['users'] = {
        id: 'suspended-user',
        full_name: 'Suspended User',
        email: 'suspended@example.com',
        role: 'clinic_owner',
        status: 'suspended',
      };

      expect(await currentUser()).toBeNull();
      expect(fromCalls.some((call) => call.table === 'organizations')).toBe(false);
    });

    it('rejects missing or failed profile lookups even with stale privileged app metadata', async () => {
      process.env.CLINICBOOK_MODE = 'production';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
      mockAuthUser = {
        id: 'deleted-admin',
        email: 'deleted-admin@example.com',
        app_metadata: { role: 'super_admin' },
      };

      mockTableResponses['users'] = null;
      expect(await currentUser()).toBeNull();

      mockTableErrors['users.select'] = { message: 'profile lookup unavailable' };
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        expect(await currentUser()).toBeNull();
        expect(errorSpy).toHaveBeenCalledWith('Supabase profile lookup error:', {
          message: 'profile lookup unavailable',
        });
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('logs error when Supabase signup public.users upsert sync fails instead of failing silently', async () => {
      process.env.CLINICBOOK_MODE = 'production';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
      mockSignUpResult = {
        data: { user: { id: 'signup-sync-user' }, session: { access_token: 'tok-sync' } },
        error: null,
      };
      mockTableErrors['admin.users.upsert'] = { message: 'rls upsert failure' };

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const res = await sessionPOST(
          new Request('http://localhost:3000/api/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.40.40.1' },
            body: JSON.stringify({
              mode: 'signup',
              fullName: 'مريض جديد',
              email: 'sync-fail@test.local',
              password: 'password123',
            }),
          }),
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as { success: boolean };
        expect(body.success).toBe(true);
        expect(errSpy).toHaveBeenCalledWith('Supabase signup public.users sync error:', {
          message: 'rls upsert failure',
        });
      } finally {
        errSpy.mockRestore();
      }
    });
  });

  // ─── P0-2 & P0-3 & P1-1: Production Booking, Directories & Zero Runtime Service-Role ─
  describe('P0-2, P0-3 & P1-1: Production RPC Flows & Zero Service-Role in Request Path', () => {
    const docUuid = '11111111-1111-4111-8111-111111111111';
    const clinicUuid = '22222222-2222-4222-8222-222222222222';
    const orgUuid = '33333333-3333-4333-8333-333333333333';
    const patientUuid = '44444444-4444-4444-8444-444444444444';
    const apptUuid = '55555555-5555-4555-8555-555555555555';

    it('uses create_appointment_atomic RPC for patient booking with real slot duration & zero admin client', async () => {
      process.env.CLINICBOOK_MODE = 'production';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
      mockAuthUser = { id: patientUuid, email: 'p@test.local' };
      mockTableResponses['users'] = {
        id: patientUuid,
        full_name: 'سارة',
        email: 'p@test.local',
        role: 'patient',
        status: 'active',
      };
      mockTableResponses['availability'] = { clinic_id: clinicUuid, slot_duration_minutes: 30 };
      mockRpcResponses['create_appointment_atomic'] = {
        data: { id: apptUuid, doctor_id: docUuid, clinic_id: clinicUuid, status: 'pending' },
        error: null,
      };

      const res = await createSupabaseBooking({
        doctorId: docUuid,
        clinicId: clinicUuid,
        start: '2026-11-12T07:00:00.000Z',
        visitType: 'first_visit',
      });

      expect(res.success).toBe(true);
      expect(adminCalls).toHaveLength(0);
      const atomicCall = rpcCalls.find((c) => c.fn === 'create_appointment_atomic');
      expect(atomicCall).toBeDefined();
      expect((atomicCall?.args as Record<string, unknown>).p_end_at).toBe(
        '2026-11-12T07:30:00.000Z',
      );
      expect(fromCalls.some((c) => c.table === 'appointments' && c.op === 'insert')).toBe(false);
    });

    it('uses create_staff_appointment_atomic for staff walk-in without any client-side users lookup', async () => {
      process.env.CLINICBOOK_MODE = 'production';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
      const recUuid = '66666666-6666-4666-8666-666666666666';
      mockAuthUser = { id: recUuid, email: 'rec@test.local' };
      mockTableResponses['availability'] = { clinic_id: clinicUuid, slot_duration_minutes: 20 };
      mockTableResponses['users'] = {
        id: recUuid,
        full_name: 'نور',
        email: 'rec@test.local',
        role: 'receptionist',
        status: 'active',
      };
      mockTableResponses['organization_members'] = {
        organization_id: orgUuid,
        clinic_id: clinicUuid,
      };
      mockRpcResponses['create_staff_appointment_atomic'] = {
        data: {
          id: apptUuid,
          booking_source: 'reception_desk',
          walk_in_patient_name: 'سارة الخطيب',
        },
        error: null,
      };

      const res = await createSupabaseBooking({
        doctorId: docUuid,
        clinicId: clinicUuid,
        start: '2026-11-12T07:00:00.000Z',
        patientName: 'سارة الخطيب',
        phone: '+963991122334',
        visitType: 'walk_in',
      });

      expect(res.success).toBe(true);
      expect(adminCalls).toHaveLength(0);
      const staffCall = rpcCalls.find((c) => c.fn === 'create_staff_appointment_atomic');
      expect(staffCall).toBeDefined();
      const staffArgs = staffCall?.args as Record<string, unknown>;
      expect(staffArgs.p_patient_id).toBeNull();
      expect(staffArgs.p_walk_in_name).toBe('سارة الخطيب');
      expect(staffArgs.p_walk_in_phone).toBe('+963991122334');
      // Only currentUser() reads its own users row; phone matching happens inside the SECURITY DEFINER RPC.
      const userLookups = fromCalls.filter((c) => c.table === 'users' && c.op === 'select');
      expect(userLookups).toHaveLength(1);
      expect(userLookups[0].filters.some(([col, val]) => col === 'id' && val === recUuid)).toBe(
        true,
      );
      for (const lookup of userLookups) {
        expect(lookup.filters.some(([col]) => col === 'full_name' || col === 'phone')).toBe(false);
        expect(lookup.filters.some(([col, val]) => col === 'role' && val === 'patient')).toBe(
          false,
        );
      }
    });

    it('resolves real weekday shift duration in multi-shift availability schedules', async () => {
      process.env.CLINICBOOK_MODE = 'production';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
      mockAuthUser = { id: patientUuid, email: 'p@test.local' };
      mockTableResponses['users'] = {
        id: patientUuid,
        full_name: 'سارة',
        email: 'p@test.local',
        role: 'patient',
        status: 'active',
      };
      mockTableResponses['clinics'] = { timezone: 'Asia/Damascus' };
      // 2026-11-12T07:00:00.000Z = 10:00:00 Asia/Damascus on Thursday (day_of_week = 4)
      mockTableResponses['availability'] = [
        { day_of_week: 0, start_time: '09:00:00', end_time: '13:00:00', slot_duration_minutes: 20 },
        { day_of_week: 4, start_time: '09:00:00', end_time: '14:00:00', slot_duration_minutes: 45 },
      ];
      mockRpcResponses['create_appointment_atomic'] = {
        data: { id: apptUuid, doctor_id: docUuid, clinic_id: clinicUuid, status: 'pending' },
        error: null,
      };

      const res = await createSupabaseBooking({
        doctorId: docUuid,
        clinicId: clinicUuid,
        start: '2026-11-12T07:00:00.000Z',
        visitType: 'first_visit',
      });

      expect(res.success).toBe(true);
      const atomicCall = rpcCalls.find((c) => c.fn === 'create_appointment_atomic');
      expect((atomicCall?.args as Record<string, unknown>).p_end_at).toBe(
        '2026-11-12T07:45:00.000Z',
      );
    });

    it('translates Postgres booking and transition errors accurately and exposes 404/409 via routes', async () => {
      expect(translatePostgresBookingError({ message: 'HOLD_EXPIRES_IMMEDIATELY' }).code).toBe(
        'VALIDATION_ERROR',
      );
      expect(
        translatePostgresBookingError({ message: 'WALK_IN_NAME_AND_PHONE_REQUIRED' }).code,
      ).toBe('VALIDATION_ERROR');
      expect(translatePostgresBookingError({ code: '22023', message: 'invalid input' }).code).toBe(
        'VALIDATION_ERROR',
      );
      expect(translatePostgresBookingError({ message: 'PATIENT_NOT_FOUND' }).code).toBe(
        'NOT_FOUND',
      );
      expect(translatePostgresBookingError({ message: 'UNAUTHORIZED' }).code).toBe('UNAUTHORIZED');
      expect(translatePostgresBookingError({ message: 'UNAUTHORIZED_PATIENT' }).code).toBe(
        'FORBIDDEN',
      );

      process.env.CLINICBOOK_MODE = 'production';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
      mockAuthUser = { id: patientUuid, email: 'p@test.local' };
      mockTableResponses['users'] = {
        id: patientUuid,
        full_name: 'سارة',
        email: 'p@test.local',
        role: 'patient',
        status: 'active',
      };
      mockTableResponses['availability'] = { clinic_id: clinicUuid, slot_duration_minutes: 30 };

      mockRpcResponses['transition_appointment'] = {
        data: null,
        error: { code: '22023', message: 'INVALID_TRANSITION' },
      };
      const transRes = await transitionSupabaseAppointment(apptUuid, 'completed');
      expect(transRes.success).toBe(false);
      if (!transRes.success) expect(transRes.code).toBe('INVALID_STATE');

      mockRpcResponses['create_appointment_atomic'] = {
        data: null,
        error: { message: 'PATIENT_NOT_FOUND' },
      };
      const appt404Res = await appointmentsPOST(
        new Request('http://localhost:3000/api/appointments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.99.99.1' },
          body: JSON.stringify({
            doctorId: docUuid,
            clinicId: clinicUuid,
            start: '2026-11-12T07:00:00.000Z',
          }),
        }),
      );
      expect(appt404Res.status).toBe(404);
      expect((await appt404Res.json()).code).toBe('NOT_FOUND');

      mockRpcResponses['create_appointment_atomic'] = {
        data: null,
        error: { code: '23P01', message: 'appointment_no_overlap' },
      };
      const chatConflictRes = await chatPOST(
        new Request('http://localhost:3000/api/agent/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.99.99.2' },
          body: JSON.stringify({
            action: 'book_slot',
            doctorId: docUuid,
            start: '2026-11-12T07:00:00.000Z',
            patientName: 'سارة الخطيب',
            phone: '+963991122334',
          }),
        }),
      );
      expect(chatConflictRes.status).toBe(409);
      const chatConflictBody = (await chatConflictRes.json()) as {
        success: boolean;
        code?: string;
        error?: string;
      };
      expect(chatConflictBody.success).toBe(false);
      expect(chatConflictBody.code).toBe('SLOT_CONFLICT');
      expect(chatConflictBody.error).toBeTruthy();
    });

    it('uses get_available_slots RPC instead of admin queries', async () => {
      mockRpcResponses['get_available_slots'] = {
        data: [{ start_at: '2026-11-12T07:00:00Z', end_at: '2026-11-12T07:30:00Z' }],
        error: null,
      };
      const slotsRes = await getSupabaseSlots(docUuid, '2026-11-12', clinicUuid);
      expect(slotsRes.success).toBe(true);
      expect(adminCalls).toHaveLength(0);
      expect(rpcCalls.some((c) => c.fn === 'get_available_slots')).toBe(true);
    });

    it('uses public_doctor_directory, team_directory, public_reviews, get_tenant_appointments & omits EMR query for non-treating roles', async () => {
      process.env.CLINICBOOK_MODE = 'production';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
      const ownerUuid = '77777777-7777-4777-8777-777777777777';
      mockAuthUser = { id: ownerUuid, email: 'owner@test.local' };
      mockTableResponses['users'] = {
        id: ownerUuid,
        full_name: 'عمر',
        email: 'owner@test.local',
        role: 'clinic_owner',
        status: 'active',
      };
      mockTableResponses['organizations'] = {
        id: orgUuid,
        name: 'مركز الحياة',
        verification_status: 'approved',
      };
      mockTableResponses['clinics'] = [
        {
          id: clinicUuid,
          organization_id: orgUuid,
          name: 'فرع 1',
          district: 'مزة',
          phone: '1234567',
        },
      ];
      mockRpcResponses['public_doctor_directory'] = { data: [], error: null };
      mockRpcResponses['team_directory'] = { data: [], error: null };
      mockRpcResponses['public_reviews'] = { data: [], error: null };
      mockRpcResponses['get_tenant_appointments'] = { data: [], error: null };

      await fetchSupabaseAppData();

      expect(adminCalls).toHaveLength(0);
      expect(rpcCalls.some((c) => c.fn === 'public_doctor_directory')).toBe(true);
      expect(rpcCalls.some((c) => c.fn === 'team_directory')).toBe(true);
      expect(rpcCalls.some((c) => c.fn === 'public_reviews')).toBe(true);
      expect(rpcCalls.some((c) => c.fn === 'get_tenant_appointments')).toBe(true);
      expect(fromCalls.some((c) => c.table === 'medical_records')).toBe(false);
    });

    it('executes operational actions without admin client, resolves doctor branch clinic_id, enforces owner-only settings, and audits review with organization_id', async () => {
      const doctorUser: User = {
        id: 'doc-1',
        name: 'د. سمير',
        email: 'doc@test.local',
        role: 'doctor',
        organizationId: 'org-1',
        clinicId: 'clinic-1',
      };
      const ownerUser: User = {
        id: 'owner-1',
        name: 'عمر',
        email: 'owner@test.local',
        role: 'clinic_owner',
        organizationId: 'org-1',
        clinicId: 'clinic-1',
      };
      const patientActor: User = {
        id: 'pat-1',
        name: 'سارة',
        email: 'pat@test.local',
        role: 'patient',
      };

      mockTableResponses['appointments'] = {
        id: 'appt-1',
        organization_id: 'org-1',
        clinic_id: 'clinic-1',
        doctor_id: 'doc-1',
        patient_id: 'pat-1',
        status: 'confirmed',
        payment_status: 'unpaid',
      };
      mockTableResponses['organization_members'] = { clinic_id: 'clinic-1' };

      await executeSupabaseAction(doctorUser, 'payment', { id: 'appt-1' });
      await executeSupabaseAction(doctorUser, 'schedule', {
        doctorId: 'doc-1',
        shifts: [{ day: 0, start: '09:00', end: '12:00', duration: 20, active: true }],
      });

      await expect(
        executeSupabaseAction(doctorUser, 'settings', {
          name: 'مركز الشفاء',
          phone: '011-2233445',
          address: 'دمشق',
          cancelHours: 2,
          leadMinutes: 60,
          autoConfirm: false,
        }),
      ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });

      mockTableResponses['organizations'] = { id: 'org-1' };
      mockTableResponses['clinics'] = { id: 'clinic-1' };
      await executeSupabaseAction(ownerUser, 'settings', {
        name: 'مركز الشفاء',
        phone: '011-2233445',
        address: 'دمشق',
        cancelHours: 2,
        leadMinutes: 60,
        autoConfirm: false,
      });

      // Owner scheduling for a branch-2 doctor resolves branch clinic-2 via organization_members
      mockTableResponses['doctors'] = { id: 'doc-branch-2', organization_id: 'org-1' };
      mockTableResponses['organization_members'] = { clinic_id: 'clinic-2' };
      await executeSupabaseAction(ownerUser, 'schedule', {
        doctorId: 'doc-branch-2',
        shifts: [{ day: 1, start: '10:00', end: '13:00', duration: 30, active: true }],
      });
      const atomicScheduleCall = rpcCalls.find(
        (call) =>
          call.fn === 'replace_availability_atomic' &&
          (call.args as { p_doctor_id?: string }).p_doctor_id === 'doc-branch-2',
      );
      expect(atomicScheduleCall).toBeDefined();
      expect((atomicScheduleCall?.args as { p_clinic_id: string }).p_clinic_id).toBe('clinic-2');
      expect(fromCalls.some((call) => call.table === 'availability')).toBe(false);

      // Patient review writes organization_id into audit_logs
      mockTableResponses['appointments'] = {
        id: 'appt-rev-1',
        organization_id: 'org-1',
        doctor_id: 'doc-1',
        patient_id: 'pat-1',
        status: 'completed',
      };
      mockTableResponses['reviews'] = null;
      await executeSupabaseAction(patientActor, 'review', {
        appointmentId: 'appt-rev-1',
        rating: 5,
        comment: 'ممتاز',
      });
      const reviewAudit = writePayloads.find(
        (w) =>
          w.table === 'audit_logs' &&
          w.op === 'insert' &&
          (w.data as { action?: string }).action === 'review.created',
      );
      expect((reviewAudit?.data as { organization_id?: string }).organization_id).toBe('org-1');

      expect(adminCalls).toHaveLength(0);
    });

    it('does not instantiate createSupabaseAdmin in team action when serverClient validation fails', async () => {
      const ownerUser: User = {
        id: 'owner-1',
        name: 'عمر',
        email: 'owner@test.local',
        role: 'clinic_owner',
        organizationId: 'org-1',
        clinicId: 'clinic-1',
      };

      // 1. Cross-organization clinicId fails before admin client
      mockTableResponses['clinics'] = { id: 'clinic-other', organization_id: 'org-other' };
      await expect(
        executeSupabaseAction(ownerUser, 'team', {
          name: 'د. سامي',
          email: 'sami@test.local',
          role: 'doctor',
          specialty: 'الطب العام',
          fee: 30,
          license: 'SY-999',
          clinicId: 'clinic-other',
        }),
      ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
      expect(adminCalls).toHaveLength(0);

      // 2. Receptionist on solo_starter tier fails before admin client
      delete mockTableResponses['clinics'];
      mockTableResponses['subscriptions'] = { tier: 'solo_starter', max_doctors: 1 };
      await expect(
        executeSupabaseAction(ownerUser, 'team', {
          name: 'موظف استقبال',
          email: 'rec-new@test.local',
          role: 'receptionist',
          specialty: 'الاستقبال',
          fee: 0,
        }),
      ).rejects.toMatchObject({ status: 422, code: 'TIER_RESTRICTION' });
      expect(adminCalls).toHaveLength(0);

      // 3. Doctor missing license fails before admin client
      mockTableResponses['subscriptions'] = { tier: 'clinic_pro', max_doctors: 10 };
      await expect(
        executeSupabaseAction(ownerUser, 'team', {
          name: 'د. بلا ترخيص',
          email: 'nolicense@test.local',
          role: 'doctor',
          specialty: 'الطب العام',
          fee: 25,
          license: ' ',
        }),
      ).rejects.toMatchObject({ status: 422, code: 'LICENSE_REQUIRED' });
      expect(adminCalls).toHaveLength(0);

      // 4. Max doctors reached fails before admin client
      mockTableResponses['subscriptions'] = { tier: 'solo_starter', max_doctors: 1 };
      mockTableResponses['doctors'] = 1;
      await expect(
        executeSupabaseAction(ownerUser, 'team', {
          name: 'د. إضافي',
          email: 'extra@test.local',
          role: 'doctor',
          specialty: 'الطب العام',
          fee: 25,
          license: 'SY-EXTRA-1',
        }),
      ).rejects.toMatchObject({ status: 422, code: 'LIMIT_REACHED' });
      expect(adminCalls).toHaveLength(0);
    });

    it('propagates DB (500) and RLS (403) errors instead of masking them as 404 in payment, medical, and review actions', async () => {
      const doctorUser: User = {
        id: 'doc-1',
        name: 'د. سمير',
        email: 'doc@test.local',
        role: 'doctor',
        organizationId: 'org-1',
        clinicId: 'clinic-1',
      };
      const patientActor: User = {
        id: 'pat-1',
        name: 'سارة',
        email: 'pat@test.local',
        role: 'patient',
      };

      // RLS 42501 -> 403 FORBIDDEN
      mockTableErrors['appointments'] = { code: '42501', message: 'permission denied for table' };
      await expect(
        executeSupabaseAction(doctorUser, 'payment', { id: 'appt-1' }),
      ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
      await expect(
        executeSupabaseAction(doctorUser, 'medical', {
          appointmentId: 'appt-1',
          diagnosis: 'التهاب حاد',
        }),
      ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
      await expect(
        executeSupabaseAction(patientActor, 'review', {
          appointmentId: 'appt-1',
          rating: 5,
          comment: 'ممتاز',
        }),
      ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });

      // Transient/DB error -> 500 DB_ERROR
      mockTableErrors['appointments'] = { code: '08006', message: 'connection failure' };
      await expect(
        executeSupabaseAction(doctorUser, 'payment', { id: 'appt-1' }),
      ).rejects.toMatchObject({ status: 500, code: 'DB_ERROR' });
      await expect(
        executeSupabaseAction(doctorUser, 'medical', {
          appointmentId: 'appt-1',
          diagnosis: 'التهاب حاد',
        }),
      ).rejects.toMatchObject({ status: 500, code: 'DB_ERROR' });
      await expect(
        executeSupabaseAction(patientActor, 'review', {
          appointmentId: 'appt-1',
          rating: 5,
          comment: 'ممتاز',
        }),
      ).rejects.toMatchObject({ status: 500, code: 'DB_ERROR' });

      // Missing row without error -> 404 NOT_FOUND
      delete mockTableErrors['appointments'];
      delete mockTableResponses['appointments'];
      await expect(
        executeSupabaseAction(doctorUser, 'payment', { id: 'appt-missing' }),
      ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
      await expect(
        executeSupabaseAction(doctorUser, 'medical', {
          appointmentId: 'appt-missing',
          diagnosis: 'التهاب حاد',
        }),
      ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
      await expect(
        executeSupabaseAction(patientActor, 'review', {
          appointmentId: 'appt-missing',
          rating: 5,
          comment: 'ممتاز',
        }),
      ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    });

    it('normalizes blank clinicId to user.clinicId, trims license, and surfaces admin lookup DB errors in team action', async () => {
      const ownerUser: User = {
        id: 'owner-1',
        name: 'عمر',
        email: 'owner@test.local',
        role: 'clinic_owner',
        organizationId: 'org-1',
        clinicId: 'clinic-1',
      };

      mockTableResponses['subscriptions'] = { tier: 'clinic_pro', max_doctors: 10 };
      mockTableResponses['doctors'] = 0;
      mockTableResponses['specialties'] = { id: 'spec-1' };

      const res = await executeSupabaseAction(ownerUser, 'team', {
        name: 'د. مازن',
        email: 'mazen@test.local',
        role: 'doctor',
        specialty: 'الطب العام',
        fee: 35,
        license: '  SY-777  ',
        clinicId: '   ',
      });
      expect(res.success).toBe(true);

      // Blank clinicId should not query clinics and should fall back to user.clinicId ('clinic-1')
      expect(fromCalls.some((c) => c.table === 'clinics' && c.op === 'select')).toBe(false);
      const provisionCall = adminCalls.find(
        (call) => call.fn === 'rpc.provision_team_member_atomic',
      );
      expect(provisionCall).toBeDefined();
      expect(
        provisionCall?.args as { p_clinic_id?: string | null; p_license?: string },
      ).toMatchObject({ p_clinic_id: 'clinic-1', p_license: 'SY-777' });

      // Admin license uniqueness query error must surface as 500 DB_ERROR
      mockTableErrors['admin.doctors.select'] = { message: 'admin doctors lookup failed' };
      await expect(
        executeSupabaseAction(ownerUser, 'team', {
          name: 'د. مازن',
          email: 'mazen2@test.local',
          role: 'doctor',
          specialty: 'الطب العام',
          fee: 35,
          license: 'SY-778',
        }),
      ).rejects.toMatchObject({ status: 500, code: 'DB_ERROR' });

      // Admin user email uniqueness query error must surface as 500 DB_ERROR
      delete mockTableErrors['admin.doctors.select'];
      mockTableErrors['admin.users.select'] = { message: 'admin users lookup failed' };
      await expect(
        executeSupabaseAction(ownerUser, 'team', {
          name: 'د. مازن',
          email: 'mazen3@test.local',
          role: 'doctor',
          specialty: 'الطب العام',
          fee: 35,
          license: 'SY-779',
        }),
      ).rejects.toMatchObject({ status: 500, code: 'DB_ERROR' });
    });

    it('propagates 403/500 errors on medical_records upsert and reviews lookup/insert', async () => {
      const doctorUser: User = {
        id: 'doc-1',
        name: 'د. سمير',
        email: 'doc@test.local',
        role: 'doctor',
        organizationId: 'org-1',
        clinicId: 'clinic-1',
      };
      const patientActor: User = {
        id: 'pat-1',
        name: 'سارة',
        email: 'pat@test.local',
        role: 'patient',
      };

      mockTableResponses['appointments'] = {
        id: 'appt-1',
        organization_id: 'org-1',
        clinic_id: 'clinic-1',
        doctor_id: 'doc-1',
        patient_id: 'pat-1',
        status: 'completed',
      };

      mockTableErrors['medical_records.upsert'] = { code: '42501', message: 'rls denied' };
      await expect(
        executeSupabaseAction(doctorUser, 'medical', {
          appointmentId: 'appt-1',
          diagnosis: 'التهاب حاد',
        }),
      ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });

      mockTableErrors['reviews.select'] = { code: '42501', message: 'rls select denied' };
      await expect(
        executeSupabaseAction(patientActor, 'review', {
          appointmentId: 'appt-1',
          rating: 5,
          comment: 'ممتاز',
        }),
      ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });

      mockTableErrors['reviews.select'] = { code: '08006', message: 'db down' };
      await expect(
        executeSupabaseAction(patientActor, 'review', {
          appointmentId: 'appt-1',
          rating: 5,
          comment: 'ممتاز',
        }),
      ).rejects.toMatchObject({ status: 500, code: 'DB_ERROR' });

      delete mockTableErrors['reviews.select'];
      mockTableResponses['reviews'] = null;
      mockTableErrors['reviews.insert'] = { code: '42501', message: 'rls insert denied' };
      await expect(
        executeSupabaseAction(patientActor, 'review', {
          appointmentId: 'appt-1',
          rating: 5,
          comment: 'ممتاز',
        }),
      ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    });
  });

  // ─── P0-4: Super Admin Clinical & Appointment Isolation ─────────────────────
  describe('P0-4: Super Admin Isolation', () => {
    it('denies super_admin on medical records and tenant appointments while /api/data still serves governance console', async () => {
      ensureSeed();
      expect(
        canAccess(
          { id: 'admin-1', role: 'super_admin' },
          {
            organizationId: 'org-1',
            doctorId: 'doctor-1',
            patientId: 'patient-1',
            clinicId: 'clinic-1',
          },
          'medical',
        ),
      ).toBe(false);
      expect(
        canAccess(
          { id: 'admin-1', role: 'super_admin', organizationId: 'org-1' },
          {
            organizationId: 'org-1',
            doctorId: 'doctor-1',
            patientId: 'patient-1',
            clinicId: 'clinic-1',
          },
          'appointment',
        ),
      ).toBe(false);

      const admin = roles.find((r) => r.role === 'super_admin')!;
      await createSession(admin.id);
      const res = await dataGET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.appointments).toEqual([]);
      expect(body.data.records).toEqual([]);
      expect(body.data.admin).not.toBeNull();
      expect(body.data.admin.organizations.length).toBeGreaterThan(0);
      expect(body.data.admin.verifications.length).toBeGreaterThan(0);
    });
  });

  // ─── P0-5 & P1-7: Agent Chat Auth, Rate Limits & AgentRouter Hygiene ───────
  describe('P0-5 & P1-7: Agent Auth, Rate Limiting & AgentRouter Hygiene', () => {
    it('returns 401 when book_slot is called without an authenticated patient session', async () => {
      const req = new Request('http://localhost:3000/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.10.10.1' },
        body: JSON.stringify({
          action: 'book_slot',
          doctorId: 'doctor-1',
          start: '2026-11-15T07:00:00Z',
          patientName: 'مريض زائر',
          phone: '+963991112233',
        }),
      });
      const res = await chatPOST(req);
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe('UNAUTHORIZED');
    });

    it('refuses forged patient creation in book_appointment tool when patientId is missing', async () => {
      const result = (await bookAppointmentTool.execute({
        doctorId: 'doctor-1',
        start: '2026-11-15T07:00:00Z',
        patientName: 'مريض مجهول',
        phone: '+963991112233',
        visitType: 'first_visit',
      })) as { success: boolean; code?: string };

      expect(result.success).toBe(false);
      expect(result.code).toBe('UNAUTHORIZED');
    });

    it('rejects chat messages exceeding 2000 characters at both route (400) and service boundaries', async () => {
      const tooLong = 'أ'.repeat(2001);
      const req = new Request('http://localhost:3000/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.10.10.2' },
        body: JSON.stringify({ action: 'chat', message: tooLong }),
      });
      const res = await chatPOST(req);
      expect(res.status).toBe(400);

      const svcRes = await processAgentMessage({ message: tooLong });
      expect(svcRes.success).toBe(false);
      if (!svcRes.success) expect(svcRes.code).toBe('VALIDATION_ERROR');
    });

    it('enforces rate limits with 429 and Retry-After header on book_slot, appointments, and session login', async () => {
      ensureSeed();
      const patient = roles.find((r) => r.role === 'patient')!;
      await createSession(patient.id);

      // 6th consecutive book_slot attempt triggers 429 (limit is 5/10m)
      let sixthStatus = 0;
      let retryAfter: string | null = null;
      for (let i = 0; i < 6; i++) {
        const res = await chatPOST(
          new Request('http://localhost:3000/api/agent/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.20.30.40' },
            body: JSON.stringify({
              action: 'book_slot',
              doctorId: 'doctor-1',
              start: '2020-01-01T07:00:00Z',
              patientName: 'سارة',
              phone: '+963991112233',
            }),
          }),
        );
        if (i === 5) {
          sixthStatus = res.status;
          retryAfter = res.headers.get('Retry-After');
        }
      }
      expect(sixthStatus).toBe(429);
      expect(Number(retryAfter)).toBeGreaterThan(0);

      // 11th request to /api/appointments triggers 429 (limit is 10/min)
      let eleventhStatus = 0;
      for (let i = 0; i < 11; i++) {
        const res = await appointmentsPOST(
          new Request('http://localhost:3000/api/appointments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.20.30.41' },
            body: JSON.stringify({}),
          }),
        );
        if (i === 10) eleventhStatus = res.status;
      }
      expect(eleventhStatus).toBe(429);

      // 11th request to /api/session login triggers 429 with Retry-After (limit is 10/15m)
      let loginEleventhStatus = 0;
      let loginRetryAfter: string | null = null;
      for (let i = 0; i < 11; i++) {
        const res = await sessionPOST(
          new Request('http://localhost:3000/api/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.20.30.42' },
            body: JSON.stringify({ email: 'missing@example.com', password: 'wrongpassword' }),
          }),
        );
        if (i === 10) {
          loginEleventhStatus = res.status;
          loginRetryAfter = res.headers.get('Retry-After');
        }
      }
      expect(loginEleventhStatus).toBe(429);
      expect(Number(loginRetryAfter)).toBeGreaterThan(0);
    });

    it('refills token bucket gradually over time and keys limits independently by IP + route', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-10T10:00:00.000Z'));

      const config = { limit: 4, windowMs: 40_000 }; // 1 token per 10,000ms
      const keyA = '10.1.1.1:/api/agent/chat:chat';
      const keySameIpOtherRoute = '10.1.1.1:/api/appointments';
      const keyOtherIpSameRoute = '10.1.1.2:/api/agent/chat:chat';

      // Burst consumes full bucket capacity (4 tokens)
      expect(checkRateLimit(keyA, config)).toMatchObject({ allowed: true, remaining: 3 });
      expect(checkRateLimit(keyA, config)).toMatchObject({ allowed: true, remaining: 2 });
      expect(checkRateLimit(keyA, config)).toMatchObject({ allowed: true, remaining: 1 });
      expect(checkRateLimit(keyA, config)).toMatchObject({ allowed: true, remaining: 0 });

      const deniedAtZero = checkRateLimit(keyA, config);
      expect(deniedAtZero).toMatchObject({ allowed: false, remaining: 0, resetMs: 10_000 });

      // Other route on same IP and same route on other IP remain unaffected
      expect(checkRateLimit(keySameIpOtherRoute, config)).toMatchObject({
        allowed: true,
        remaining: 3,
      });
      expect(checkRateLimit(keyOtherIpSameRoute, config)).toMatchObject({
        allowed: true,
        remaining: 3,
      });

      // Half a refill interval (5s) -> 0.5 tokens, still denied with accurate 5,000ms resetMs
      vi.advanceTimersByTime(5_000);
      expect(checkRateLimit(keyA, config)).toMatchObject({
        allowed: false,
        remaining: 0,
        resetMs: 5_000,
      });

      // Completing the 10s interval yields exactly 1 refilled token (not full window reset)
      vi.advanceTimersByTime(5_000);
      expect(checkRateLimit(keyA, config)).toMatchObject({ allowed: true, remaining: 0 });
      expect(checkRateLimit(keyA, config)).toMatchObject({
        allowed: false,
        remaining: 0,
        resetMs: 10_000,
      });

      // Long idle period refills tokens but caps at config.limit (4)
      vi.advanceTimersByTime(120_000);
      expect(checkRateLimit(keyA, config)).toMatchObject({ allowed: true, remaining: 3 });
    });

    it('returns 400 VALIDATION_ERROR on malformed JSON in /api/agent/chat and rate-limits repeated invalid payloads', async () => {
      const malformedRes = await chatPOST(
        new Request('http://localhost:3000/api/agent/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.60.60.1' },
          body: '{malformed-json',
        }),
      );
      expect(malformedRes.status).toBe(400);
      const malformedBody = (await malformedRes.json()) as { success: boolean; code?: string };
      expect(malformedBody.success).toBe(false);
      expect(malformedBody.code).toBe('VALIDATION_ERROR');

      // Exhaust chat rate limit (20) using invalid payloads on another IP -> 21st must return 429
      for (let i = 0; i < RATE_LIMIT_CONFIGS.chat.limit; i++) {
        const res = await chatPOST(
          new Request('http://localhost:3000/api/agent/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.60.60.2' },
            body: '{invalid-json',
          }),
        );
        expect(res.status).toBe(400);
      }

      const throttledRes = await chatPOST(
        new Request('http://localhost:3000/api/agent/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.60.60.2' },
          body: '{invalid-json',
        }),
      );
      expect(throttledRes.status).toBe(429);
      expect((await throttledRes.json()).code).toBe('RATE_LIMITED');
      expect(Number(throttledRes.headers.get('Retry-After'))).toBeGreaterThan(0);
    });

    it('returns 422 VALIDATION_ERROR on malformed JSON in /api/actions and surfaces DB errors in /api/cron/retention', async () => {
      const actionsRes = await actionsPOST(
        new Request('http://localhost:3000/api/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{not-valid-json',
        }),
      );
      expect(actionsRes.status).toBe(422);
      const actionsBody = (await actionsRes.json()) as { success: boolean; code?: string };
      expect(actionsBody.success).toBe(false);
      expect(actionsBody.code).toBe('VALIDATION_ERROR');

      process.env.CLINICBOOK_MODE = 'production';
      mockTableErrors['appointments'] = { message: 'upcoming query failed' };
      const cronRes = await retentionPOST(
        new Request('http://localhost:3000/api/cron/retention', {
          method: 'POST',
          headers: { authorization: 'Bearer clinicbook-internal-cron-secret' },
        }),
      );
      expect(cronRes.status).toBe(500);
      const cronBody = (await cronRes.json()) as { success: boolean; code?: string };
      expect(cronBody.success).toBe(false);
      expect(cronBody.code).toBe('INTERNAL_ERROR');
    });

    it('falls back cleanly on blank x-forwarded-for in getClientIp and evicts expired buckets in 60s cleanup timer', async () => {
      const blankXffReq = new Request('http://localhost:3000/api/session', {
        method: 'POST',
        headers: { 'x-forwarded-for': '   ', 'x-real-ip': ' 203.0.113.5 ' },
      });
      expect(getClientIp(blankXffReq)).toBe('203.0.113.5');

      const leadingCommaReq = new Request('http://localhost:3000/api/session', {
        method: 'POST',
        headers: { 'x-forwarded-for': ', 10.0.0.2' },
      });
      expect(getClientIp(leadingCommaReq)).toBe('127.0.0.1');

      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-11-10T10:00:00.000Z'));
        vi.resetModules();
        const freshRateLimit = await import('../../src/lib/rate-limit');
        const cfg = { limit: 2, windowMs: 30_000 };
        const key = '10.88.88.1:/api/agent/chat:chat';

        expect(freshRateLimit.checkRateLimit(key, cfg)).toMatchObject({
          allowed: true,
          remaining: 1,
        });
        expect(freshRateLimit.checkRateLimit(key, cfg)).toMatchObject({
          allowed: true,
          remaining: 0,
        });
        expect(freshRateLimit.checkRateLimit(key, cfg)).toMatchObject({ allowed: false });

        // Advance past the 60s cleanup interval (>= windowMs 30s -> bucket evicted -> fresh full capacity)
        vi.advanceTimersByTime(60_000);
        expect(freshRateLimit.checkRateLimit(key, cfg)).toMatchObject({
          allowed: true,
          remaining: 1,
        });
      } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
      }
    });

    it('uses the rightmost proxy-appended IP when trusted hop count is not configured', () => {
      delete process.env.TRUSTED_PROXY_HOPS;
      const request = new Request('http://localhost:3000/api/session', {
        headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' },
      });

      expect(getClientIp(request)).toBe('10.0.0.1');
    });

    it('skips currentUser and Supabase auth lookups when /api/agent/chat returns 429 RATE_LIMITED', async () => {
      process.env.CLINICBOOK_MODE = 'production';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
      const serverSpy = vi.mocked(createSupabaseServer);

      // Exhaust chat limit (20 requests) with valid chat payload
      for (let i = 0; i < RATE_LIMIT_CONFIGS.chat.limit; i++) {
        const res = await chatPOST(
          new Request('http://localhost:3000/api/agent/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.77.77.1' },
            body: JSON.stringify({ action: 'chat', message: 'ألم في الصدر' }),
          }),
        );
        expect(res.status).toBe(200);
      }

      const callsBeforeChat429 = serverSpy.mock.calls.length;
      const fromBeforeChat429 = fromCalls.length;
      const chat429 = await chatPOST(
        new Request('http://localhost:3000/api/agent/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.77.77.1' },
          body: JSON.stringify({ action: 'chat', message: 'ألم في الصدر' }),
        }),
      );
      expect(chat429.status).toBe(429);
      expect(serverSpy.mock.calls.length).toBe(callsBeforeChat429);
      expect(fromCalls.length).toBe(fromBeforeChat429);

      // Exhaust book_slot limit (5 requests) on another IP
      for (let i = 0; i < RATE_LIMIT_CONFIGS.bookSlot.limit; i++) {
        const res = await chatPOST(
          new Request('http://localhost:3000/api/agent/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.77.77.2' },
            body: JSON.stringify({
              action: 'book_slot',
              doctorId: 'doctor-1',
              start: '2026-11-15T07:00:00Z',
              patientName: 'سارة',
              phone: '+963991112233',
            }),
          }),
        );
        expect(res.status).toBe(401);
      }

      const callsBeforeBook429 = serverSpy.mock.calls.length;
      const fromBeforeBook429 = fromCalls.length;
      const book429 = await chatPOST(
        new Request('http://localhost:3000/api/agent/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.77.77.2' },
          body: JSON.stringify({
            action: 'book_slot',
            doctorId: 'doctor-1',
            start: '2026-11-15T07:00:00Z',
            patientName: 'سارة',
            phone: '+963991112233',
          }),
        }),
      );
      expect(book429.status).toBe(429);
      expect(serverSpy.mock.calls.length).toBe(callsBeforeBook429);
      expect(fromCalls.length).toBe(fromBeforeBook429);
    });

    it('redacts PII, uses JSON.stringify cleanly, avoids spoofed CLI headers, and strips CRLF in AgentRouter', async () => {
      process.env.AGENTROUTER_API_KEY = 'secret-key\r\nInjected: bad';
      delete process.env.AGENTROUTER_USER_AGENT;
      delete process.env.AGENTROUTER_CUSTOM_APP_HEADER;

      let capturedInit: RequestInit | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
          capturedInit = init;
          return new Response(
            JSON.stringify({
              output: [{ type: 'message', content: [{ type: 'output_text', text: 'إجابة طبية' }] }],
            }),
            { status: 200 },
          );
        }),
      );

      const res = await callAgentRouter(
        'لدي صداع وبريدي secret@example.com وهاتفي +963991234567 ومعه "اقتباس"\nوسطر جديد',
        { specialties: ['الطب العام'] },
      );

      expect(res.success).toBe(true);
      expect(capturedInit).toBeDefined();
      const headers = capturedInit!.headers as Record<string, string>;
      expect(headers['User-Agent']).toContain('ClinicBook-AI-Triage');
      expect(headers['User-Agent']).not.toContain('claude-cli');
      expect(headers['x-app']).toBeUndefined();
      expect(headers['Authorization']).toBe('Bearer secret-keyInjected: bad');

      const sentBody = JSON.parse(String(capturedInit!.body));
      expect(sentBody.input).not.toContain('secret@example.com');
      expect(sentBody.input).not.toContain('963991234567');
      expect(sentBody.input).toContain('[بريد محذوف]');
      expect(sentBody.input).toContain('[هاتف محذوف]');
    });
  });

  // ─── P1-2: Zero Top-Level SQLite Imports & Production Isolation ─────────────
  describe('P1-2: Zero Top-Level SQLite Imports & Production Fail-Closed', () => {
    it('ensures no app API route, agent module, or non-demo service statically imports demo-db or booking-service', () => {
      const scanDirs = [
        path.resolve(__dirname, '../../src/app'),
        path.resolve(__dirname, '../../src/lib/services'),
        path.resolve(__dirname, '../../src/lib/auth'),
        path.resolve(__dirname, '../../agent'),
      ];
      const staticImportPattern =
        /^\s*import\s+(?!type\b)[^;]*\bfrom\s+['"][^'"]*\/(?:demo-db|booking-service)['"]/m;

      const walk = (dir: string): string[] =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) return walk(full);
          return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [full] : [];
        });

      const offenders: string[] = [];
      for (const dir of scanDirs) {
        for (const file of walk(dir)) {
          if (
            file.endsWith(`${path.sep}booking-service.ts`) ||
            file.endsWith(`${path.sep}demo-db.ts`)
          )
            continue;
          const content = fs.readFileSync(file, 'utf8');
          if (staticImportPattern.test(content)) {
            offenders.push(path.relative(process.cwd(), file));
          }
        }
      }
      expect(offenders).toEqual([]);
    });

    it('never uses SQLite session fallback when CLINICBOOK_MODE=production even with cookie present', async () => {
      ensureSeed();
      const admin = roles.find((r) => r.role === 'super_admin')!;
      const token = await createSession(admin.id);
      mockCookieStore.set('clinicbook-session', token);

      process.env.CLINICBOOK_MODE = 'production';
      expect(await currentUser()).toBeNull();
    });

    it('never uses a SQLite actor when FORCE_SUPABASE overrides demo mode', async () => {
      ensureSeed();
      const admin = roles.find((r) => r.role === 'super_admin')!;
      const token = await createSession(admin.id);
      mockCookieStore.set('clinicbook-session', token);

      process.env.FORCE_SUPABASE = 'true';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
      expect(await currentUser()).toBeNull();
    });
  });

  // ─── P1-4: Middleware Security Headers, CSP, CSRF & Body Size ───────────────
  describe('P1-4: Middleware Security Headers, CSRF & Body Validation', () => {
    it('blocks cross-site API mutations via Sec-Fetch-Site while exempting /api/cron/*', async () => {
      const crossApiReq = new NextRequest('http://localhost:3000/api/appointments', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          'sec-fetch-site': 'cross-site',
          'content-type': 'application/json',
          'content-length': '2',
        },
        body: '{}',
      });
      const apiRes = await middleware(crossApiReq);
      expect(apiRes.status).toBe(403);

      const cronReq = new NextRequest('http://localhost:3000/api/cron/retention', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          'sec-fetch-site': 'cross-site',
        },
      });
      const cronRes = await middleware(cronReq);
      expect(cronRes.status).toBe(200);
    });

    it('enforces 411 Content-Length required, 415 Content-Type, and 413 oversized payload guard on API mutations while allowing bodyless DELETE', async () => {
      const noLengthJsonReq = new NextRequest('http://localhost:3000/api/appointments', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          'content-type': 'application/json',
        },
        body: '{}',
      });
      expect((await middleware(noLengthJsonReq)).status).toBe(411);

      const noLengthTextReq = new NextRequest('http://localhost:3000/api/appointments', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          'content-type': 'text/plain',
        },
        body: '{}',
      });
      expect((await middleware(noLengthTextReq)).status).toBe(411);

      const unsupportedTextReq = new NextRequest('http://localhost:3000/api/appointments', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          'content-type': 'text/plain',
          'content-length': '2',
        },
        body: '{}',
      });
      expect((await middleware(unsupportedTextReq)).status).toBe(415);

      const headerlessPostReq = new NextRequest('http://localhost:3000/api/appointments', {
        method: 'POST',
        headers: { host: 'localhost:3000' },
      });
      expect((await middleware(headerlessPostReq)).status).toBe(411);

      const emptyLengthReq = new NextRequest('http://localhost:3000/api/appointments', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          'content-type': 'application/json',
          'content-length': '',
        },
      });
      expect((await middleware(emptyLengthReq)).status).toBe(411);

      const hugeReq = new NextRequest('http://localhost:3000/api/appointments', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          'content-type': 'application/json',
          'content-length': '70000',
        },
        body: '{}',
      });
      expect((await middleware(hugeReq)).status).toBe(413);

      // Next.js real HTTP server passes a non-null closed ReadableStream even for bodyless DELETE
      const bodylessDeleteSession = new NextRequest('http://localhost:3000/api/session', {
        method: 'DELETE',
        headers: {
          host: 'localhost:3000',
        },
        body: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        duplex: 'half',
      });
      expect((await middleware(bodylessDeleteSession)).status).toBe(200);
    });

    it('reports CSP in development and enforces it with HSTS in production', async () => {
      const pageReq = new NextRequest('http://localhost:3000/', {
        method: 'GET',
        headers: { host: 'localhost:3000' },
      });

      const nonProdRes = await middleware(pageReq);
      const csp = nonProdRes.headers.get('Content-Security-Policy-Report-Only') ?? '';
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("'nonce-");
      expect(csp).toContain("object-src 'none'");
      expect(nonProdRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(nonProdRes.headers.get('Strict-Transport-Security')).toBeNull();

      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      const prodRes = await middleware(pageReq);
      expect(prodRes.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
      expect(prodRes.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
      expect(prodRes.headers.get('Content-Security-Policy-Report-Only')).toBeNull();

      process.env.CSP_REPORT_ONLY = 'true';
      const reportingProdRes = await middleware(pageReq);
      expect(reportingProdRes.headers.get('Content-Security-Policy')).toBeNull();
      expect(reportingProdRes.headers.get('Content-Security-Policy-Report-Only')).toContain(
        "default-src 'self'",
      );
    });
  });

  // ─── P1-5 & P1-6: Scrypt Password Hashing & Session Cookie Lifecycle ─────────
  describe('P1-5 & P1-6: Scrypt Passwords, Lazy Migration & Cookie Hardening', () => {
    it('hashes with scrypt$N$r$p$salt$hash and upgrades legacy SHA-256 on successful login', async () => {
      ensureSeed();
      const hashed = await hashPassword('MyStr0ng!Pass');
      expect(hashed).toMatch(/^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
      expect(await verifyPassword('MyStr0ng!Pass', hashed)).toEqual({
        valid: true,
        needsUpgrade: false,
      });
      expect(await verifyPassword('WrongPass', hashed)).toEqual({
        valid: false,
        needsUpgrade: false,
      });

      const legacyId = randomUUID();
      const legacyEmail = `legacy-${legacyId.slice(0, 8)}@test.demo`;
      const legacyHash = createHash('sha256').update('legacyPass99').digest('hex');
      put('user', legacyId, {
        id: legacyId,
        name: 'مستخدم قديم',
        email: legacyEmail,
        role: 'patient',
        passwordHash: legacyHash,
      });

      const loginRes = await sessionPOST(
        new Request('http://localhost:3000/api/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.30.40.50' },
          body: JSON.stringify({ email: legacyEmail, password: 'legacyPass99' }),
        }),
      );
      expect(loginRes.status).toBe(200);

      const upgradedRow = JSON.parse(
        (
          db.prepare('SELECT data FROM entities WHERE kind=? AND id=?').get('user', legacyId) as {
            data: string;
          }
        ).data,
      ) as { passwordHash: string };
      expect(upgradedRow.passwordHash.startsWith('scrypt$')).toBe(true);
    });

    it('rejects passwordless demo users using default password while seeded accounts authenticate cleanly', async () => {
      ensureSeed();
      const noPassId = `invited-staff-${randomUUID().slice(0, 8)}`;
      const noPassEmail = `invited-${noPassId}@clinicbook.demo`;
      put('user', noPassId, {
        id: noPassId,
        name: 'عضو بلا كلمة مرور',
        email: noPassEmail,
        role: 'doctor',
        organizationId: 'org-1',
        clinicId: 'clinic-1',
      });

      const deniedRes = await sessionPOST(
        new Request('http://localhost:3000/api/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.30.40.51' },
          body: JSON.stringify({ email: noPassEmail, password: 'demo1234' }),
        }),
      );
      expect(deniedRes.status).toBe(401);

      const doc2Res = await sessionPOST(
        new Request('http://localhost:3000/api/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.30.40.52' },
          body: JSON.stringify({ email: 'doctor-2@clinicbook.demo', password: 'demo1234' }),
        }),
      );
      expect(doc2Res.status).toBe(200);

      const pat2Res = await sessionPOST(
        new Request('http://localhost:3000/api/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.30.40.53' },
          body: JSON.stringify({ email: 'patient2@clinicbook.demo', password: 'demo1234' }),
        }),
      );
      expect(pat2Res.status).toBe(200);
    });

    it('rotates prior sessions on login, rejects expired or >24h tokens, and uses __Host- prefix in production', async () => {
      ensureSeed();
      const pat = roles.find((r) => r.role === 'patient')!;
      const firstToken = await createSession(pat.id);
      const firstHash = createHash('sha256').update(firstToken).digest('hex');

      const secondToken = await createSession(pat.id);
      const secondHash = createHash('sha256').update(secondToken).digest('hex');

      expect(db.prepare('SELECT 1 FROM sessions WHERE token=?').get(firstHash)).toBeUndefined();
      expect(db.prepare('SELECT 1 FROM sessions WHERE token=?').get(secondHash)).toBeDefined();

      // Reject token with future lifetime exceeding 24h ceiling
      db.prepare('UPDATE sessions SET expires_at=? WHERE token=?').run(
        new Date(Date.now() + 72 * 3600000).toISOString(),
        secondHash,
      );
      expect(await currentUser()).toBeNull();

      // Reject expired token
      db.prepare('UPDATE sessions SET expires_at=? WHERE token=?').run(
        new Date(Date.now() - 1000).toISOString(),
        secondHash,
      );
      expect(await currentUser()).toBeNull();

      // __Host- cookie prefix in production unless COOKIE_SECURE=false
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      delete process.env.COOKIE_SECURE;
      expect(getSessionCookieName()).toBe('__Host-clinicbook-session');

      process.env.COOKIE_SECURE = 'false';
      expect(getSessionCookieName()).toBe('clinicbook-session');
    });
  });

  // ─── P1-8: Demo Review Isolation ─────────────────────────────────────────────
  describe('P1-8: Demo Review Tenant & Verification Isolation', () => {
    it('filters out reviews tied to unverified or hidden doctors for anonymous visitors', async () => {
      ensureSeed();
      const hiddenDocId = `hidden-doc-${Date.now()}`;
      const hiddenReviewAppt = `hidden-rev-${Date.now()}`;
      put('doctor', hiddenDocId, {
        id: hiddenDocId,
        name: 'طبيب غير معتمد',
        specialty: 'الطب العام',
        organizationId: 'org-unverified',
        clinicId: 'clinic-unverified',
        clinic: 'عيادة مخفية',
        city: 'دمشق',
        district: 'الشعلان',
        fee: 20,
        followUpFee: 10,
        rating: 5,
        reviews: 1,
        experience: 2,
        bio: '',
        color: '#fff',
        image: 'doctor-1.jpg',
        verified: false,
        license: 'PENDING',
      });
      put('review', hiddenReviewAppt, {
        appointmentId: hiddenReviewAppt,
        doctorId: hiddenDocId,
        rating: 5,
        comment: 'تقييم مخفي',
        name: 'مريض',
      });

      const res = await dataGET();
      expect(res.status).toBe(200);
      const body = await res.json();
      const loadedReviews = body.data.reviews as Array<{ appointmentId: string }>;
      expect(loadedReviews.some((r) => r.appointmentId === hiddenReviewAppt)).toBe(false);
    });
  });
});
