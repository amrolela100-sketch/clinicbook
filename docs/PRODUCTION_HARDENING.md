# Production hardening — progress and deployment constraints

Branch: `production-hardening`, based on `3d85eed`.

This is a work-in-progress security release, **not a production sign-off**.
No migrations have been applied to a remote database.

## Completed changes

| Audit issue | Change | Regression boundary |
| --- | --- | --- |
| #2 | Runtime refuses demo mode in production; an opt-in variable does not enable it. | `demoEnabled()` environment contract |
| #1 | Demo onboarding requires an authenticated session before changing any account. | `POST /api/actions` |
| #3 | Anonymous access to the raw reviews table is revoked; the masked public RPC remains available. | Actual PostgreSQL roles and RPCs |
| #4 | Tenant membership no longer grants owner permissions in another tenant. | Actual PostgreSQL policies and schedule RPC |
| #5 | Clients cannot insert audit events. Mutation triggers record committed changes without copying private values. Billing requests have independent, authoritative state. | Actual PostgreSQL transactions and billing RPCs |
| #8 | Privileged Auth provisioning is service-role-only, refuses unrelated/claimed identities, checks scoped unused invitations and uses fixed Starter onboarding entitlements. | Actual PostgreSQL roles, invitation state, cleanup and concurrent provisioning |

The audit's claim that direct availability writes were open at the base commit was
too broad: `20261110000001` already revoked direct DML. The vulnerable schedule RPC,
doctor fees, clinic inserts, exception inserts and cross-tenant audit reads were
reproduced and fixed.

## Audit and billing migration notes

- Apply **all** pending migrations, in order, on staging before deploying the new
  application. Do not edit or replay already-applied migration history.
- Existing audit rows are preserved with `source = 'legacy'`. They may have been
  client-supplied, so they must not be treated as proof of payment or approval.
- New database events use `source = 'database'`; trusted application-admin events
  use `source = 'server'`. This is append-only for application users, not protection
  against a database owner or leaked service-role credential.
- Audit metadata stores the operation and names of changed fields, **not** old or
  new clinical values. This avoids copying diagnoses, prescriptions, notes or
  contact details into the platform audit console.
- Old `billing.requested` audit rows are intentionally **not** imported into the new
  billing table. Legitimate pending requests must be reviewed and re-submitted by
  their owners; historical rows are not deleted.
- `request_billing_upgrade()` creates one pending request per organization and
  derives the requester from `auth.uid()`. It does not activate a paid tier.
- A matching, active, unexpired subscription mutation resolves a request. An audit
  row named `subscription.activated` cannot do so.

## Provisioning and trial policy

- Production onboarding starts a **14-day Starter trial** with one doctor and one
  clinic. Pro requires an administrative activation after a billing request.
  The server and database reject Pro as an initial entitlement; they do not
  silently downgrade a user's selection. The registration UI explains this policy.
- Tenant clients cannot execute the onboarding/team provisioning RPCs directly.
  The trusted server supplies the actor ID from the verified session; the database
  also checks the actor's active profile and actual ownership.
- A separate first doctor or new team member must be an unused Auth invitation,
  with a patient/active placeholder profile, no existing membership or doctor
  record, and invitation metadata matching its inviter, purpose and organization.
- User metadata is **not authorization by itself**: service-role execution,
  the absence of a sign-in and the database profile/ownership checks are required.
- Safe rollback only deletes an unclaimed, unsigned-in invitation belonging to
  that operation. It refuses claimed members or established users, even when an
  RPC response is lost. It never falls back to an unconditional Auth deletion.
- Role/status changes are also recorded by database triggers. Doctor-limit tests
  exercise concurrent provisioning against the locked subscription row.
- A real Supabase staging invitation/acceptance/rollback test is still required:
  local verification models the Auth columns but does not run GoTrue or SMTP.

## Verification so far

- Vitest: **175/175** passing across 12 files.
- TypeScript: `npm run typecheck` passes.
- PostgreSQL: all migrations and `tests/postgres/verify.ts` pass on an isolated
  PostgreSQL 17 instance, including 50 competing bookings with only one winner.
- PostgreSQL verification is not a full Supabase Auth/PostgREST or browser test.

## Remaining release blockers

- #7: verify CSP nonces in a production build and browser, not just header tests.
- #9: distributed rate limiting and a trusted-proxy contract for the deployment.
- #13: preserve persisted credentials during demo onboarding.
- #6 and #10.3: medical-record retention and atomic encounter completion.
- Production-like E2E, migration upgrade testing, backups/restore testing,
  monitoring, credential configuration and deployment-specific checks.

Do not merge this branch as a claim of readiness until the remaining blockers have
been explicitly verified. Do not push migrations to a live database without a
backup, a tested staging upgrade and an agreed deployment window.
