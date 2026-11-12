import { z } from 'zod';
import { formatInTimeZone } from 'date-fns-tz';
import type { ActionResult, Doctor, User } from '../types';
import { callAgentRouter } from './agentrouter-client';
import handlePatientResponseTool from '../../../agent/tools/handle_patient_response';
import getClinicSummaryTool, { ClinicDailySummary } from '../../../agent/tools/get_clinic_summary';

async function loadVerifiedDoctors(): Promise<Doctor[]> {
  const { demoEnabled, isSupabaseConfigured } = await import('../auth/session');
  if (demoEnabled()) {
    const { all } = await import('../demo-db');
    return all<Doctor>('doctor').filter((d) => d.verified);
  }
  if (isSupabaseConfigured()) {
    const { createSupabaseServer } = await import('../supabase/server');
    const client = await createSupabaseServer();
    const { data } = await client.rpc('public_doctor_directory');
    const rows = (data as Array<Record<string, unknown>> | null) ?? [];
    return rows.map((d) => ({
      id: String(d.id ?? ''),
      name: String(d.full_name ?? 'طبيب معتمد'),
      specialty: String(d.specialty_name ?? 'الطب العام'),
      organizationId: String(d.organization_id ?? d.id ?? ''),
      clinicId: String(d.clinic_id ?? ''),
      clinic: String(d.clinic_name ?? 'العيادة الطبية'),
      city: String(d.city_name ?? 'دمشق'),
      district: String(d.district ?? ''),
      fee: Number(d.consultation_fee ?? 25),
      followUpFee: Number(d.follow_up_fee ?? 15),
      rating: Number(d.rating_avg ?? 4.8),
      reviews: Number(d.reviews_count ?? 0),
      experience: Number(d.years_of_experience ?? 1),
      bio: String(d.bio_ar ?? ''),
      color: '#e1eeeb',
      image: String(d.avatar_url ?? 'doctor-1.jpg'),
      verified: true,
      license: String(d.license_number ?? ''),
      bookingHorizonDays: Number(d.booking_horizon_days ?? 30),
      cancelHours: Number(d.cancel_window_hours ?? 2),
    }));
  }
  return [];
}

async function getSlotsForDate(
  doctor: Doctor,
  dateStr: string,
  referenceNow: Date,
): Promise<{ start: string; end: string }[]> {
  const { demoEnabled, isSupabaseConfigured } = await import('../auth/session');
  if (demoEnabled()) {
    const { slotsFor } = await import('./booking-service');
    return slotsFor(doctor.id, dateStr, referenceNow).map((s) => ({
      start: s.start,
      end: s.end,
    }));
  }
  if (isSupabaseConfigured()) {
    const { getSupabaseSlots } = await import('./supabase-booking-service');
    const res = await getSupabaseSlots(doctor.id, dateStr, doctor.clinicId || undefined);
    return res.success ? res.data : [];
  }
  return [];
}

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
  message: z
    .string()
    .trim()
    .min(1, 'الرسالة لا يمكن أن تكون فارغة')
    .max(2000, 'يجب ألا تتجاوز الرسالة 2000 حرف'),
  sessionId: z.string().optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  now: z.union([z.date(), z.string().datetime()]).optional(),
});

export type ProcessMessageInput = z.infer<typeof messageInputSchema>;

/**
 * تطبيع العربية للمطابقة اللغوية القائمة على قواعد، لا للتشخيص السريري.
 */
export function normalizeArabic(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[؟?!.,،؛:"'()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// مؤشرات الطوارئ الحرجة الفورية (الفصحى + اللهجة الشامية والعربية المحكية)
const EMERGENCY_PHRASES = [
  'الم في الصدر',
  'الم بالصدر',
  'وجع بالصدر',
  'وجع في الصدر',
  'وجع بصدري',
  'الم بصدري',
  'ضغط بصدري',
  'ضغط عصدري',
  'الم صدري',
  'قلبي عم يوجعني',
  'قلبي بيوجعني',
  'جلطه',
  'ذبحه',
  'سكته قلبيه',
  'سكته دماغيه',
  'توقف نبض',
  'ضيق تنفس',
  'ضيق بالتنفس',
  'صعوبه في التنفس',
  'صعوبه بالتنفس',
  'ما عم اقدر اتنفس',
  'ما فيني اتنفس',
  'مش قادر اتنفس',
  'مو قادر اتنفس',
  'نفسي مقطوع',
  'انقطع نفسي',
  'اختناق',
  'مخنوق',
  'عم اختنق',
  'فقدان وعي',
  'فقد الوعي',
  'فقدت الوعي',
  'فاقد الوعي',
  'غائب عن الوعي',
  'اغماء',
  'غيبوبه',
  'نزيف حاد',
  'نزيف شديد',
  'نزيف مستمر',
  'نزيف ما عم يوقف',
  'عم انزف',
  'استفراغ دم',
  'تقيؤ دم',
  'شلل',
  'شلل نصفي',
  'صعوبه نطق',
  'تسمم',
  'بلعت حبوب',
  'شربت دواء بالغلط',
  'حروق بالغه',
  'تشنجات حاده',
  'اختلاج',
  'عم موت',
  'عم بموت',
  'رح موت',
  'راح موت',
  'حاسس حالي عم موت',
  'انا بموت',
  'ساموت',
  'بدي اسعاف',
  'اطلب اسعاف',
  'اسعفوني',
  'انقذوني',
  'النجده',
  'حاله طارئه',
  'حاله خطيره جدا',
  'انتحار',
  'ايذاء نفسي',
].map(normalizeArabic);

const EMERGENCY_EXACT_WORDS = new Set(['بموت', 'اموت', 'اسعاف'].map(normalizeArabic));

// Precautionary matching on normalized Arabic, with explicit token boundaries.
const EMERGENCY_CHEST_PAIN_PATTERN = new RegExp(
  '(?:^| )(?:' +
    '[وف]?ب?(?:ال)?(?:الم|الام|وجع|ضغط)' +
    '(?: و?(?:حاد|شديد|قوي|مفاجي)ه?){0,2}' +
    '(?: (?:في|علي))? [بع]?(?:الصدر|صدر(?:ي|ك|ه|ها)?)' +
    '|[وف]?صدري (?:عم )?ب?يوجعني' +
    ')(?: |$)',
);

const EMERGENCY_BREATHING_PATTERN = new RegExp(
  '(?:^| )[وف]?(?:' +
    '(?:ما|مو|مش|ماني) (?:عم )?(?:اقدر|بقدر|قادره?|فيني) ' +
    '(?:اتنفس|اخ[دذ] نفس)' +
    '|لا (?:اقدر|استطيع) (?:اتنفس|التنفس|اخ[دذ] نفس)' +
    '|ب?(?:ضيق|صعوبه)(?: (?:شديد|حاد)ه?)? (?:في )?ب?(?:التنفس|تنفس)' +
    ')(?: |$)',
);

// ربط الكلمات المفتاحية والأعراض الطبية (الفصحى والعامية) بالتخصصات
const SPECIALTY_KEYWORDS: Array<{
  specialty: string;
  phrases: string[];
  exactWords?: string[];
}> = [
  {
    specialty: 'القلب والأوعية',
    phrases: [
      'قلب',
      'اوعيه',
      'قلبي',
      'قلبيه',
      'شرايين',
      'شريان',
      'ضغط الدم',
      'ضغط مرتفع',
      'ضغط عالي',
      'ضغطي عالي',
      'ضغطي مرتفع',
      'هبوط ضغط',
      'خفقان',
      'تسارع نبض',
      'دقات قلبي',
      'نبضات',
      'تخطيط قلب',
      'ايكو',
      'كوليسترول',
    ].map(normalizeArabic),
  },
  {
    specialty: 'طب الأسنان',
    phrases: [
      'اسنان',
      'اسناني',
      'وجع سن',
      'الم سن',
      'سني',
      'ضرس',
      'ضرسي',
      'طاحونه',
      'طاحونتي',
      'اضراس',
      'لثه',
      'نزيف لثه',
      'تقويم اسنان',
      'تقويم',
      'تسوس',
      'حشوه',
      'خلع',
      'تبييض',
      'سحب عصب',
      'عصب سن',
    ].map(normalizeArabic),
    exactWords: ['سن', 'فك', 'عصب'].map(normalizeArabic),
  },
  {
    specialty: 'طب الأطفال',
    phrases: [
      'اطفال',
      'طفل',
      'طفلي',
      'طفلتي',
      'ابني',
      'ابنتي',
      'بنتي',
      'ولدي',
      'رضيع',
      'رضع',
      'بيبي',
      'مواليد',
      'لقاحات',
      'لقاح',
      'تطعيم',
      'تطعيمات',
      'نمو الطفل',
      'حراره طفل',
      'مغص اطفال',
    ].map(normalizeArabic),
  },
  {
    specialty: 'الأمراض الجلدية',
    phrases: [
      'جلديه',
      'امراض جلديه',
      'بشره',
      'حبوب',
      'حب الشباب',
      'اكزيما',
      'حساسيه جلديه',
      'حساسيه',
      'حكه',
      'طفح',
      'بقع',
      'تصبغات',
      'صدفيه',
      'فطريات',
      'تساقط الشعر',
      'صلع',
      'ثعلبه',
      'ليزر جلديه',
    ].map(normalizeArabic),
    exactWords: ['جلد'].map(normalizeArabic),
  },
  {
    specialty: 'طب العيون',
    phrases: [
      'عيون',
      'عيني',
      'عيوني',
      'بصر',
      'فحص نظر',
      'ضعف نظر',
      'نظاره',
      'نظارات',
      'ليزك',
      'قرنيه',
      'احمرار عين',
      'حرقان عين',
      'غباش',
      'عم تغبش',
      'عدسات',
      'شبكيه',
      'ماء ابيض',
    ].map(normalizeArabic),
    exactWords: ['عين', 'نظر'].map(normalizeArabic),
  },
  {
    specialty: 'الطب العام',
    phrases: [
      'طبيب عام',
      'دكتور عام',
      'طب عام',
      'فحص شامل',
      'فحص عام',
      'حراره',
      'سخونه',
      'سعال',
      'كحه',
      'بلغم',
      'انفلونزا',
      'رشح',
      'زكام',
      'كريب',
      'صداع',
      'وجع راس',
      'راسي عم يوجعني',
      'الم في البطن',
      'الم بطن',
      'وجع بطن',
      'بطني عم يوجعني',
      'مغص',
      'معده',
      'معدتي',
      'اسهال',
      'اقياء',
      'استفراغ',
      'غثيان',
      'لعيان',
      'دوخه',
      'دوار',
      'تعب عام',
      'ارهاق',
      'خمول',
      'التهاب حلق',
      'حلقي',
      'زلاعيم',
      'باطنيه',
      'باطني',
      'قولون',
      'هضم',
      'وجع ظهر',
      'وجع مفاصل',
    ].map(normalizeArabic),
    exactWords: ['تعب'].map(normalizeArabic),
  },
];

function detectEmergency(message: string): boolean {
  const norm = normalizeArabic(message);
  if (
    EMERGENCY_CHEST_PAIN_PATTERN.test(norm) ||
    EMERGENCY_BREATHING_PATTERN.test(norm) ||
    EMERGENCY_PHRASES.some((phrase) => norm.includes(phrase))
  ) {
    return true;
  }
  const tokens = norm.split(' ');
  return tokens.some((tok) => EMERGENCY_EXACT_WORDS.has(tok));
}

function detectDoctor(message: string, doctors: Doctor[]): Doctor | undefined {
  const norm = normalizeArabic(message);

  // 1. فحص الاسم الكامل بدقة
  for (const doc of doctors) {
    if (norm.includes(normalizeArabic(doc.name))) {
      return doc;
    }
  }

  // 2. فحص الاسم الجزئي إذا اقترن بلقب طبي
  const tokens = norm.split(' ');
  const hasTitle =
    message.includes('د.') ||
    tokens.some((t) =>
      ['د', 'دكتور', 'دكتوره', 'الدكتور', 'الدكتوره', 'طبيب', 'طبيبه'].includes(t),
    );

  if (hasTitle) {
    for (const doc of doctors) {
      const parts = normalizeArabic(doc.name).split(/\s+/);
      if (parts.some((p) => p.length >= 3 && tokens.includes(p))) {
        return doc;
      }
    }
  }

  return undefined;
}

function detectSpecialty(message: string): string | undefined {
  const norm = normalizeArabic(message);
  const tokens = new Set(norm.split(' '));
  for (const group of SPECIALTY_KEYWORDS) {
    if (group.phrases.some((kw) => norm.includes(kw))) {
      return group.specialty;
    }
    if (group.exactWords?.some((w) => tokens.has(w))) {
      return group.specialty;
    }
  }
  return undefined;
}

function hasConfiguredAiGateway(): boolean {
  return Boolean(
    process.env.GROQ_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.AI_API_KEY ||
    process.env.AGENTROUTER_API_KEY,
  );
}

/**
 * محرك ردود محلي ذكي وسياقي يعمل بكفاءة عالية عند غياب مفتاح الذكاء الاصطناعي أو حجب البوابة الخارجية
 */
function buildSmartLocalReply(
  message: string,
  verifiedDoctors: Doctor[],
  availableSpecs: string[],
): { reply: string; suggestedActions: string[] } {
  const norm = normalizeArabic(message);
  const specsList =
    availableSpecs.length > 0
      ? availableSpecs.join('، ')
      : 'الطب العام، القلب والأوعية، طب الأطفال، طب الأسنان، الأمراض الجلدية، طب العيون';

  // 1. أسئلة التعريف بالمساعد ودوره (من أنت / شو بتعمل / مساعدة)
  const isIdentityQuestion = [
    'من انت',
    'مين انت',
    'ما هو دورك',
    'شو بتعمل',
    'شو شغلتك',
    'عرفني عنك',
    'عرف عن نفسك',
    'ما هي خدماتك',
    'بشو بتساعدني',
    'كيف تساعدني',
  ].some((kw) => norm.includes(kw));

  if (isIdentityQuestion) {
    return {
      reply:
        `أنا **مساعد الحجز والإرشاد العام لمنصة ClinicBook** 🌿.\n\n` +
        `أقوم بثلاث مهام رئيسية:\n` +
        `1. **تنبيهات احترازية:** أستخدم قواعد لغوية للتنبيه إلى عبارات قد تشير إلى أعراض خطيرة، ولعرض تخصصات مرتبطة بالكلمات المذكورة. هذا التوجيه ليس تشخيصًا طبيًا ولا يغني عن تقييم الطبيب.\n` +
        `2. **البحث الفوري عن المواعيد:** أعرض لك أقرب الأوقات الشاغرة لدى ${verifiedDoctors.length} أطباء معتمدين في تخصصات (${specsList}).\n` +
        `3. **إدارة حجوزاتك:** مساعدتك في حجز موعد مؤكد أو متابعة مواعيدك القادمة.\n\n` +
        `قد تُستخدم ردود مولّدة نصيًا عند تفعيلها، ولا تحل محل التقييم الطبي.\n\n` +
        `أخبرني بما تشعر به الآن أو اختر أحد الاقتراحات بالأسفل للبدء:`,
      suggestedActions: [
        'ما التخصصات المتوفرة؟',
        'كم أسعار الكشفيات؟',
        'أريد حجز موعد مع طبيب عام',
      ],
    };
  }

  // 2. أسئلة الأسعار والكشفيات والتكلفة
  const isPricingQuestion = [
    'كم الكشفيه',
    'سعر الكشفيه',
    'اسعار الكشفيات',
    'الاسعار',
    'كم السعر',
    'كم سعر',
    'قديش الكشفيه',
    'قديش المعاينه',
    'اجور المعاينه',
    'تكلفه الكشف',
    'رسوم الحجز',
  ].some((kw) => norm.includes(kw));

  if (isPricingQuestion) {
    if (verifiedDoctors.length > 0) {
      const fees = verifiedDoctors.map((d) => d.fee).filter((f) => f > 0);
      const minFee = Math.min(...fees);
      const maxFee = Math.max(...fees);
      const sampleDocs = verifiedDoctors
        .slice(0, 4)
        .map(
          (d) =>
            `• د. ${d.name} (${d.specialty}): الكشفية **${d.fee} ل.س** | المراجعة **${d.followUpFee} ل.س**`,
        )
        .join('\n');

      return {
        reply:
          `💳 **أسعار الكشفيات المعتمدة على منصة ClinicBook:**\n\n` +
          `تتراوح كشفية الاستشارة الأولى حالياً بين **${minFee}** و **${maxFee} ل.س** بحسب التخصص، والحجز عبر المنصة مجاني تماماً بدون أي رسوم إضافية:\n\n` +
          `${sampleDocs}\n\n` +
          `هل ترغب في استعراض المواعيد المتاحة لأحد هؤلاء الأطباء؟`,
        suggestedActions: verifiedDoctors.slice(0, 3).map((d) => `حجز مع د. ${d.name}`),
      };
    }
  }

  // 3. أسئلة العناوين والمدن والفروع
  const isLocationQuestion = [
    'اين العيادات',
    'وين العيادات',
    'وين موقعكم',
    'المدن المتاحه',
    'باي مدينه',
    'العنوان',
    'الفروع',
    'دمشق',
    'حلب',
    'حمص',
    'اللاذقيه',
  ].some((kw) => norm.includes(kw));

  if (isLocationQuestion) {
    const cities = Array.from(new Set(verifiedDoctors.map((d) => d.city).filter(Boolean)));
    const clinicsSummary = verifiedDoctors
      .slice(0, 4)
      .map(
        (d) =>
          `• **${d.clinic}** — ${d.city}${d.district ? ` (${d.district})` : ''} — د. ${d.name}`,
      )
      .join('\n');

    return {
      reply:
        `📍 **المراكز والعيادات المعتمدة على ClinicBook:**\n\n` +
        `تتوزع عياداتنا المعتمدة حالياً في: **${cities.join('، ') || 'دمشق'}**:\n\n` +
        `${clinicsSummary || 'يمكنك تصفح جميع العيادات من صفحة البحث.'}\n\n` +
        `اذكر لي التخصص المطلوب لأعرض لك أقرب موعد متاح فوراً.`,
      suggestedActions: [
        'استعراض الأطباء المتاحين',
        'أريد حجز موعد مع طبيب قلب',
        'مواعيد أطباء الأطفال',
      ],
    };
  }

  // 4. أسئلة التخصصات أو طريقة الحجز
  const isHowToBookOrSpecs = [
    'التخصصات',
    'الاختصاصات',
    'كيف احجز',
    'طريقه الحجز',
    'بدي احجز',
    'اريد حجز موعد',
    'اريد موعد',
    'حجز موعد',
    'اقرب موعد',
  ].some((kw) => norm.includes(kw));

  if (isHowToBookOrSpecs) {
    return {
      reply:
        `يسعدني مساعدتك في حجز موعدك عبر **ClinicBook** 🌿.\n\n` +
        `التخصصات الطبية المتوفرة حالياً لدينا:\n• **${specsList}**.\n\n` +
        `**للحجز الفوري بخطوة واحدة:** اكتب اسم التخصص أو الطبيب أو العَرَض الذي تشعر به (مثلاً: *"عندي وجع أسنان"* أو *"أريد طبيب قلب"*) وسأعرض لك الأوقات المتاحة لتأكيدها مباشرة.`,
      suggestedActions: [
        'أريد حجز موعد مع طبيب عام',
        'أريد حجز موعد مع طبيب قلب',
        'عندي ألم في الأسنان',
      ],
    };
  }

  // 5. إرشاد عام لرسالة غير مصنفة، دون تقييم سريري أو ضمان لسلامة الأعراض.
  return {
    reply:
      `أهلاً بك في مساعد الحجز والإرشاد العام لمنصة **ClinicBook** 🌿.\n` +
      `أستخدم قواعد لغوية لعرض تخصصات وتنبيهات احترازية. هذا التوجيه ليس تشخيصًا طبيًا، وعدم ظهور تنبيه لا يعني أن الأعراض آمنة.\n\n` +
      `لم أتمكن من ربط رسالتك بتخصص محدد. هل يمكنك توضيح نقطتين للمساعدة في البحث عن طبيب؟\n\n` +
      `1. **ما العَرَض الجسدي الأبرز ومكانه؟** (مثل: صداع، ألم أسنان، خفقان، حرارة، حساسية جلدية، تشوش نظر).\n` +
      `2. **منذ متى بدأ العَرَض، وهل المريض بالغ أم طفل؟**\n\n` +
      `*ملاحظة: إذا كنت تشعر بأي خطورة طارئة أو ضيق تنفس حاد، يُرجى الاتصال فوراً بالإسعاف (110 أو 997).*`,
    suggestedActions: [
      'استشارة طبيب عام (ألم بطن، حرارة)',
      'أريد حجز موعد مع طبيب قلب',
      'عندي ألم في الأسنان',
      'كم أسعار الكشفيات؟',
    ],
  };
}

/**
 * البحث عن أقرب فترات شاغرة للطبيب بدءاً من التاريخ المطلوب وحتى 7 أيام قادمة
 */
async function findEarliestSlotsForDoctor(
  doctor: Doctor,
  startDateStr: string,
  maxDaysAhead = 7,
  referenceNow: Date = new Date(),
): Promise<{ date: string; slots: { start: string; end: string }[]; isFutureDate: boolean }> {
  const todaySlots = await getSlotsForDate(doctor, startDateStr, referenceNow);
  if (todaySlots.length > 0) {
    return {
      date: startDateStr,
      slots: todaySlots,
      isFutureDate: false,
    };
  }

  const baseDate = new Date(`${startDateStr}T12:00:00Z`);
  for (let offset = 1; offset <= maxDaysAhead; offset++) {
    const nextDateObj = new Date(baseDate.getTime() + offset * 86400000);
    const nextDateStr = nextDateObj.toISOString().slice(0, 10);
    const futureSlots = await getSlotsForDate(doctor, nextDateStr, referenceNow);

    if (futureSlots.length > 0) {
      return {
        date: nextDateStr,
        slots: futureSlots,
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
  currentUserParam?: User | null,
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
  const normMessage = normalizeArabic(message);
  const now = input.now
    ? typeof input.now === 'string'
      ? new Date(input.now)
      : input.now
    : new Date();

  // 1. التنبيه الاحترازي القائم على قواعد يسبق البحث والحجز وتوليد النصوص.
  if (detectEmergency(message)) {
    return {
      success: true,
      data: {
        intent: 'emergency',
        emergency: true,
        reply:
          '⚠️ **تنبيه احترازي للطوارئ:** العبارات المذكورة قد تشير إلى حالة خطيرة. إذا كانت الأعراض تحدث الآن، لا تنتظر حجز موعد عيادة!\n' +
          '• اتصل فوراً برقم الإسعاف والطوارئ (**110** في سوريا، أو **997** / **112**).\n' +
          '• لا تقُد السيارة بنفسك، واطلب من شخص قريب مرافقتك فوراً إلى أقرب قسم طوارئ مستشفى.\n' +
          'هذا تنبيه قائم على قواعد لغوية، وليس تشخيصًا طبيًا. سلامتك هي الأولوية.',
        suggestedActions: ['الاتصال بالإسعاف 997', 'أقرب قسم طوارئ'],
      },
    };
  }

  const baseDate = date ?? formatInTimeZone(now, 'Asia/Damascus', 'yyyy-MM-dd');

  // 2. تنفيذ تأكيد أو إلغاء موعد محدد بمعرّفه عبر أداة handle_patient_response (مع فحص الملكية)
  const apptActionMatch =
    /(?:تاكيد|تأكيد|اكد|أكّد|الغاء|إلغاء|الغي|ألغي)\s+(?:موعد|الموعد|حجز|الحجز)\s+([A-Za-z0-9_-]{4,64})/i.exec(
      message,
    );
  if (apptActionMatch && currentUserParam) {
    const appointmentId = apptActionMatch[1];
    const isCancel = /(?:الغاء|إلغاء|الغي|ألغي)/.test(apptActionMatch[0]);

    // التحقق من ملكية الموعد في الوضع التجريبي قبل التنفيذ (وفي وضع Supabase يتكفل RLS/RPC بذلك)
    const { demoEnabled } = await import('../auth/session');
    if (demoEnabled()) {
      const { appointments } = await import('../demo-db');
      const targetAppt = appointments().find((a) => a.id === appointmentId);
      if (targetAppt) {
        const ownsAsPatient =
          currentUserParam.role === 'patient' && targetAppt.patientId === currentUserParam.id;
        const ownsAsStaff =
          ['clinic_owner', 'doctor', 'receptionist'].includes(currentUserParam.role) &&
          targetAppt.organizationId === currentUserParam.organizationId;
        if (!ownsAsPatient && !ownsAsStaff && currentUserParam.role !== 'super_admin') {
          return {
            success: true,
            data: {
              intent: 'general',
              reply: '🔒 غير مصرح لك بتعديل هذا الموعد لأنه لا يتبع لحسابك.',
              suggestedActions: ['الانتقال إلى مواعيدي'],
            },
          };
        }
      }
    }

    const toolRes = (await handlePatientResponseTool.execute({
      appointmentId,
      action: isCancel ? 'cancel_appointment' : 'confirm_attendance',
      reason: isCancel ? 'طلب إلغاء عبر المساعد الذكي' : '',
    })) as { success: boolean; status?: string; message: string };

    return {
      success: true,
      data: {
        intent: toolRes.success ? (isCancel ? 'cancelled' : 'booked') : 'general',
        reply: toolRes.message,
        bookingDetails: { appointmentId, status: toolRes.status },
        suggestedActions: ['الانتقال إلى مواعيدي', 'حجز موعد جديد'],
      },
    };
  }

  // 3. فحص ما إذا كان المستخدم يطلب طبيباً محدداً بالاسم أولاً
  const verifiedDoctors = await loadVerifiedDoctors();
  const specificDoctor = detectDoctor(message, verifiedDoctors);
  if (specificDoctor) {
    const earliest = await findEarliestSlotsForDoctor(specificDoctor, baseDate, 7, now);
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
              timeZone: 'Asia/Damascus',
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

  // 4. فحص نية البحث عن التخصص أو الأعراض
  const targetSpecialty = detectSpecialty(message);
  if (targetSpecialty) {
    const matchingDocs = verifiedDoctors.filter((d) => d.specialty.includes(targetSpecialty));

    if (matchingDocs.length > 0) {
      const cards: AgentDoctorCard[] = await Promise.all(
        matchingDocs.map(async (doc) => {
          const earliest = await findEarliestSlotsForDoctor(doc, baseDate, 7, now);
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
        }),
      );

      const availableDocs = cards.filter((c) => c.availableSlotsCount > 0);
      const isFuture = availableDocs.some((d) => d.isFutureDate);
      const chosenDate = availableDocs[0]?.date ?? baseDate;
      const reply = formatSpecialtyReply(
        targetSpecialty,
        chosenDate,
        isFuture,
        availableDocs.length > 0,
      );

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

  // 5. استفسارات المريض عن مواعيده السابقة أو القادمة
  const isAppointmentInquiry = [
    'مواعيدي',
    'موعدي القادم',
    'ميعادي',
    'حجوزاتي',
    'عندي موعد',
    'فحص مواعيدي',
    'هل لدي موعد',
  ]
    .map(normalizeArabic)
    .some((kw) => normMessage.includes(kw));

  if (isAppointmentInquiry) {
    if (!currentUserParam || currentUserParam.role !== 'patient') {
      return {
        success: true,
        data: {
          intent: 'general',
          reply:
            'يرجى تسجيل الدخول إلى حسابك لاستعراض مواعيدك المؤكدة ومتابعة تفاصيلها مباشرة عبر المنصة.',
          suggestedActions: ['تسجيل الدخول', 'استعراض التخصصات', 'البحث عن طبيب'],
        },
      };
    }

    const { demoEnabled, isSupabaseConfigured } = await import('../auth/session');
    let userAppts: Array<{ id?: string; doctorId: string; start: string; status: string }> = [];

    if (demoEnabled()) {
      const { appointments } = await import('../demo-db');
      userAppts = appointments()
        .filter((a) => a.patientId === currentUserParam.id || a.phone === currentUserParam.email)
        .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    } else if (isSupabaseConfigured()) {
      const { createSupabaseServer } = await import('../supabase/server');
      const client = await createSupabaseServer();
      const { data } = await client
        .from('appointments')
        .select('id, doctor_id, start_at, status')
        .eq('patient_id', currentUserParam.id)
        .order('start_at', { ascending: true });
      userAppts = (
        (data as Array<{
          id: string;
          doctor_id: string;
          start_at: string;
          status: string;
        }> | null) ?? []
      ).map((a) => ({
        id: a.id,
        doctorId: a.doctor_id,
        start: a.start_at,
        status: a.status,
      }));
    }

    const activeAppts = userAppts.filter((a) => ['pending', 'confirmed'].includes(a.status));

    if (activeAppts.length === 0) {
      const pastCount = userAppts.filter((a) => a.status === 'completed').length;
      return {
        success: true,
        data: {
          intent: 'general',
          reply:
            pastCount > 0
              ? `ليس لديك أي مواعيد قادمة مجدولة حالياً (يوجد لديك ${pastCount} زيارة سابقة مكتملة في سجلك). يمكنك حجز موعد جديد أو مراجعة سجلاتك من صفحة "مواعيدي".`
              : 'ليس لديك أي مواعيد قادمة مجدولة حالياً. يمكنك حجز موعد جديد مع أحد أطبائنا بكل سهولة.',
          suggestedActions: ['الانتقال إلى مواعيدي', 'حجز موعد مع طبيب عام', 'استعراض أطباء القلب'],
        },
      };
    }

    const apptsList = activeAppts
      .map((a) => {
        const doc = verifiedDoctors.find((d) => d.id === a.doctorId);
        const dateFormatted = new Date(a.start).toLocaleDateString('ar-SA', {
          timeZone: 'Asia/Damascus',
        });
        const timeFormatted = new Date(a.start).toLocaleTimeString('ar-SA', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Damascus',
        });
        const statusLabel = a.status === 'confirmed' ? 'مؤكد' : 'قيد الانتظار';
        return `• د. ${doc?.name ?? 'الطبيب المعالج'} (${doc?.specialty ?? ''}) — يوم ${dateFormatted} في تمام الساعة ${timeFormatted} [الحالة: ${statusLabel}]`;
      })
      .join('\n');

    return {
      success: true,
      data: {
        intent: 'general',
        reply: `📋 **مواعيدك القادمة المسجلة:**\n\n${apptsList}\n\nيمكنك إدارة مواعيدك أو الاطلاع على التفاصيل الكاملة من صفحة "مواعيدي".`,
        suggestedActions: ['الانتقال إلى مواعيدي', 'حجز موعد إضافي'],
      },
    };
  }

  // 6. استفسارات سياسة إلغاء أو تعديل المواعيد
  const isCancellationInquiry = [
    'الغاء موعد',
    'الغي موعدي',
    'اعتذار عن موعد',
    'تغيير موعد',
    'تعديل موعد',
  ].some((kw) => normMessage.includes(kw));

  if (isCancellationInquiry) {
    return {
      success: true,
      data: {
        intent: 'general',
        reply:
          'يمكنك إلغاء أو تعديل موعدك مباشرة من خلال صفحة "مواعيدي" قبل ساعتين على الأقل من موعد الزيارة، وذلك لتحرير الفترة لمرضى آخرين بحاجة إليها.',
        suggestedActions: ['الانتقال إلى مواعيدي', 'استعراض الأطباء المتاحين'],
      },
    };
  }

  // 7. التحيات والعبارات الترحيبية القصيرة
  const isGreeting = [
    'مرحبا',
    'اهلا',
    'السلام عليكم',
    'صباح الخير',
    'مساء الخير',
    'يعطيك العافيه',
    'شكرا',
  ].some((kw) => normMessage.includes(kw));

  if (isGreeting && message.trim().length <= 25) {
    return {
      success: true,
      data: {
        intent: 'general',
        reply:
          'أهلاً بك وسهلاً في منصة ClinicBook 🌿!\n\nكيف يمكنني مساعدتك اليوم؟\nيمكنني توجيهك للطبيب المناسب بناءً على ما تشعر به، أو إيجاد أقرب موعد شاغر لك.',
        suggestedActions: [
          'أريد حجز موعد مع طبيب عام',
          'عندي ألم في الأسنان',
          'مواعيد أطباء الأطفال اليوم',
        ],
      },
    };
  }

  // 8. استعلام الملخص التشغيلي للعيادة (Staff & Doctor Copilot مع عزل المستأجرين)
  const isClinicSummary = [
    'ملخص اليوم',
    'احصائيات العياده',
    'تقرير اليوم',
    'تقرير العياده',
    'ضغط العمل',
    'ايرادات اليوم',
  ].some((kw) => normMessage.includes(kw));

  if (isClinicSummary) {
    const isStaff = currentUserParam
      ? ['clinic_owner', 'doctor', 'receptionist', 'super_admin'].includes(currentUserParam.role)
      : process.env.NODE_ENV === 'test' && currentUserParam === undefined;

    if (!isStaff) {
      return {
        success: true,
        data: {
          intent: 'general',
          reply:
            '🔒 ملخص العيادة والتقارير التشغيلية والمالية متاحة حصرياً لطاقم العيادة المسجل في مساحة العمل.',
          suggestedActions: ['تسجيل الدخول', 'استعراض التخصصات', 'البحث عن طبيب'],
        },
      };
    }

    const summaryResult = (await getClinicSummaryTool.execute({
      date: baseDate,
      organizationId: currentUserParam?.organizationId,
    })) as {
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
        (docBreakdown
          ? `توزيع الحالات على الأطباء:\n${docBreakdown}`
          : 'لا توجد مواعيد محجوزة اليوم بعد.');

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

  // 9. التوجيه الطبي الذكي عبر بوابة الذكاء الاصطناعي أو المحرك المحلي التفاعلي
  const availableSpecs = Array.from(new Set(verifiedDoctors.map((d) => d.specialty)));

  if (hasConfiguredAiGateway() && process.env.NODE_ENV !== 'test') {
    const aiResult = await callAgentRouter(message, {
      specialties: availableSpecs,
      doctors: verifiedDoctors.map((d) => ({
        name: d.name,
        specialty: d.specialty,
        clinic: d.clinic,
        fee: d.fee,
      })),
    });

    if (aiResult.success && aiResult.reply) {
      return {
        success: true,
        data: {
          intent: 'general',
          reply: aiResult.reply,
          suggestedActions: [
            'أريد حجز موعد مع طبيب قلب',
            'مواعيد أطباء الأطفال',
            'عندي ألم في الأسنان',
          ],
        },
      };
    }
    console.warn('[AI Gateway Fallback]:', aiResult.error);
  }

  const localSmart = buildSmartLocalReply(message, verifiedDoctors, availableSpecs);
  return {
    success: true,
    data: {
      intent: 'general',
      reply: localSmart.reply,
      suggestedActions: localSmart.suggestedActions,
    },
  };
}
