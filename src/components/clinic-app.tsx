'use client';
import dynamic from 'next/dynamic';
import { MotionConfig, motion } from 'motion/react';
import { useApp } from './app-provider';
import { Loading, ErrorBox } from './shared';
import { PublicShell, Home, SearchPage, DoctorPage } from './public-pages';

const Login = dynamic(() => import('./auth-pages').then((m) => m.Login), {
  loading: () => <Loading />,
});
const Onboarding = dynamic(() => import('./auth-pages').then((m) => m.Onboarding), {
  loading: () => <Loading />,
});
const WorkspaceShell = dynamic(() => import('./workspace-shell').then((m) => m.WorkspaceShell), {
  loading: () => <Loading />,
});
const Dashboard = dynamic(() => import('./dashboard').then((m) => m.Dashboard), {
  loading: () => <Loading />,
});
const AppointmentsPage = dynamic(() => import('./dashboard').then((m) => m.AppointmentsPage), {
  loading: () => <Loading />,
});
const SchedulePage = dynamic(() => import('./clinical-pages').then((m) => m.SchedulePage), {
  loading: () => <Loading />,
});
const PatientsPage = dynamic(() => import('./clinical-pages').then((m) => m.PatientsPage), {
  loading: () => <Loading />,
});
const MedicalPage = dynamic(() => import('./clinical-pages').then((m) => m.MedicalPage), {
  loading: () => <Loading />,
});
const MyAppointments = dynamic(() => import('./clinical-pages').then((m) => m.MyAppointments), {
  loading: () => <Loading />,
});
const TeamPage = dynamic(() => import('./management-pages').then((m) => m.TeamPage), {
  loading: () => <Loading />,
});
const BillingPage = dynamic(() => import('./management-pages').then((m) => m.BillingPage), {
  loading: () => <Loading />,
});
const ReportsPage = dynamic(() => import('./management-pages').then((m) => m.ReportsPage), {
  loading: () => <Loading />,
});
const SettingsPage = dynamic(() => import('./management-pages').then((m) => m.SettingsPage), {
  loading: () => <Loading />,
});
const AdminPage = dynamic(() => import('./management-pages').then((m) => m.AdminPage), {
  loading: () => <Loading />,
});

export function ClinicApp({ route }: { route: string }) {
  const { data, loading, error, refresh } = useApp();
  if (loading && !data) return <Loading />;
  if (error && !data)
    return (
      <div className="page-error">
        <ErrorBox text={error} retry={refresh} />
      </div>
    );
  let page;
  if (route === '/login') return <Login />;
  if (route === '/admin') return <AdminPage />;
  if (route.startsWith('/workspace')) {
    switch (route) {
      case '/workspace/dashboard':
        page = <Dashboard />;
        break;
      case '/workspace/appointments':
        page = <AppointmentsPage />;
        break;
      case '/workspace/schedule':
        page = <SchedulePage />;
        break;
      case '/workspace/patients':
        page = <PatientsPage />;
        break;
      case '/workspace/team':
        page = <TeamPage />;
        break;
      case '/workspace/billing':
        page = <BillingPage />;
        break;
      case '/workspace/reports':
        page = <ReportsPage />;
        break;
      case '/workspace/settings':
        page = <SettingsPage />;
        break;
      default:
        page = <MedicalPage key={route} id={route.split('/').pop()!} />;
    }
    return (
      <MotionConfig reducedMotion="user">
        <WorkspaceShell route={route}>
          <motion.div
            key={route}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            {page}
          </motion.div>
        </WorkspaceShell>
      </MotionConfig>
    );
  }
  if (route === '/') page = <Home />;
  else if (route === '/search') page = <SearchPage />;
  else if (route === '/register-clinic') page = <Onboarding />;
  else if (route === '/my-appointments') page = <MyAppointments />;
  else page = <DoctorPage key={route} id={route.split('/').pop()!} />;
  return (
    <MotionConfig reducedMotion="user">
      <PublicShell>{page}</PublicShell>
    </MotionConfig>
  );
}
