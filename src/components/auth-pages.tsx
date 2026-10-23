'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  UserRound,
  Stethoscope,
  ShieldCheck,
  Check,
  Mail,
  LockKeyhole,
  UsersRound,
  CalendarDays,
  LoaderCircle,
  Phone,
} from 'lucide-react';
import { useApp } from './app-provider';
import { Logo, Field, Submit } from './shared';
import { Button } from './ui/button';

export function Login() {
  const { login, signup, toast } = useApp();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState('');

  // Sign In fields
  const [signInEmail, setSignInEmail] = useState('');
  const [signInPassword, setSignInPassword] = useState('');

  // Sign Up fields
  const [fullName, setFullName] = useState('');
  const [signUpEmail, setSignUpEmail] = useState('');
  const [signUpPhone, setSignUpPhone] = useState('');
  const [signUpPassword, setSignUpPassword] = useState('');
  const [signUpRole, setSignUpRole] = useState<'patient' | 'clinic_owner'>('patient');

  async function handleSignIn(e: FormEvent) {
    e.preventDefault();
    if (!signInEmail || !signInPassword) {
      toast('يرجى إدخال البريد الإلكتروني وكلمة المرور.', true);
      return;
    }
    setBusy(true);
    try {
      await login({ email: signInEmail, password: signInPassword });
    } finally {
      setBusy(false);
    }
  }

  async function handleSignUp(e: FormEvent) {
    e.preventDefault();
    if (!fullName.trim() || !signUpEmail.trim() || !signUpPassword) {
      toast('يرجى ملء جميع الحقول المطلوبة.', true);
      return;
    }
    if (signUpPassword.length < 6) {
      toast('كلمة المرور يجب أن تكون 6 خانات على الأقل.', true);
      return;
    }
    setBusy(true);
    try {
      await signup({
        fullName: fullName.trim(),
        email: signUpEmail.trim(),
        password: signUpPassword,
        phone: signUpPhone.trim() || undefined,
        intent: signUpRole,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-layout">
      <div className="auth-form-side">
        <Link className="auth-back" href="/">
          <ArrowRight size={17} />
          العودة للرئيسية
        </Link>
        <div className="auth-form-wrap">
          <Logo />

          <div className="auth-tab-group" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signin'}
              className={`auth-tab-btn ${mode === 'signin' ? 'active' : ''}`}
              onClick={() => setMode('signin')}
            >
              تسجيل الدخول
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              className={`auth-tab-btn ${mode === 'signup' ? 'active' : ''}`}
              onClick={() => setMode('signup')}
            >
              حساب جديد
            </button>
          </div>

          {mode === 'signin' ? (
            <>
              <span className="eyebrow">سعداء بعودتك</span>
              <h1>
                مكانك هنا.
                <br />
                ورعايتك تبدأ من هنا.
              </h1>
              <p>سجّل الدخول إلى حسابك أو استكشف مساحات العمل.</p>

              <form onSubmit={handleSignIn}>
                <Field label="البريد الإلكتروني">
                  <div className="input-icon">
                    <Mail size={18} />
                    <input
                      type="email"
                      required
                      value={signInEmail}
                      onChange={(e) => setSignInEmail(e.target.value)}
                      placeholder="you@example.com"
                      dir="ltr"
                    />
                  </div>
                </Field>
                <Field label="كلمة المرور">
                  <div className="input-icon">
                    <LockKeyhole size={18} />
                    <input
                      type="password"
                      required
                      value={signInPassword}
                      onChange={(e) => setSignInPassword(e.target.value)}
                      placeholder="••••••••"
                      dir="ltr"
                    />
                  </div>
                </Field>
                <Button className="full-width" variant="default" type="submit" disabled={busy}>
                  {busy ? <LoaderCircle className="spin" size={17} /> : <ArrowLeft size={17} />}
                  {busy ? 'جارٍ تسجيل الدخول...' : 'تسجيل الدخول'}
                </Button>
              </form>
            </>
          ) : (
            <>
              <span className="eyebrow">انضم إلى كلينك بوك</span>
              <h1>
                رعايتك الصحية،
                <br />
                تبدأ من حسابك.
              </h1>
              <p>أنشئ حسابك لإدارة مواعيدك وسجلاتك الطبية أو لتسجيل مركزك.</p>

              <div className="demo-role-grid" style={{ marginBottom: '1rem' }}>
                <button
                  type="button"
                  className={signUpRole === 'patient' ? 'selected' : ''}
                  onClick={() => setSignUpRole('patient')}
                  style={{ border: signUpRole === 'patient' ? '2px solid var(--primary)' : undefined }}
                >
                  <UserRound size={20} strokeWidth={1.6} />
                  <span>مريض</span>
                </button>
                <button
                  type="button"
                  className={signUpRole === 'clinic_owner' ? 'selected' : ''}
                  onClick={() => setSignUpRole('clinic_owner')}
                  style={{ border: signUpRole === 'clinic_owner' ? '2px solid var(--primary)' : undefined }}
                >
                  <Building2 size={20} strokeWidth={1.6} />
                  <span>عيادة أو مركز طبي</span>
                </button>
              </div>

              <form onSubmit={handleSignUp}>
                <Field label="الاسم الكامل">
                  <div className="input-icon">
                    <UserRound size={18} />
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="مثال: أحمد الحلبي"
                    />
                  </div>
                </Field>
                <Field label="رقم الهاتف (اختياري)">
                  <div className="input-icon">
                    <Phone size={18} />
                    <input
                      type="tel"
                      value={signUpPhone}
                      onChange={(e) => setSignUpPhone(e.target.value)}
                      placeholder="09xxxxxxxx"
                      dir="ltr"
                    />
                  </div>
                </Field>
                <Field label="البريد الإلكتروني">
                  <div className="input-icon">
                    <Mail size={18} />
                    <input
                      type="email"
                      required
                      value={signUpEmail}
                      onChange={(e) => setSignUpEmail(e.target.value)}
                      placeholder="you@example.com"
                      dir="ltr"
                    />
                  </div>
                </Field>
                <Field label="كلمة المرور" hint="6 أحرف أو أرقام على الأقل">
                  <div className="input-icon">
                    <LockKeyhole size={18} />
                    <input
                      type="password"
                      required
                      value={signUpPassword}
                      onChange={(e) => setSignUpPassword(e.target.value)}
                      placeholder="••••••••"
                      dir="ltr"
                    />
                  </div>
                </Field>
                <Button className="full-width" variant="default" type="submit" disabled={busy}>
                  {busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}
                  {busy ? 'جارٍ إنشاء الحساب...' : 'إنشاء حساب'}
                </Button>
              </form>
            </>
          )}

          <div className="demo-login-panel">
            <div className="demo-login-heading">
              <span className="live-dot" />
              <strong>تسجيل الدخول السريع للأدوار</strong>
              <span>الوصول المباشر للمنظومة</span>
            </div>
            <p>اختر حسابك المعتمد للانتقال المباشر إلى مساحة العمل الخاصة بك.</p>
            <div className="demo-role-grid">
              {[
                { role: 'clinic_owner', label: 'مدير المركز', icon: Building2 },
                { role: 'doctor', label: 'طبيب', icon: Stethoscope },
                { role: 'receptionist', label: 'الاستقبال', icon: UsersRound },
                { role: 'patient', label: 'مريض', icon: UserRound },
                { role: 'super_admin', label: 'مدير المنصة', icon: ShieldCheck },
              ].map((r) => (
                <button
                  key={r.role}
                  disabled={busy || !!demoBusy}
                  onClick={() => {
                    setDemoBusy(r.role);
                    login(r.role).finally(() => setDemoBusy(''));
                  }}
                >
                  {demoBusy === r.role ? (
                    <LoaderCircle className="spin" size={20} />
                  ) : (
                    <r.icon size={20} strokeWidth={1.6} />
                  )}
                  <span>{r.label}</span>
                  <ArrowUpLeftIcon />
                </button>
              ))}
            </div>
          </div>
          <p className="auth-bottom">
            هل تدير عيادة أو مركزًا طبيًا؟ <Link href="/register-clinic">ابدأ رحلتك معنا</Link>
          </p>
        </div>
      </div>
      <div className="auth-art-side">
        <img src="/images/care-editorial.jpg" alt="رعاية طبية إنسانية متكاملة" />
        <div className="auth-art-overlay">
          <span>أكثر من مجرد موعد.</span>
          <h2>
            تفاصيل أقل.
            <br />
            وقت أكثر للرعاية.
          </h2>
          <p>
            مساحة تجمع الطبيب والمريض،
            <br />
            وتترك للاهتمام الإنساني المساحة الأكبر.
          </p>
          <div className="auth-art-caption">
            <span className="brandmark">
              <i />
              <i />
              <i />
              <i />
            </span>
            <span dir="ltr">clinicbook</span>
          </div>
        </div>
      </div>
    </div>
  );
}
function ArrowUpLeftIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M17 17 7 7m0 10V7h10" />
    </svg>
  );
}
export function Onboarding() {
  const { act, data } = useApp();
  const authUser = data?.user;
  const [step, setStep] = useState(1),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const [form, setForm] = useState({
    name: '',
    city: 'دمشق',
    district: '',
    phone: '',
    doctorName: authUser?.name ?? '',
    email: authUser?.email ?? '',
    license: '',
    tier: 'clinic_pro',
  });
  const change = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (step < 3) {
      setStep(step + 1);
      return;
    }
    setBusy(true);
    if (await act('onboard', form, 'تم إنشاء المركز وإرسال طلب الاعتماد')) setDone(true);
    setBusy(false);
  }
  return (
    <div className="onboarding-page public-container">
      <div className="onboarding-intro">
        <span className="eyebrow">لرعاية تستحق التنظيم</span>
        <h1>
          مركزك الطبي،
          <br />
          <span>بداية جديدة.</span>
        </h1>
        <p>
          لنجهّز مساحة عمل تناسبك.
          <br />
          ثلاث خطوات بسيطة، وفترة تجريبية لمدة 14 يومًا.
        </p>
        <div className="onboarding-benefits">
          {[
            'كل المواعيد في تقويم واحد',
            'مساحة خاصة لكل عضو في الفريق',
            'ملفات طبية ووصفات أكثر تنظيمًا',
          ].map((s) => (
            <span key={s}>
              <Check size={17} />
              {s}
            </span>
          ))}
        </div>
        <div className="onboarding-note">
          <ShieldCheck size={24} />
          <p>
            تبدأ رحلة اعتماد المركز بمراجعة الترخيص.
            <br />
            لن يظهر الأطباء في البحث قبل الاعتماد.
          </p>
        </div>
      </div>
      <div className="onboarding-form card">
        {done ? (
          <div className="onboarding-success">
            <span className="success-illustration">
              <Check size={50} />
            </span>
            <h2>أهلاً بمركزك في كلينك بوك</h2>
            <p>
              تم حفظ بيانات مركزك بنجاح وأُرسلت للمراجعة والاعتماد. يمكنك الآن البدء في تهيئة مساحة عملك
              وإدارة العيادة.
            </p>
            <Link href="/workspace/dashboard" className="btn btn-primary full-width">
              انتقل لمساحة العمل <ArrowLeft size={18} />
            </Link>
            <small>نظام سحابي آمن ومحمي · متوافق مع معايير الرعاية الصحية</small>
          </div>
        ) : (
          <>
            <div className="onboarding-steps">
              {['المركز', 'الطبيب', 'الباقة'].map((s, i) => (
                <div className={step >= i + 1 ? 'active' : ''} key={s}>
                  <span>{step > i + 1 ? <Check size={16} /> : i + 1}</span>
                  {s}
                </div>
              ))}
            </div>
            <h2>
              {step === 1
                ? 'لنتعرف إلى مركزك'
                : step === 2
                  ? 'الرعاية تبدأ بفريقك'
                  : 'اختر مساحة تناسب طموحك'}
            </h2>
            <p className="muted">
              {step === 1
                ? 'أخبرنا عن المكان الذي تصنع فيه الفرق.'
                : step === 2
                  ? 'بيانات الطبيب الأول والترخيص الطبي.'
                  : 'يمكنك طلب تغيير الباقة لاحقًا من مساحة العمل.'}
            </p>
            <form onSubmit={submit}>
              {step === 1 ? (
                <>
                  <Field label="اسم المركز أو العيادة">
                    <input
                      required
                      minLength={2}
                      value={form.name}
                      onChange={(e) => change('name', e.target.value)}
                      placeholder="مثل: مركز الحياة الطبي"
                    />
                  </Field>
                  <div className="form-grid">
                    <Field label="المدينة">
                      <select value={form.city} onChange={(e) => change('city', e.target.value)}>
                        <option>دمشق</option>
                        <option>حلب</option>
                        <option>حمص</option>
                        <option>اللاذقية</option>
                      </select>
                    </Field>
                    <Field label="الحي">
                      <input
                        required
                        minLength={2}
                        value={form.district}
                        onChange={(e) => change('district', e.target.value)}
                      />
                    </Field>
                  </div>
                  <Field label="هاتف المركز">
                    <input
                      dir="ltr"
                      required
                      minLength={7}
                      maxLength={25}
                      value={form.phone}
                      onChange={(e) => change('phone', e.target.value)}
                      placeholder="+963"
                    />
                  </Field>
                </>
              ) : step === 2 ? (
                <>
                  <Field label="اسم الطبيب الكامل">
                    <input
                      required
                      minLength={2}
                      value={form.doctorName}
                      onChange={(e) => change('doctorName', e.target.value)}
                    />
                  </Field>
                  <Field label="البريد الإلكتروني للمدير">
                    <input
                      required
                      type="email"
                      dir="ltr"
                      value={form.email}
                      onChange={(e) => change('email', e.target.value)}
                      readOnly={!!authUser}
                      style={authUser ? { opacity: 0.7, cursor: 'not-allowed' } : undefined}
                    />
                  </Field>
                  <Field label="رقم الترخيص الطبي">
                    <input
                      required
                      minLength={2}
                      value={form.license}
                      onChange={(e) => change('license', e.target.value)}
                      placeholder="رقم الترخيص النقابي أو الوزاري"
                    />
                  </Field>
                  <div className="info-note">
                    يُنشأ حساب مستقل للمدير. تتطلب بيانات الطبيب الاعتماد قبل إتاحة الحجز.
                  </div>
                </>
              ) : (
                <>
                  <div className="onboarding-plans">
                    {[
                      {
                        key: 'solo_starter',
                        name: 'Solo Starter',
                        subtitle: 'لعيادتك الفردية',
                        fee: 19,
                        text: 'طبيب واحد · فرع واحد · حجز إلكتروني',
                      },
                      {
                        key: 'clinic_pro',
                        name: 'Clinic Pro',
                        subtitle: 'لمركزك المتكامل',
                        fee: 59,
                        text: '10 أطباء · 3 فروع · فريق استقبال · ملفات طبية',
                      },
                    ].map((p) => (
                      <label key={p.key} className={form.tier === p.key ? 'selected' : ''}>
                        <input
                          type="radio"
                          checked={form.tier === p.key}
                          onChange={() => change('tier', p.key)}
                        />
                        <div>
                          <span>{p.subtitle}</span>
                          <h3 dir="ltr">{p.name}</h3>
                          <p>{p.text}</p>
                        </div>
                        <strong>
                          ${p.fee}
                          <small>/شهر*</small>
                        </strong>
                      </label>
                    ))}
                  </div>
                  <div className="info-note">
                    فترة تجربة مجانية لمدة 14 يومًا بدون الحاجة لبطاقة ائتمانية. تحكم كامل بالباقات وإدارتها في أي وقت.
                  </div>
                </>
              )}
              <div className="form-footer">
                {step > 1 && (
                  <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
                    <ArrowRight size={17} />
                    السابق
                  </Button>
                )}
                <Button type="submit" disabled={busy}>
                  {busy ? (
                    <LoaderCircle size={18} className="spin" />
                  ) : step === 3 ? (
                    <Check size={18} />
                  ) : null}
                  {step === 3 ? 'إنشاء المركز وإرسال الاعتماد' : 'الخطوة التالية'}
                  {step < 3 && <ArrowLeft size={18} />}
                </Button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
