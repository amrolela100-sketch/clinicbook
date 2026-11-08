import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { processAgentMessage } from '../../src/lib/services/agent-service';
import { all } from '../../src/lib/demo-db';
import type { Doctor } from '../../src/lib/types';

describe('TDD: Agent Service Orchestrator (processAgentMessage)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T10:00:00+03:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });
  it('RED: detects emergency keywords and triggers emergency triage protocol', async () => {
    const result = await processAgentMessage({
      message: 'أشعر بألم حاد ومفاجئ في الصدر وضيق تنفس',
      sessionId: 'test-session-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.emergency).toBe(true);
      expect(result.data.intent).toBe('emergency');
      expect(result.data.reply).toContain('طوارئ');
      expect(result.data.reply).toContain('997');
    }
  });

  it('RED: identifies specialty intent and returns matching doctors with slots', async () => {
    const result = await processAgentMessage({
      message: 'أريد حجز موعد مع طبيب قلب وأوعية',
      sessionId: 'test-session-2',
      date: '2026-10-25',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intent).toBe('slots_found');
      expect(result.data.doctors?.length).toBeGreaterThan(0);
      expect(result.data.doctors?.[0].specialty).toContain('القلب');
    }
  });

  it('RED: handles general inquiries and provides helpful guidance', async () => {
    const result = await processAgentMessage({
      message: 'مرحباً، ما هي التخصصات الطبية المتوفرة لديكم؟',
      sessionId: 'test-session-3',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intent).toBe('general');
      expect(result.data.reply).toContain('ClinicBook');
      expect(result.data.reply.length).toBeGreaterThan(20);
    }
  });

  it('RED: validates input and rejects empty messages', async () => {
    const result = await processAgentMessage({
      message: '   ',
      sessionId: 'test-session-4',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
    }
  });

  it('RED: recognizes doctor by name and does NOT misclassify "الحسن" as dental due to "سن"', async () => {
    const result = await processAgentMessage({
      message: 'حجز مع د. أحمد الحسن',
      sessionId: 'test-session-5',
      date: '2026-10-25',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intent).toBe('slots_found');
      expect(result.data.doctors).toHaveLength(1);
      expect(result.data.doctors?.[0].doctorName).toBe('أحمد الحسن');
      expect(result.data.doctors?.[0].specialty).toContain('القلب');
      expect(result.data.doctors?.[0].date).toBe('2026-10-25');
      expect(result.data.doctors?.[0].isFutureDate).toBe(false);
    }
  });

  it('RED: automatically discovers next available slots when today has 0 slots left', async () => {
    // 2026-10-17 shifts are already passed, so it should advance to 2026-10-18 or 2026-10-19
    const result = await processAgentMessage({
      message: 'أريد موعد قلب',
      date: '2026-10-17', // A past date with 0 slots
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.doctors?.[0].availableSlotsCount).toBeGreaterThan(0);
      expect(result.data.reply).toMatch(/2026-10-(18|19)/);
    }
  });

  it('handles clinic summary inquiries for staff copilot', async () => {
    const result = await processAgentMessage({
      message: 'أريد ملخص اليوم وإحصائيات العيادة',
      date: '2026-10-18',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intent).toBe('clinic_summary');
      expect(result.data.reply).toContain('الملخص التشغيلي للعيادة');
      expect(result.data.clinicSummary).toBeDefined();
    }
  });

  it('correctly maps abdominal pain symptoms to General Medicine', async () => {
    const result = await processAgentMessage({
      message: 'عندي مغص شديد وألم في البطن مع غثيان',
      date: '2026-10-25',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intent).toBe('slots_found');
      expect(result.data.doctors?.[0].specialty).toContain('الطب العام');
    }
  });

  it('recognizes female doctor by name with title (دكتورة ليلى)', async () => {
    const result = await processAgentMessage({
      message: 'أريد حجز كشفية مع دكتورة ليلى',
      date: '2026-10-25',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intent).toBe('slots_found');
      expect(result.data.doctors).toHaveLength(1);
      expect(result.data.doctors?.[0].doctorName).toBe('ليلى منصور');
      expect(result.data.doctors?.[0].specialty).toContain('أطفال');
    }
  });

  it('handles patient appointments lookup when logged in', async () => {
    const mockPatient = {
      id: 'patient-1',
      name: 'سارة الخطيب',
      email: 'sarah@example.com',
      role: 'patient' as const,
    };

    const result = await processAgentMessage(
      {
        message: 'أين مواعيدي القادمة المسجلة؟',
      },
      mockPatient,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intent).toBe('general');
      expect(result.data.reply).toBeDefined();
      expect(result.data.suggestedActions).toContain('الانتقال إلى مواعيدي');
    }
  });

  it('explains cancellation policy when asking to cancel an appointment', async () => {
    const result = await processAgentMessage({
      message: 'كيف ألغي موعدي في العيادة؟',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intent).toBe('general');
      expect(result.data.reply).toContain('ساعتين');
      expect(result.data.suggestedActions).toContain('الانتقال إلى مواعيدي');
    }
  });
});
