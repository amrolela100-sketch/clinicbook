import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

vi.mock('server-only', () => ({}));

import { processAgentMessage } from '@/lib/services/agent-service';
import { appointments, db, ensureSeed, roles, saveAppointment } from '@/lib/demo-db';

type TriageExample = {
  id: string;
  label: 'emergency' | 'benign' | 'nonemergency' | 'specialty';
  message: string;
};

// Hand-labelled synthetic safety expectations, not diagnoses or clinician-reviewed data.
// Labels remain fixed while the implementation changes; this is not an independent dataset.
// Informational, negated, historical and metaphorical messages expose false alarms too.
const SYNTHETIC_TRIAGE_CORPUS: readonly TriageExample[] = [
  { id: 'E01', label: 'emergency', message: 'عندي الم على الصدر' },
  { id: 'E02', label: 'emergency', message: 'وجع على الصدر' },
  { id: 'E03', label: 'emergency', message: 'الم في الصدر' },
  { id: 'E04', label: 'emergency', message: 'ما عم اقدر اتنفس' },
  { id: 'E05', label: 'emergency', message: 'أشعر بألم شديد في الصدر منذ دقائق' },
  { id: 'E06', label: 'emergency', message: 'عندي ألم حاد ومفاجئ في الصدر' },
  { id: 'E07', label: 'emergency', message: 'في وجع قوي على صدري هل أحجز؟' },
  { id: 'E08', label: 'emergency', message: 'أحس بضغط شديد بالصدر' },
  { id: 'E09', label: 'emergency', message: 'صدري بيوجعني من الصبح' },
  { id: 'E10', label: 'emergency', message: 'صدري عم يوجعني وبدي موعد' },
  { id: 'E11', label: 'emergency', message: 'صَدْري يوجعني الآن' },
  { id: 'E12', label: 'emergency', message: 'عندي آلام بالصدر' },
  { id: 'E13', label: 'emergency', message: 'أَلَمٌ عَلَى الصَّدْرِ' },
  { id: 'E14', label: 'emergency', message: 'وجــع علـى الصــدر' },
  { id: 'E15', label: 'emergency', message: 'عندي ألم علي الصدر' },
  { id: 'E16', label: 'emergency', message: 'عم حس بوجع بصدري' },
  { id: 'E17', label: 'emergency', message: 'قلبي عم يوجعني وضغط بصدري' },
  { id: 'E18', label: 'emergency', message: 'مش قادر أتنفّس كويس' },
  { id: 'E19', label: 'emergency', message: 'مو قادر اتنفس' },
  { id: 'E20', label: 'emergency', message: 'ما عم بقدر اتنفس من شوي' },
  { id: 'E21', label: 'emergency', message: 'ما بقدر أتنفس' },
  { id: 'E22', label: 'emergency', message: 'ما عم اقدر آخد نفس' },
  { id: 'E23', label: 'emergency', message: 'ماني قادر اتنفس' },
  { id: 'E24', label: 'emergency', message: 'لا أستطيع التنفس' },
  { id: 'E25', label: 'emergency', message: 'أعاني من صعوبة شديدة في التنفس' },
  { id: 'E26', label: 'emergency', message: 'صُعوبة بالتنفُّس' },
  { id: 'E27', label: 'emergency', message: 'ما فيني اتنفس' },
  { id: 'E28', label: 'emergency', message: 'عم اختنق ساعدوني' },
  { id: 'E29', label: 'emergency', message: 'حاسس حالي عم موت شو سوي' },
  { id: 'E30', label: 'emergency', message: 'اسعفوني فوراً' },
  { id: 'E31', label: 'emergency', message: 'أمي فقدت الوعي فجأة' },
  { id: 'E32', label: 'emergency', message: 'أبي فاقد الوعي' },
  { id: 'E33', label: 'emergency', message: 'نزيف ما عم يوقف من ساعة' },
  { id: 'E34', label: 'emergency', message: 'استفراغ دم' },
  { id: 'E35', label: 'emergency', message: 'صار عندي شلل نصفي فجأة' },
  { id: 'E36', label: 'emergency', message: 'تقيؤ دم بعد شوي' },
  { id: 'E37', label: 'emergency', message: 'تشنجات حادة' },
  { id: 'E38', label: 'emergency', message: 'شربت دواء بالغلط' },
  { id: 'E39', label: 'emergency', message: 'بلعت حبوب كثيرة بالغلط' },
  { id: 'E40', label: 'emergency', message: 'عندي نزيف شديد وما عم يوقف' },
  { id: 'B01', label: 'benign', message: 'السلام عليكم' },
  { id: 'B02', label: 'benign', message: 'شو بتعمل' },
  { id: 'B03', label: 'benign', message: 'كم أسعار الكشفيات؟' },
  { id: 'B04', label: 'benign', message: 'وين العيادات؟' },
  { id: 'B05', label: 'benign', message: 'كيف أحجز موعد؟' },
  { id: 'B06', label: 'benign', message: 'أين مواعيدي القادمة؟' },
  { id: 'B07', label: 'benign', message: 'أريد طبيب مختص بأمراض الصدر' },
  { id: 'B08', label: 'benign', message: 'ما هي تمارين التنفس؟' },
  { id: 'B09', label: 'benign', message: 'أبحث عن كتاب عن الإسعافات الأولية' },
  { id: 'B10', label: 'benign', message: 'تعجبني أغنية أنا بموت فيك' },
  { id: 'N01', label: 'nonemergency', message: 'عندي ألم في الأسنان' },
  { id: 'N02', label: 'nonemergency', message: 'وجع على الضرس' },
  { id: 'N03', label: 'nonemergency', message: 'عندي ألم على الظهر من الجلوس' },
  { id: 'N04', label: 'nonemergency', message: 'عندي حكة خفيفة بالجلد' },
  { id: 'N05', label: 'nonemergency', message: 'عندي زكام خفيف' },
  { id: 'N06', label: 'nonemergency', message: 'عمري 30 سنة وعندي وجع راس' },
  { id: 'N07', label: 'nonemergency', message: 'ما عندي ألم في الصدر، بدي فحص روتيني' },
  { id: 'N08', label: 'nonemergency', message: 'لا أعاني من ضيق تنفس وأريد فحصاً عاماً' },
  { id: 'N09', label: 'nonemergency', message: 'ما علامات الجلطة؟ أسأل للتثقيف فقط' },
  {
    id: 'N10',
    label: 'nonemergency',
    message: 'صار عندي إغماء السنة الماضية وأريد متابعة روتينية',
  },
  { id: 'S01', label: 'specialty', message: 'أريد موعد مع طبيب قلب' },
  { id: 'S02', label: 'specialty', message: 'أحتاج تنظيف الأسنان' },
  { id: 'S03', label: 'specialty', message: 'موعد لقاح لطفلي' },
  { id: 'S04', label: 'specialty', message: 'عندي حب الشباب وبدي طبيب جلدية' },
  { id: 'S05', label: 'specialty', message: 'أريد فحص نظر للنظارات' },
  { id: 'S06', label: 'specialty', message: 'أريد حجز موعد عند طبيب عام' },
  { id: 'S07', label: 'specialty', message: 'ضغطي مرتفع وبدي متابعة دورية' },
  { id: 'S08', label: 'specialty', message: 'موعد مع د. أحمد الحسن' },
  { id: 'S09', label: 'specialty', message: 'بدي طبيب أطفال لروتين النمو' },
  { id: 'S10', label: 'specialty', message: 'متابعة كوليسترول مع طبيب قلب' },
];

describe('Audit #22: precautionary emergency rules through the exported agent service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T10:00:00+03:00'));
    vi.stubEnv('CLINICBOOK_MODE', 'demo');
    vi.stubEnv('FORCE_SUPABASE', 'false');
    for (const key of [
      'GROQ_API_KEY',
      'GEMINI_API_KEY',
      'OPENROUTER_API_KEY',
      'OPENAI_API_KEY',
      'AI_API_KEY',
      'AGENTROUTER_API_KEY',
    ])
      vi.stubEnv(key, '');
    ensureSeed();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([
    ['chest-on-pain', 'عندي الم على الصدر'],
    ['chest-on-ache', 'وجع على الصدر'],
    ['chest-in-control', 'الم في الصدر'],
    ['breathing-control', 'ما عم اقدر اتنفس'],
    ['sudden-unconsciousness', 'أمي فقدت الوعي فجأة'],
    ['severe-continuing-bleeding', 'عندي نزيف شديد وما عم يوقف'],
    ['chest-diacritics', 'أَلَمٌ عَلَى الصَّدْرِ'],
    ['chest-tatweel', 'وجــع علـى الصــدر'],
    ['chest-colloquial', 'صَدْري يوجعني الآن'],
    ['breathing-diacritics', 'مش قادر أتنفّس كويس'],
    ['breathing-severity', 'أعاني من صعوبة شديدة في التنفس'],
  ])('returns precautionary emergency guidance for %s', async (_id, message) => {
    const result = await processAgentMessage({ message });

    expect(result).toMatchObject({
      success: true,
      data: { intent: 'emergency', emergency: true },
    });
    if (result.success) {
      expect(result.data.reply).toContain('طوارئ');
      expect(result.data.reply).toContain('997');
      expect(result.data.reply).toContain('ليس تشخيصًا طبيًا');
      expect(result.data.doctors).toBeUndefined();
      expect(result.data.bookingDetails).toBeUndefined();
    }
  });

  it('prioritizes emergency guidance without any cloud request when a model and database are configured but unavailable', async () => {
    vi.stubEnv('CLINICBOOK_MODE', 'production');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:4199');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'local-triage-test-not-a-real-key');
    vi.stubEnv('AI_API_KEY', 'local-triage-model-not-a-real-key');
    vi.stubEnv('AI_BASE_URL', 'http://127.0.0.1:4199');
    const transport = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Synthetic outage'));
    const patient = roles.find((user) => user.role === 'patient')!;

    const result = await processAgentMessage(
      {
        message: 'إلغاء الموعد synthetic-appointment. عندي ألم على الصدر وأريد طبيب قلب',
      },
      patient,
    );

    expect(result).toMatchObject({ success: true, data: { intent: 'emergency', emergency: true } });
    expect(transport).not.toHaveBeenCalled();
    if (result.success) {
      expect(result.data.doctors).toBeUndefined();
      expect(result.data.bookingDetails).toBeUndefined();
    }
  });

  it('does not cancel an owned appointment when the same message describes an emergency', async () => {
    const patient = roles.find((user) => user.role === 'patient')!;
    const template = appointments()[0];
    const id = randomUUID();
    const appointment = {
      ...template,
      id,
      patientId: patient.id,
      status: 'pending' as const,
      start: '2026-10-20T10:00:00+03:00',
      end: '2026-10-20T10:30:00+03:00',
      expiresAt: '2026-10-19T10:00:00+03:00',
    };
    saveAppointment(appointment);
    try {
      const result = await processAgentMessage(
        {
          message: `إلغاء الموعد ${id}. عندي ألم على الصدر`,
        },
        patient,
      );
      expect(result).toMatchObject({
        success: true,
        data: { intent: 'emergency', emergency: true },
      });
      expect(appointments().find((row) => row.id === id)).toEqual(appointment);
    } finally {
      db.prepare('DELETE FROM appointments WHERE id=?').run(id);
    }
  });

  it('describes its local capabilities as lexical precautions, not medical diagnosis', async () => {
    const result = await processAgentMessage({ message: 'من انت' }, null);

    expect(result).toMatchObject({ success: true, data: { intent: 'general' } });
    if (result.success) {
      expect(result.data.reply).toContain('قواعد لغوية');
      expect(result.data.reply).toContain('ليس تشخيصًا طبيًا');
      expect(result.data.reply).toContain('ردود مولّدة نصيًا');
      expect(result.data.emergency).not.toBe(true);
    }
  });

  it('does not imply that an unmatched symptom is safe or clinically assessed', async () => {
    const result = await processAgentMessage({ message: 'عندي انزعاج غير واضح' }, null);

    expect(result).toMatchObject({ success: true, data: { intent: 'general' } });
    if (result.success) {
      expect(result.data.reply).toContain('قواعد لغوية');
      expect(result.data.reply).toContain('ليس تشخيصًا طبيًا');
      expect(result.data.reply).toContain('عدم ظهور تنبيه لا يعني أن الأعراض آمنة');
      expect(result.data.reply).not.toContain('بدقة وأمان');
      expect(result.data.emergency).not.toBe(true);
    }
  });

  it('measures recall, precision and F1 against fixed synthetic labels (not clinical validation)', async () => {
    const counts = { truePositives: 0, falseNegatives: 0, falsePositives: 0, trueNegatives: 0 };
    const falseNegativeIds: string[] = [];
    const falsePositiveIds: string[] = [];

    expect(SYNTHETIC_TRIAGE_CORPUS).toHaveLength(70);
    expect(new Set(SYNTHETIC_TRIAGE_CORPUS.map((example) => example.id)).size).toBe(70);
    expect(SYNTHETIC_TRIAGE_CORPUS.filter((example) => example.label === 'emergency')).toHaveLength(
      40,
    );

    for (const example of SYNTHETIC_TRIAGE_CORPUS) {
      const result = await processAgentMessage({ message: example.message }, null);
      expect(result.success, example.id).toBe(true);
      if (!result.success) continue;

      const predictedEmergency = result.data.intent === 'emergency';
      expect(result.data.emergency === true, example.id).toBe(predictedEmergency);

      if (example.label === 'emergency') {
        if (predictedEmergency) {
          counts.truePositives++;
        } else {
          counts.falseNegatives++;
          falseNegativeIds.push(example.id);
        }
      } else if (predictedEmergency) {
        counts.falsePositives++;
        falsePositiveIds.push(example.id);
      } else {
        counts.trueNegatives++;
      }
    }

    const recall = counts.truePositives / (counts.truePositives + counts.falseNegatives);
    const precision = counts.truePositives / (counts.truePositives + counts.falsePositives);
    const f1 =
      (2 * counts.truePositives) /
      (2 * counts.truePositives + counts.falsePositives + counts.falseNegatives);

    // Log only aggregate measurements and synthetic IDs, never messages or model/auth data.
    console.info(
      '[Audit #22 synthetic triage, not clinical validation]',
      JSON.stringify({
        examples: SYNTHETIC_TRIAGE_CORPUS.length,
        ...counts,
        recall,
        precision,
        f1,
        falseNegativeIds,
        falsePositiveIds,
      }),
    );
    expect(
      recall,
      `Synthetic-only recall; missed IDs: ${falseNegativeIds.join(', ')}`,
    ).toBeGreaterThanOrEqual(0.9);
    // A blanket emergency response would meet recall but create thirty false alarms.
    // Keep the fixed synthetic corpus's known false-positive budget from worsening.
    expect(
      counts.falsePositives,
      `False-alarm IDs: ${falsePositiveIds.join(', ')}`,
    ).toBeLessThanOrEqual(5);
  });
});
