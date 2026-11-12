import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const cookieStore = new Map<string, string>();
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined),
    set: (name: string, value: string) => cookieStore.set(name, value),
    getAll: () => [...cookieStore].map(([name, value]) => ({ name, value })),
  }),
}));

import { GET } from '@/app/api/data/route';
import { createSession } from '@/lib/auth/session';
import { roles, get, put } from '@/lib/demo-db';
import type { Doctor } from '@/lib/types';

describe('Conditional app-data HTTP responses', () => {
  beforeEach(() => {
    cookieStore.clear();
    vi.stubEnv('CLINICBOOK_MODE', 'demo');
    vi.stubEnv('FORCE_SUPABASE', 'false');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('returns 304 without transferring an unchanged snapshot while retaining no-store', async () => {
    const first = await GET(new Request('http://localhost:3000/api/data'));
    expect(first.status).toBe(200);
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^"[a-f0-9]{64}"$/);
    const second = await GET(
      new Request('http://localhost:3000/api/data', {
        headers: { 'if-none-match': etag! },
      }),
    );
    expect(second.status).toBe(304);
    expect(second.headers.get('cache-control')).toBe('no-store');
    expect(await second.text()).toBe('');
  });

  it('resolves identity and permissions before comparing a prior user validator', async () => {
    const owner = roles.find((user) => user.role === 'clinic_owner')!;
    const patient = roles.find((user) => user.role === 'patient')!;
    await createSession(owner.id);
    const first = await GET(new Request('http://localhost:3000/api/data'));
    const validator = first.headers.get('etag')!;
    await createSession(patient.id);
    const second = await GET(
      new Request('http://localhost:3000/api/data', {
        headers: { 'if-none-match': validator },
      }),
    );
    expect(second.status).toBe(200);
    expect(second.headers.get('etag')).not.toBe(validator);
    const body = await second.json();
    expect(body.data.user.id).toBe(patient.id);
    expect(body.data.admin).toBeNull();
    expect(
      body.data.appointments.every(
        (appointment: { patientId: string }) => appointment.patientId === patient.id,
      ),
    ).toBe(true);
  });

  it('transfers a changed snapshot instead of retaining stale doctor data', async () => {
    const first = await GET(new Request('http://localhost:3000/api/data'));
    const body = await first.json();
    const id = body.data.doctors[0].id;
    const doctor = get<Doctor>('doctor', id)!;
    try {
      put('doctor', id, { ...doctor, fee: doctor.fee + 1 });
      const changed = await GET(
        new Request('http://localhost:3000/api/data', {
          headers: { 'if-none-match': first.headers.get('etag')! },
        }),
      );
      expect(changed.status).toBe(200);
      expect(changed.headers.get('etag')).not.toBe(first.headers.get('etag'));
      const next = await changed.json();
      expect(next.data.doctors.find((row: { id: string }) => row.id === id).fee).toBe(
        doctor.fee + 1,
      );
    } finally {
      put('doctor', id, doctor);
    }
  });
});
