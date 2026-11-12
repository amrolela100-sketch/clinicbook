import { metadataForClinicRoute, renderClinicRoute } from '@/lib/clinic-routes';

type Props = { params: Promise<{ doctorId: string }> };
export async function generateMetadata({ params }: Props) {
  return metadataForClinicRoute(`/doctors/${encodeURIComponent((await params).doctorId)}`);
}
export default async function DoctorPage({ params }: Props) {
  return renderClinicRoute(`/doctors/${encodeURIComponent((await params).doctorId)}`);
}
