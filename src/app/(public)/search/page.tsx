import { metadataForClinicRoute, renderClinicRoute } from '@/lib/clinic-routes';

export const generateMetadata = () => metadataForClinicRoute('/search');
export default function SearchPage() {
  return renderClinicRoute('/search');
}
