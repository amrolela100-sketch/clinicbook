# Project: ClinicBook Production-Grade Transformation

## Architecture
ClinicBook is an Arabic medical SaaS platform built on Next.js 15 (App Router), React 19, Tailwind CSS / Vanilla CSS (`globals.css`), and an SQLite data layer (`data/clinicbook.sqlite` + `src/lib/demo-db.ts`) with optional Supabase adapters.

- **Presentation Layer**: `src/components/` (`public-pages.tsx`, `clinical-pages.tsx`, `management-pages.tsx`, `workspace-shell.tsx`, `auth-pages.tsx`, `appointment-tools.tsx`, `dashboard.tsx`, `shared.tsx`).
- **Data & Storage Layer**: `src/lib/demo-db.ts`, `data/clinicbook.sqlite`, `src/lib/services/`.
- **API Actions**: `src/app/api/actions/route.ts`.
- **Static Assets**: `public/images/` (`doctor-1.jpg`, `doctor-2.jpg`, `doctor-3.jpg`, etc.).
- **Styles**: `src/app/globals.css`.
- **Testing**: Vitest (`tests/unit/`, `tests/integration/`), Playwright (`tests/e2e/`).

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Unique Doctor Portraits | Unique high-resolution medical portraits for all doctors (`doctor-1.jpg` to `doctor-6.jpg`, `doctor-samir.jpg`), eliminating all image duplication | M1 | Survey 1, ORIGINAL_REQUEST §R1 |
| 2 | Doctor Name Normalization | `cleanDoctorName` & `formatDoctorName` utility to eliminate "د. د." glitches across all 14 UI sites and fix search filtering | M1 | Survey 1, ORIGINAL_REQUEST §R1 |
| 3 | Visual Styling & Responsiveness | Remove `filter: saturate(0.65)`, fix Avatar lg intrinsic dimensions to 112px, fix mobile card footer wrap | M1 | Survey 1, ORIGINAL_REQUEST §R1 |
| 4 | Doctor Data & Seed Sanitization | Clean SQLite records and seed definitions, assign diverse specialties (including Ophthalmology), realistic fees | M1 | Survey 1, ORIGINAL_REQUEST §R1 |
| 5 | Public Banner & Footer Copy | Authentic announcement banner and medical compliance footer replacing prototype disclaimers | M2 | Survey 2, ORIGINAL_REQUEST §R2 |
| 6 | Ratings & Reviews Trust Copy | Verified patient ratings and review counters replacing illustrative/demo indicators | M2 | Survey 2, ORIGINAL_REQUEST §R2 |
| 7 | Booking Dialog & Auth Copy | Production-grade patient portal and registration copy without "تجريبي" or "اصطناعية" | M2 | Survey 2, ORIGINAL_REQUEST §R2 |
| 8 | Clinical EHR & Prescription Copy | Official medical prescription footer and realistic EHR clinical records | M2 | Survey 2, ORIGINAL_REQUEST §R2 |
| 9 | Workspace & Management Copy | Production SaaS copy for shell status, switcher, team, billing, invoices, reports, and admin queue | M2 | Survey 2, ORIGINAL_REQUEST §R2 |
| 10 | E2E Test Synchronization | Synchronize `tests/e2e/flows.spec.ts:258` toast assertion with updated production toast copy | M2 | Survey 2, Survey 3 |
| 11 | TypeScript Typecheck Gate | Zero diagnostics from `npm run typecheck` (`tsc --noEmit`) | M3 | Survey 3, ORIGINAL_REQUEST §R3 |
| 12 | Unit & Integration Test Gate | 100% pass across all unit and integration tests (`npm run test:unit`) | M3 | Survey 3, ORIGINAL_REQUEST §R3 |
| 13 | WCAG AA Accessibility Gate | Zero violations in automated axe-core audit (`npx playwright test tests/e2e/accessibility.spec.ts`) | M3 | Survey 3, ORIGINAL_REQUEST §R3 |
| 14 | Forensic Integrity Verification | Audit check confirming authentic implementation, no regressions, no hardcoding | M3 | Forensic Audit |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Visual Identity & Doctor Portraits | Image assets, name formatting helper, UI call-site wiring, database & seed sanitization, CSS visual enhancements | none | PLANNED |
| M2 | Authentic Medical Copywriting & Disclaimers Purge | Purge all 21+ demo disclaimers across public, clinical, management, and auth views; update E2E test assertion | M1 | PLANNED |
| M3 | Quality Assurance & Acceptance Verification | Execute full typecheck, unit tests, accessibility E2E suite, adversarial verification, forensic audit | M1, M2 | PLANNED |

## Interface Contracts
### `src/lib/format.ts` ↔ UI Components
```ts
export function cleanDoctorName(name?: string | null): string;
export function formatDoctorName(name?: string | null, prefix?: string): string;
```
- Guarantees idempotent doctor name formatting with exactly one `"د. "` prefix.
- Handled safely when input is null, undefined, empty, or already prefixed.

### Doctor Entity Schema
```ts
interface Doctor {
  id: string;
  name: string; // Clean name without honorific prefix (e.g. 'أحمد الحسن')
  specialty: string;
  clinic: string;
  rating: number;
  reviews: number;
  verified: boolean;
  image: string; // Unique image path in /images/ (e.g. 'doctor-1.jpg', 'doctor-4.jpg')
  fee: number;
}
```

## Code Layout
- `public/images/`: Portrait assets (`doctor-1.jpg` .. `doctor-6.jpg`, `doctor-samir.jpg`).
- `src/lib/format.ts`: Name formatting & text helpers.
- `src/lib/demo-db.ts`: Seed definitions and schema initialization.
- `src/components/`:
  - `public-pages.tsx`: Public home, search, doctor profile, booking modal.
  - `clinical-pages.tsx`: EHR consultation records, prescription sheet, patient portal.
  - `management-pages.tsx`: Team, billing, invoices, reports, admin queue.
  - `workspace-shell.tsx`: Workspace layout, top bar, role switcher, help modal.
  - `auth-pages.tsx`: Login and clinic registration forms.
  - `shared.tsx`: Avatar, Button, Modal, Card common components.
  - `dashboard.tsx`: Workspace dashboard views.
  - `appointment-tools.tsx`: Appointment booking drawer and tools.
- `src/app/globals.css`: Platform styling, saturation filter, responsive layout.
- `tests/`:
  - `tests/unit/`: Core unit tests.
  - `tests/integration/`: Storage and slot tests.
  - `tests/e2e/accessibility.spec.ts`: WCAG AA Playwright suite.
  - `tests/e2e/flows.spec.ts`: End-to-end user flows.
