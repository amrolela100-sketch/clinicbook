import { renderClinicRoute } from '@/lib/clinic-routes';

export const metadata = { robots: { index: false, follow: false } };
export default function AdminPage() {
  return renderClinicRoute('/admin');
}
