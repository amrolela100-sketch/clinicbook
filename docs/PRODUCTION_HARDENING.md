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

## Verification so far

- Vitest: **175/175** passing across 12 files.
- TypeScript: `npm run typecheck` passes.
- PostgreSQL: all migrations and `tests/postgres/verify.ts` pass on an isolated
  PostgreSQL 17 instance, including 50 competing bookings with only one winner.
- PostgreSQL verification is not a full Supabase Auth/PostgREST or browser test.

## Remaining release blockers

- #8: restrict privileged provisioning RPCs, protect existing identities and
  enforce server-controlled onboarding entitlements.
- #7: verify CSP nonces in a production build and browser, not just header tests.
- #9: distributed rate limiting and a trusted-proxy contract for the deployment.
- #13: preserve persisted credentials during demo onboarding.
- #6 and #10.3: medical-record retention and atomic encounter completion.
- Production-like E2E, migration upgrade testing, backups/restore testing,
  monitoring, credential configuration and deployment-specific checks.

Do not merge this branch as a claim of readiness until the remaining blockers have
been explicitly verified. Do not push migrations to a live database without a
backup, a tested staging upgrade and an agreed deployment window.
