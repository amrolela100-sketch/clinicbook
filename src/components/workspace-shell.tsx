'use client';
import Link from 'next/link';
import { useState, useEffect, type ReactNode } from 'react';
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  Clock3,
  UsersRound,
  ChartNoAxesCombined,
  Wallet,
  Settings,
  ChevronDown,
  ChevronLeft,
  Search,
  Bell,
  Plus,
  ArrowUpLeft,
  LogOut,
  HelpCircle,
  Menu,
  X,
  ShieldCheck,
  Globe,
  Command,
  Check,
  ArrowLeft,
  Building2,
} from 'lucide-react';
import { Logo, Avatar, Badge, Empty } from './shared';
import { useApp } from './app-provider';
import { Modal } from './ui/dialog';
import { Button } from './ui/button';
const mainNav = [
  { href: '/workspace/dashboard', label: 'نظرة عامة', icon: LayoutDashboard },
  { href: '/workspace/appointments', label: 'المواعيد', icon: CalendarDays },
  { href: '/workspace/patients', label: 'المرضى', icon: Users },
  { href: '/workspace/schedule', label: 'جدول الدوام', icon: Clock3 },
];
const managementNav = [
  { href: '/workspace/team', label: 'الفريق الطبي', icon: UsersRound },
  { href: '/workspace/reports', label: 'التقارير والإحصائيات', icon: ChartNoAxesCombined },
  { href: '/workspace/billing', label: 'الاشتراك والفوترة', icon: Wallet },
  { href: '/workspace/settings', label: 'إعدادات المركز', icon: Settings },
];
export function WorkspaceShell({ route, children }: { route: string; children: ReactNode }) {
  const { data, act, login } = useApp();
  const [menu, setMenu] = useState(false),
    [notifications, setNotifications] = useState(false),
    [switcher, setSwitcher] = useState(false),
    [help, setHelp] = useState(false),
    [search, setSearch] = useState(false),
    [query, setQuery] = useState('');
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearch((v) => !v);
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
  const user = data?.user;
  const title = [...mainNav, ...managementNav].find((n) => n.href === route)?.label ?? 'ملف المريض';
  const pending = data?.appointments.filter((a) => a.status === 'pending').length ?? 0;
  const nav = (items: typeof mainNav) =>
    items.map((n) => (
      <Link
        href={n.href}
        key={n.href}
        onClick={() => setMenu(false)}
        className={`sidebar-link ${route === n.href ? 'active' : ''}`}
      >
        <n.icon size={20} strokeWidth={1.65} />
        <span>{n.label}</span>
        {n.href.endsWith('/appointments') && pending > 0 ? (
          <span className="nav-count">{pending}</span>
        ) : route === n.href ? (
          <span className="nav-active-dot" />
        ) : null}
      </Link>
    ));
  return (
    <div className="workspace-shell">
      <button
        className={`sidebar-backdrop ${menu ? 'visible' : ''}`}
        aria-label="إغلاق القائمة"
        onClick={() => setMenu(false)}
      />
      <aside className={`sidebar ${menu ? 'sidebar-open' : ''}`}>
        <div className="sidebar-logo">
          <Logo />
          <button
            className="mobile-menu icon-button"
            onClick={() => setMenu(false)}
            aria-label="إغلاق القائمة"
          >
            <X />
          </button>
        </div>
        <button className="clinic-switcher" onClick={() => setSwitcher(true)}>
          <span className="clinic-symbol">
            <Building2 size={23} />
          </span>
          <span>
            <strong>{data?.organization?.name ?? 'مركزك الطبي'}</strong>
            <small>{data?.organization?.city ?? 'دمشق'} · الفرع الرئيسي</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <div className="sidebar-section-label">مساحة العمل</div>
        <nav>{nav(mainNav)}</nav>
        {user?.role === 'clinic_owner' && (
          <>
            <div className="sidebar-section-label">إدارة المركز</div>
            <nav>{nav(managementNav)}</nav>
          </>
        )}
        <div className="sidebar-bottom">
          <div className="upgrade-card">
            <span className="upgrade-icon">
              <HeartMark />
            </span>
            <strong>رعاية أفضل تبدأ بتنظيم أفضل</strong>
            <p>اكتشف ما يمكن لمساحة عملك أن تقدّمه.</p>
            <Link href={user?.role === 'clinic_owner' ? '/workspace/billing' : '/search'}>
              استكشف المزيد <ArrowUpLeft size={16} />
            </Link>
          </div>
          <button className="sidebar-link" onClick={() => setHelp(true)}>
            <HelpCircle size={20} />
            <span>المساعدة والدعم</span>
            <ArrowUpLeft size={15} />
          </button>
          <Link href="/" className="sidebar-link">
            <Globe size={19} />
            <span>بوابة المرضى</span>
            <ArrowUpLeft size={15} />
          </Link>
          <button className="sidebar-user" onClick={() => setSwitcher(true)}>
            <Avatar name={user?.name ?? 'مستخدم'} color="#e3ece6" />
            <span>
              <strong>{user?.name}</strong>
              <small>{roleLabels[user?.role ?? 'clinic_owner']}</small>
            </span>
            <ChevronDown size={16} />
          </button>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="workspace-topbar">
          <div className="workspace-breadcrumb">
            <button
              className="mobile-menu icon-button"
              aria-label="فتح القائمة"
              onClick={() => setMenu(true)}
            >
              <Menu />
            </button>
            <span className="breadcrumb-mark">
              <LayoutDashboard size={18} />
            </span>
            <span>مساحة العمل</span>
            <ChevronLeft size={14} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-actions">
            <button className="topbar-search" onClick={() => setSearch(true)}>
              <Search size={17} />
              <span>ابحث عن أي شيء…</span>
              <kbd>⌘ K</kbd>
            </button>
            <span className="topbar-divider" />
            <button
              className="notification-trigger icon-button"
              aria-label="الإشعارات"
              onClick={() => setNotifications(true)}
            >
              <Bell size={20} />
              {data?.notifications.some((n) => !n.read) && <i />}
            </button>
            <button
              className="icon-button topbar-avatar"
              onClick={() => setSwitcher(true)}
              aria-label="إدارة الحساب"
            >
              <Avatar name={user?.name ?? ''} size="sm" color="#eddccf" />
            </button>
          </div>
        </header>
        <main className="workspace-content">{children}</main>
        <footer className="workspace-footer">
          <span>صُنعت التفاصيل لتعتني بما هو أهم.</span>
          <span className="demo-dot">
            <i />
            النظام متصل · مزامنة وتحديث فوري
          </span>
          <span dir="ltr">ClinicBook © {new Date().getFullYear()}</span>
        </footer>
      </div>
      <Modal
        open={notifications}
        onClose={() => setNotifications(false)}
        title="إشعاراتك"
        description="كل جديد في المركز، في مكان واحد."
      >
        {data?.notifications.length ? (
          data.notifications.map((n) => (
            <button
              className={`notification-row ${!n.read ? 'unread' : ''}`}
              key={n.id}
              onClick={() => act('notification', { id: n.id }, 'تم وضع علامة مقروء')}
            >
              <span className="soft-icon">
                <Bell size={19} />
              </span>
              <span>
                <strong>{n.title}</strong>
                <p>{n.body}</p>
                <small>{n.read ? 'تمت القراءة' : 'اضغط لوضع علامة مقروء'}</small>
              </span>
              {!n.read && <i className="live-dot" />}
            </button>
          ))
        ) : (
          <Empty title="كل شيء هادئ هنا" text="ستظهر إشعاراتك الجديدة في هذه المساحة." />
        )}
      </Modal>
      <Modal
        open={switcher}
        onClose={() => setSwitcher(false)}
        title="مساحتك، حسب دورك"
        description="إدارة الصلاحيات والتبديل السريع بين حسابات فريق العمل."
      >
        <div className="role-switch-grid">
          {Object.entries(roleLabels).map(([role, label]) => (
            <button
              key={role}
              className={user?.role === role ? 'active' : ''}
              onClick={() => login(role)}
            >
              <Avatar name={label} />
              <span>
                <strong>{label}</strong>
                <small>{role === user?.role ? 'حسابك الحالي' : 'الانتقال إلى صلاحيات هذا الدور'}</small>
              </span>
              {role === user?.role ? <Check size={19} /> : <ArrowLeft size={18} />}
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          className="full-width"
          onClick={async () => {
            await fetch('/api/session', { method: 'DELETE' });
            window.location.href = '/';
          }}
        >
          <LogOut size={18} />
          تسجيل الخروج
        </Button>
      </Modal>
      <Modal
        open={help}
        onClose={() => setHelp(false)}
        title="كيف يمكننا مساعدتك؟"
        description="دليل مساحة عمل كلينك بوك"
      >
        <div className="help-steps">
          <div>
            <b>01</b>
            <span>
              <strong>ابدأ من يومك</strong>
              <p>تابع المواعيد والطلبات المعلقة في النظرة العامة.</p>
            </span>
          </div>
          <div>
            <b>02</b>
            <span>
              <strong>تكامل الصلاحيات</strong>
              <p>يتابع موظف الاستقبال تسجيل الوصول والتحصيل، بينما يتفرغ الأطباء لإدارة الكشوفات والوصفات الطبية.</p>
            </span>
          </div>
          <div>
            <b>03</b>
            <span>
              <strong>حفظ آمن للبيانات</strong>
              <p>تُحفظ وتُوثّق جميع العمليات والسجلات الطبية بأعلى درجات الأمان والخصوصية والاعتمادية.</p>
            </span>
          </div>
        </div>
      </Modal>
      <Modal
        open={search}
        onClose={() => setSearch(false)}
        title="ابحث في مساحة عملك"
        description="ابحث عن مريض أو انتقل مباشرة إلى أي قسم."
      >
        <div className="input-icon">
          <Search size={18} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="اسم المريض أو القسم…"
          />
        </div>
        <div className="command-results">
          {[...mainNav, ...(user?.role === 'clinic_owner' ? managementNav : [])]
            .filter((n) => !query || n.label.includes(query))
            .map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setSearch(false)}>
                <n.icon size={18} />
                {n.label}
                <ArrowLeft size={15} />
              </Link>
            ))}
          {query &&
            [
              ...new Map(
                data?.appointments
                  .filter((a) => a.patientName.includes(query))
                  .map((a) => [a.patientName, a]),
              ).values(),
            ]
              .slice(0, 4)
              .map((a) => (
                <Link
                  key={a.id}
                  href={
                    user?.role === 'doctor' ? `/workspace/patients/${a.id}` : '/workspace/patients'
                  }
                  onClick={() => setSearch(false)}
                >
                  <Users size={18} />
                  {a.patientName}
                  <ArrowLeft size={15} />
                </Link>
              ))}
        </div>
      </Modal>
    </div>
  );
}
export const roleLabels: Record<string, string> = {
  clinic_owner: 'مدير المركز',
  doctor: 'طبيب',
  receptionist: 'موظف استقبال',
  patient: 'مريض',
  super_admin: 'مدير المنصة',
};
function HeartMark() {
  return (
    <svg viewBox="0 0 28 28" fill="none" width="28" height="28">
      <path
        d="M14 24S3 17 3 9a6 6 0 0 1 11-3 6 6 0 0 1 11 3c0 8-11 15-11 15Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M6 13h5l2-5 3 10 2-5h5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
