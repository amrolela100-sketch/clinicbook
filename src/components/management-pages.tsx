'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import {
  UsersRound,
  Building2,
  Plus,
  Search,
  ShieldCheck,
  Mail,
  ArrowLeft,
  ArrowUpLeft,
  Check,
  CheckCircle2,
  CalendarDays,
  Wallet,
  FileText,
  Star,
  Settings,
  LogOut,
  SlidersHorizontal,
  Download,
  Stethoscope,
  Clock,
  Activity,
  Pencil,
  Globe,
  MapPin,
  Eye,
} from 'lucide-react';
import { useApp } from './app-provider';
import {
  PageHeading,
  CardHeading,
  Field,
  Submit,
  Avatar,
  Badge,
  Empty,
  DownloadCSV,
  dateLabel,
  today,
  dateKey,
  Logo,
} from './shared';
import { Button } from './ui/button';
import { Modal } from './ui/dialog';
import { ActivityChart } from './dashboard';
import { roleLabels } from './workspace-shell';
import type { Doctor } from '@/lib/types';
import { formatDoctorName } from '@/lib/format';
export function TeamPage() {
  const { data, act } = useApp();
  const [branchOpen, setBranchOpen] = useState(false);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState('doctors'),
    [query, setQuery] = useState(''),
    [edit, setEdit] = useState<Doctor | null>(null);
  const org = data?.organization;
  const docs = data?.doctors.filter((d) => d.organizationId === org?.id) ?? [];
  const team =
    data?.team.filter(
      (u) =>
        (tab === 'doctors' ? u.role === 'doctor' : u.role === 'receptionist') &&
        (!query || u.name.includes(query)),
    ) ?? [];
  const max = org?.tier === 'solo_starter' ? 1 : org?.tier === 'clinic_pro' ? 10 : '∞';
  return (
    <>
      <PageHeading
        title="فريق واحد. عناية متكاملة."
        description="أشخاص يصنعون الفرق كل يوم. أدر فريقك ومساحة عملهم."
      >
        <Button variant="outline" onClick={() => setBranchOpen(true)}>
          <Building2 size={18} />
          إضافة فرع
        </Button>
        <Button onClick={() => setOpen(true)}>
          <Plus size={18} />
          إضافة عضو للفريق
        </Button>
      </PageHeading>
      <div className="team-summary-grid">
        <section className="card usage-card">
          <span className="soft-icon">
            <Stethoscope size={23} />
          </span>
          <div>
            <span>الأطباء في المركز</span>
            <strong>
              {docs.length}
              <small> / {max}</small>
            </strong>
            <div className="usage-track">
              <i
                style={{
                  width:
                    typeof max === 'number'
                      ? Math.min(100, (docs.length / max) * 100) + '%'
                      : '20%',
                }}
              />
            </div>
          </div>
          <Badge status="active">
            {org?.tier === 'clinic_pro'
              ? 'Clinic Pro'
              : org?.tier === 'enterprise'
                ? 'Enterprise'
                : 'Solo Starter'}
          </Badge>
        </section>
        <section className="card usage-card">
          <span className="soft-icon warm">
            <Building2 size={23} />
          </span>
          <div>
            <span>الفرع الرئيسي</span>
            <h3>{org?.name}</h3>
            <p>
              {org?.city} · {org?.district}
            </p>
          </div>
          <Link className="text-link" href="/workspace/settings">
            الإعدادات <ArrowLeft size={16} />
          </Link>
        </section>
      </div>
      <section className="card">
        <div className="team-table-top">
          <div className="table-tabs">
            {[
              { key: 'doctors', label: 'الأطباء' },
              { key: 'reception', label: 'موظفو الاستقبال' },
            ].map((t) => (
              <button
                className={tab === t.key ? 'selected' : ''}
                key={t.key}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="input-icon">
            <Search size={17} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث عن عضو في الفريق…"
            />
          </div>
        </div>
        {team.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>عضو الفريق</th>
                  <th>البريد الإلكتروني</th>
                  <th>التخصص / الدور</th>
                  <th>الحالة</th>
                  <th>الكشفية</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {team.map((u) => {
                  const d = docs.find((d) => d.id === u.id);
                  return (
                    <tr key={u.id}>
                      <td>
                        <div className="patient-cell">
                          <Avatar name={u.name} image={d?.image} />
                          <strong>
                            {d ? 'د. ' : ''}
                            {u.name}
                          </strong>
                        </div>
                      </td>
                      <td>
                        <span dir="ltr">{u.email}</span>
                      </td>
                      <td>{d?.specialty ?? roleLabels[u.role]}</td>
                      <td>
                        <Badge status={d && !d.verified ? 'pending' : 'active'} />
                      </td>
                      <td>{d ? `$${d.fee}` : '—'}</td>
                      <td>
                        {d && (
                          <button
                            className="icon-button"
                            aria-label={`تعديل كشفية ${u.name}`}
                            onClick={() => setEdit(d)}
                          >
                            <Pencil size={17} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="لم يُضف أحد إلى هذه القائمة بعد" />
        )}
        <div className="table-footer">
          <span>{team.length} أعضاء في هذه القائمة</span>
          <span>حسابات معتمدة · إدارة الصلاحيات النشطة</span>
        </div>
      </section>
      <div className="reference-grid branch-grid">
        {data?.branches.map((b) => (
          <div className="reference-card" key={b.id}>
            <Building2 size={23} />
            <strong>{b.name}</strong>
            <span>
              {b.city} · {b.district}
            </span>
            <small dir="ltr">{b.phone}</small>
          </div>
        ))}
      </div>
      <Modal
        open={branchOpen}
        onClose={() => setBranchOpen(false)}
        title="إضافة فرع للمركز"
        description="تُراجع حدود الباقة قبل إنشاء الفرع."
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            if (await act('branch', Object.fromEntries(f), 'تمت إضافة الفرع')) setBranchOpen(false);
            setBusy(false);
          }}
        >
          <Field label="اسم الفرع">
            <input name="name" required minLength={2} />
          </Field>
          <div className="form-grid">
            <Field label="المدينة">
              <input name="city" required minLength={2} />
            </Field>
            <Field label="الحي">
              <input name="district" required minLength={2} />
            </Field>
          </div>
          <Field label="الهاتف">
            <input name="phone" dir="ltr" required minLength={7} />
          </Field>
          <Submit busy={busy}>إضافة الفرع</Submit>
        </form>
      </Modal>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="شخص جديد، في فريق الرعاية"
        description="سيُضاف العضو محليًا. يحتاج الطبيب الجديد لاعتماد الترخيص قبل نشره."
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            if (
              await act(
                'team',
                {
                  name: f.get('name'),
                  email: f.get('email'),
                  role: f.get('role'),
                  specialty: f.get('specialty'),
                  fee: Number(f.get('fee')),
                  license: f.get('license') ?? '',
                  clinicId: f.get('clinicId'),
                },
                'تمت إضافة العضو إلى الفريق المحلي',
              )
            )
              setOpen(false);
            setBusy(false);
          }}
        >
          <Field label="الاسم الكامل">
            <input name="name" required minLength={2} />
          </Field>
          <Field label="البريد الإلكتروني">
            <input name="email" type="email" required dir="ltr" />
          </Field>
          <Field label="الفرع">
            <select name="clinicId">
              {data?.branches.map((b) => (
                <option value={b.id} key={b.id}>
                  {b.name} — {b.city}
                </option>
              ))}
            </select>
          </Field>
          <Field label="الترخيص الطبي (مطلوب للأطباء)">
            <input name="license" placeholder="رقم الترخيص" />
          </Field>
          <Field label="الدور">
            <select name="role">
              <option value="doctor">طبيب</option>
              <option value="receptionist">موظف استقبال</option>
            </select>
          </Field>
          <div className="form-grid">
            <Field label="التخصص (للأطباء)">
              <select name="specialty">
                {[
                  'الطب العام',
                  'طب الأطفال',
                  'طب الأسنان',
                  'القلب والأوعية',
                  'الأمراض الجلدية',
                  'طب العيون',
                ].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="الكشفية بالدولار">
              <input name="fee" type="number" min="0" max="10000" defaultValue="20" required />
            </Field>
          </div>
          <Submit busy={busy}>إضافة عضو</Submit>
        </form>
      </Modal>
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title="تحديث رسوم الطبيب"
        description="تُطبّق الرسوم الجديدة على الحجوزات اللاحقة فقط."
      >
        {edit && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              if (
                await act('doctorFee', {
                  id: edit.id,
                  fee: Number(f.get('fee')),
                  followUpFee: Number(f.get('followUpFee')),
                })
              )
                setEdit(null);
              setBusy(false);
            }}
          >
            <Field label="الكشفية">
              <input name="fee" type="number" min="0" defaultValue={edit.fee} required />
            </Field>
            <Field label="المراجعة">
              <input
                name="followUpFee"
                type="number"
                min="0"
                defaultValue={edit.followUpFee}
                required
              />
            </Field>
            <Submit busy={busy} />
          </form>
        )}
      </Modal>
    </>
  );
}
const plans = [
  {
    key: 'solo_starter',
    name: 'Solo Starter',
    ar: 'رعاية تبدأ من عيادتك',
    price: 19,
    features: [
      'طبيب واحد، وفرع واحد',
      'الحجز الإلكتروني وإدارة المواعيد',
      'جدول دوام أسبوعي مرن',
      'أفق حجز حتى 30 يومًا',
    ],
  },
  {
    key: 'clinic_pro',
    name: 'Clinic Pro',
    ar: 'فريق متكامل، في مساحة واحدة',
    price: 59,
    features: [
      'حتى 10 أطباء و3 فروع',
      'حسابات موظفي استقبال',
      'ملفات طبية ووصفات قابلة للطباعة',
      'تقارير مالية وأفق حجز 90 يومًا',
    ],
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    ar: 'مساحة تنمو مع طموحك',
    price: null,
    features: [
      'أطباء وفروع دون حدود الباقات',
      'أفق حجز حتى 180 يومًا',
      'متطلبات تكامل مخصصة عند النشر',
      'إعداد وتشغيل حسب الاتفاق',
    ],
  },
];
export function BillingPage() {
  const { data, act } = useApp();
  const [request, setRequest] = useState(''),
    [busy, setBusy] = useState(false);
  const org = data?.organization;
  return (
    <>
      <PageHeading
        title="خطتك، على قدر طموحك"
        description="كل ما تحتاجه لتنمية مركزك، بوضوح ومرونة."
      />
      <section className="current-plan">
        <div>
          <Badge status={org?.subscriptionStatus ?? 'trialing'} />
          <span className="eyebrow">باقتك الحالية</span>
          <h2 dir="ltr">{plans.find((p) => p.key === org?.tier)?.name ?? 'Clinic Pro'}</h2>
          <p>مساحة تنظّم التفاصيل، لتتفرغ للرعاية.</p>
        </div>
        <div className="current-plan-details">
          <div>
            <CalendarDays size={20} />
            <span>
              نهاية الفترة الحالية<strong>{org?.periodEnd ? dateLabel(org.periodEnd) : '—'}</strong>
            </span>
          </div>
          <div>
            <ShieldCheck size={20} />
            <span>
              حالة الدفع<strong>لم يتم ربط بوابة دفع خارجية</strong>
            </span>
          </div>
        </div>
        <div className="plan-orbit">
          <i />
          <i />
          <span>+</span>
        </div>
      </section>
      <div className="section-heading billing-section-heading">
        <div>
          <h2>لكل مرحلة، مساحة تناسبها</h2>
          <p>باقات اشتراك مرنة مصممة لتناسب مختلف العيادات والمراكز الطبية مع دعم كامل.</p>
        </div>
        <span className="date-chip">فوترة شهرية</span>
      </div>
      <div className="pricing-grid">
        {plans.map((p) => (
          <article
            key={p.key}
            className={`pricing-card ${p.key === 'clinic_pro' ? 'featured' : ''}`}
          >
            {p.key === 'clinic_pro' && <span className="popular-plan">المساحة الأكثر تكاملًا</span>}
            <span className="plan-ar">{p.ar}</span>
            <h3 dir="ltr">{p.name}</h3>
            <div className="plan-price">
              {p.price ? (
                <>
                  <b>${p.price}</b>
                  <span>/ شهريًا</span>
                </>
              ) : (
                <b className="custom-price">لنتحدث</b>
              )}
            </div>
            <ul>
              {p.features.map((f) => (
                <li key={f}>
                  <Check size={16} />
                  {f}
                </li>
              ))}
            </ul>
            <Button
              variant={p.key === 'clinic_pro' ? 'default' : 'outline'}
              className="full-width"
              disabled={p.key === org?.tier}
              onClick={() => setRequest(p.key)}
            >
              {p.key === org?.tier ? 'باقتك الحالية' : 'طلب تفعيل الباقة'}
              {p.key !== org?.tier && <ArrowUpLeft size={17} />}
            </Button>
          </article>
        ))}
      </div>
      <div className="billing-bottom-grid">
        <section className="card">
          <CardHeading title="طلبات الاشتراك" subtitle="طلبات التفعيل اليدوي محفوظة للمراجعة." />
          {data?.billingRequests.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>الباقة</th>
                    <th>تاريخ الطلب</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {data.billingRequests.map((r) => (
                    <tr key={r.id}>
                      <td dir="ltr">{plans.find((p) => p.key === r.tier)?.name}</td>
                      <td>{dateLabel(r.createdAt)}</td>
                      <td>
                        <Badge status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="لا توجد طلبات تفعيل" text="اختر باقة لإرسال طلب تفعيل يدوي." />
          )}
        </section>
        <section className="card">
          <CardHeading title="فواتير الاشتراك" subtitle="شفافية في كل تفصيلة." />
          <Empty
            title="لا توجد فواتير صادرة"
            text="يتم إنشاء الفواتير وتوثيقها تلقائيًا عند تجديد الاشتراك أو إصدار دورات الفوترة."
          />
        </section>
      </div>
      <Modal
        open={!!request}
        onClose={() => setRequest('')}
        title="طلب تفعيل الباقة"
        description="طلب ترقية أو تفعيل الباقة لاعتمادها مباشرة من إدارة المنصة."
      >
        <div className="info-note">
          سيُسجّل طلب باقة <b dir="ltr">{plans.find((p) => p.key === request)?.name}</b> للمراجعة.
          يتطلب التفعيل موافقة مسؤول المنصة.
        </div>
        <Button
          className="full-width"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            if (await act('billingRequest', { tier: request }, 'تم تسجيل طلب التفعيل للمراجعة'))
              setRequest('');
            setBusy(false);
          }}
        >
          إرسال طلب التفعيل <ArrowLeft size={18} />
        </Button>
      </Modal>
    </>
  );
}
export function ReportsPage() {
  const { data } = useApp();
  const [period, setPeriod] = useState('week');
  const all = data?.appointments ?? [];
  const days = period === 'week' ? 7 : 14;
  const filtered = all.filter((a) => new Date(a.start).getTime() >= Date.now() - days * 86400000);
  const collected = filtered
    .filter((a) => a.payment === 'paid_cash')
    .reduce((s, a) => s + a.fee, 0);
  const complete = filtered.filter((a) => a.status === 'completed').length;
  const doctors = data?.doctors.filter((d) => d.organizationId === data.user?.organizationId) ?? [];
  return (
    <>
      <PageHeading
        title="أرقام تحكي قصة الرعاية"
        description="تابع أداء مركزك، واتخذ خطوتك القادمة بثقة."
      >
        <DownloadCSV
          name="clinicbook-report"
          rows={[
            ['المريض', 'التاريخ', 'الحالة', 'الكشفية', 'الدفع'],
            ...filtered.map((a) => [a.patientName, a.start, a.status, a.fee, a.payment]),
          ]}
        />
      </PageHeading>
      <div className="stats-grid report-stats">
        {[
          { title: 'الكشفيات المحصّلة', value: `$${collected}`, icon: Wallet },
          { title: 'الزيارات المكتملة', value: complete, icon: CheckCircle2 },
          {
            title: 'عدد المرضى',
            value: new Set(filtered.map((a) => a.patientId ?? a.phone)).size,
            icon: UsersRound,
          },
          {
            title: 'معدل إتمام الزيارات',
            value: Math.round((complete / Math.max(1, filtered.length)) * 100) + '%',
            icon: Activity,
          },
        ].map((s) => (
          <div className="stat-card" key={s.title}>
            <div className="stat-top">
              {s.title}
              <span className="stat-icon mint">
                <s.icon size={20} />
              </span>
            </div>
            <div className="stat-middle">
              <strong dir="ltr">{s.value}</strong>
            </div>
            <span className="muted">آخر {days} أيام</span>
          </div>
        ))}
      </div>
      <section className="card">
        <CardHeading
          title="الإيرادات المحصّلة"
          subtitle="تحصيلات نقدية مسجلة فعليًا في بيانات العرض"
        >
          <div className="segmented">
            <button
              className={period === 'week' ? 'selected' : ''}
              onClick={() => setPeriod('week')}
            >
              7 أيام
            </button>
            <button
              className={period === 'month' ? 'selected' : ''}
              onClick={() => setPeriod('month')}
            >
              14 يومًا
            </button>
          </div>
        </CardHeading>
        <ActivityChart appointments={all} period={period} money />
      </section>
      <section className="card reports-doctors">
        <CardHeading title="أداء الفريق الطبي" subtitle="نظرة على الزيارات والإيرادات لكل طبيب" />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>الطبيب</th>
                <th>المواعيد</th>
                <th>مكتمل</th>
                <th>لم يحضر</th>
                <th>المحصّل نقدًا</th>
              </tr>
            </thead>
            <tbody>
              {doctors.map((d) => {
                const a = filtered.filter((a) => a.doctorId === d.id);
                return (
                  <tr key={d.id}>
                    <td>
                      <div className="patient-cell">
                        <Avatar name={d.name} image={d.image} />
                        <strong>{formatDoctorName(d.name)}</strong>
                      </div>
                    </td>
                    <td>{a.length}</td>
                    <td>{a.filter((a) => a.status === 'completed').length}</td>
                    <td>{a.filter((a) => a.status === 'no_show').length}</td>
                    <td>
                      ${a.filter((a) => a.payment === 'paid_cash').reduce((s, a) => s + a.fee, 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
export function SettingsPage() {
  const { data, act } = useApp();
  const o = data?.organization;
  const [busy, setBusy] = useState(false);
  return (
    <>
      <PageHeading
        title="تفاصيل مركزك، بطريقتك"
        description="اضبط بيانات المؤسسة وقواعد الحجز بما يناسب فريقك ومرضاك."
      />
      <div className="settings-layout">
        <aside className="settings-nav">
          <a href="#clinic-details" className="active">
            <Building2 size={19} />
            بيانات المركز
          </a>
          <a href="#booking-policy">
            <CalendarDays size={19} />
            سياسة الحجز
          </a>
          <a href="#integrations">
            <Globe size={19} />
            التكاملات الخارجية
          </a>
        </aside>
        <div>
          <section className="card settings-card">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setBusy(true);
                await act('settings', {
                  name: f.get('name'),
                  phone: f.get('phone'),
                  address: f.get('address'),
                  cancelHours: Number(f.get('cancelHours')),
                  leadMinutes: Number(f.get('leadMinutes')),
                  autoConfirm: f.get('autoConfirm') === 'on',
                });
                setBusy(false);
              }}
            >
              <CardHeading
                title="بيانات المركز"
                subtitle="المعلومات التي تعرّف مرضاك بمكان الرعاية."
              />
              <div className="settings-form" id="clinic-details">
                <div className="form-grid">
                  <Field label="اسم المركز">
                    <input name="name" defaultValue={o?.name} required minLength={2} />
                  </Field>
                  <Field label="رقم الهاتف">
                    <input name="phone" defaultValue={o?.phone} required minLength={7} dir="ltr" />
                  </Field>
                </div>
                <Field label="العنوان التفصيلي">
                  <input name="address" defaultValue={o?.address ?? ''} maxLength={300} />
                </Field>
                <div className="form-grid">
                  <Field label="المدينة">
                    <input value={o?.city ?? ''} readOnly />
                  </Field>
                  <Field label="المنطقة الزمنية">
                    <input value="Asia/Damascus" dir="ltr" readOnly />
                  </Field>
                </div>
              </div>
              <div className="settings-divider" />
              <div className="settings-form" id="booking-policy">
                <h3>سياسة الحجز</h3>
                <p className="muted">تُطبّق هذه القواعد على الحجوزات الجديدة فور حفظها.</p>
                <div className="form-grid">
                  <Field label="مهلة الإلغاء (ساعات)">
                    <input
                      name="cancelHours"
                      type="number"
                      min="0"
                      max="72"
                      defaultValue={o?.cancelHours ?? 2}
                      required
                    />
                  </Field>
                  <Field label="أقل وقت قبل الحجز (دقائق)">
                    <input
                      name="leadMinutes"
                      type="number"
                      min="15"
                      max="1440"
                      defaultValue={o?.leadMinutes ?? 60}
                      required
                    />
                  </Field>
                </div>
                <label className="switch-line">
                  <span>
                    <strong>تأكيد الحجوزات تلقائيًا</strong>
                    <small>بدلاً من انتظار موافقة العيادة على كل طلب</small>
                  </span>
                  <input
                    name="autoConfirm"
                    type="checkbox"
                    role="switch"
                    defaultChecked={o?.autoConfirm}
                  />
                </label>
              </div>
              <div className="form-footer">
                <Submit busy={busy} />
              </div>
            </form>
          </section>
          <section className="card settings-card integration-card" id="integrations">
            <CardHeading title="التكاملات الخارجية" subtitle="إدارة بوابات الربط والخدمات الخارجية للمنصة." />
            {[
              { name: 'Supabase', text: 'قاعدة بيانات الإنتاج والمصادقة وRealtime' },
              { name: 'Google OAuth', text: 'تسجيل الدخول بحساب Google' },
              { name: 'Stripe', text: 'الدفع الإلكتروني وتجديد الاشتراكات' },
              { name: 'SMS / WhatsApp', text: 'الإشعارات الخارجية وتذكير المرضى' },
            ].map((i) => (
              <div className="integration-row" key={i.name}>
                <span className="integration-logo">{i.name[0]}</span>
                <div>
                  <strong dir="ltr">{i.name}</strong>
                  <p>{i.text}</p>
                </div>
                <Badge status="pending">يلزم إعداد خارجي</Badge>
              </div>
            ))}
          </section>
        </div>
      </div>
    </>
  );
}
export function AdminPage() {
  const { data, act, login } = useApp();
  const [tab, setTab] = useState('verification'),
    [reject, setReject] = useState(''),
    [busy, setBusy] = useState(false),
    [reference, setReference] = useState(false);
  const admin = data?.admin;
  const orgs = admin?.organizations ?? [];
  const waiting = admin?.verifications.filter((v) => v.status === 'pending') ?? [];
  return (
    <div className="admin-shell">
      <header className="admin-header">
        <Logo />
        <div>
          <Badge status="active">إدارة المنصة</Badge>
          <Link href="/" className="btn btn-outline">
            <Globe size={17} />
            بوابة المرضى
          </Link>
          <Button variant="ghost" onClick={() => login('clinic_owner')}>
            مساحة العيادة <ArrowUpLeft size={17} />
          </Button>
        </div>
      </header>
      <main className="admin-content">
        <PageHeading
          eyebrow="غرفة التحكم"
          title="صورة أشمل. رعاية أوسع."
          description="حوكمة المؤسسات الطبية، ومتابعة الاعتماد والاشتراكات من مكان واحد."
        />
        <div className="stats-grid">
          {[
            { label: 'المؤسسات المسجلة', value: orgs.length, icon: Building2 },
            {
              label: 'المراكز المعتمدة',
              value: orgs.filter((o) => o.status === 'approved').length,
              icon: ShieldCheck,
            },
            { label: 'طلبات قيد المراجعة', value: waiting.length, icon: Clock },
            { label: 'الأطباء المنشورون', value: data?.doctors.length ?? 0, icon: Stethoscope },
          ].map((s) => (
            <div className="stat-card" key={s.label}>
              <div className="stat-top">
                {s.label}
                <span className="stat-icon mint">
                  <s.icon size={21} />
                </span>
              </div>
              <div className="stat-middle">
                <strong>{s.value}</strong>
              </div>
            </div>
          ))}
        </div>
        <section className="card">
          <div className="admin-tabs table-tabs">
            {[
              { key: 'verification', name: 'التحقق والاعتماد' },
              { key: 'organizations', name: 'المؤسسات والاشتراكات' },
              { key: 'references', name: 'المدن والتخصصات' },
              { key: 'audit', name: 'سجل التدقيق' },
            ].map((t) => (
              <button
                key={t.key}
                className={tab === t.key ? 'selected' : ''}
                onClick={() => setTab(t.key)}
              >
                {t.name}
                {t.key === 'verification' && <span>{waiting.length}</span>}
              </button>
            ))}
          </div>
          {tab === 'verification' ? (
            <>
              <CardHeading
                title="طلبات الترخيص"
                subtitle="مراجعة وتدقيق الوثائق الرسمية واعتماد المنشآت الطبية والكوادر."
              />
              {admin?.verifications.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>مقدم الطلب</th>
                        <th>النوع</th>
                        <th>المدينة</th>
                        <th>رقم الترخيص</th>
                        <th>الحالة</th>
                        <th>الإجراءات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {admin.verifications.map((v) => (
                        <tr key={v.id}>
                          <td>
                            <strong>{v.name}</strong>
                          </td>
                          <td>{v.type}</td>
                          <td>{v.city}</td>
                          <td dir="ltr">{v.license}</td>
                          <td>
                            <Badge status={v.status} />
                          </td>
                          <td>
                            {v.status === 'pending' && (
                              <div className="inline-actions">
                                <Button
                                  size="sm"
                                  disabled={busy}
                                  onClick={async () => {
                                    setBusy(true);
                                    await act(
                                      'verify',
                                      { id: v.id, status: 'approved' },
                                      'تم اعتماد الطلب في بيئة العرض',
                                    );
                                    setBusy(false);
                                  }}
                                >
                                  <Check size={16} />
                                  اعتماد
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => setReject(v.id)}>
                                  رفض
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="لا توجد طلبات اعتماد" />
              )}
            </>
          ) : tab === 'organizations' ? (
            <>
              <CardHeading
                title="مؤسسات المنصة"
                subtitle="التفعيل اليدوي يُمدد الاشتراك 30 يومًا داخل بيئة العرض."
              />
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>المؤسسة</th>
                      <th>الباقة</th>
                      <th>الحالة</th>
                      <th>نهاية الفترة</th>
                      <th>تفعيل / تمديد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orgs.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <strong>{o.name}</strong>
                          <small>{o.city}</small>
                        </td>
                        <td>{plans.find((p) => p.key === o.tier)?.name}</td>
                        <td>
                          <Badge status={o.subscriptionStatus} />
                        </td>
                        <td>{dateLabel(o.periodEnd)}</td>
                        <td>
                          <form
                            className="inline-actions"
                            onSubmit={async (e) => {
                              e.preventDefault();
                              const f = new FormData(e.currentTarget);
                              await act(
                                'subscription',
                                { id: o.id, tier: f.get('tier') },
                                'تم تفعيل الاشتراك لمدة 30 يومًا',
                              );
                            }}
                          >
                            <select name="tier" defaultValue={o.tier}>
                              {plans.map((p) => (
                                <option key={p.key} value={p.key}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                            <Button size="sm" type="submit">
                              تفعيل
                            </Button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : tab === 'references' ? (
            <>
              <CardHeading title="دليل المدن والتخصصات" subtitle="إضافات إدارية محفوظة محليًا">
                <Button onClick={() => setReference(true)}>
                  <Plus size={17} />
                  إضافة عنصر
                </Button>
              </CardHeading>
              <div className="reference-grid">
                {[
                  { name: 'دمشق', type: 'city', id: 'base-1' },
                  { name: 'حلب', type: 'city', id: 'base-2' },
                  { name: 'الطب العام', type: 'specialty', id: 'base-3' },
                  ...(admin?.references ?? []),
                ].map((r) => (
                  <div className="reference-card" key={r.id}>
                    {r.type === 'city' ? <MapPin size={21} /> : <Stethoscope size={21} />}
                    <strong>{r.name}</strong>
                    <span>{r.type === 'city' ? 'مدينة' : 'تخصص'}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <CardHeading
                title="سجل الإجراءات"
                subtitle="يسجل العمليات المحلية دون تضمين محتوى الملاحظات الطبية."
              />
              {admin?.audit.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>الإجراء</th>
                        <th>الوقت</th>
                        <th>معرّف السجل</th>
                      </tr>
                    </thead>
                    <tbody>
                      {admin.audit.map((a) => (
                        <tr key={a.id}>
                          <td>
                            <code>{a.action}</code>
                          </td>
                          <td>{dateLabel(a.created_at)}</td>
                          <td>
                            <code>{a.entity_id.slice(0, 20)}</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="لم تُسجّل إجراءات بعد" />
              )}
            </>
          )}
        </section>
      </main>
      <Modal
        open={!!reject}
        onClose={() => setReject('')}
        title="رفض طلب الاعتماد"
        description="يساعد السبب الواضح مقدم الطلب على استكمال متطلباته."
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (
              await act(
                'verify',
                { id: reject, status: 'rejected', reason: f.get('reason') },
                'تم رفض الطلب مع توثيق السبب',
              )
            )
              setReject('');
          }}
        >
          <Field label="سبب الرفض">
            <textarea name="reason" required minLength={2} rows={4} />
          </Field>
          <Submit>حفظ القرار</Submit>
        </form>
      </Modal>
      <Modal
        open={reference}
        onClose={() => setReference(false)}
        title="إضافة إلى الدليل"
        description="أضف مدينة أو تخصصًا جديدًا إلى السجل الإداري."
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (await act('reference', { name: f.get('name'), type: f.get('type') }))
              setReference(false);
          }}
        >
          <Field label="الاسم">
            <input name="name" required minLength={2} />
          </Field>
          <Field label="النوع">
            <select name="type">
              <option value="city">مدينة</option>
              <option value="specialty">تخصص</option>
            </select>
          </Field>
          <Submit>إضافة العنصر</Submit>
        </form>
      </Modal>
    </div>
  );
}
