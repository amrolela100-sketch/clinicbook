import { describe, it, expect } from 'vitest';
import { POST, GET } from '../../src/app/api/cron/retention/route';

describe('Integration: Retention Cron Endpoint (/api/cron/retention)', () => {
  it('rejects unauthorized requests without valid Bearer token', async () => {
    const req = new Request('http://localhost:3000/api/cron/retention', {
      method: 'POST',
      headers: {
        authorization: 'Bearer wrong-secret',
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.code).toBe('UNAUTHORIZED');
  });

  it('authorizes requests with valid secret and returns retention summary', async () => {
    const validSecret = process.env.CRON_SECRET || 'clinicbook-internal-cron-secret';
    const req = new Request('http://localhost:3000/api/cron/retention', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${validSecret}`,
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveProperty('checkedCount');
    expect(json.data).toHaveProperty('upcomingCount');
    expect(Array.isArray(json.data.candidatesForConfirmation)).toBe(true);
  });

  it('supports GET requests via same authorized handler', async () => {
    const validSecret = process.env.CRON_SECRET || 'clinicbook-internal-cron-secret';
    const req = new Request('http://localhost:3000/api/cron/retention', {
      method: 'GET',
      headers: {
        authorization: `Bearer ${validSecret}`,
      },
    });

    const res = await GET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
  });
});
