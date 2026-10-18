'use client';
import Link from 'next/link';
import { useState } from 'react';
import { motion } from 'motion/react';
import {
  CalendarDays,
  ArrowUpLeft,
  ArrowUpRight,
  ArrowDownRight,
  ChevronLeft,
  ChevronRight,
  Users,
  Clock3,
  Wallet,
  ArrowLeft,
  Check,
  Plus,
  Sun,
  MoreHorizontal,
  Activity,
  Search,
  Filter,
  CalendarCheck2,
  HeartPulse,
  Stethoscope,
} from 'lucide-react';
import { useApp } from './app-provider';
import {
  Avatar,
  Badge,
  CardHeading,
  PageHeading,
  Empty,
  time,
  dateLabel,
  today,
  dateKey,
  DownloadCSV,
} from './shared';
import { Button } from './ui/button';
import { WalkInButton, AppointmentTable } from './appointment-tools';
import type { Appointment } from '@/lib/types';
import { formatDoctorName } from '@/lib/format';
export function Dashboard() {
  const { data } = useApp();
  const [tab, setTab] = useState('all'),
    [period, setPeriod] = useState('week');
  const appts = data?.appointments ?? [];
  const day = today();
  const daily = appts.filter((a) => dateKey(a.start) === day);
  const waiting = daily.filter((a) => a.status === 'checked_in');
  const pending = appts.filter((a) => a.status === 'pending');
  const revenue = daily.filter((a) => a.payment === 'paid_cash').reduce((n, a) => n + a.fee, 0);
  const greeting = new Date().getHours() < 12 ? 'صباح الخير' : 'أهلاً بعودتك';
  const doctors = data?.doctors.filter((d) => d.organizationId === data.user?.organizationId) ?? [];
  const tableAppts = tab === 'all' ? daily : daily.filter((a) => a.status === tab);
  return (
    <>
      <PageHeading
        title={`${greeting}، ${data?.user?.name.split(' ')[0] ?? 'عمر'} ${new Date().getHours() < 12 ? '☀' : ''}`}
        description="يوم جديد، وفرصة جديدة لنصنع فرقًا في حياة مرضانا."
      >
        <span className="date-chip">
          <CalendarDays size={17} />
          {new Date().toLocaleDateString('ar-SY', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'Asia/Damascus',
          })}
        </span>
        <WalkInButton />
      </PageHeading>
      <div className="welcome-banner">
        <div className="welcome-banner-icon">
          <Stethoscope size={32} strokeWidth={1.5} />
        </div>
        <div>
          <span className="welcome-eyebrow">كل التفاصيل في مكانها</span>
          <h3>أنت تعتني بمرضاك، ونحن نعتني بيومك.</h3>
          <p>
            لديك <b>{daily.length} موعدًا</b> اليوم، و<span>{pending.length} طلبات</span> بانتظار
            التأكيد. لنجعله يومًا مميزًا.
          </p>
        </div>
        <Link href="/workspace/appointments">
          استعرض مواعيد اليوم <ArrowLeft size={17} />
        </Link>
        <div className="banner-art" aria-hidden="true">
          <svg viewBox="0 0 190 120">
            <circle cx="122" cy="65" r="63" fill="none" stroke="#b7d3c6" />
            <circle cx="122" cy="65" r="44" fill="none" stroke="#b7d3c6" />
            <path d="M82 65h23l9-20 14 40 9-20h28" fill="none" stroke="#679886" strokeWidth="2" />
            <circle cx="167" cy="36" r="9" fill="#c4d7a4" />
            <path d="M63 19v20m-10-10h20" stroke="#80a995" strokeWidth="2" />
          </svg>
        </div>
      </div>
      <div className="stats-grid">
        {[
          {
            title: 'مواعيد اليوم',
            value: daily.length,
            detail: 'جميع الحجوزات لهذا اليوم',
            icon: CalendarDays,
            variant: 'mint',
            bars: [5, 8, 6, 10, 7, 12, 9, 14],
          },
          {
            title: 'في غرفة الانتظار',
            value: waiting.length,
            detail: 'مرضى بانتظار الرعاية',
            icon: Users,
            variant: 'blue',
            bars: [4, 8, 5, 7, 6, 10, 5, 8],
          },
          {
            title: 'طلبات بانتظار التأكيد',
            value: pending.length,
            detail: 'امنح مرضاك بداية مطمئنة',
            icon: Clock3,
            variant: 'orange',
            bars: [10, 7, 9, 5, 8, 6, 4, 7],
          },
          {
            title: 'إيرادات اليوم',
            value: `$${revenue}`,
            detail: 'الكشفيات المحصّلة نقدًا',
            icon: Wallet,
            variant: 'violet',
            bars: [4, 6, 5, 8, 6, 10, 9, 13],
          },
        ].map((s, i) => (
          <motion.div
            className="stat-card"
            key={s.title}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07, duration: 0.35 }}
          >
            <div className="stat-top">
              <span>{s.title}</span>
              <span className={`stat-icon ${s.variant}`}>
                <s.icon size={20} strokeWidth={1.6} />
              </span>
            </div>
            <div className="stat-middle">
              <strong dir="ltr">{s.value}</strong>
              <div className={`stat-spark ${s.variant}`} aria-hidden="true">
                {s.bars.map((h, n) => (
                  <i key={n} style={{ height: h * 2.5, opacity: 0.25 + n * 0.1 }} />
                ))}
              </div>
            </div>
            <div className="stat-bottom">
              <span className={`stat-dot ${s.variant}`} />
              {s.detail}
            </div>
          </motion.div>
        ))}
      </div>
      <div className="dashboard-chart-row">
        <section className="card activity-card">
          <CardHeading title="نبض المركز" subtitle="صورة أوضح لنشاط المواعيد خلال الأيام الماضية">
            <div className="segmented">
              <button
                className={period === 'week' ? 'selected' : ''}
                onClick={() => setPeriod('week')}
              >
                هذا الأسبوع
              </button>
              <button
                className={period === 'month' ? 'selected' : ''}
                onClick={() => setPeriod('month')}
              >
                آخر أسبوعين
              </button>
            </div>
          </CardHeading>
          <ActivityChart appointments={appts} period={period} />
        </section>
        <section className="card distribution-card">
          <CardHeading title="نظرة على يومك" subtitle="توزيع حالات المواعيد">
            <CalendarCheck2 size={19} className="muted" />
          </CardHeading>
          <div className="donut-container">
            <svg viewBox="0 0 160 160" className="donut-chart">
              <circle cx="80" cy="80" r="59" fill="none" stroke="#f0f3f0" strokeWidth="16" />
              {(() => {
                let offset = 0;
                return [
                  { status: 'confirmed', color: '#327360' },
                  { status: 'checked_in', color: '#a2c3af' },
                  { status: 'pending', color: '#e9c17d' },
                  { status: 'completed', color: '#dde6cb' },
                ].map((item) => {
                  const len =
                    (daily.filter((a) => a.status === item.status).length /
                      Math.max(1, daily.length)) *
                    370.7;
                  const node = (
                    <circle
                      key={item.status}
                      cx="80"
                      cy="80"
                      r="59"
                      fill="none"
                      stroke={item.color}
                      strokeWidth="16"
                      strokeDasharray={`${Math.max(0, len - 5)} ${370.7 - Math.max(0, len - 5)}`}
                      strokeDashoffset={-offset}
                      transform="rotate(-90 80 80)"
                      strokeLinecap="round"
                    />
                  );
                  offset += len;
                  return node;
                });
              })()}
            </svg>
            <div className="donut-label">
              <b>{daily.length}</b>
              <span>إجمالي المواعيد</span>
            </div>
          </div>
          <div className="donut-legend">
            {[
              { key: 'confirmed', label: 'مؤكد', color: '#327360' },
              { key: 'checked_in', label: 'في الانتظار', color: '#a2c3af' },
              { key: 'pending', label: 'معلق', color: '#e9c17d' },
              { key: 'completed', label: 'مكتمل', color: '#dde6cb' },
            ].map((s) => (
              <span key={s.key}>
                <i style={{ background: s.color }} />
                {s.label}
                <b>{daily.filter((a) => a.status === s.key).length}</b>
              </span>
            ))}
          </div>
        </section>
      </div>
      <div className="dashboard-bottom-row">
        <section className="card daily-card">
          <CardHeading title="مواعيد اليوم" subtitle="كل موعد هو بداية لرعاية أفضل">
            <Link href="/workspace/appointments" className="text-link">
              عرض الكل <ArrowLeft size={16} />
            </Link>
          </CardHeading>
          <div className="table-tabs">
            {[
              { key: 'all', label: 'الكل', count: daily.length },
              {
                key: 'confirmed',
                label: 'القادمة',
                count: daily.filter((a) => a.status === 'confirmed').length,
              },
              { key: 'checked_in', label: 'في الانتظار', count: waiting.length },
              {
                key: 'pending',
                label: 'المعلقة',
                count: daily.filter((a) => a.status === 'pending').length,
              },
            ].map((t) => (
              <button
                key={t.key}
                className={tab === t.key ? 'selected' : ''}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                <span>{t.count}</span>
              </button>
            ))}
          </div>
          <AppointmentTable appointments={tableAppts.slice(0, 5)} compact />
          <div className="table-footer">
            <span>
              عرض {Math.min(5, tableAppts.length)} من {tableAppts.length} مواعيد
            </span>
            <Link href="/workspace/appointments">
              إدارة المواعيد <ArrowLeft size={14} />
            </Link>
          </div>
        </section>
        <section className="card doctors-today">
          <CardHeading title="فريقك اليوم" subtitle="رعاية نعمل من أجلها معًا">
            <span className="small-count">{doctors.length} أطباء</span>
          </CardHeading>
          {doctors.map((d) => {
            const count = daily.filter((a) => a.doctorId === d.id).length;
            return (
              <div className="team-doctor-row" key={d.id}>
                <Avatar name={d.name} image={d.image} />
                <div>
                  <strong>{formatDoctorName(d.name)}</strong>
                  <small>{d.specialty}</small>
                  <span className="doctor-workload">
                    <i style={{ width: Math.min(100, count * 15) + '%' }} />
                  </span>
                </div>
                <span className="doctor-appointment-count">
                  {count}
                  <small>مواعيد</small>
                </span>
              </div>
            );
          })}
          <div className="team-card-bottom">
            <span className="live-dot" />
            معًا نصنع رعاية طبية أفضل
            <HeartPulse size={17} />
          </div>
        </section>
      </div>
    </>
  );
}
export function ActivityChart({
  appointments,
  period = 'week',
  money = false,
}: {
  appointments: Appointment[];
  period?: string;
  money?: boolean;
}) {
  const days = Array.from({ length: period === 'week' ? 7 : 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (period === 'week' ? 6 : 13) + i);
    return {
      date: dateKey(d.toISOString()),
      label: new Date(dateKey(d.toISOString()) + 'T12:00:00Z').toLocaleDateString('ar-SY', {
        weekday: 'short',
      }),
    };
  });
  const values = days.map((d) =>
    appointments
      .filter((a) => dateKey(a.start) === d.date)
      .reduce((n, a) => n + (money ? (a.payment === 'paid_cash' ? a.fee : 0) : 1), 0),
  );
  const max = Math.max(...values, 4);
  const pts = values.map(
    (v, i) => `${55 + i * (665 / (values.length - 1))},${155 - (v / max) * 110}`,
  );
  const path = 'M' + pts.join(' L');
  const area = path + ` L720,175 L55,175 Z`;
  return (
    <>
      <div className="chart-summary">
        <div>
          <strong>
            {values.reduce((a, b) => a + b, 0)}
            {money && <small> $</small>}
          </strong>
          <span>{money ? 'إجمالي التحصيلات' : 'إجمالي المواعيد'}</span>
        </div>
        <div className="chart-key">
          <i />
          المواعيد المسجلة <span>آخر {days.length} أيام</span>
        </div>
      </div>
      <div className="activity-chart">
        <svg
          viewBox="0 0 760 208"
          role="img"
          aria-label={`مخطط نشاط المركز: ${values.join('، ')}`}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#accbbb" stopOpacity=".45" />
              <stop offset="100%" stopColor="#dceae2" stopOpacity=".08" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <line
                x1="50"
                x2="734"
                y1={45 + i * 43}
                y2={45 + i * 43}
                stroke="#e9eeea"
                strokeDasharray="4 5"
              />
              <text x="26" y={49 + i * 43} fill="#97a39a" fontSize="10" textAnchor="middle">
                {Math.round(max * (1 - i / 3))}
              </text>
            </g>
          ))}
          <path d={area} fill="url(#chart-fill)" />
          <motion.path
            d={path}
            fill="none"
            stroke="#3b8068"
            strokeWidth="2.6"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.2 }}
          />
          {values.map((v, i) => (
            <g key={i}>
              <circle
                cx={55 + i * (665 / (values.length - 1))}
                cy={155 - (v / max) * 110}
                r="3.6"
                fill="#fff"
                stroke="#3b8068"
                strokeWidth="2"
              />
              <title>
                {days[i].date}: {v}
              </title>
              {(values.length === 7 || i % 2 === 0) && (
                <text
                  x={55 + i * (665 / (values.length - 1))}
                  y="201"
                  textAnchor="middle"
                  fill="#89968d"
                  fontSize="11"
                >
                  {days[i].label}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
    </>
  );
}
export function AppointmentsPage() {
  const { data } = useApp();
  const [date, setDate] = useState(today()),
    [status, setStatus] = useState('all'),
    [doctor, setDoctor] = useState(''),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(1);
  const filtered = (data?.appointments ?? []).filter(
    (a) =>
      (!date || dateKey(a.start) === date) &&
      (status === 'all' || a.status === status) &&
      (!doctor || a.doctorId === doctor) &&
      (!query || a.patientName.includes(query) || a.phone.includes(query)),
  );
  return (
    <>
      <PageHeading
        title="كل موعد، في مكانه"
        description="نظّم يوم المركز وتابع رحلة المريض من الحجز حتى اكتمال الزيارة."
      >
        <WalkInButton />
      </PageHeading>
      <div className="appointment-page-stats">
        {[
          { key: 'all', label: 'كل المواعيد' },
          { key: 'confirmed', label: 'مؤكد' },
          { key: 'checked_in', label: 'في الانتظار' },
          { key: 'pending', label: 'بانتظار التأكيد' },
        ].map((s) => (
          <button
            className={status === s.key ? 'selected' : ''}
            key={s.key}
            onClick={() => {
              setStatus(s.key);
              setPage(1);
            }}
          >
            <span>{s.label}</span>
            <strong>
              {
                (data?.appointments ?? []).filter(
                  (a) =>
                    (!date || dateKey(a.start) === date) && (s.key === 'all' || a.status === s.key),
                ).length
              }
            </strong>
          </button>
        ))}
      </div>
      <section className="card">
        <div className="list-toolbar">
          <div className="input-icon">
            <Search size={18} />
            <input
              placeholder="ابحث باسم المريض أو الهاتف…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <input
            type="date"
            aria-label="تاريخ الموعد"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setPage(1);
            }}
          />
          <select
            aria-label="الطبيب"
            value={doctor}
            onChange={(e) => {
              setDoctor(e.target.value);
              setPage(1);
            }}
          >
            <option value="">كل الأطباء</option>
            {data?.doctors
              .filter((d) => d.organizationId === data.user?.organizationId)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {formatDoctorName(d.name)}
                </option>
              ))}
          </select>
          <Button
            variant="outline"
            onClick={() => {
              setDate('');
              setStatus('all');
              setDoctor('');
              setQuery('');
            }}
          >
            كل السجل
          </Button>
        </div>
        <AppointmentTable appointments={filtered.slice((page - 1) * 10, page * 10)} />
        <div className="table-footer">
          <span>{filtered.length} مواعيد مطابقة</span>
          <div className="pagination">
            <button
              disabled={page <= 1}
              aria-label="الصفحة السابقة"
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronRight size={17} />
            </button>
            <span>
              {page} / {Math.max(1, Math.ceil(filtered.length / 10))}
            </span>
            <button
              disabled={page * 10 >= filtered.length}
              aria-label="الصفحة التالية"
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronLeft size={17} />
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
