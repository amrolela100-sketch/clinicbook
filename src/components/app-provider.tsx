'use client';
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import type { User, Doctor, Appointment, MedicalRecord, Shift } from '@/lib/types';
import type { Organization } from '@/lib/services/booking-service';
import { startAppDataRevalidation } from '@/lib/app-data-revalidation';
export type AppData = {
  user: User | null;
  doctors: Doctor[];
  appointments: Appointment[];
  records: MedicalRecord[];
  organization: Organization | null;
  team: User[];
  branches: {
    id: string;
    organizationId: string;
    name: string;
    city: string;
    district: string;
    phone: string;
  }[];
  references: { id: string; name: string; type: string }[];
  notifications: { id: string; title: string; body: string; read: boolean; createdAt: string }[];
  schedules: Record<string, Shift[]>;
  exceptions: {
    id: string;
    doctorId: string;
    start: string;
    end: string;
    reason: string;
    affected: number;
  }[];
  reviews: {
    appointmentId: string;
    doctorId: string;
    rating: number;
    comment: string;
    name: string;
  }[];
  billingRequests: { id: string; tier: string; status: string; createdAt: string }[];
  admin: {
    organizations: Organization[];
    verifications: {
      id: string;
      name: string;
      type: string;
      city: string;
      license: string;
      status: string;
    }[];
    references: { id: string; name: string; type: string }[];
    audit: { id: string; action: string; created_at: string; entity_id: string }[];
  } | null;
};
interface AppContext {
  data: AppData | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  toast: (message: string, error?: boolean) => void;
  act: (action: string, payload: unknown, message?: string) => Promise<boolean>;
  login: (
    roleOrCredentials: string | { email: string; password: string },
    destination?: string,
  ) => Promise<boolean>;
  signup: (
    payload: {
      fullName: string;
      email: string;
      password: string;
      phone?: string;
      intent?: 'patient' | 'clinic_owner';
    },
    destination?: string,
  ) => Promise<boolean>;
  logout: () => Promise<void>;
}
const Ctx = createContext<AppContext>(null!);
export const useApp = () => useContext(Ctx);
export function AppProvider({
  children,
  initialData = null,
}: {
  children: ReactNode;
  initialData?: AppData | null;
}) {
  const refreshVersion = useRef(0);
  const refreshAbort = useRef<AbortController | null>(null);
  const etag = useRef<string | null>(null);
  const bootstrapped = useRef(initialData !== null);
  const [data, setData] = useState<AppData | null>(initialData),
    [loading, setLoading] = useState(initialData === null),
    [error, setError] = useState(''),
    [toasts, setToasts] = useState<{ id: number; message: string; error: boolean }[]>([]);
  const toast = useCallback((message: string, error = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    refreshAbort.current?.abort();
    const controller = new AbortController();
    refreshAbort.current = controller;
    try {
      const r = await fetch('/api/data', {
        cache: 'no-store',
        signal: controller.signal,
        headers: etag.current ? { 'If-None-Match': etag.current } : undefined,
      });
      if (version !== refreshVersion.current) return;
      if (r.status === 304) {
        setError('');
        return;
      }
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error();
      if (version !== refreshVersion.current) return;
      etag.current = r.headers.get('etag');
      setData(j.data);
      setError('');
    } catch {
      if (version !== refreshVersion.current || controller.signal.aborted) return;
      setError('تعذر تحميل البيانات. تحقق من الاتصال وحاول مجدداً.');
    } finally {
      if (version === refreshVersion.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!bootstrapped.current) void refresh();
    return () => {
      refreshVersion.current += 1;
      refreshAbort.current?.abort();
    };
  }, [refresh]);
  const updateUser = data?.user ?? null;
  useEffect(
    () => startAppDataRevalidation(updateUser, refresh),
    [refresh, updateUser?.id, updateUser?.role, updateUser?.organizationId, updateUser?.clinicId],
  );
  const act = async (action: string, payload: unknown, message = 'تم حفظ التغييرات بنجاح') => {
    try {
      const r = await fetch('/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload }),
      });
      const j = await r.json();
      if (!r.ok || !j.success) {
        toast(j.error ?? 'تعذر إتمام الإجراء.', true);
        return false;
      }
      toast(message);
      await refresh();
      return true;
    } catch {
      toast('تعذر الاتصال بالخادم، حاول مجدداً.', true);
      return false;
    }
  };
  const login = async (
    roleOrCredentials: string | { email: string; password: string },
    destination?: string,
  ) => {
    try {
      const payload =
        typeof roleOrCredentials === 'string'
          ? { role: roleOrCredentials }
          : { email: roleOrCredentials.email, password: roleOrCredentials.password };

      const r = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!j.success) {
        toast(j.error ?? 'تعذر تسجيل الدخول.', true);
        return false;
      }
      const userRole = j.data?.role;
      const orgId = j.data?.organizationId;
      let targetUrl = j.redirectTo;
      if (
        destination &&
        destination.startsWith('/') &&
        !destination.startsWith('//') &&
        !destination.includes('\\')
      ) {
        if (
          userRole === 'patient' &&
          (destination.startsWith('/workspace') || destination.startsWith('/admin'))
        ) {
          targetUrl = '/my-appointments';
        } else if (userRole === 'clinic_owner' && !orgId) {
          targetUrl = '/register-clinic?onboarding=1';
        } else {
          targetUrl = destination;
        }
      }
      window.location.href =
        targetUrl ??
        (userRole === 'patient'
          ? '/my-appointments'
          : userRole === 'super_admin'
            ? '/admin'
            : '/workspace/dashboard');
      return true;
    } catch {
      toast('تعذر تسجيل الدخول. تحقق من الاتصال.', true);
      return false;
    }
  };
  const signup = async (
    payload: {
      fullName: string;
      email: string;
      password: string;
      phone?: string;
      intent?: 'patient' | 'clinic_owner';
    },
    destination?: string,
  ) => {
    try {
      const r = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'signup', ...payload }),
      });
      const j = await r.json();
      if (j.needsConfirmation) {
        toast(j.error ?? 'تم إرسال رابط التأكيد إلى بريدك الإلكتروني.');
        return true;
      }
      if (!j.success) {
        toast(j.error ?? 'تعذر إنشاء الحساب.', true);
        return false;
      }
      toast('تم إنشاء الحساب بنجاح! أهلاً بك.');
      const userRole =
        j.data?.role ?? (payload.intent === 'clinic_owner' ? 'clinic_owner' : 'patient');
      const orgId = j.data?.organizationId;
      let targetUrl = j.redirectTo;
      if (userRole === 'clinic_owner' && !orgId) {
        targetUrl = '/register-clinic?onboarding=1';
      } else if (
        destination &&
        destination.startsWith('/') &&
        !destination.startsWith('//') &&
        !destination.includes('\\')
      ) {
        if (
          userRole === 'patient' &&
          (destination.startsWith('/workspace') || destination.startsWith('/admin'))
        ) {
          targetUrl = '/my-appointments';
        } else {
          targetUrl = destination;
        }
      }
      window.location.href =
        targetUrl ??
        (userRole === 'clinic_owner' ? '/register-clinic?onboarding=1' : '/my-appointments');
      return true;
    } catch {
      toast('تعذر إنشاء الحساب. حاول مجدداً.', true);
      return false;
    }
  };
  const logout = async () => {
    refreshVersion.current += 1;
    refreshAbort.current?.abort();
    etag.current = null;
    setData(null);
    try {
      await fetch('/api/session', { method: 'DELETE' });
      setData(null);
      window.location.href = '/';
    } catch {
      window.location.href = '/';
    }
  };
  return (
    <Ctx.Provider value={{ data, loading, error, refresh, toast, act, login, signup, logout }}>
      {children}
      <div className="toast-stack" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              className={`toast ${t.error ? 'toast-error' : ''}`}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              {t.error ? <AlertCircle size={21} /> : <CheckCircle2 size={21} />}
              <span>{t.message}</span>
              <button
                aria-label="إغلاق التنبيه"
                onClick={() => setToasts((s) => s.filter((x) => x.id !== t.id))}
              >
                <X size={16} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
