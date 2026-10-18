'use client';
import Link from 'next/link';
import { useState, useEffect, type FormEvent } from 'react';
import {
  Plus,
  Check,
  Clock,
  ArrowLeft,
  Phone,
  CalendarDays,
  Wallet,
  MoreHorizontal,
  CheckCircle2,
  X,
  UserCheck,
  FileText,
  LoaderCircle,
} from 'lucide-react';
import { useApp } from './app-provider';
import { Modal } from './ui/dialog';
import { Button } from './ui/button';
import { Avatar, Badge, Field, Submit, Empty, time, dateLabel, today } from './shared';
import type { Appointment, Doctor } from '@/lib/types';
import { formatDoctorName } from '@/lib/format';
export function WalkInButton({ className = '' }: { className?: string }) {
  const { data, toast, refresh } = useApp();
  const [open, setOpen] = useState(false),
    [doctorId, setDoctorId] = useState(''),
    [date, setDate] = useState(today()),
    [slots, setSlots] = useState<{ start: string; end: string }[]>([]),
    [busy, setBusy] = useState(false),
    [slotLoading, setSlotLoading] = useState(false),
    [slotError, setSlotError] = useState('');
  const user = data?.user;
  const role = user?.role;

  const clinicDoctors = (data?.doctors ?? []).filter((d) => {
    if (!d.verified) return false;
    if (role === 'doctor') return d.id === user?.id;
    if (user?.organizationId) {
      return d.organizationId === user.organizationId || d.clinicId === user.clinicId;
    }
    return true;
  });
  const doctors = clinicDoctors.length > 0 ? clinicDoctors : (data?.doctors?.filter((d) => d.verified) ?? []);

  useEffect(() => {
    if ((!doctorId || !doctors.some((d) => d.id === doctorId)) && doctors[0]) {
      setDoctorId(doctors[0].id);
    }
  }, [doctors, doctorId]);

  useEffect(() => {
    if (!open || !doctorId) return;
    let active = true;
    setSlotLoading(true);
    fetch(`/api/slots?doctorId=${doctorId}&date=${date}`)
      .then((r) => r.json())
      .then((j) => {
        if (active) {
          setSlots(j.data ?? []);
          setSlotError(j.success ? '' : j.error);
        }
      })
      .catch(() => {
        if (active) setSlotError('تعذر تحميل الفترات.');
      })
      .finally(() => {
        if (active) setSlotLoading(false);
      });
    return () => {
      active = false;
    };
  }, [doctorId, date, open]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      const r = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doctorId,
          start: form.get('start'),
          patientName: form.get('patientName'),
          phone: form.get('phone'),
          visitType: form.get('visitType'),
        }),
      });
      const j = await r.json();
      if (!j.success) {
        toast(j.error ?? 'تعذر إضافة الموعد.', true);
        return;
      }
      toast('تمت إضافة الموعد وتأكيده بنجاح');
      setOpen(false);
      await refresh();
    } catch {
      toast('تعذر الاتصال بالخادم.', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button className={className} onClick={() => setOpen(true)}>
        <Plus size={19} />
        موعد جديد
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="أضف موعدًا جديدًا"
        description="حجز هاتفي أو حضور مباشر، بكل بساطة."
      >
        {!['doctor', 'receptionist', 'clinic_owner', 'super_admin'].includes(role ?? '') ? (
          <>
            <div className="info-note">
              للحفاظ على فصل الصلاحيات، تُضاف الحجوزات المباشرة من حساب الطبيب أو موظف الاستقبال أو إدارة المركز.
            </div>
            <RoleLogin />
          </>
        ) : (
          <form onSubmit={submit}>
            <div className="form-grid">
              <Field label="اسم المريض">
                <input name="patientName" required minLength={2} placeholder="الاسم الكامل" />
              </Field>
              <Field label="رقم الهاتف">
                <input
                  name="phone"
                  required
                  minLength={7}
                  maxLength={25}
                  placeholder="+963 9…"
                  dir="ltr"
                />
              </Field>
            </div>
            <Field label="الطبيب المعالج">
              <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                {doctors.map((d) => (
                  <option value={d.id} key={d.id}>
                    {formatDoctorName(d.name)} — {d.specialty}
                  </option>
                ))}
              </select>
            </Field>
            <div className="form-grid">
              <Field label="تاريخ الموعد">
                <input
                  type="date"
                  min={today()}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </Field>
              <Field label="نوع الزيارة">
                <select name="visitType">
                  <option value="walk_in">حضور مباشر</option>
                  <option value="first_visit">كشف جديد / هاتفي</option>
                  <option value="follow_up">مراجعة</option>
                </select>
              </Field>
            </div>
            <Field label="الفترة المتاحة">
              <select name="start" required disabled={slotLoading || slots.length === 0}>
                <option value="">
                  {slotLoading
                    ? 'جارٍ تحميل الفترات…'
                    : slotError
                      ? slotError
                      : slots.length === 0
                        ? 'لا توجد فترات حجز متبقية لهذا اليوم'
                        : 'اختر الفترة المناسبة'}
                </option>
                {slots.map((s) => (
                  <option value={s.start} key={s.start}>
                    {time(s.start)} — {time(s.end)}
                  </option>
                ))}
              </select>
              {!slotLoading && slots.length === 0 && doctorId && (
                <small style={{ color: '#8a6414', display: 'block', marginTop: '6px' }}>
                  انتهت فترات العمل المتاحة لهذا اليوم ({date}). يرجى اختيار تاريخ عمل قادم (مثل الغد).
                </small>
              )}
            </Field>
            <div className="info-note">
              يُؤكّد الحجز المباشر فوراً، وتُحتسب الكشفية تلقائيًا من ملف الطبيب.
            </div>
            <Button
              type="submit"
              className="full-width"
              disabled={busy || slotLoading || !slots.length || !doctorId}
            >
              {busy ? (
                <>
                  <LoaderCircle size={18} className="spin" /> جارٍ إضافة وتأكيد الموعد...
                </>
              ) : (
                <>
                  <Check size={18} /> إضافة وتأكيد الموعد
                </>
              )}
            </Button>
          </form>
        )}
      </Modal>
    </>
  );
}
function RoleLogin() {
  const { login } = useApp();
  return (
    <Button className="full-width" onClick={() => login('receptionist')}>
      الدخول بحساب موظف الاستقبال <ArrowLeft size={18} />
    </Button>
  );
}
export function AppointmentTable({
  appointments,
  compact = false,
}: {
  appointments: Appointment[];
  compact?: boolean;
}) {
  const { data, act } = useApp();
  const [selected, setSelected] = useState<Appointment | null>(null),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [reject, setReject] = useState(false);
  const user = data?.user;
  const doAction = async (action: string, payload: unknown, msg: string) => {
    setBusy(true);
    const ok = await act(action, payload, msg);
    setBusy(false);
    if (ok) setSelected(null);
  };
  if (!appointments.length)
    return (
      <Empty title="لا توجد مواعيد في هذه القائمة" text="غيّر التصفية أو أضف موعدًا جديدًا." />
    );
  return (
    <>
      <div className="table-scroll">
        <table className="appointments-table">
          <thead>
            <tr>
              <th>المريض</th>
              {!compact && <th>الطبيب المعالج</th>}
              <th>الموعد</th>
              <th>نوع الزيارة</th>
              <th>الحالة</th>
              {!compact && <th>الكشفية</th>}
              <th aria-label="الإجراءات" />
            </tr>
          </thead>
          <tbody>
            {appointments.map((a) => {
              const d = data?.doctors.find((d) => d.id === a.doctorId);
              return (
                <tr key={a.id}>
                  <td>
                    <div className="patient-cell">
                      <Avatar
                        name={a.patientName}
                        color={
                          ['#e9e7f1', '#e0ebe5', '#f3e8de', '#e2eaf0'][a.patientName.length % 4]
                        }
                      />
                      <div>
                        <strong>{a.patientName}</strong>
                        <small>
                          {a.source === 'patient_portal' ? 'حجز إلكتروني' : 'حجز الاستقبال'}
                        </small>
                      </div>
                    </div>
                  </td>
                  {!compact && (
                    <td>
                      <div className="doctor-cell">
                        <strong>د. {d?.name ?? 'الطبيب'}</strong>
                        <small>{d?.specialty}</small>
                      </div>
                    </td>
                  )}
                  <td>
                    <strong className="table-time" dir="ltr">
                      {time(a.start)}
                    </strong>
                    <small>{dateLabel(a.start, true)}</small>
                  </td>
                  <td>
                    <span className="visit-type">
                      {a.visitType === 'follow_up'
                        ? 'مراجعة'
                        : a.visitType === 'walk_in'
                          ? 'حضور مباشر'
                          : 'كشف جديد'}
                    </span>
                  </td>
                  <td>
                    <Badge status={a.status} />
                  </td>
                  {!compact && (
                    <td>
                      <strong className="table-fee">${a.fee}</strong>
                      <small className={a.payment === 'paid_cash' ? 'green' : ''}>
                        {a.payment === 'paid_cash' ? 'مدفوع' : 'غير مدفوع'}
                      </small>
                    </td>
                  )}
                  <td>
                    <button
                      className="icon-button row-menu"
                      aria-label={`إجراءات موعد ${a.patientName}`}
                      onClick={() => {
                        setSelected(a);
                        setReject(false);
                        setReason('');
                      }}
                    >
                      <MoreHorizontal size={20} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? 'موعد ' + selected.patientName : 'الموعد'}
        description="إجراءات الموعد حسب دورك وحالته الحالية."
      >
        {selected && (
          <>
            <div className="summary-details">
              <span>
                <CalendarDays size={18} />
                {dateLabel(selected.start)}
              </span>
              <span>
                <Clock size={18} />
                {time(selected.start)}
              </span>
              <Badge status={selected.status} />
            </div>
            <div className="appointment-actions">
              {['doctor', 'receptionist'].includes(user?.role ?? '') && (
                <>
                  {selected.status === 'pending' && (
                    <>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          doAction(
                            'transition',
                            { id: selected.id, status: 'confirmed' },
                            'تم تأكيد الموعد',
                          )
                        }
                      >
                        <Check size={18} />
                        قبول وتأكيد الموعد
                      </Button>
                      <Button variant="outline" onClick={() => setReject(true)}>
                        <X size={18} />
                        رفض الطلب مع السبب
                      </Button>
                    </>
                  )}
                  {selected.status === 'confirmed' && (
                    <>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          doAction(
                            'transition',
                            { id: selected.id, status: 'checked_in' },
                            'تم تسجيل وصول المريض',
                          )
                        }
                      >
                        <UserCheck size={18} />
                        تسجيل وصول المريض
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy || new Date(selected.start) > new Date()}
                        onClick={() =>
                          doAction(
                            'transition',
                            { id: selected.id, status: 'no_show' },
                            'تم تسجيل عدم الحضور',
                          )
                        }
                      >
                        <Clock size={18} />
                        لم يحضر
                      </Button>
                      <Button variant="outline" onClick={() => setReject(true)}>
                        إلغاء الموعد
                      </Button>
                    </>
                  )}
                  {['confirmed', 'checked_in', 'completed'].includes(selected.status) &&
                    selected.payment === 'unpaid' && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          doAction('payment', { id: selected.id }, 'تم تسجيل التحصيل النقدي')
                        }
                      >
                        <Wallet size={18} />
                        تحصيل الكشفية نقدًا · ${selected.fee}
                      </Button>
                    )}
                </>
              )}
              {user?.role === 'doctor' &&
                ['confirmed', 'checked_in', 'completed'].includes(selected.status) && (
                  <Link href={`/workspace/patients/${selected.id}`} className="btn btn-primary">
                    <FileText size={18} />
                    فتح الملف وكتابة الوصفة
                  </Link>
                )}
              {user?.role === 'clinic_owner' && (
                <div className="info-note">
                  حساب المدير يعرض تفاصيل الموعد. الإجراءات السريرية وتسجيل الوصول متاحة للطبيب
                  وموظف الاستقبال.
                </div>
              )}
              {['cancelled', 'expired', 'rejected', 'no_show', 'completed'].includes(
                selected.status,
              ) && (
                <p className="muted">
                  هذا الموعد {selected.status === 'completed' ? 'مكتمل' : 'مغلق'}. {selected.reason}
                </p>
              )}
              {reject && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    doAction(
                      'transition',
                      {
                        id: selected.id,
                        status: selected.status === 'pending' ? 'rejected' : 'cancelled',
                        reason,
                      },
                      'تم تحديث حالة الموعد',
                    );
                  }}
                >
                  <Field label="سبب الإلغاء أو الرفض">
                    <textarea
                      required
                      minLength={2}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={3}
                    />
                  </Field>
                  <Submit busy={busy}>تأكيد الإجراء</Submit>
                </form>
              )}
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
