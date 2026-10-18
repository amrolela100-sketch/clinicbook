'use client';
import Link from 'next/link';
import { useState, useEffect, type FormEvent } from 'react';
import {
  Search,
  Plus,
  CalendarDays,
  Clock,
  Trash2,
  ArrowLeft,
  FileText,
  Printer,
  ShieldCheck,
  UserRound,
  HeartPulse,
  Check,
  ChevronDown,
  Star,
  X,
  AlertCircle,
  Palmtree,
  Save,
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
  time,
  dateLabel,
  dateKey,
  today,
} from './shared';
import { Button } from './ui/button';
import { Modal } from './ui/dialog';
import type { Shift, MedicalRecord, Appointment } from '@/lib/types';
import { formatDoctorName } from '@/lib/format';
export function SchedulePage() {
  const { data, act } = useApp();
  const doctors =
    data?.doctors.filter(
      (d) =>
        d.organizationId === data.user?.organizationId &&
        (data.user?.role !== 'doctor' || d.id === data.user.id),
    ) ?? [];
  const [doctorId, setDoctorId] = useState(doctors[0]?.id ?? ''),
    [shifts, setShifts] = useState<Shift[]>([]),
    [duration, setDuration] = useState(30),
    [busy, setBusy] = useState(false),
    [open, setOpen] = useState(false),
    [exStart, setExStart] = useState(''),
    [exEnd, setExEnd] = useState('');
  const editable = ['doctor', 'clinic_owner'].includes(data?.user?.role ?? '');
  useEffect(() => {
    const existing = data?.schedules[doctorId] ?? [];
    setShifts(
      Array.from({ length: 7 }, (_, day) =>
        existing.filter((s) => s.day === day).length
          ? existing.filter((s) => s.day === day)
          : [{ day, start: '09:00', end: '17:00', duration: 30, active: false }],
      ).flat(),
    );
    setDuration(existing[0]?.duration ?? 30);
  }, [doctorId]);
  const names = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const update = (idx: number, patch: Partial<Shift>) =>
    setShifts((s) => s.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  const affected =
    data?.appointments.filter(
      (a) =>
        a.doctorId === doctorId &&
        ['confirmed', 'checked_in', 'pending'].includes(a.status) &&
        exStart &&
        exEnd &&
        new Date(a.start) < new Date(exEnd + '+03:00') &&
        new Date(a.end) > new Date(exStart + '+03:00'),
    ).length ?? 0;
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await act(
      'schedule',
      { doctorId, shifts: shifts.map((s) => ({ ...s, duration })) },
      'تم تحديث جدول الدوام',
    );
    setBusy(false);
  }
  return (
    <>
      <PageHeading
        title="وقت منظّم، رعاية أفضل"
        description="اضبط ساعات العمل وفترات الراحة، لنجد لكل مريض الوقت المناسب."
      >
        <Button variant="outline" disabled={!editable} onClick={() => setOpen(true)}>
          <Palmtree size={18} />
          إضافة إجازة
        </Button>
      </PageHeading>
      <div className="schedule-layout">
        <section className="card">
          <CardHeading
            title="جدول الدوام الأسبوعي"
            subtitle="يُستخدم هذا الجدول لحساب الفترات المتاحة للحجز مباشرة."
          />
          <form onSubmit={save}>
            <div className="schedule-controls">
              <Field label="الطبيب">
                <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {formatDoctorName(d.name)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="مدة الموعد">
                <select
                  disabled={!editable}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                >
                  {[10, 15, 20, 30, 45, 60].map((n) => (
                    <option key={n} value={n}>
                      {n} دقيقة
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="schedule-week">
              {names.map((name, day) => {
                const rows = shifts
                  .map((s, i) => ({ ...s, index: i }))
                  .filter((s) => s.day === day);
                return (
                  <div className="schedule-day" key={day}>
                    <label className="schedule-day-name">
                      <input
                        type="checkbox"
                        role="switch"
                        disabled={!editable}
                        checked={rows.some((s) => s.active)}
                        onChange={(e) =>
                          setShifts((s) =>
                            s.map((v) => (v.day === day ? { ...v, active: e.target.checked } : v)),
                          )
                        }
                      />
                      <strong>{name}</strong>
                    </label>
                    <div className="schedule-shifts">
                      {rows.some((s) => s.active) ? (
                        rows.map((s) => (
                          <div className="shift-row" key={s.index}>
                            <span>من</span>
                            <input
                              aria-label={`بداية ${name}`}
                              type="time"
                              step="900"
                              disabled={!editable}
                              value={s.start}
                              onChange={(e) => update(s.index, { start: e.target.value })}
                            />
                            <span>إلى</span>
                            <input
                              aria-label={`نهاية ${name}`}
                              type="time"
                              step="900"
                              disabled={!editable}
                              value={s.end}
                              onChange={(e) => update(s.index, { end: e.target.value })}
                            />
                            {rows.length > 1 && (
                              <button
                                type="button"
                                className="icon-button"
                                aria-label="حذف الفترة"
                                disabled={!editable}
                                onClick={() => setShifts((v) => v.filter((_, i) => i !== s.index))}
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                        ))
                      ) : (
                        <span className="day-off">يوم راحة</span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="icon-button add-shift"
                      aria-label={`إضافة فترة ${name}`}
                      disabled={!editable || rows.length >= 3}
                      onClick={() =>
                        setShifts((s) => [
                          ...s,
                          { day, start: '18:00', end: '21:00', duration, active: true },
                        ])
                      }
                    >
                      <Plus size={17} />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="form-footer">
              <span className="muted">
                <Clock size={15} />
                جميع الأوقات بتوقيت دمشق
              </span>
              {editable && <Submit busy={busy}>حفظ جدول الدوام</Submit>}
            </div>
          </form>
        </section>
        <aside>
          <div className="schedule-note">
            <span className="soft-icon">
              <CalendarDays size={24} />
            </span>
            <h3>
              جدول مرن.
              <br />
              يوم أكثر توازنًا.
            </h3>
            <p>
              الفترات تُحسب مباشرة من أوقات العمل، بعد استبعاد المواعيد والإجازات. لا حاجة لإضافة كل
              موعد يدويًا.
            </p>
            <hr />
            <div>
              <ShieldCheck size={19} />
              <span>تُرفض فترات الدوام المتداخلة تلقائيًا.</span>
            </div>
          </div>
          <section className="card exception-list">
            <CardHeading title="الإجازات والاستثناءات" />
            {data?.exceptions.filter((e) => e.doctorId === doctorId).length ? (
              data.exceptions
                .filter((e) => e.doctorId === doctorId)
                .map((e) => (
                  <div className="exception-row" key={e.id}>
                    <Palmtree size={18} />
                    <div>
                      <strong>{e.reason}</strong>
                      <p>
                        {dateLabel(e.start)} — {dateLabel(e.end)}
                      </p>
                      <small>{e.affected} مواعيد تحتاج المتابعة</small>
                    </div>
                  </div>
                ))
            ) : (
              <Empty title="لا توجد إجازات مضافة" text="توازن العمل والراحة مهم أيضًا." />
            )}
          </section>
        </aside>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="مساحة للراحة"
        description="أضف إجازة للطبيب المحدد. المواعيد القائمة لا تُلغى تلقائيًا."
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const f = new FormData(e.currentTarget);
            const ok = await act(
              'exception',
              {
                doctorId,
                start: new Date(exStart + '+03:00').toISOString(),
                end: new Date(exEnd + '+03:00').toISOString(),
                reason: f.get('reason'),
              },
              'تم حفظ الإجازة. راجع المواعيد المتأثرة.',
            );
            setBusy(false);
            if (ok) setOpen(false);
          }}
        >
          <Field label="بداية الإجازة (دمشق)">
            <input
              type="datetime-local"
              required
              value={exStart}
              onChange={(e) => setExStart(e.target.value)}
            />
          </Field>
          <Field label="نهاية الإجازة (دمشق)">
            <input
              type="datetime-local"
              required
              value={exEnd}
              min={exStart}
              onChange={(e) => setExEnd(e.target.value)}
            />
          </Field>
          <Field label="السبب">
            <input name="reason" required minLength={2} placeholder="إجازة شخصية، مؤتمر طبي…" />
          </Field>
          <div className={affected ? 'warning-note' : 'info-note'}>
            {affected
              ? `تنبيه: ${affected} مواعيد نشطة تتقاطع مع الإجازة. تواصل مع المرضى وألغِها أو أعد ترتيبها يدويًا.`
              : 'لا توجد مواعيد نشطة متأثرة بالفترة المحددة.'}
          </div>
          <Submit busy={busy}>حفظ الإجازة</Submit>
        </form>
      </Modal>
    </>
  );
}
export function PatientsPage() {
  const { data } = useApp();
  const [query, setQuery] = useState('');
  const patients = [
    ...new Map(
      (data?.appointments ?? [])
        .slice()
        .reverse()
        .map((a) => [a.patientId ?? a.phone, a]),
    ).values(),
  ].filter((a) => a.patientName.includes(query) || a.phone.includes(query));
  return (
    <>
      <PageHeading
        title="وراء كل ملف، إنسان"
        description="تعرّف إلى مرضاك وتابع سجل زياراتهم بكل عناية."
      >
        <span className="date-chip">
          <UsersIcon />
          {patients.length} مرضى في سجلات المركز
        </span>
      </PageHeading>
      <section className="card">
        <div className="list-toolbar">
          <div className="input-icon">
            <Search size={18} />
            <input
              placeholder="ابحث عن مريض بالاسم أو الهاتف…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <span className="muted">البيانات معزولة حسب المركز والصلاحيات</span>
        </div>
        {patients.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>المريض</th>
                  <th>رقم الهاتف</th>
                  <th>عدد الزيارات</th>
                  <th>آخر موعد مسجل</th>
                  <th>الحالة</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {patients.map((a) => (
                  <tr key={a.patientId ?? a.id}>
                    <td>
                      <div className="patient-cell">
                        <Avatar name={a.patientName} />
                        <strong>{a.patientName}</strong>
                      </div>
                    </td>
                    <td dir="ltr">{a.phone || '—'}</td>
                    <td>
                      {
                        data?.appointments.filter((x) =>
                          x.patientId ? x.patientId === a.patientId : x.phone === a.phone,
                        ).length
                      }
                    </td>
                    <td>{dateLabel(a.start)}</td>
                    <td>
                      <Badge status={a.status} />
                    </td>
                    <td>
                      {data?.user?.role === 'doctor' ? (
                        <Link
                          className="btn btn-outline btn-sm"
                          href={`/workspace/patients/${a.id}`}
                        >
                          فتح الملف <ArrowLeft size={16} />
                        </Link>
                      ) : (
                        <span className="muted">
                          <ShieldCheck size={15} />
                          السجل الطبي للطبيب فقط
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="لم نجد مريضًا بهذا الاسم" />
        )}
      </section>
    </>
  );
}
function UsersIcon() {
  return <UserRound size={18} />;
}
export function MedicalPage({ id }: { id: string }) {
  const { data, act } = useApp();
  const a = data?.appointments.find((a) => a.id === id);
  const existing = data?.records.find((r) => r.appointmentId === id);
  const [form, setForm] = useState<MedicalRecord>(
      existing ?? {
        appointmentId: id,
        complaint: '',
        diagnosis: '',
        notes: '',
        medications: [],
        followUp: '',
        visible: true,
      },
    ),
    [busy, setBusy] = useState(false),
    [print, setPrint] = useState(false);
  if (!a) return <Empty title="الموعد غير موجود أو ليس ضمن صلاحياتك" />;
  const patch = (p: Partial<MedicalRecord>) => setForm((f) => ({ ...f, ...p }));
  return (
    <>
      <PageHeading
        title={`ملف ${a.patientName}`}
        description="رعاية موثقة، وتفاصيل تبقى مع المريض."
      >
        <Link className="btn btn-outline" href="/workspace/patients">
          <ArrowRightIcon />
          قائمة المرضى
        </Link>
        {existing && (
          <Button variant="outline" onClick={() => setPrint(true)}>
            <Printer size={18} />
            عرض الوصفة
          </Button>
        )}
      </PageHeading>
      <div className="medical-layout">
        <section className="card medical-form">
          <CardHeading
            title="المعاينة السريرية"
            subtitle="لا يُتاح هذا السجل إلا للطبيب المعالج والمريض وفق سياسة الظهور."
          />
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              await act('medical', form, 'حُفظ السجل الطبي وأُتمّت الزيارة');
              setBusy(false);
            }}
          >
            <Field label="الشكوى الرئيسية">
              <textarea
                rows={2}
                maxLength={1000}
                value={form.complaint}
                onChange={(e) => patch({ complaint: e.target.value })}
                placeholder="سبب زيارة المريض والأعراض الأساسية…"
              />
            </Field>
            <Field label="التشخيص">
              <textarea
                required
                minLength={2}
                maxLength={150}
                rows={2}
                value={form.diagnosis}
                onChange={(e) => patch({ diagnosis: e.target.value })}
                placeholder="اكتب التشخيص السريري…"
              />
            </Field>
            <div className="medications-heading">
              <h3>الوصفة الدوائية</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  patch({
                    medications: [
                      ...form.medications,
                      { name: '', dose: '', frequency: '', duration: '' },
                    ],
                  })
                }
              >
                <Plus size={17} />
                إضافة دواء
              </Button>
            </div>
            {form.medications.map((m, i) => (
              <div className="medication-row" key={i}>
                {[
                  { key: 'name', label: 'اسم الدواء' },
                  { key: 'dose', label: 'الجرعة' },
                  { key: 'frequency', label: 'التكرار' },
                  { key: 'duration', label: 'المدة' },
                ].map((f) => (
                  <Field key={f.key} label={f.label}>
                    <input
                      required
                      minLength={2}
                      value={m[f.key as keyof typeof m]}
                      onChange={(e) =>
                        patch({
                          medications: form.medications.map((v, n) =>
                            n === i ? { ...v, [f.key]: e.target.value } : v,
                          ),
                        })
                      }
                    />
                  </Field>
                ))}
                <button
                  className="icon-button"
                  type="button"
                  aria-label="حذف الدواء"
                  onClick={() => patch({ medications: form.medications.filter((_, n) => n !== i) })}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
            {!form.medications.length && (
              <div className="medication-empty">لا توجد أدوية مضافة. أضف دواءً عند الحاجة.</div>
            )}
            <Field label="ملاحظات الطبيب للمريض">
              <textarea
                rows={3}
                maxLength={3000}
                value={form.notes}
                onChange={(e) => patch({ notes: e.target.value })}
              />
            </Field>
            <Field label="تاريخ المراجعة المقترح (اختياري)">
              <input
                type="date"
                value={form.followUp}
                onChange={(e) => patch({ followUp: e.target.value })}
              />
            </Field>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={form.visible}
                onChange={(e) => patch({ visible: e.target.checked })}
              />
              إتاحة التشخيص والوصفة للمريض
            </label>
            {new Date(a.start) > new Date() && (
              <div className="warning-note">لا يمكن إتمام الزيارة قبل وقت بدايتها.</div>
            )}
            <div className="form-footer">
              <Submit busy={busy || new Date(a.start) > new Date()}>حفظ وإتمام الزيارة</Submit>
            </div>
          </form>
        </section>
        <aside>
          <section className="card patient-summary">
            <Avatar name={a.patientName} size="lg" />
            <h2>{a.patientName}</h2>
            <Badge status={a.status} />
            <hr />
            <div>
              <span>موعد الزيارة</span>
              <strong>
                {dateLabel(a.start)} · {time(a.start)}
              </strong>
            </div>
            <div>
              <span>نوع الزيارة</span>
              <strong>{a.visitType === 'follow_up' ? 'مراجعة' : 'كشف جديد'}</strong>
            </div>
            <div>
              <span>الهاتف</span>
              <strong dir="ltr">{a.phone || 'غير مسجل'}</strong>
            </div>
          </section>
          <section className="card visit-history">
            <CardHeading title="الزيارات السابقة" />
            {data?.appointments
              .filter(
                (v) => v.patientId === a.patientId && v.id !== a.id && v.status === 'completed',
              )
              .slice(-4)
              .reverse()
              .map((v) => (
                <Link key={v.id} href={`/workspace/patients/${v.id}`}>
                  <span>
                    <CalendarDays size={16} />
                    {dateLabel(v.start)}
                  </span>
                  <ArrowLeft size={15} />
                </Link>
              ))}
          </section>
        </aside>
      </div>
      <Modal
        wide
        open={print}
        onClose={() => setPrint(false)}
        title="الوصفة الطبية"
        description="استخدم الطباعة لحفظ نسخة PDF من المتصفح."
      >
        {existing && <Prescription appointment={a} record={existing} />}
      </Modal>
    </>
  );
}
function ArrowRightIcon() {
  return <ArrowLeft size={17} style={{ transform: 'rotate(180deg)' }} />;
}
export function Prescription({
  appointment: a,
  record: r,
}: {
  appointment: Appointment;
  record: MedicalRecord;
}) {
  const { data } = useApp();
  const d = data?.doctors.find((d) => d.id === a.doctorId);
  return (
    <>
      <div className="prescription-paper" id="prescription">
        <div className="prescription-head">
          <div>
            <h2>{formatDoctorName(d?.name)}</h2>
            <p>
              {d?.specialty} · {d?.clinic}
            </p>
          </div>
          <span className="prescription-symbol">℞</span>
        </div>
        <div className="prescription-patient">
          <strong>المريض: {a.patientName}</strong>
          <span>{dateLabel(a.start)}</span>
        </div>
        <h3>التشخيص</h3>
        <p>{r.diagnosis}</p>
        <h3>الأدوية الموصوفة</h3>
        {r.medications.length ? (
          <table>
            <thead>
              <tr>
                <th>الدواء</th>
                <th>الجرعة</th>
                <th>التكرار</th>
                <th>المدة</th>
              </tr>
            </thead>
            <tbody>
              {r.medications.map((m, i) => (
                <tr key={i}>
                  <td>{m.name}</td>
                  <td>{m.dose}</td>
                  <td>{m.frequency}</td>
                  <td>{m.duration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>لا توجد أدوية موصوفة.</p>
        )}
        {r.notes && (
          <>
            <h3>تعليمات الطبيب</h3>
            <p>{r.notes}</p>
          </>
        )}
        {r.followUp && <p>المراجعة المقترحة: {r.followUp}</p>}
        <div className="prescription-foot">ClinicBook · وثيقة طبية معتمدة إلكترونياً من المركز الطبي</div>
      </div>
      <Button onClick={() => window.print()} className="full-width no-print">
        <Printer size={18} />
        طباعة / حفظ PDF
      </Button>
    </>
  );
}
export function MyAppointments() {
  const { data, act } = useApp();
  const [tab, setTab] = useState('upcoming'),
    [review, setReview] = useState<Appointment | null>(null),
    [rating, setRating] = useState(5),
    [comment, setComment] = useState(''),
    [print, setPrint] = useState<Appointment | null>(null),
    [cancel, setCancel] = useState<Appointment | null>(null),
    [busy, setBusy] = useState(false);
  const upcoming = (data?.appointments ?? []).filter((a) =>
    ['pending', 'confirmed', 'checked_in'].includes(a.status),
  );
  const history = (data?.appointments ?? []).filter(
    (a) => !['pending', 'confirmed', 'checked_in'].includes(a.status),
  );
  const list = tab === 'upcoming' ? upcoming : history;
  return (
    <div className="public-container my-appointments">
      <PageHeading
        eyebrow="مساحتك الشخصية"
        title={`أهلاً ${data?.user?.name.split(' ')[0]}، صحتك أولاً.`}
        description="مواعيدك، تفاصيل زياراتك، ووصفاتك. كلها قريبة منك."
      >
        <Link href="/search" className="btn btn-primary">
          <Plus size={18} />
          احجز موعدًا جديدًا
        </Link>
      </PageHeading>
      <div className="patient-tabs">
        <button className={tab === 'upcoming' ? 'selected' : ''} onClick={() => setTab('upcoming')}>
          <CalendarDays size={18} />
          المواعيد القادمة <span>{upcoming.length}</span>
        </button>
        <button className={tab === 'history' ? 'selected' : ''} onClick={() => setTab('history')}>
          <FileText size={18} />
          سجل الزيارات والوصفات <span>{history.length}</span>
        </button>
      </div>
      <div className="patient-appointments-list">
        {list.length ? (
          list
            .slice()
            .reverse()
            .map((a) => {
              const d = data?.doctors.find((d) => d.id === a.doctorId),
                r = data?.records.find((r) => r.appointmentId === a.id);
              const reviewed = data?.reviews.some((r) => r.appointmentId === a.id);
              const canCancel =
                a.status === 'pending' ||
                (a.status === 'confirmed' &&
                  new Date(a.start).getTime() - Date.now() >= (d?.cancelHours ?? 2) * 3600000);
              return (
                <article className="card patient-appointment" key={a.id}>
                  <div className="patient-appt-doctor">
                    <Avatar name={d?.name ?? ''} image={d?.image} size="lg" />
                    <div>
                      <Badge status={a.status} />
                      <h3>{formatDoctorName(d?.name)}</h3>
                      <p>
                        {d?.specialty} · {d?.clinic}
                      </p>
                    </div>
                    <strong className="patient-appt-fee">
                      ${a.fee}
                      <small>الكشفية</small>
                    </strong>
                  </div>
                  <div className="patient-appt-info">
                    <span>
                      <CalendarDays size={18} />
                      {dateLabel(a.start)}
                    </span>
                    <span>
                      <Clock size={18} />
                      {time(a.start)} – {time(a.end)}
                    </span>
                    <span>{a.visitType === 'follow_up' ? 'مراجعة' : 'كشف جديد'}</span>
                  </div>
                  {a.status === 'pending' && a.expiresAt && <Countdown expiresAt={a.expiresAt} />}
                  <div className="patient-appt-actions">
                    {canCancel && (
                      <Button variant="outline" onClick={() => setCancel(a)}>
                        <X size={17} />
                        إلغاء الموعد
                      </Button>
                    )}
                    {a.status === 'confirmed' && !canCancel && (
                      <span className="muted">انتهت مهلة الإلغاء الذاتي. تواصل مع العيادة.</span>
                    )}
                    {a.status === 'completed' && (
                      <>
                        <Button variant="outline" disabled={!r} onClick={() => setPrint(a)}>
                          <FileText size={17} />
                          {r ? 'عرض الوصفة الطبية' : 'لم تُصدر وصفة بعد'}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={reviewed}
                          onClick={() => {
                            setReview(a);
                            setComment('');
                            setRating(5);
                          }}
                        >
                          <Star size={17} />
                          {reviewed ? 'تم تقييم الزيارة' : 'قيّم تجربتك'}
                        </Button>
                      </>
                    )}
                    <span className="patient-appt-ref" dir="ltr">
                      #{a.id.slice(0, 8).toUpperCase()}
                    </span>
                  </div>
                </article>
              );
            })
        ) : (
          <Empty
            title="مساحة لموعدك القادم"
            text="ابدأ بالبحث عن الطبيب المناسب، وسنحتفظ بتفاصيل موعدك هنا."
          >
            <Link className="btn btn-primary" href="/search">
              اكتشف الأطباء <ArrowLeft size={17} />
            </Link>
          </Empty>
        )}
      </div>
      <Modal
        open={!!review}
        onClose={() => setReview(null)}
        title="كيف كانت تجربتك؟"
        description="رأيك يساعد الآخرين على اختيار الرعاية المناسبة."
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            if (
              await act(
                'review',
                { appointmentId: review!.id, rating, comment },
                'شكرًا لمشاركة تجربتك',
              )
            )
              setReview(null);
            setBusy(false);
          }}
        >
          <div className="review-stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button type="button" key={n} aria-label={`${n} نجوم`} onClick={() => setRating(n)}>
                <Star size={36} fill={n <= rating ? 'currentColor' : 'none'} />
              </button>
            ))}
          </div>
          <Field label="شاركنا التفاصيل (اختياري)">
            <textarea
              rows={3}
              maxLength={1000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </Field>
          <Submit busy={busy}>نشر التقييم</Submit>
        </form>
      </Modal>
      <Modal
        open={!!cancel}
        onClose={() => setCancel(null)}
        title="هل ترغب بإلغاء الموعد؟"
        description="ستُتاح هذه الفترة لمريض آخر بعد الإلغاء."
      >
        <div className="info-note">يمكنك الحجز مرة أخرى في أي وقت من الفترات المتاحة.</div>
        <Button
          variant="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            if (await act('transition', { id: cancel!.id, status: 'cancelled' }, 'تم إلغاء الموعد'))
              setCancel(null);
            setBusy(false);
          }}
        >
          تأكيد إلغاء الموعد
        </Button>
      </Modal>
      <Modal
        wide
        open={!!print}
        onClose={() => setPrint(null)}
        title="وصفتك الطبية"
        description="يمكنك طباعة الوصفة أو حفظها PDF."
      >
        {print && data?.records.find((r) => r.appointmentId === print.id) && (
          <Prescription
            appointment={print}
            record={data.records.find((r) => r.appointmentId === print.id)!}
          />
        )}
      </Modal>
    </div>
  );
}
function Countdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState('');
  useEffect(() => {
    const update = () => {
      const ms = Math.max(0, new Date(expiresAt).getTime() - Date.now());
      setRemaining(
        `${Math.floor(ms / 3600000)}:${String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0')}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`,
      );
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return (
    <div className="pending-countdown">
      <Clock size={16} />
      بانتظار تأكيد العيادة · تنتهي المهلة خلال <strong dir="ltr">{remaining}</strong>
    </div>
  );
}
