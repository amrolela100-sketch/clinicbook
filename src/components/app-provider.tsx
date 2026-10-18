'use client';
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import type { User, Doctor, Appointment, MedicalRecord, Shift } from '@/lib/types';
import type { Organization } from '@/lib/services/booking-service';
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
  login: (roleOrCredentials: string | { email: string; password: string }, destination?: string) => Promise<boolean>;
  signup: (payload: { fullName: string; email: string; password: string; phone?: string }) => Promise<boolean>;
}
const Ctx = createContext<AppContext>(null!);
export const useApp = () => useContext(Ctx);
export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [toasts, setToasts] = useState<{ id: number; message: string; error: boolean }[]>([]);
  const toast = useCallback((message: string, error = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/data', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error();
      setData(j.data);
      setError('');
    } catch {
      setError('تعذر تحميل البيانات. تحقق من الاتصال وحاول مجدداً.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20000);
    return () => clearInterval(id);
  }, [refresh]);
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
  const login = async (roleOrCredentials: string | { email: string; password: string }, destination?: string) => {
    try {
      const payload = typeof roleOrCredentials === 'string'
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
      toast('تم تسجيل الدخول بنجاح');
      const userRole = j.data?.role;
      window.location.href =
        destination ??
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
  const signup = async (payload: { fullName: string; email: string; password: string; phone?: string }) => {
    try {
      const r = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'signup', ...payload }),
      });
      const j = await r.json();
      if (!j.success) {
        toast(j.error ?? 'تعذر إنشاء الحساب.', true);
        return false;
      }
      toast('تم إنشاء الحساب بنجاح! أهلاً بك.');
      window.location.href = '/my-appointments';
      return true;
    } catch {
      toast('تعذر إنشاء الحساب. حاول مجدداً.', true);
      return false;
    }
  };
  return (
    <Ctx.Provider value={{ data, loading, error, refresh, toast, act, login, signup }}>
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
