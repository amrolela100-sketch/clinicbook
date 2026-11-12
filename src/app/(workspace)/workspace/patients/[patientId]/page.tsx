import { renderClinicRoute } from '@/lib/clinic-routes';

export default async function PatientPage({ params }: { params: Promise<{ patientId: string }> }) {
  return renderClinicRoute(`/workspace/patients/${encodeURIComponent((await params).patientId)}`);
}
