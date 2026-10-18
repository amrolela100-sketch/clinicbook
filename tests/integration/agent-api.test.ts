import { describe, it, expect } from 'vitest';
import { POST } from '../../src/app/api/agent/chat/route';

describe('Integration: Agent Chat API Endpoint (/api/agent/chat)', () => {
  it('handles chat action and returns 200 with structured agent response', async () => {
    const req = new Request('http://localhost:3000/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'chat',
        message: 'أريد حجز موعد مع طبيب قلب',
        date: '2026-10-25',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.intent).toBe('slots_found');
    expect(json.data.doctors.length).toBeGreaterThan(0);
  });

  it('triggers emergency protocol and returns high-priority alert', async () => {
    const req = new Request('http://localhost:3000/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'chat',
        message: 'أشعر بألم في الصدر وضيق تنفس حاد',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.emergency).toBe(true);
    expect(json.data.reply).toContain('997');
  });

  it('returns 400 error on invalid request payload', async () => {
    const req = new Request('http://localhost:3000/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'invalid_action',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.code).toBe('VALIDATION_ERROR');
  });
});
