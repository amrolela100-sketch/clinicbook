import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { Appointment, Doctor, User, Shift } from './types';
import { hashPasswordSync } from './auth/password';

let _dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  const globalDb = globalThis as unknown as { clinicDb?: Database.Database };
  if (globalDb.clinicDb) return globalDb.clinicDb;
  if (_dbInstance) return _dbInstance;

  const dir = path.join(process.cwd(), 'data');
  mkdirSync(dir, { recursive: true });
  const instance = new Database(path.join(dir, 'clinicbook.sqlite'));
  instance.pragma('journal_mode = WAL');
  instance.pragma('busy_timeout = 5000');
  instance.pragma('foreign_keys = ON');
  instance.exec(`
CREATE TABLE IF NOT EXISTS entities(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id));
CREATE TABLE IF NOT EXISTS appointments(id TEXT PRIMARY KEY,doctor_id TEXT NOT NULL,patient_id TEXT,organization_id TEXT NOT NULL,start_at TEXT NOT NULL,end_at TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,CHECK(end_at>start_at));
CREATE INDEX IF NOT EXISTS appt_doctor ON appointments(doctor_id,start_at,end_at);
CREATE INDEX IF NOT EXISTS appt_patient ON appointments(patient_id,status);
CREATE TRIGGER IF NOT EXISTS prevent_overlap_insert BEFORE INSERT ON appointments WHEN NEW.status IN ('pending','confirmed','checked_in') BEGIN
 SELECT RAISE(ABORT,'SLOT_CONFLICT') WHERE EXISTS(SELECT 1 FROM appointments WHERE doctor_id=NEW.doctor_id AND status IN ('pending','confirmed','checked_in') AND start_at<NEW.end_at AND end_at>NEW.start_at); END;
CREATE TRIGGER IF NOT EXISTS prevent_overlap_update BEFORE UPDATE ON appointments WHEN NEW.status IN ('pending','confirmed','checked_in') BEGIN
 SELECT RAISE(ABORT,'SLOT_CONFLICT') WHERE EXISTS(SELECT 1 FROM appointments WHERE id<>NEW.id AND doctor_id=NEW.doctor_id AND status IN ('pending','confirmed','checked_in') AND start_at<NEW.end_at AND end_at>NEW.start_at); END;
CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,organization_id TEXT,actor_id TEXT,action TEXT NOT NULL,entity_id TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at TEXT NOT NULL,role TEXT);
  `);
  const sessionCols = instance.prepare("PRAGMA table_info('sessions')").all() as Array<{
    name: string;
  }>;
  if (!sessionCols.some((c) => c.name === 'role')) {
    instance.exec('ALTER TABLE sessions ADD COLUMN role TEXT');
  }

  globalDb.clinicDb = instance;
  _dbInstance = instance;
  return instance;
}

export const db: Database.Database = new Proxy({} as Database.Database, {
  get(_target, prop) {
    const database = getDb();
    const val = (database as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof val === 'function') {
      return (val as (...args: unknown[]) => unknown).bind(database);
    }
    return val;
  },
});

export function all<T>(kind: string): T[] {
  if (kind !== 'meta') ensureSeed();
  return (db.prepare('SELECT data FROM entities WHERE kind=?').all(kind) as { data: string }[]).map(
    (r) => JSON.parse(r.data),
  );
}
export function get<T>(kind: string, id: string): T | undefined {
  if (kind !== 'meta') ensureSeed();
  const row = db.prepare('SELECT data FROM entities WHERE kind=? AND id=?').get(kind, id) as
    { data: string } | undefined;
  return row ? JSON.parse(row.data) : undefined;
}
export function put(kind: string, id: string, value: unknown) {
  db.prepare(
    'INSERT INTO entities VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data',
  ).run(kind, id, JSON.stringify(value));
}
export function appointments(): Appointment[] {
  ensureSeed();
  return (
    db.prepare('SELECT data FROM appointments ORDER BY start_at').all() as { data: string }[]
  ).map((r) => JSON.parse(r.data));
}
export function saveAppointment(a: Appointment) {
  const updated = db
    .prepare('UPDATE appointments SET status=?,data=?,start_at=?,end_at=? WHERE id=?')
    .run(a.status, JSON.stringify(a), a.start, a.end, a.id);
  if (!updated.changes)
    db.prepare('INSERT INTO appointments VALUES(?,?,?,?,?,?,?,?)').run(
      a.id,
      a.doctorId,
      a.patientId ?? null,
      a.organizationId,
      a.start,
      a.end,
      a.status,
      JSON.stringify(a),
    );
}
export function audit(actor: User, action: string, entityId: string) {
  db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?)').run(
    randomUUID(),
    actor.organizationId ?? null,
    actor.id,
    action,
    entityId,
    new Date().toISOString(),
  );
}
export function expirePending() {
  const now = new Date();
  for (const a of appointments())
    if (a.status === 'pending' && a.expiresAt && new Date(a.expiresAt) <= now)
      saveAppointment({ ...a, status: 'expired' });
}
export function localDate(offset = 0) {
  return formatInTimeZone(new Date(Date.now() + offset * 86400000), 'Asia/Damascus', 'yyyy-MM-dd');
}
export const DEFAULT_DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo1234';
export const DEFAULT_DEMO_PASSWORD_HASH = hashPasswordSync(DEFAULT_DEMO_PASSWORD);

export const roles: (User & { passwordHash?: string })[] = [
  {
    id: 'owner-1',
    name: 'عمر الشامي',
    email: 'owner@clinicbook.demo',
    role: 'clinic_owner',
    organizationId: 'org-1',
    clinicId: 'clinic-1',
    passwordHash: DEFAULT_DEMO_PASSWORD_HASH,
  },
  {
    id: 'doctor-1',
    name: 'أحمد الحسن',
    email: 'doctor@clinicbook.demo',
    role: 'doctor',
    organizationId: 'org-1',
    clinicId: 'clinic-1',
    passwordHash: DEFAULT_DEMO_PASSWORD_HASH,
  },
  {
    id: 'reception-1',
    name: 'نور حمود',
    email: 'reception@clinicbook.demo',
    role: 'receptionist',
    organizationId: 'org-1',
    clinicId: 'clinic-1',
    passwordHash: DEFAULT_DEMO_PASSWORD_HASH,
  },
  {
    id: 'patient-1',
    name: 'سارة الخطيب',
    email: 'patient@clinicbook.demo',
    role: 'patient',
    passwordHash: DEFAULT_DEMO_PASSWORD_HASH,
  },
  {
    id: 'admin-1',
    name: 'مدير المنصة',
    email: 'admin@clinicbook.demo',
    role: 'super_admin',
    passwordHash: DEFAULT_DEMO_PASSWORD_HASH,
  },
];
function seed() {
  if (get('meta', 'seeded')) return;
  db.transaction(() => {
    for (const u of roles) put('user', u.id, u);
    put('organization', 'org-1', {
      id: 'org-1',
      name: 'مركز الحياة الطبي',
      city: 'دمشق',
      district: 'أبو رمانة',
      phone: '+963 11 333 4455',
      address: 'شارع الجلاء، بناء الحياة، الطابق الثاني',
      status: 'approved',
      license: 'SY-MC-2048',
      tier: 'clinic_pro',
      subscriptionStatus: 'trialing',
      periodEnd: new Date(Date.now() + 14 * 86400000).toISOString(),
      cancelHours: 2,
      leadMinutes: 60,
      pendingHours: 12,
      expiryMinutes: 60,
      autoConfirm: false,
      timezone: 'Asia/Damascus',
    });
    put('organization', 'org-2', {
      id: 'org-2',
      name: 'عيادة الندى',
      city: 'حلب',
      district: 'الجميلية',
      phone: '+963 21 222 0011',
      status: 'approved',
      tier: 'solo_starter',
      subscriptionStatus: 'active',
      periodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
      cancelHours: 2,
      leadMinutes: 60,
      pendingHours: 12,
      expiryMinutes: 60,
      timezone: 'Asia/Damascus',
    });
    const specs = [
      [
        'أحمد الحسن',
        'القلب والأوعية',
        'أخصائي أمراض القلب والأوعية الدموية، خبرة في الرعاية الوقائية ومتابعة صحة القلب.',
        25,
        18,
        '#e1eeeb',
        'doctor-1.jpg',
      ],
      [
        'ليلى منصور',
        'طب الأطفال',
        'رعاية متكاملة للأطفال من الولادة وحتى المراهقة، مع اهتمام خاص بالنمو والتغذية.',
        20,
        12,
        '#f5e6e0',
        'doctor-2.jpg',
      ],
      [
        'كريم العلي',
        'طب الأسنان',
        'طب وتجميل الأسنان، رعاية دقيقة وابتسامة صحية تبدأ براحة المريض.',
        30,
        15,
        '#e5eaf4',
        'doctor-3.jpg',
      ],
      [
        'رنا الشامي',
        'الأمراض الجلدية',
        'اختصاصية في الأمراض الجلدية والعناية بالبشرة والعلاجات الوقائية.',
        25,
        14,
        '#f3e8d7',
        'doctor-4.jpg',
      ],
      [
        'وسيم الجراح',
        'الطب العام',
        'طبيب عام واستشاري طب الأسرة، تشخيص الحالات الباطنية العامة والمتابعة الصحية الوقائية.',
        20,
        14,
        '#e8eff5',
        'doctor-5.jpg',
      ],
      [
        'أمل الفايز',
        'طب العيون',
        'استشارية في طب وجراحة العيون، تصحيح البصر والمتابعة الوقائية لصحة العين.',
        30,
        16,
        '#e5efdf',
        'doctor-6.jpg',
      ],
    ];
    specs.forEach((s, i) => {
      const id = `doctor-${i + 1}`,
        org = i === 5 ? 'org-2' : 'org-1';
      const d: Doctor = {
        id,
        name: s[0] as string,
        specialty: s[1] as string,
        organizationId: org,
        clinicId: i === 5 ? 'clinic-2' : 'clinic-1',
        clinic: i === 5 ? 'عيادة الندى' : 'مركز الحياة الطبي',
        city: i === 5 ? 'حلب' : 'دمشق',
        district: i === 5 ? 'الجميلية' : 'أبو رمانة',
        fee: s[3] as number,
        followUpFee: 10,
        rating: 4.9 - i * 0.1,
        reviews: 128 - i * 17,
        experience: s[4] as number,
        bio: s[2] as string,
        color: s[5] as string,
        image: s[6] as string,
        verified: true,
        license: `SY-MD-${12040 + i}`,
      };
      put('doctor', id, d);
      if (i !== 0)
        put('user', id, {
          id,
          name: d.name,
          role: 'doctor',
          email: `${id}@clinicbook.demo`,
          organizationId: org,
          clinicId: d.clinicId,
          passwordHash: DEFAULT_DEMO_PASSWORD_HASH,
        });
      put(
        'schedule',
        id,
        Array.from(
          { length: 7 },
          (_, day) =>
            ({
              day,
              start: '09:00',
              end: '19:00',
              duration: 30,
              active: day !== 5,
            }) satisfies Shift,
        ),
      );
    });
    const names = [
      'سارة الخطيب',
      'محمد الأحمد',
      'ريم الكيالي',
      'خالد المصري',
      'هبة حمود',
      'علي درويش',
      'لينا حسن',
      'يوسف حمدان',
      'نور علي',
      'أحمد زيدان',
      'رنا طه',
      'مازن سالم',
      'عبير مراد',
      'عمر حجازي',
      'نادين عامر',
      'فادي سليمان',
    ];
    names.forEach((name, i) => {
      if (i)
        put('user', `patient-${i + 1}`, {
          id: `patient-${i + 1}`,
          name,
          email: `patient${i + 1}@clinicbook.demo`,
          role: 'patient',
          passwordHash: DEFAULT_DEMO_PASSWORD_HASH,
        });
    });
    for (let day = -6; day <= 0; day++)
      for (let i = 0; i < (day === 0 ? 16 : 10 + ((day + 6) % 5)); i++) {
        const doc = get<Doctor>('doctor', `doctor-${(i % 4) + 1}`)!;
        const start = fromZonedTime(
          `${localDate(day)}T${String(9 + Math.floor(i / 4)).padStart(2, '0')}:${i % 2 ? '30' : '00'}:00`,
          'Asia/Damascus',
        );
        const status =
          day < 0
            ? i !== 0 && i % 8 === 0
              ? 'no_show'
              : 'completed'
            : i < 3
              ? 'checked_in'
              : i >= 12
                ? 'pending'
                : 'confirmed';
        const a: Appointment = {
          id: `seed-${day}-${i}`,
          organizationId: 'org-1',
          clinicId: 'clinic-1',
          doctorId: doc.id,
          patientId: `patient-${i + 1}`,
          patientName: names[i],
          phone: `+963 93 ${String(1000000 + i)}`,
          start: start.toISOString(),
          end: new Date(start.getTime() + 30 * 60000).toISOString(),
          status,
          visitType: i % 3 === 0 ? 'follow_up' : 'first_visit',
          source: i % 3 === 0 ? 'reception_desk' : 'patient_portal',
          fee: i % 3 === 0 ? 10 : doc.fee,
          payment: day < 0 ? 'paid_cash' : i < 3 ? 'paid_cash' : 'unpaid',
          expiresAt:
            status === 'pending'
              ? new Date(
                  Math.min(Date.now() + 12 * 3600000, start.getTime() - 3600000),
                ).toISOString()
              : undefined,
          createdAt: new Date(Date.now() - 2 * 3600000).toISOString(),
        };
        saveAppointment(a);
        if (status === 'completed' && i === 0)
          put('medical', a.id, {
            appointmentId: a.id,
            diagnosis: 'زيارة متابعة دورية',
            complaint: 'متابعة الحالة الصحية',
            notes:
              'المريض بحالة صحية جيدة، تم فحص العلامات الحيوية وضغط الدم ضمن الحدود الطبيعية. استمرار على نمط الحياة الصحي.',
            medications: [],
            followUp: '',
            visible: true,
          });
      }
    put('notification', 'welcome', {
      id: 'welcome',
      organizationId: 'org-1',
      title: 'صباح جديد، ورعاية أفضل',
      body: 'كل مواعيد المركز وفريقك في مساحة واحدة. أهلاً بك في كلينك بوك.',
      read: false,
      createdAt: new Date().toISOString(),
    });
    put('verification', 'request-1', {
      id: 'request-1',
      name: 'مركز الياسمين الطبي',
      type: 'مركز طبي',
      city: 'دمشق',
      license: 'SY-MC-3091',
      status: 'pending',
    });
    put('verification', 'request-2', {
      id: 'request-2',
      name: 'د. مريم السالم',
      type: 'طبيب اختصاصي',
      city: 'حلب',
      license: 'SY-MD-18024',
      status: 'pending',
    });
    put('meta', 'seeded', true);
  })();
}
let _seeding = false;
export function ensureSeed(): void {
  if (_seeding) return;
  _seeding = true;
  try {
    const isSeeded = db
      .prepare("SELECT data FROM entities WHERE kind='meta' AND id='seeded'")
      .get();
    if (!isSeeded) {
      seed();
    }
    const branch1 = db
      .prepare("SELECT data FROM entities WHERE kind='branch' AND id='clinic-1'")
      .get();
    if (!branch1) {
      put('branch', 'clinic-1', {
        id: 'clinic-1',
        organizationId: 'org-1',
        name: 'الفرع الرئيسي',
        city: 'دمشق',
        district: 'أبو رمانة',
        phone: '+963 11 333 4455',
      });
      put('branch', 'clinic-2', {
        id: 'clinic-2',
        organizationId: 'org-2',
        name: 'عيادة الندى',
        city: 'حلب',
        district: 'الجميلية',
        phone: '+963 21 222 0011',
      });
    }

    const hist = db
      .prepare("SELECT data FROM entities WHERE kind='meta' AND id='history-v2'")
      .get();
    if (!hist) {
      const rawAppts = (
        db.prepare('SELECT data FROM appointments ORDER BY start_at').all() as { data: string }[]
      ).map((r) => JSON.parse(r.data) as Appointment);
      for (const a of rawAppts) {
        if (a.id.startsWith('seed--') && a.patientId === 'patient-1') {
          saveAppointment({ ...a, status: 'completed' });
          put('medical', a.id, {
            appointmentId: a.id,
            diagnosis: 'زيارة متابعة دورية',
            complaint: 'فحص دوري واستشارة سريرية',
            notes:
              'استقرار الحالة السريرية واستجابة ممتازة للخطة العلاجية المتبعة. إعادة التقييم بعد 6 أشهر أو عند اللزوم.',
            medications: [],
            followUp: '',
            visible: true,
          });
        }
      }
      put('meta', 'history-v2', true);
    }

    const pwBackfill = db
      .prepare("SELECT data FROM entities WHERE kind='meta' AND id='demo-passwords-v1'")
      .get();
    if (!pwBackfill) {
      const seededIdPattern = /^((owner|reception|admin)-1|doctor-[1-6]|patient-([1-9]|1[0-6]))$/;
      const storedUsers = db
        .prepare("SELECT id, data FROM entities WHERE kind='user'")
        .all() as Array<{ id: string; data: string }>;
      for (const row of storedUsers) {
        if (!seededIdPattern.test(row.id)) continue;
        const parsed = JSON.parse(row.data) as User & { passwordHash?: string };
        if (!parsed.passwordHash && parsed.email?.endsWith('@clinicbook.demo')) {
          put('user', row.id, { ...parsed, passwordHash: DEFAULT_DEMO_PASSWORD_HASH });
        }
      }
      put('meta', 'demo-passwords-v1', true);
    }
  } finally {
    _seeding = false;
  }
}
