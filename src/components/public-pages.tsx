'use client';
import Link from 'next/link';
import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { motion } from 'motion/react';
import {
  Search,
  ArrowLeft,
  ArrowUpLeft,
  MapPin,
  ChevronDown,
  CalendarDays,
  Clock,
  Star,
  ShieldCheck,
  HeartPulse,
  Stethoscope,
  Baby,
  Eye,
  Flower2,
  Smile,
  Check,
  Plus,
  SlidersHorizontal,
  CheckCircle2,
  MoveUpLeft,
  Menu,
  X,
  Building2,
  ArrowRight,
  UserRound,
  LoaderCircle,
} from 'lucide-react';
import { useApp } from './app-provider';
import {
  Logo,
  Avatar,
  Badge,
  Empty,
  ErrorBox,
  Field,
  Submit,
  time,
  dateLabel,
  today,
  PageHeading,
} from './shared';
import { Button } from './ui/button';
import { Modal } from './ui/dialog';
import type { Doctor, Appointment } from '@/lib/types';
import { cleanDoctorName, formatDoctorName } from '@/lib/format';
import { AgentChatDrawer } from './agent-chat-drawer';
const specialties = [
  { name: 'طب الأسنان', icon: Smile },
  { name: 'القلب والأوعية', icon: HeartPulse },
  { name: 'طب الأطفال', icon: Baby },
  { name: 'الأمراض الجلدية', icon: Flower2 },
  { name: 'الطب العام', icon: Stethoscope },
  { name: 'طب العيون', icon: Eye },
];
export function PublicShell({ children }: { children: ReactNode }) {
  const { data, login } = useApp();
  const [menu, setMenu] = useState(false);
  return (
    <div className="public-shell">
      <div className="public-announcement">
        <span className="live-dot" /> مساحة واحدة لرعاية أفضل{' '}
        <span className="announcement-divider">|</span>
        <span>حجز فوري وموثوق · نخبة من أفضل الأطباء والمراكز المعتمدة</span>
      </div>
      <header className="public-header">
        <Logo />
        <nav onClick={() => setMenu(false)} className={menu ? 'mobile-open' : ''}>
          <Link href="/search">اكتشف الأطباء</Link>
          <Link href="/#how-it-works">كيف نساعدك؟</Link>
          <Link href="/register-clinic">للأطباء والمراكز</Link>
        </nav>
        <div className="public-nav-actions">
          {data?.user ? (
            <Link
              href={
                data.user.role === 'patient'
                  ? '/my-appointments'
                  : data.user.role === 'super_admin'
                    ? '/admin'
                    : '/workspace/dashboard'
              }
              className="nav-account"
            >
              <Avatar name={data.user.name} size="sm" />
              <span>حسابي</span>
            </Link>
          ) : (
            <Link href="/login" className="login-link">
              تسجيل الدخول
            </Link>
          )}
          <Button variant="outline" onClick={() => login('clinic_owner')}>
            جرّب مساحة العمل <ArrowUpLeft size={17} />
          </Button>
          <button
            className="mobile-menu icon-button"
            aria-label="فتح القائمة"
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      <main>{children}</main>
      <AgentChatDrawer />
      <footer className="public-footer">
        <div>
          <Logo />
          <p>نقرّب المسافة بينك وبين رعاية تستحقها.</p>
        </div>
        <div>
          <Link href="/search">ابحث عن طبيب</Link>
          <Link href="/register-clinic">انضم بمركزك الطبي</Link>
          <Link href="/login">مساحة العمل</Link>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} ClinicBook. صُمّم بعناية.</span>
          <span>بيئة عرض فقط · لا تستخدم بيانات طبية حقيقية</span>
          <span>
            العربية <span dir="ltr">AR</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
export function Home() {
  const { data } = useApp();
  const [city, setCity] = useState('دمشق'),
    [specialty, setSpecialty] = useState('');
  return (
    <>
      <section className="hero public-container">
        <motion.div
          className="hero-copy"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="hero-eyebrow">
            <span className="tiny-cross">+</span> لصحتك، ولراحة بالك
          </div>
          <h1>
            رعاية أقرب.
            <br />
            <span>حياة أفضل.</span>
            <svg className="headline-flower" viewBox="0 0 80 80" aria-hidden="true">
              <path
                d="M40 4v72M4 40h72M14 14l52 52M14 66l52-52"
                stroke="currentColor"
                strokeWidth="9"
              />
            </svg>
          </h1>
          <p className="hero-description">
            الطبيب المناسب، في الوقت المناسب.
            <br />
            اكتشف أطباء تثق بهم، واحجز موعدك بسهولة…
            <br className="desktop-only" /> لأن رحلتك نحو صحة أفضل تبدأ بخطوة بسيطة.
          </p>
          <form className="hero-search" action="/search">
            <label>
              <MapPin size={19} />
              <span>
                <small>أين تبحث؟</small>
                <select name="city" value={city} onChange={(e) => setCity(e.target.value)}>
                  <option>دمشق</option>
                  <option>حلب</option>
                  <option>حمص</option>
                </select>
              </span>
            </label>
            <span className="search-divider" />
            <label>
              <Stethoscope size={19} />
              <span>
                <small>التخصص الطبي</small>
                <select
                  name="specialty"
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                >
                  <option value="">كل التخصصات</option>
                  {specialties.map((s) => (
                    <option key={s.name}>{s.name}</option>
                  ))}
                </select>
              </span>
            </label>
            <Button type="submit" aria-label="ابحث عن طبيب">
              <Search size={20} />
              <span>ابحث الآن</span>
            </Button>
          </form>
          <div className="hero-assurance">
            <ShieldCheck size={17} />
            <span>أطباء معتمدون</span>
            <i />
            <span>حجز بدون رسوم إضافية</span>
            <i />
            <span>خطوات أقل، راحة أكثر</span>
          </div>
        </motion.div>
        <motion.div
          className="hero-visual"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.1 }}
        >
          <div className="hero-backdrop" />
          <img
            className="hero-photo"
            src="/images/care-editorial.jpg"
            alt="طبيبة ترحب بك في عيادة هادئة ومضيئة"
            width={500}
            height={516}
            fetchPriority="high"
            loading="eager"
          />
          <div className="hero-photo-tag">
            <span className="live-dot" /> هنا تبدأ حكاية رعاية أفضل
          </div>
          <motion.div
            className="floating-booking"
            animate={{ y: [0, -7, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
          >
            <div className="booking-check">
              <Check size={23} />
            </div>
            <div>
              <strong>موعدك، صار أقرب</strong>
              <p>احجز ببساطة، واطمئن أكثر.</p>
            </div>
            <span className="floating-stroke" />
          </motion.div>
          <div className="floating-rating">
            <div className="star-row">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star key={n} size={13} fill="currentColor" />
              ))}
            </div>
            <strong dir="ltr">
              4.9 <small>/ 5</small>
            </strong>
            <span>أعلى تقييمات رضا المرضى</span>
            <div className="avatar-stack">
              {['doctor-1.jpg', 'doctor-2.jpg', 'doctor-3.jpg'].map((image, i) => (
                <Avatar key={image} image={image} name={'طبيب ' + i} size="sm" />
              ))}
            </div>
          </div>
          <svg className="visual-scribble" viewBox="0 0 110 80">
            <path
              d="M8 25C35-5 87 5 78 33S32 65 37 44s61-16 64 26"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
        </motion.div>
      </section>
      <section className="specialties-section public-container">
        <div className="section-heading">
          <div>
            <span className="eyebrow">لأن لكل احتياج، اختصاصه</span>
            <h2>رعاية لكل فرد في العائلة</h2>
          </div>
          <Link href="/search" className="text-link">
            كل التخصصات <ArrowLeft size={18} />
          </Link>
        </div>
        <div className="specialties-grid">
          {specialties.map((s, i) => (
            <Link
              href={`/search?specialty=${encodeURIComponent(s.name)}`}
              key={s.name}
              className="specialty-card"
            >
              <span className={`specialty-icon specialty-${i}`}>
                <s.icon size={27} strokeWidth={1.5} />
              </span>
              <strong>{s.name}</strong>
              <ArrowUpLeft size={16} />
            </Link>
          ))}
        </div>
      </section>
      <section className="featured-section public-container">
        <div className="section-heading">
          <div>
            <span className="eyebrow">خبرة تطمئن إليها</span>
            <h2>تعرّف إلى طبيبك القادم</h2>
          </div>
          <Link href="/search" className="text-link">
            استكشف كل الأطباء <ArrowLeft size={18} />
          </Link>
        </div>
        <div className="doctor-grid">
          {(data?.doctors ?? [])
            .filter((d) => d.verified)
            .slice(0, 4)
            .map((d) => (
              <DoctorCard key={d.id} doctor={d} />
            ))}
        </div>
      </section>
      <section className="how-section public-container" id="how-it-works">
        <div className="how-intro">
          <span className="eyebrow">أبسط مما تتخيل</span>
          <h2>
            ثلاث خطوات.
            <br />
            واطمئنان أكبر.
          </h2>
          <p>
            من أول بحث إلى باب العيادة،
            <br />
            نحن معك في كل خطوة.
          </p>
        </div>
        {[
          {
            n: '01',
            title: 'اختر طبيبك',
            text: 'ابحث حسب التخصص والمدينة، وتعرّف على الخبرات والتقييمات.',
            icon: Search,
          },
          {
            n: '02',
            title: 'حدّد وقتك',
            text: 'اختر من المواعيد المتاحة فعلياً، بما يناسب يومك.',
            icon: CalendarDays,
          },
          {
            n: '03',
            title: 'اهتم بصحتك',
            text: 'تابع تأكيد موعدك، واترك بقية التفاصيل علينا.',
            icon: HeartPulse,
          },
        ].map((s) => (
          <div className="how-step" key={s.n}>
            <span className="how-number" aria-hidden="true">
              {s.n}
            </span>
            <s.icon size={25} />
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </div>
        ))}
      </section>
      <section className="clinic-cta public-container">
        <div>
          <span>مساحة عمل تفهم احتياجاتك</span>
          <h2>
            اهتم بمرضاك.
            <br />
            واترك لنا تنظيم يومك.
          </h2>
          <p>المواعيد، الفريق، والملفات الطبية. كلها في مكان واحد.</p>
          <Link className="btn btn-white" href="/register-clinic">
            ابدأ مع كلينك بوك <ArrowUpLeft size={18} />
          </Link>
        </div>
        <div className="cta-illustration">
          <div className="mini-window">
            <div className="mini-window-top">
              <span />
              <span />
              <span />
            </div>
            <div className="mini-window-body">
              <div className="mini-check">
                <Check size={30} />
              </div>
              <h3>يوم أكثر هدوءًا</h3>
              <p>كل التفاصيل، تحت السيطرة.</p>
              <div className="mini-bars">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
          </div>
          <span className="cta-plus">+</span>
        </div>
      </section>
    </>
  );
}
export function DoctorCard({ doctor: d }: { doctor: Doctor }) {
  const formattedName = formatDoctorName(d.name);
  return (
    <article className="doctor-card">
      <Link href={`/doctors/${d.id}`} className="doctor-card-photo" style={{ background: d.color }}>
        <img
          src={`/images/${d.image}`}
          alt={formattedName}
          width={300}
          height={205}
          loading="lazy"
        />
        <span className="doctor-verified">
          <ShieldCheck size={14} /> طبيب معتمد
        </span>
        <span className="doctor-photo-arrow">
          <ArrowUpLeft size={19} />
        </span>
      </Link>
      <div className="doctor-card-content">
        <div className="doctor-card-top">
          <span className="doctor-specialty">{d.specialty}</span>
          <span className="rating">
            <Star size={13} fill="currentColor" />
            <b>{d.rating.toFixed(1)}</b>
            <small>({d.reviews})</small>
          </span>
        </div>
        <Link href={`/doctors/${d.id}`}>
          <h3>{formattedName}</h3>
        </Link>
        <p className="doctor-location">
          <MapPin size={14} />
          {d.city}، {d.district} · {d.clinic}
        </p>
        <div className="doctor-card-bottom">
          <span>
            <b>${d.fee.toLocaleString('en-US')}</b> <small>/ الكشفية</small>
          </span>
          <Link className="book-link" href={`/doctors/${d.id}`}>
            احجز موعدًا <ArrowLeft size={15} />
          </Link>
        </div>
      </div>
    </article>
  );
}
export function SearchPage() {
  const { data } = useApp();
  const [query, setQuery] = useState(''),
    [city, setCity] = useState(''),
    [specialty, setSpecialty] = useState(''),
    [district, setDistrict] = useState(''),
    [sort, setSort] = useState('rating'),
    [todayOnly, setTodayOnly] = useState(false),
    [available, setAvailable] = useState<string[]>([]),
    [checking, setChecking] = useState(false);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setCity(p.get('city') ?? '');
    setSpecialty(p.get('specialty') ?? '');
  }, []);
  useEffect(() => {
    if (!todayOnly || !data) return;
    let active = true;
    setChecking(true);
    Promise.all(
      data.doctors.map(async (d) => {
        const r = await fetch(`/api/slots?doctorId=${d.id}&date=${today()}`);
        const j = await r.json();
        return j.data?.length ? d.id : '';
      }),
    )
      .then((ids) => {
        if (active) setAvailable(ids);
      })
      .catch(() => {
        if (active) setAvailable([]);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [todayOnly, data?.doctors.length]);
  const doctors = (data?.doctors ?? [])
    .filter(
      (d) =>
        d.verified &&
        (!city || d.city === city) &&
        (!specialty || d.specialty === specialty) &&
        (!district || d.district === district) &&
        (!query || `${d.name} ${d.specialty} ${d.clinic}`.includes(query)) &&
        (!todayOnly || available.includes(d.id)),
    )
    .sort((a, b) => (sort === 'fee' ? a.fee - b.fee : b.rating - a.rating));
  return (
    <div className="public-container search-page">
      <div className="breadcrumb">
        <Link href="/">الرئيسية</Link>
        <span>/</span>اكتشف الأطباء
      </div>
      <PageHeading
        eyebrow="رعايتك تبدأ من هنا"
        title="طبيب تثق به. موعد يناسبك."
        description="اختر من بين أطباء معتمدين، وابدأ رحلتك نحو صحة أفضل."
      />
      <div className="search-toolbar">
        <div className="input-icon">
          <Search size={19} />
          <input
            placeholder="ابحث باسم الطبيب، التخصص أو المركز…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select aria-label="ترتيب النتائج" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="rating">الأعلى تقييمًا</option>
          <option value="fee">الكشفية الأقل</option>
        </select>
      </div>
      <div className="search-layout">
        <aside className="search-filters">
          <div className="filter-title">
            <h3>
              <SlidersHorizontal size={18} /> تخصيص البحث
            </h3>
            <button
              onClick={() => {
                setCity('');
                setSpecialty('');
                setDistrict('');
                setQuery('');
                setTodayOnly(false);
              }}
            >
              مسح الكل
            </button>
          </div>
          <Field label="المدينة">
            <select
              value={city}
              onChange={(e) => {
                setCity(e.target.value);
                setDistrict('');
              }}
            >
              <option value="">كل المدن</option>
              {['دمشق', 'حلب', 'حمص'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="الحي">
            <select value={district} onChange={(e) => setDistrict(e.target.value)}>
              <option value="">كل الأحياء</option>
              {[
                ...new Set(
                  (data?.doctors ?? [])
                    .filter((d) => !city || d.city === city)
                    .map((d) => d.district),
                ),
              ].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <h4>التخصص الطبي</h4>
          <div className="specialty-filters">
            <label>
              <input type="radio" checked={!specialty} onChange={() => setSpecialty('')} />
              كل التخصصات
            </label>
            {specialties.map((s) => (
              <label key={s.name}>
                <input
                  type="radio"
                  checked={s.name === specialty}
                  onChange={() => setSpecialty(s.name)}
                />
                <s.icon size={17} />
                {s.name}
              </label>
            ))}
          </div>
          <div className="filter-divider" />
          <label className="switch-line">
            <span>متاح اليوم</span>
            <input
              type="checkbox"
              role="switch"
              checked={todayOnly}
              onChange={(e) => setTodayOnly(e.target.checked)}
            />
          </label>
          <div className="filter-note">
            <ShieldCheck size={24} />
            <strong>رعاية يمكنك الوثوق بها</strong>
            <p>الأطباء المعروضون معتمدون ضمن مراكز ذات اشتراكات نشطة.</p>
          </div>
        </aside>
        <div>
          <div className="results-label">
            <strong>
              {checking ? 'جارٍ فحص المواعيد…' : `${doctors.length} أطباء يناسبون بحثك`}
            </strong>
            <span>اختر الرعاية التي تستحقها</span>
          </div>
          {doctors.length ? (
            <div className="doctor-grid search-doctors">
              {doctors.map((d) => (
                <DoctorCard key={d.id} doctor={d} />
              ))}
            </div>
          ) : (
            <Empty title="لم نجد طبيبًا بهذه الخيارات" text="جرّب مدينة أخرى أو وسّع نطاق التخصص.">
              <Button
                variant="outline"
                onClick={() => {
                  setCity('');
                  setSpecialty('');
                  setDistrict('');
                  setQuery('');
                  setTodayOnly(false);
                }}
              >
                عرض جميع الأطباء
              </Button>
            </Empty>
          )}
        </div>
      </div>
    </div>
  );
}
export function DoctorPage({ id }: { id: string }) {
  const { data, toast, refresh, login } = useApp();
  const d = data?.doctors.find((d) => d.id === id && d.verified);
  const [date, setDate] = useState(today()),
    [slots, setSlots] = useState<{ start: string; end: string }[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [selected, setSelected] = useState(''),
    [open, setOpen] = useState(false),
    [visit, setVisit] = useState('first_visit'),
    [notes, setNotes] = useState(''),
    [busy, setBusy] = useState(false),
    [success, setSuccess] = useState(false),
    [refreshId, setRefreshId] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setSelected('');
    fetch(`/api/slots?doctorId=${id}&date=${date}`)
      .then((r) => r.json())
      .then((j) => {
        if (active) {
          setSlots(j.data ?? []);
          setError(j.success ? '' : j.error);
        }
      })
      .catch(() => {
        if (active) setError('تعذر تحميل الفترات، حاول مجدداً.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, date, refreshId]);
  if (!d) return <Empty title="الطبيب غير متاح" text="قد يكون ملفه قيد المراجعة أو غير منشور." />;
  const days = Array.from({ length: d.bookingHorizonDays ?? 30 }, (_, i) => {
    const n = new Date(today() + 'T12:00:00Z');
    n.setDate(n.getDate() + i);
    return n.toISOString().slice(0, 10);
  });
  async function book() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doctorId: id, start: selected, visitType: visit, notes }),
      });
      const j = await r.json();
      if (!j.success) {
        toast(j.error, true);
        if (r.status === 409) {
          setOpen(false);
          setRefreshId((n) => n + 1);
        }
        return;
      }
      setOpen(false);
      setSuccess(true);
      setRefreshId((n) => n + 1);
      await refresh();
    } catch {
      toast('تعذر الاتصال، حاول مجدداً.', true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="public-container doctor-profile-page">
      <div className="breadcrumb">
        <Link href="/">الرئيسية</Link>
        <span>/</span>
        <Link href="/search">الأطباء</Link>
        <span>/</span>{formatDoctorName(d.name)}
      </div>
      <div className="doctor-profile-grid">
        <div>
          <section className="profile-card">
            <div className="profile-cover" style={{ background: d.color }}>
              <span className="profile-cross">+</span>
              <span className="profile-cover-label">كل تفصيلة في رعايتك، تهمّنا.</span>
            </div>
            <div className="profile-main">
              <Avatar name={d.name} image={d.image} size="lg" />
              <Badge status="approved">ترخيص طبي موثّق</Badge>
              <h1>{formatDoctorName(d.name)}</h1>
              <p className="profile-specialty">أخصائي {d.specialty}</p>
              <div className="profile-meta">
                <span>
                  <Star size={17} fill="currentColor" />
                  {d.rating.toFixed(1)} <small>({d.reviews} تقييم مريض)</small>
                </span>
                <span>
                  <Stethoscope size={17} />
                  {d.experience} سنة خبرة
                </span>
                <span>
                  <MapPin size={17} />
                  {d.city}، {d.district}
                </span>
              </div>
              <div className="profile-about">
                <h3>تعرف إلى طبيبك</h3>
                <p>
                  {d.bio} نؤمن أن الاستماع الجيد هو البداية لرعاية أفضل، ونحرص على تقديم رعاية طبية مريحة
                  وواضحة في كل زيارة.
                </p>
              </div>
              <div className="clinic-address">
                <span className="soft-icon">
                  <Building2 size={24} />
                </span>
                <div>
                  <h3>{d.clinic}</h3>
                  <p>
                    {d.city} · {d.district}
                  </p>
                  <small>
                    رقم الترخيص: <b dir="ltr">{d.license}</b>
                  </small>
                </div>
              </div>
            </div>
          </section>
          <section className="card profile-reviews">
            <h3>تقييمات الزيارات الموثقة</h3>
            <p className="muted">تقييم واحد لكل زيارة مكتملة عبر المنصة.</p>
            {data?.reviews.filter((r) => r.doctorId === id).length ? (
              data.reviews
                .filter((r) => r.doctorId === id)
                .map((r) => (
                  <div className="review-row" key={r.appointmentId}>
                    <Avatar name={r.name} />
                    <div>
                      <strong>{r.name}</strong>
                      <span className="rating">{'★'.repeat(r.rating)}</span>
                      <p>{r.comment}</p>
                    </div>
                    <ShieldCheck size={17} />
                  </div>
                ))
            ) : (
              <Empty title="كن أول من يشارك تقييمه للزيارة" text="تتاح كتابة التقييم بعد إتمام زيارتك." />
            )}
          </section>
        </div>
        <aside className="booking-panel card">
          <div className="booking-panel-head">
            <span className="soft-icon">
              <CalendarDays size={22} />
            </span>
            <div>
              <h2>وقت لصحتك</h2>
              <p>اختر يومًا وموعدًا يناسبك</p>
            </div>
          </div>
          <div className="booking-price">
            <span>قيمة الكشفية</span>
            <strong>
              {d.fee} <small>دولار</small>
            </strong>
          </div>
          <div className="date-control">
            <strong>
              {new Date(date + 'T12:00:00Z').toLocaleDateString('ar-SY', {
                month: 'long',
                year: 'numeric',
              })}
            </strong>
            <input
              type="date"
              aria-label="تاريخ الحجز"
              min={today()}
              max={new Date(Date.now() + (d.bookingHorizonDays ?? 30) * 86400000)
                .toISOString()
                .slice(0, 10)}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="days-carousel">
            {days.map((v, i) => (
              <button key={v} className={v === date ? 'selected' : ''} onClick={() => setDate(v)}>
                <span>
                  {i === 0
                    ? 'اليوم'
                    : new Date(v + 'T12:00:00Z').toLocaleDateString('ar-SY', { weekday: 'short' })}
                </span>
                <b>{Number(v.slice(-2))}</b>
              </button>
            ))}
          </div>
          <div className="slots-title">
            <Clock size={15} />
            <span>الفترات المتاحة</span>
            <small>بتوقيت دمشق</small>
          </div>
          {loading ? (
            <div className="slot-grid">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <div className="skeleton slot-skeleton" key={n} />
              ))}
            </div>
          ) : error ? (
            <ErrorBox text={error} retry={() => setRefreshId((n) => n + 1)} />
          ) : slots.length ? (
            <div className="slot-grid">
              {slots.map((s) => (
                <button
                  dir="ltr"
                  className={selected === s.start ? 'selected' : ''}
                  key={s.start}
                  onClick={() => setSelected(s.start)}
                >
                  {time(s.start)}
                  {selected === s.start && <Check size={14} />}
                </button>
              ))}
            </div>
          ) : (
            <Empty title="لا توجد فترات في هذا اليوم" text="جرّب اختيار يوم آخر من التقويم." />
          )}
          <Button className="full-width" disabled={!selected} onClick={() => setOpen(true)}>
            متابعة الحجز <ArrowLeft size={18} />
          </Button>
          <p className="booking-reassurance">
            <ShieldCheck size={15} />
            لا تدفع أي رسوم حجز إضافية
          </p>
          <div className="booking-policy">
            يمكن إلغاء الموعد مجانًا قبل بدايته بـ {d.cancelHours ?? 2} ساعات. الحجز المعلّق بانتظار
            تأكيد العيادة.
          </div>
        </aside>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="خطوة أخيرة، لصحتك"
        description="راجع تفاصيل موعدك قبل إرسال طلب الحجز."
      >
        {data?.user?.role === 'patient' ? (
          <>
            <div className="booking-summary">
              <Avatar name={d.name} image={d.image} />
              <div>
                <h3>{formatDoctorName(d.name)}</h3>
                <p>
                  {d.specialty} · {d.clinic}
                </p>
              </div>
            </div>
            <div className="summary-details">
              <span>
                <CalendarDays size={18} />
                {dateLabel(date + 'T12:00:00Z')}
              </span>
              <span>
                <Clock size={18} />
                <b dir="ltr">{selected ? time(selected) : ''}</b>
              </span>
            </div>
            <Field label="نوع الزيارة">
              <select value={visit} onChange={(e) => setVisit(e.target.value)}>
                <option value="first_visit">كشف جديد — {d.fee} دولار</option>
                <option value="follow_up">مراجعة — {d.followUpFee} دولار</option>
              </select>
            </Field>
            <Field label="ملاحظات للطبيب (اختياري)">
              <textarea
                rows={3}
                maxLength={1000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="أخبر الطبيب باختصار عن سبب الزيارة…"
              />
            </Field>
            <div className="info-note">
              تُحجز الفترة فور الإرسال، وتظهر حالة التأكيد في صفحة مواعيدك.
            </div>
            <Button className="full-width" disabled={busy} onClick={book}>
              {busy ? <LoaderCircle className="spin" size={18} /> : <CheckCircle2 size={18} />}تأكيد
              طلب الحجز
            </Button>
          </>
        ) : (
          <>
            <div className="info-note">
              يرجى تسجيل الدخول بحساب المريض لإتمام حجز الموعد وتأكيده فورًا.
            </div>
            <Button className="full-width" onClick={() => login('patient', `/doctors/${id}`)}>
              المتابعة وتأكيد الحجز <ArrowLeft size={18} />
            </Button>
            <Link className="btn btn-outline full-width" href="/login">
              تسجيل الدخول
            </Link>
          </>
        )}
      </Modal>
      <Modal
        open={success}
        onClose={() => setSuccess(false)}
        title="طلب موعدك أصبح في مكانه"
        description="يمكنك متابعة حالة التأكيد من صفحة مواعيدك."
      >
        <div className="success-illustration">
          <CheckCircle2 size={60} />
        </div>
        <p className="center-text">
          تم حفظ طلب الحجز بنجاح. ستجده في مواعيدك مع حالة تأكيد العيادة.
        </p>
        <Link href="/my-appointments" className="btn btn-primary full-width">
          الانتقال إلى مواعيدي <ArrowLeft size={18} />
        </Link>
      </Modal>
    </div>
  );
}
