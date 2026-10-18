import { z } from 'zod';
import { formatInTimeZone } from 'date-fns-tz';
import type { ActionResult, Doctor } from '../types';
import { all } from '../demo-db';
import { slotsFor } from './booking-service';
import bookAppointmentTool from '../../../agent/tools/book_appointment';
import handlePatientResponseTool from '../../../agent/tools/handle_patient_response';
import getClinicSummaryTool, { ClinicDailySummary } from '../../../agent/tools/get_clinic_summary';

export interface AgentDoctorCard {
  doctorId: string;
  doctorName: string;
  specialty: string;
  clinic: string;
  fee: number;
  availableSlotsCount: number;
  slots: { start: string; end: string }[];
  date: string;
  isFutureDate?: boolean;
}

export interface AgentMessageResult {
  reply: string;
  intent: 'emergency' | 'slots_found' | 'booked' | 'cancelled' | 'clinic_summary' | 'general';
  emergency?: boolean;
  doctors?: AgentDoctorCard[];
  bookingDetails?: Record<string, unknown>;
  clinicSummary?: ClinicDailySummary;
  suggestedActions?: string[];
}

const messageInputSchema = z.object({
  message: z.string().trim().min(1, 'الرسالة لا يمكن أن تكون فارغة'),
  sessionId: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type ProcessMessageInput = z.infer<typeof messageInputSchema>;

// مؤشرات الطوارئ الحرجة
const EMERGENCY_KEYWORDS = [
  'ألم في الصدر',
  'ألم بالصدر',
  'جلطة',
  'ذبحة',
  'ضيق تنفس',
  'ضيق بالتنفس',
  'فقدان وعي',
  'إغماء',
  'نزيف حاد',
  'شلل',
  'تسمم',
  'حروق بالغة',
];

// ربط الكلمات المفتاحية الدقيقة بالتخصصات (بدون كلمات قصيرة مضللة مثل "سن")
const SPECIALTY_KEYWORDS: Array<{ keywords: string[]; specialty: string }> = [
  {
    specialty: 'القلب والأوعية',
    keywords: ['قلب', 'أوعية', 'اوعية', 'قلبي', 'قلبية', 'شرايين', 'ضغط الدم'],
  },
  {
    specialty: 'طب الأسنان',
    keywords: ['أسنان', 'اسنان', 'أسناني', 'اسناني', 'ضرس', 'ضرسي', 'أضراس', 'لثة', 'تقويم'],
  },
  {
    specialty: 'طب الأطفال',
    keywords: ['أطفال', 'اطفال', 'طفل', 'طفلي', 'طفلتي', 'رضيع', 'مواليد', 'لقاحات'],
  },
  {
    specialty: 'الأمراض الجلدية',
    keywords: ['جلد', 'جلدية', 'بشرة', 'حبوب', 'أكزيما', 'حساسية جلدية', 'تساقط الشعر'],
  },
  {
    specialty: 'طب العيون',
    keywords: ['عيون', 'عين', 'بصر', 'نظارة', 'ليزك', 'قرنية', 'ضعف نظر'],
  },
  {
    specialty: 'الطب العام',
    keywords: ['طبيب عام', 'فحص شامل', 'حرارة', 'سعال', 'إنفلونزا', 'صداع'],
  },
];

function detectEmergency(message: string): boolean {
  const normalized = message.toLowerCase();
  return EMERGENCY_KEYWORDS.some((kw) => normalized.includes(kw));
}

function detectDoctor(message: string): Doctor | undefined {
  const normalized = message.toLowerCase();
  const doctors = all<Doctor>('doctor').filter((d) => d.verified);

  // 1. فحص الاسم الكامل
  for (const doc of doctors) {
    if (normalized.includes(doc.name.toLowerCase())) {
      return doc;
    }
  }

  // 2. فحص الاسم الجزئي (مثل "أحمد" أو "كريم" إذا ذُكر مع كلمة د. أو طبيب)
  if (normalized.includes('د.') || normalized.includes('طبيب') || normalized.includes('دكتور')) {
    for (const doc of doctors) {
      const parts = doc.name.toLowerCase().split(' ');
      if (parts.some((p) => p.length >= 3 && normalized.includes(p))) {
        return doc;
      }
    }
  }

  return undefined;
}

function detectSpecialty(message: string): string | undefined {
  const normalized = message.toLowerCase();
  for (const group of SPECIALTY_KEYWORDS) {
    if (group.keywords.some((kw) => normalized.includes(kw))) {
      return group.specialty;
    }
  }
  return undefined;
}

/**
 * البحث عن أقرب فترات شاغرة للطبيب بدءاً من التاريخ المطلوب وحتى 7 أيام قادمة
 */
function findEarliestSlotsForDoctor(
  doctor: Doctor,
  startDateStr: string,
  maxDaysAhead = 7,
): { date: string; slots: { start: string; end: string }[]; isFutureDate: boolean } {
  // فحص تاريخ اليوم أولاً
  const todaySlots = slotsFor(doctor.id, startDateStr);
  if (todaySlots.length > 0) {
    return {
      date: startDateStr,
      slots: todaySlots.map((s) => ({ start: s.start, end: s.end })),
      isFutureDate: false,
    };
  }

  // إذا لم تتوفر مواعيد اليوم، نبحث تلقائياً في الأيام التالية
  const baseDate = new Date(`${startDateStr}T12:00:00Z`);
  for (let offset = 1; offset <= maxDaysAhead; offset++) {
    const nextDateObj = new Date(baseDate.getTime() + offset * 86400000);
    const nextDateStr = nextDateObj.toISOString().slice(0, 10);
    const futureSlots = slotsFor(doctor.id, nextDateStr);

    if (futureSlots.length > 0) {
      return {
        date: nextDateStr,
        slots: futureSlots.map((s) => ({ start: s.start, end: s.end })),
        isFutureDate: true,
      };
    }
  }

  return {
    date: startDateStr,
    slots: [],
    isFutureDate: false,
  };
}

function formatDoctorReply(
  doctorName: string,
  specialty: string,
  earliest: { date: string; slots: unknown[]; isFutureDate: boolean },
): string {
  if (earliest.slots.length === 0) {
    return `عذراً، جدول د. ${doctorName} مكتمل خلال الأيام القادمة. يمكنك تجربة طبيب آخر في تخصص ${specialty}:`;
  }
  if (earliest.isFutureDate) {
    return `لا توجد فترات شاغرة متبقية لليوم لدى د. ${doctorName}. وجدت لك أقرب مواعيد متاحة ليوم ${earliest.date}، يمكنك اختيار الوقت المناسب وتأكيده مباشرة:`;
  }
  return `إليك الفترات المتاحة لدى د. ${doctorName} (${specialty}) ليوم ${earliest.date}:`;
}

function formatSpecialtyReply(
  specialty: string,
  chosenDate: string,
  isFuture: boolean,
  hasSlots: boolean,
): string {
  if (!hasSlots) {
    return `عذراً، جميع المواعيد مكتملة حالياً في تخصص (${specialty}) للأيام القريبة القادمة.`;
  }
  if (isFuture) {
    return `انتهت مواعيد اليوم في تخصص (${specialty}). وجدت لك أقرب فترات شاغرة متاحة ليوم ${chosenDate}:`;
  }
  return `وجدت لك أطباء معتمدين في تخصص (${specialty}) مع فترات متاحة ليوم ${chosenDate}. يمكنك اختيار الموعد المناسب وتأكيده مباشرة:`;
}

export async function processAgentMessage(
  input: ProcessMessageInput,
): Promise<ActionResult<AgentMessageResult>> {
  const parsed = messageInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      error: 'يرجى إرسال رسالة صالحة وغير فارغة.',
    };
  }

  const { message, date } = parsed.data;

  // 1. بروتوكول فرز الطوارئ الصارم (Emergency Protocol)
  if (detectEmergency(message)) {
    return {
      success: true,
      data: {
        intent: 'emergency',
        emergency: true,
        reply:
          '⚠️ **تنبيه عاجل:** الأعراض التي ذكرتها قد تشير إلى حالة طبية طارئة تتطلب تدخلاً فورياً.\n' +
          'يرجى التوجه فوراً لأقرب قسم طوارئ في مستشفى، أو الاتصال فوراً برقم الإسعاف الموحد (997 أو 112).\n' +
          'سلامتك هي الأولوية القصوى دائماً.',
        suggestedActions: ['الاتصال بالإسعاف 997', 'أقرب قسم طوارئ'],
      },
    };
  }

  // اعتماد التوقيت المحلي للعيادة (Damascus GMT+3) بدلاً من توقيت السيرفر العالمي
  const baseDate = date ?? formatInTimeZone(new Date(), 'Asia/Damascus', 'yyyy-MM-dd');

  // 2. فحص ما إذا كان المستخدم يطلب طبيباً محدداً بالاسم أولاً
  const specificDoctor = detectDoctor(message);
  if (specificDoctor) {
    const earliest = findEarliestSlotsForDoctor(specificDoctor, baseDate);
    const doctorCard: AgentDoctorCard = {
      doctorId: specificDoctor.id,
      doctorName: specificDoctor.name,
      specialty: specificDoctor.specialty,
      clinic: specificDoctor.clinic,
      fee: specificDoctor.fee,
      availableSlotsCount: earliest.slots.length,
      slots: earliest.slots,
      date: earliest.date,
      isFutureDate: earliest.isFutureDate,
    };

    const reply = formatDoctorReply(specificDoctor.name, specificDoctor.specialty, earliest);
    const suggestedActions =
      earliest.slots.length > 0
        ? earliest.slots.slice(0, 3).map((s) => {
            const timeStr = new Date(s.start).toLocaleTimeString('ar-SA', {
              hour: '2-digit',
              minute: '2-digit',
            });
            return `موعد الساعة ${timeStr}`;
          })
        : ['البحث عن طبيب آخر في التخصص', 'استعراض جميع التخصصات'];

    return {
      success: true,
      data: {
        intent: 'slots_found',
        reply,
        doctors: [doctorCard],
        suggestedActions,
      },
    };
  }

  // 3. فحص نية البحث عن التخصص أو الأعراض
  const targetSpecialty = detectSpecialty(message);
  if (targetSpecialty) {
    const matchingDocs = all<Doctor>('doctor')
      .filter((d) => d.verified)
      .filter((d) => d.specialty.includes(targetSpecialty));

    if (matchingDocs.length > 0) {
      const cards: AgentDoctorCard[] = matchingDocs.map((doc) => {
        const earliest = findEarliestSlotsForDoctor(doc, baseDate);
        return {
          doctorId: doc.id,
          doctorName: doc.name,
          specialty: doc.specialty,
          clinic: doc.clinic,
          fee: doc.fee,
          availableSlotsCount: earliest.slots.length,
          slots: earliest.slots,
          date: earliest.date,
          isFutureDate: earliest.isFutureDate,
        };
      });

      const availableDocs = cards.filter((c) => c.availableSlotsCount > 0);
      const isFuture = availableDocs.some((d) => d.isFutureDate);
      const chosenDate = availableDocs[0]?.date ?? baseDate;
      const reply = formatSpecialtyReply(targetSpecialty, chosenDate, isFuture, availableDocs.length > 0);

      return {
        success: true,
        data: {
          intent: 'slots_found',
          reply,
          doctors: cards,
          suggestedActions: availableDocs.slice(0, 3).map((d) => `حجز مع د. ${d.doctorName}`),
        },
      };
    }
  }

  // 4. استعلام الملخص التشغيلي للعيادة (Staff & Doctor Copilot)
  const isClinicSummary = ['ملخص اليوم', 'إحصائيات العيادة', 'تقرير اليوم', 'تقرير العيادة', 'ضغط العمل', 'إيرادات اليوم'].some((kw) => message.includes(kw));
  if (isClinicSummary) {
    const summaryResult = (await getClinicSummaryTool.execute({ date: baseDate })) as {
      success: boolean;
      summary: ClinicDailySummary;
    };

    if (summaryResult.success) {
      const s = summaryResult.summary;
      const docBreakdown = s.doctorLoad
        .filter((d) => d.appointmentCount > 0)
        .map((d) => `• د. ${d.doctorName} (${d.specialty}): ${d.appointmentCount} مواعيد`)
        .join('\n');

      const reply =
        `📊 **الملخص التشغيلي للعيادة ليوم ${s.date}:**\n\n` +
        `• إجمالي المواعيد: ${s.totalAppointments}\n` +
        `• مؤكدة: ${s.confirmedCount} | قيد الانتظار: ${s.pendingCount}\n` +
        `• بالعيادة (حضور): ${s.checkedInCount} | مكتملة: ${s.completedCount}\n` +
        `• الإيرادات التقديرية: ${s.totalEstimatedRevenue} ل.س\n\n` +
        (docBreakdown ? `توزيع الحالات على الأطباء:\n${docBreakdown}` : 'لا توجد مواعيد محجوزة اليوم بعد.');

      return {
        success: true,
        data: {
          intent: 'clinic_summary',
          reply,
          clinicSummary: s,
          suggestedActions: ['تأكيد المواعيد المعلقة', 'فحص مواعيد الغد', 'حجز موعد جديد'],
        },
      };
    }
  }

  // 5. الاستفسارات العامة والتوجيه الطبي
  const availableSpecs = Array.from(new Set(all<Doctor>('doctor').map((d) => d.specialty)));
  const specsList = availableSpecs.join('، ');

  return {
    success: true,
    data: {
      intent: 'general',
      reply:
        `أهلاً بك في المساعد الطبي الذكي لمنصة ClinicBook 🩺.\n\n` +
        `يمكنني مساعدتك في حجز المواعيد الفورية، توجيهك للطبيب المناسب، أو متابعة مواعيدك.\n\n` +
        `التخصصات الطبية المتوفرة حالياً في المنصة:\n• ${specsList}.\n\n` +
        `صف لي ما تشعر به أو اطلب موعدك مع طبيب محدد وسأقوم بجدولته لك.`,
      suggestedActions: [
        'أريد حجز موعد مع طبيب قلب',
        'مواعيد أطباء الأطفال',
        'عندي ألم في الأسنان',
      ],
    },
  };
}
