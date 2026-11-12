import { metadataForClinicRoute, renderClinicRoute } from '@/lib/clinic-routes';

export const generateMetadata = () => metadataForClinicRoute('/register-clinic');
export default function RegisterClinicPage() {
  return renderClinicRoute('/register-clinic');
}
