import { beforeEach, describe, expect, it, vi } from 'vitest';

const slotMocks = vi.hoisted(() => ({
  demoEnabled: vi.fn(),
  getSupabaseSlots: vi.fn(),
  slotsFor: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({ demoEnabled: slotMocks.demoEnabled }));
vi.mock('@/lib/services/supabase-booking-service', () => ({
  getSupabaseSlots: slotMocks.getSupabaseSlots,
}));
vi.mock('@/lib/services/booking-service', () => ({ slotsFor: slotMocks.slotsFor }));

import { GET } from '@/app/api/slots/route';

describe('Slots HTTP interface', () => {
  beforeEach(() => {
    slotMocks.demoEnabled.mockReset();
    slotMocks.getSupabaseSlots.mockReset();
    slotMocks.slotsFor.mockReset();
  });

  it.each([
    'http://localhost/api/slots?date=2026-10-25',
    'http://localhost/api/slots?doctorId=doctor-1&date=invalid',
    'http://localhost/api/slots?doctorId=doctor-1&date=2026-99-99',
  ])('returns 400 for an invalid query: %s', async (url) => {
    const response = await GET(new Request(url));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false });
  });

  it('returns demo slots with no-store caching', async () => {
    slotMocks.demoEnabled.mockReturnValue(true);
    slotMocks.slotsFor.mockReturnValue([{ start: '2026-10-25T06:00:00Z', end: 'x' }]);
    const response = await GET(
      new Request('http://localhost/api/slots?doctorId=doctor-1&date=2026-10-25'),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()).data).toHaveLength(1);
  });

  it.each([
    [true, 200],
    [false, 422],
  ] as const)('maps a production result success=%s to HTTP %s', async (success, status) => {
    slotMocks.demoEnabled.mockReturnValue(false);
    slotMocks.getSupabaseSlots.mockResolvedValue({
      success,
      ...(success ? { data: [] } : { error: 'unavailable' }),
    });
    const response = await GET(
      new Request(
        'http://localhost/api/slots?doctorId=doctor-prod&date=2026-10-25&clinicId=clinic-prod',
      ),
    );
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(slotMocks.getSupabaseSlots).toHaveBeenCalledWith(
      'doctor-prod',
      '2026-10-25',
      'clinic-prod',
    );
  });
});
