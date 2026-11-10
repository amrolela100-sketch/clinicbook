export interface PublicOrganizationState {
  status: string;
  subscriptionStatus: string;
  periodEnd: string;
}

/** Shared publication rule for demo directory, metadata, and slot discovery. */
export function isOrganizationPubliclyBookable(
  organization: PublicOrganizationState | null | undefined,
  now: Date = new Date(),
): organization is PublicOrganizationState {
  if (!organization) return false;
  const periodEnd = new Date(organization.periodEnd);
  return (
    organization.status === 'approved' &&
    ['active', 'trialing'].includes(organization.subscriptionStatus) &&
    !Number.isNaN(periodEnd.getTime()) &&
    periodEnd > now
  );
}
