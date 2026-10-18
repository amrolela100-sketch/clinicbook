'use client';
import Link from 'next/link';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronLeft,
  Search,
  ShieldCheck,
  Stethoscope,
  LoaderCircle,
  Inbox,
  AlertCircle,
  FileDown,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { Status } from '@/lib/types';
import { Button } from './ui/button';
export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className={`logo ${light ? 'light' : ''}`} aria-label="ClinicBook الرئيسية">
      <span className="brandmark">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span dir="ltr">
        clinic<span>book</span>
        <b>رعاية أقرب. حياة أفضل.</b>
      </span>
    </Link>
  );
}
export function Empty({
  title = 'لا توجد نتائج بعد',
  text = 'ستظهر البيانات هنا عندما تصبح متاحة.',
  children,
}: {
  title?: string;
  text?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Inbox size={30} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading-screen">
      <span className="brandmark">
        <i />
        <i />
        <i />
        <i />
      </span>
      <p>نرتّب لك التفاصيل…</p>
      <div className="skeleton-grid">
        {[1, 2, 3, 4].map((i) => (
          <div className="skeleton" key={i} />
        ))}
      </div>
    </div>
  );
}
export function ErrorBox({ text, retry }: { text: string; retry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={20} />
      <span>{text}</span>
      {retry && (
        <Button variant="outline" onClick={retry}>
          إعادة المحاولة
        </Button>
      )}
    </div>
  );
}
const statusLabels: Record<string, string> = {
  pending: 'بانتظار التأكيد',
  confirmed: 'مؤكد',
  checked_in: 'في الانتظار',
  completed: 'مكتمل',
  cancelled: 'ملغي',
  expired: 'انتهت المهلة',
  rejected: 'مرفوض',
  no_show: 'لم يحضر',
  paid_cash: 'مدفوع نقداً',
  unpaid: 'غير مدفوع',
  approved: 'معتمد',
  active: 'نشط',
  trialing: 'فترة تجريبية',
};
export function Badge({ status, children }: { status?: Status | string; children?: ReactNode }) {
  return (
    <span className={`badge badge-${status ?? 'neutral'}`}>
      <i />
      {children ?? statusLabels[status ?? ''] ?? status}
    </span>
  );
}
export function Avatar({
  name,
  image,
  color,
  size = 'md',
}: {
  name: string;
  image?: string;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizePx = size === 'sm' ? 32 : size === 'lg' ? 112 : 44;
  return (
    <span className={`avatar avatar-${size}`} style={{ background: color }}>
      {image ? (
        <img
          src={`/images/${image}`}
          alt={name}
          width={sizePx}
          height={sizePx}
          loading="lazy"
        />
      ) : (
        name
          .split(' ')
          .slice(0, 2)
          .map((n) => n[0])
          .join('')
      )}
    </span>
  );
}
export const time = (v: string) =>
  new Date(v).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Damascus',
  });
export const dateLabel = (v: string, short = false) =>
  new Date(v).toLocaleDateString('ar-SY', {
    day: 'numeric',
    month: short ? 'short' : 'long',
    timeZone: 'Asia/Damascus',
  });
export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Damascus',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export const dateKey = (v: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Damascus',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(v));
export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
export function CardHeading({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="card-heading">
      <div>
        <h3>{title}</h3>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Submit({
  busy,
  children = 'حفظ التغييرات',
}: {
  busy?: boolean;
  children?: ReactNode;
}) {
  return (
    <Button type="submit" disabled={busy}>
      {busy ? <LoaderCircle size={18} className="spin" /> : <Check size={18} />} {children}
    </Button>
  );
}
export function DownloadCSV({
  rows,
  name = 'clinicbook',
}: {
  rows: (string | number)[][];
  name?: string;
}) {
  return (
    <Button
      variant="outline"
      onClick={() => {
        const csv =
          '\ufeff' +
          rows
            .map((r) =>
              r
                .map(
                  (c) =>
                    '"' +
                    String(c)
                      .replace(/^[=+@-]/, "'")
                      .replaceAll('"', '""') +
                    '"',
                )
                .join(','),
            )
            .join('\r\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name + '.csv';
        a.click();
        URL.revokeObjectURL(url);
      }}
    >
      <FileDown size={17} /> تصدير التقرير
    </Button>
  );
}
