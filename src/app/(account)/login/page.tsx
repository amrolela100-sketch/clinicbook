import { metadataForClinicRoute, renderClinicRoute } from '@/lib/clinic-routes';

export const generateMetadata = () => metadataForClinicRoute('/login');
export default function LoginPage() {
  return renderClinicRoute('/login');
}
