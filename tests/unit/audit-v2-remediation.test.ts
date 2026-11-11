import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { processAgentMessage } from '@/lib/services/agent-service';
import { callAgentRouter } from '@/lib/services/agentrouter-client';
import { middleware } from '@/middleware';
import { GET as healthGet } from '@/app/api/health/route';
import sitemap from '@/app/sitemap';
import robots from '@/app/robots';
import { ensureSeed, appointments, saveAppointment } from '@/lib/demo-db';
import type { Appointment, User } from '@/lib/types';

describe('Full-Stack Audit Pass #2 Remediation Suite (REM-V2-01..REM-V2-06)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    ensureSeed();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('REM-V2-01a: triggers instant Emergency Triage Protocol on colloquial distress expressions ("انا عم موت شو سوي")', async () => {
    const phrases = [
      'انا عم موت شو سوي',
      'ما عم اقدر اتنفس ابدا',
      'قلبي عم يوجعني وضغط بصدري',
      'اسعفوني حالة طارئة',
    ];

    for (const msg of phrases) {
      const res = await processAgentMessage({ message: msg });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.intent).toBe('emergency');
        expect(res.data.emergency).toBe(true);
        expect(res.data.reply).toContain('110');
        expect(res.data.reply).toContain('997');
      }
    }
  });

  it('REM-V2-01b: answers identity, pricing, and location questions contextually instead of repeating static greeting', async () => {
    const whoRes = await processAgentMessage({ message: 'من انت' });
    expect(whoRes.success).toBe(true);
    if (whoRes.success) {
      expect(whoRes.data.intent).toBe('general');
      expect(whoRes.data.reply).toContain('أقوم بثلاث مهام رئيسية');
    }

    const priceRes = await processAgentMessage({ message: 'قديش الكشفية واسعار المعاينة؟' });
    expect(priceRes.success).toBe(true);
    if (priceRes.success) {
      expect(priceRes.data.reply).toContain('أسعار الكشفيات المعتمدة');
      expect(priceRes.data.reply).toContain('ل.س');
    }

    const locRes = await processAgentMessage({ message: 'وين العيادات والفروع المتاحة؟' });
    expect(locRes.success).toBe(true);
    if (locRes.success) {
      expect(locRes.data.reply).toContain('المراكز والعيادات المعتمدة');
    }

    // Ensure age with "سنة" is NOT misclassified as dental ("سن")
    const ageRes = await processAgentMessage({ message: 'عمري 30 سنة وعندي وجع راس' });
    expect(ageRes.success).toBe(true);
    if (ageRes.success) {
      expect(ageRes.data.intent).toBe('slots_found');
      expect(ageRes.data.doctors?.[0]?.specialty).toContain('الطب العام');
    }
  });

  it('REM-V2-01c: supports standard OpenAI-compatible /chat/completions (Groq/Gemini) and gracefully detects Aliyun WAF HTML challenges', async () => {
    process.env.GROQ_API_KEY = 'gsk_test_key_123';
    delete process.env.AGENTROUTER_API_KEY;

    let capturedUrl = '';
    let capturedBody = '';
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (input, init) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body ?? '');
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'مرحباً بك! أنصحك بمراجعة طبيب عام لتقييم الأعراض بدقة.',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const groqRes = await callAgentRouter('اشعر بارهاق مستمر منذ يومين');
    expect(groqRes.success).toBe(true);
    expect(groqRes.reply).toContain('طبيب عام');
    expect(capturedUrl).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(JSON.parse(capturedBody).messages).toHaveLength(2);

    // Test Aliyun WAF HTML captcha detection on HTTP 200
    delete process.env.GROQ_API_KEY;
    process.env.AGENTROUTER_API_KEY = 'sk-waf-blocked';
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<!doctype html><meta name="aliyun_waf_aa" content="blocked">', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    );

    const wafRes = await callAgentRouter('من انت');
    expect(wafRes.success).toBe(false);
    expect(wafRes.error).toContain('WAF HTML challenge');
  });

  it('REM-V2-02: isolates getClinicSummaryTool by tenant organizationId and wires handlePatientResponseTool confirmation', async () => {
    const ownerOrg1: User = {
      id: 'owner-1',
      name: 'مالك المركز الأول',
      email: 'owner@clinic1.demo',
      role: 'clinic_owner',
      organizationId: 'org-1',
    };
    const ownerOtherOrg: User = {
      id: 'owner-isolated',
      name: 'مالك مركز معزول',
      email: 'owner@isolated.demo',
      role: 'clinic_owner',
      organizationId: 'org-nonexistent-999',
    };

    const resOrg1 = await processAgentMessage({ message: 'ملخص اليوم' }, ownerOrg1);
    const resIsolated = await processAgentMessage(
      { message: 'ملخص اليوم' },
      ownerIsolatedOrg(ownerOtherOrg),
    );

    expect(resOrg1.success).toBe(true);
    expect(resIsolated.success).toBe(true);
    if (resOrg1.success && resIsolated.success) {
      expect(resIsolated.data.clinicSummary?.totalAppointments).toBe(0);
      expect(resIsolated.data.clinicSummary?.doctorLoad).toHaveLength(0);
    }

    // Create a pending appointment for patient-1 and confirm it via chat command
    const sampleDocAppt = appointments()[0];
    const testApptId = 'appt-agent-confirm-v2';
    const pendingAppt: Appointment = {
      ...sampleDocAppt,
      id: testApptId,
      patientId: 'patient-1',
      status: 'pending',
      start: new Date(Date.now() + 48 * 3600000).toISOString(),
      end: new Date(Date.now() + 48.5 * 3600000).toISOString(),
      expiresAt: new Date(Date.now() + 12 * 3600000).toISOString(),
    };
    saveAppointment(pendingAppt);

    const patientUser: User = {
      id: 'patient-1',
      name: 'سارة الخطيب',
      email: 'patient@clinicbook.demo',
      role: 'patient',
    };

    const confirmRes = await processAgentMessage(
      { message: `تأكيد موعد ${testApptId}` },
      patientUser,
    );
    expect(confirmRes.success).toBe(true);
    if (confirmRes.success) {
      expect(confirmRes.data.intent).toBe('booked');
      expect(confirmRes.data.bookingDetails?.status).toBe('confirmed');
    }
  });

  it('REM-V2-04: blocks cross-origin Referer CSRF and spoofed X-Forwarded-Host + Origin pairs in middleware', async () => {
    delete process.env.TRUSTED_PROXY_HOPS;

    // 1. Cross-origin Referer when Origin is omitted -> 403
    const badRefererReq = new NextRequest('http://localhost:3000/api/appointments', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        referer: 'https://evil.example/attack.html',
        'content-type': 'application/json',
        'content-length': '2',
      },
      body: '{}',
    });
    const badRefRes = await middleware(badRefererReq);
    expect(badRefRes.status).toBe(403);

    // 2. Spoofed X-Forwarded-Host + Origin pair without trusted proxy -> 403
    const spoofedHostPairReq = new NextRequest('http://localhost:3000/api/actions', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        'x-forwarded-host': 'evil.example',
        origin: 'https://evil.example',
        'content-type': 'application/json',
        'content-length': '2',
      },
      body: '{}',
    });
    const spoofedRes = await middleware(spoofedHostPairReq);
    expect(spoofedRes.status).toBe(403);

    const forgedPlatformReq = new NextRequest('http://localhost:3000/api/actions', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        'x-forwarded-host': 'evil.example',
        'x-vercel-id': 'client-controlled',
        'cf-ray': 'client-controlled',
        origin: 'https://evil.example',
        'content-type': 'application/json',
        'content-length': '2',
      },
      body: '{}',
    });
    expect((await middleware(forgedPlatformReq)).status).toBe(403);
  });

  it('REM-V2-05: exposes operational /api/health, dynamic sitemap.xml, and privacy-aware robots.txt', async () => {
    const healthRes = await healthGet();
    expect(healthRes.status).toBe(200);
    expect(healthRes.headers.get('Cache-Control')).toContain('no-store');
    const body = (await healthRes.json()) as {
      status: string;
      checks: { databaseConfigured: boolean };
    };
    expect(body.status).toBe('ok');
    expect(body.checks.databaseConfigured).toBe(true);

    const map = await sitemap();
    expect(map.some((entry) => entry.url.endsWith('/search'))).toBe(true);
    expect(map.some((entry) => entry.url.includes('/doctors/'))).toBe(true);

    const rob = robots();
    const rules = Array.isArray(rob.rules) ? rob.rules[0] : rob.rules;
    expect(rules.disallow).toContain('/workspace/');
    expect(rules.disallow).toContain('/admin');
  });
});

function ownerIsolatedOrg(u: User): User {
  return u;
}
