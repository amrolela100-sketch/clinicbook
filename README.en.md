<div align="center">

# ClinicBook

### Multi-Tenant Healthcare SaaS & Clinical Practice Management System

**Production-Grade Outpatient Scheduling, Clinical EMR, and Medical Center Operations**

<p align="center">
  <a href="#executive-summary">Overview</a> •
  <a href="#core-features-and-ui-showcase">Features & UI</a> •
  <a href="#system-architecture">Architecture</a> •
  <a href="#rbac-access-matrix">RBAC Matrix</a> •
  <a href="#local-development-and-quickstart">Quickstart</a> •
  <a href="#test-suite-and-verification">Testing</a> •
  <a href="#academic-documentation-and-research-context">Documentation</a>
</p>

[![Next.js](https://img.shields.io/badge/Next.js-15.5_App_Router-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.1-blue?style=flat-square&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9_Strict-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4_RTL-38B2AC?style=flat-square&logo=tailwind-css)](https://tailwindcss.com/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL_Immediate-003B57?style=flat-square&logo=sqlite)](https://sqlite.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17_RLS-336791?style=flat-square&logo=postgresql)](https://www.postgresql.org/)
[![Vitest](https://img.shields.io/badge/Vitest-101_Passed-6E9F18?style=flat-square&logo=vitest)](https://vitest.dev/)
[![Playwright](https://img.shields.io/badge/Playwright-E2E_Verified-2EAD33?style=flat-square&logo=playwright)](https://playwright.dev/)
[![WCAG AA](https://img.shields.io/badge/Accessibility-WCAG_2.1_AA-005A9C?style=flat-square)](docs/ACCESSIBILITY_AUDIT_REPORT.md)

<br />

<p align="center">
  <a href="docs/screenshots/showcase/01-landing-page.png">
    <img src="docs/screenshots/showcase/01-landing-page.png" alt="ClinicBook - Main Platform Landing Interface" width="94%" />
  </a>
</p>

<p align="center">
  <b>🌐 [الانتقال إلى النسخة العربية من دليل التوثيق](README.md)</b>
</p>

</div>

---

## Executive Summary

**ClinicBook** is an enterprise-grade medical center management and patient scheduling platform engineered to solve real outpatient operations and scheduling conflicts. Designed from field observations of healthcare centers across the Middle East (specifically regional Syrian healthcare workflows), the platform unifies the entire patient journey: automated discovery and appointment reservation, front-desk reception queue management, point-of-care billing, and clinical electronic medical records (EMR) with standardized e-prescriptions.

Engineered with a **Multi-Tenant SaaS architecture**, strict Row-Level Security (RLS), and a native **RTL-First Arabic UI**, ClinicBook operates completely without third-party CDN dependencies to ensure continuous operation across constrained regional network conditions.

> **Current Implementation State**: A fully functional local evaluation environment powered by a serialized SQLite engine alongside a production PostgreSQL 17 / Supabase schema with verified Row-Level Security policies. Ready for comprehensive architectural review, academic evaluation, and technical audits.

---

## Core Features and UI Showcase

All screenshots below are captured directly at High-DPI Retina resolution from the live running application:

### 1. Atomic Concurrency Slot Engine

The appointment engine models availability via half-open intervals `[start, end)`. Timestamps are persisted in standard UTC, with timezone offsets calculated dynamically for Damascus (`Asia/Damascus`). Under extreme concurrent traffic, serialized SQL transactions eliminate race conditions and prevent double-booking.

<p align="center">
  <a href="docs/screenshots/showcase/03-doctor-profile-slots.png">
    <img src="docs/screenshots/showcase/03-doctor-profile-slots.png" alt="Doctor Profile and Availability Slots" width="90%" />
  </a>
</p>

- **Dynamic Slot Slicing:** Automatically computes consultation intervals (20 or 30 minutes) based on physician shift configurations.
- **Break & Exception Handling:** Automatically excludes official holidays, practitioner leaves, and break intervals from patient availability.
- **Double-Booking Prevention:** Atomic reservations immediately discard expired pending holds and reject conflicting attempts with HTTP 409.

---

### 2. Clinical Directory, Faceted Search & Advanced Filtering

A real-time medical discovery engine allowing patients to find practitioners and clinics across multiple clinical and geographic dimensions.

<p align="center">
  <a href="docs/screenshots/showcase/02-search-and-filters.png">
    <img src="docs/screenshots/showcase/02-search-and-filters.png" alt="Medical Directory and Multi-Filter Search" width="90%" />
  </a>
</p>

- **Multi-Facet Filtering:** Filter physicians by clinical specialty, city, neighborhood, consultation fee ranges, and years of clinical experience.
- **Intelligent Sorting:** Order matching doctors by verified patient rating, earliest available slot, or consultation fees.
- **Interactive Physician Cards:** Quick-view clinic locations, weekly schedule summaries, and direct links to live booking calendars.

---

### 3. Clinic Operations & Financial Analytics

Offers executive management an instant, high-fidelity overview of clinical, operational, and financial indicators.

<p align="center">
  <a href="docs/screenshots/showcase/07-clinic-owner-dashboard.png">
    <img src="docs/screenshots/showcase/07-clinic-owner-dashboard.png" alt="Clinic Owner Management Dashboard" width="90%" />
  </a>
</p>

- **Real-Time KPI Tracking:** Daily revenue, total consultations, branch capacity utilization, and patient status distributions.
- **Staff & Branch Provisioning:** Onboard physicians, configure multi-branch assignments, and manage subscription tier limits.
- **Safe CSV Financial Exports:** Strips dangerous formula prefixes (`=`, `@`, `+`, `-`) to prevent Excel Formula Injection (CSV Injection) attacks.

---

### 4. Clinical EMR & Standardized Digital Prescriptions

A purpose-built clinical encounter workspace designed for treating doctors, prioritizing diagnostic speed and patient data confidentiality.

<p align="center">
  <a href="docs/screenshots/showcase/09-doctor-clinical-emr.png">
    <img src="docs/screenshots/showcase/09-doctor-clinical-emr.png" alt="Clinical EMR and Electronic Prescription" width="90%" />
  </a>
</p>

- **Clinical Encounter Documentation:** Structured SOAP notes capturing chief complaint, patient history, physical examination, and diagnoses.
- **Standardized Digital Prescriptions:** Structured medication entries with dosage, frequency, course duration, and pharmacist guidance.
- **Print-Ready Medical Format:** Clean browser-to-print prescription template with clinic branding and unique verification barcodes.
- **Strict Clinical Isolation:** Medical diagnosis records are strictly isolated; clinic owners and receptionists are programmatically blocked from viewing patient clinical data.

---

### 5. Doctor Shift Scheduling, Breaks & Exception Management

A flexible calendar utility allowing practitioners and clinics to configure consultation windows and shift exceptions.

<p align="center">
  <a href="docs/screenshots/showcase/10-doctor-schedule.png">
    <img src="docs/screenshots/showcase/10-doctor-schedule.png" alt="Doctor Schedule and Shift Management" width="90%" />
  </a>
</p>

- **Shift Definition:** Configure daily start and end working hours, break periods, and custom consultation slot durations.
- **Scheduled Rest Periods:** Block lunch and break intervals from appearing in patient booking slots.
- **Emergency Absence & Leave:** Log ad-hoc leaves or emergency closures with automated conflict resolution.

---

### 6. Reception Queue & Point-of-Care Check-In

Designed specifically for front-desk receptionists to manage patient queues and record cash settlements in clinic waiting rooms.

<p align="center">
  <a href="docs/screenshots/showcase/08-reception-appointments.png">
    <img src="docs/screenshots/showcase/08-reception-appointments.png" alt="Reception Desk Workspace and Check-in" width="90%" />
  </a>
</p>

- **One-Click Check-In:** Instantly transitions appointment states upon patient arrival to alert the attending physician inside the clinic.
- **In-Person Cash Collection:** Directly logs patient payments and issues verification receipts.
- **Walk-In Scheduling:** Quickly schedules emergency and walk-in arrivals into available gap intervals.

---

### 7. Clinical AI Triage Assistant (Eve)

An embedded clinical triage assistant built on AgentRouter, providing conversational guidance to direct patients to appropriate specialties.

<p align="center">
  <a href="docs/screenshots/showcase/04-ai-assistant-eve.png">
    <img src="docs/screenshots/showcase/04-ai-assistant-eve.png" alt="Clinical AI Triage Assistant Eve" width="90%" />
  </a>
</p>

- **Symptom Triage Analysis:** Evaluates patient-reported symptoms, flags red-flag emergencies, and assesses clinical urgency.
- **Specialty Routing:** Directs users to verified specialists with direct deep links to real doctor scheduling profiles.
- **Ethical & Safety Guardrails:** Clear clinical disclaimers reinforcing that AI guidance is strictly educational and does not replace in-person consultation.

---

### 8. Patient Portal & Booking Management

A responsive patient self-service portal for managing visits, reviewing prescriptions, and maintaining treatment records.

<p align="center">
  <a href="docs/screenshots/showcase/06-patient-appointments.png">
    <img src="docs/screenshots/showcase/06-patient-appointments.png" alt="Patient Portal and Appointment Tracking" width="90%" />
  </a>
</p>

- **Upcoming Visit Countdown:** Real-time countdowns, location directions, and verification codes for reception check-in.
- **Automated Cancellation Policy:** Self-service cancellation permitted up to 2 hours prior to the slot; late cancellations are blocked to protect doctor schedule utilization.
- **Historical Treatment Archive:** Searchable archive of completed visits with printable prescriptions and verified patient review submissions.

---

### 9. Multi-Role Authentication & Direct Persona Simulator

A unified authentication portal supporting single-click role switching for technical evaluators alongside secure credential flows.

<p align="center">
  <a href="docs/screenshots/showcase/05-multi-role-login.png">
    <img src="docs/screenshots/showcase/05-multi-role-login.png" alt="Authentication Portal and Multi-Role Switcher" width="90%" />
  </a>
</p>

- **Instant Persona Simulator:** Immediate testing across all five personas (`clinic_owner`, `doctor`, `receptionist`, `patient`, `super_admin`).
- **Cryptographic Session Storage:** Ephemeral test tokens hashed via SHA-256 and stored with HttpOnly session cookies.
- **Sign-Up Pipelines:** Dedicated registration flows for patients and clinic owners with strict schema validation.

---

### 10. Multi-Step Clinic Onboarding & Verification Wizard

A guided multi-step onboarding wizard for registering new outpatient clinics and specialist practices.

<p align="center">
  <a href="docs/screenshots/showcase/11-clinic-registration-wizard.png">
    <img src="docs/screenshots/showcase/11-clinic-registration-wizard.png" alt="Clinic Registration and Onboarding Wizard" width="90%" />
  </a>
</p>

- **Medical Licensing Record:** Captures official practice registry IDs, regulatory bodies, and clinic physical branch details.
- **Subscription Tier Selection:** Select tiered capacities based on active physician headcount and branch volume.
- **Pending Verification Gate:** Quarantines new clinics until authenticated and reviewed by platform administrators.

---

### 11. Platform Governance & Tamper-Evident Audit Trail

A centralized super-administration console ensuring operational compliance and security auditing across all tenants.

<p align="center">
  <a href="docs/screenshots/showcase/12-super-admin-console.png">
    <img src="docs/screenshots/showcase/12-super-admin-console.png" alt="Super Admin Console and Audit Trail" width="90%" />
  </a>
</p>

- **Clinic Verification Queue:** Review pending healthcare facility applications, verify credentials, and approve or reject access.
- **Immutable Audit Logging:** Tracks all critical state mutations (appointments, role assignments, license changes) with actor IDs and UTC timestamps.
- **System References Management:** Manage system-wide clinical specialties, cities, and administrative districts.

---

### 12. Automated Patient Retention & Proactive Cron Engine

ClinicBook features a hardened scheduled endpoint (`/api/cron/retention`) designed to reduce patient no-show rates through proactive notification triggers:

- **24-Hour Lookahead Window:** Automatically scans all scheduled consultations across clinics within the subsequent 24 hours to queue confirmation actions.
- **Constant-Time Cryptographic Verification:** Protects cron execution via `Authorization: Bearer <CRON_SECRET>` using `crypto.timingSafeEqual` to eliminate timing attack vectors.
- **Integrated Audit Logging:** Every automated retention scan records idempotent events directly to the system audit trail under the `eve-retention-cron` identity.

---

### 13. Mobile Responsive Viewports

Engineered with responsive touch targets and dynamic layout adaptations across smartphone viewports (390px to 1440px+).

<p align="center">
  <a href="docs/screenshots/showcase/mobile-01-home.png"><img src="docs/screenshots/showcase/mobile-01-home.png" alt="Mobile View - Landing" width="31%" /></a> &nbsp;
  <a href="docs/screenshots/showcase/mobile-02-search.png"><img src="docs/screenshots/showcase/mobile-02-search.png" alt="Mobile View - Search" width="31%" /></a> &nbsp;
  <a href="docs/screenshots/showcase/mobile-03-dashboard.png"><img src="docs/screenshots/showcase/mobile-03-dashboard.png" alt="Mobile View - Dashboard" width="31%" /></a>
</p>

---

## System Architecture

ClinicBook employs a clean three-tier architecture separating declarative UI components, business logic invariants, and isolated storage layers:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        Presentation & UI Layer                         │
│      Next.js 15 App Router • React 19 • Tailwind 4 • Motion • Radix     │
│             (RTL Arabic • Offline Fonts • Zero External CDN)            │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               Business Logic, Invariants & Security Gates              │
│       • Slots Engine: Asia/Damascus → Half-Open UTC Intervals          │
│       • Lifecycle State Machine: Pending → Confirmed → Completed       │
│       • RBAC Authorization: EMR Data Quarantined from Administration   │
│       • Input Validation: Zod Schemas + Excel Injection Defense        │
└──────────────────┬──────────────────────────────────┬──────────────────┘
                   │                                  │
          (Local / Evaluation)               (Cloud Production)
                   ▼                                  ▼
┌──────────────────────────────────────┐  ┌──────────────────────────────┐
│       Local High-Speed Engine        │  │    PostgreSQL 17 + Supabase  │
│   • Better-SQLite3 (WAL Mode)        │  │  • Row-Level Security (RLS)  │
│   • IMMEDIATE Serialized Mutexes     │  │  • Stored Atomic RPCs        │
│   • 0 Double Bookings under load     │  │  • Comprehensive Audit Log   │
└──────────────────────────────────────┘  └──────────────────────────────┘
```

---

## RBAC Access Matrix

Enforces the **Principle of Least Privilege** to maintain patient confidentiality and role isolation:

| Role                 |   Role Key   |         Appointments          |   Clinical EMR & Diagnosis   |        Staff & Branch Mgmt        |     Financial Operations      |
| :------------------- | :----------: | :---------------------------: | :--------------------------: | :-------------------------------: | :---------------------------: |
| **Clinic Owner**     |   `owner`    |  View/confirm clinic visits   |         🚫 Forbidden         | Add/edit staff, allocate branches |    Manage tier & invoices     |
| **Attending Doctor** |   `doctor`   |   Manage assigned schedule    | ✅ Full create/edit EMR & Rx |           🚫 Forbidden            |   View personal fee totals    |
| **Receptionist**     | `reception`  |  Book, confirm, and check in  |         🚫 Forbidden         |           🚫 Forbidden            | Collect cash & issue receipts |
| **Patient**          |  `patient`   | Book, view, and cancel visits |   ✅ View own visits & Rx    |           🚫 Forbidden            |  View personal visit charges  |
| **Super Admin**      | `superadmin` |  Global aggregate monitoring  |  🚫 Forbidden (Anonymized)   |   Approve clinic registrations    |    Manual tier activations    |

---

## Local Development and Quickstart

### Prerequisites

- **Node.js**: Version 20.19.0 or higher.
- **npm**: Version 10 or higher.

### Quick Setup Steps

```bash
# 1. Install dependencies with exact lockfile guarantees
npm ci

# 2. Configure local environment variables
cp .env.example .env.local

# 3. Seed the local SQLite database with realistic initial data
npm run db:seed

# 4. Start the development server
npm run dev
```

Navigate to `http://localhost:3000` in your browser.

### Interactive Multi-Role Exploration

Explore all five system personas instantly without manual account registration via `/login`:

1. **Clinic Owner:** Inspect the operational dashboard, manage clinic branches, and view analytics.
2. **Attending Doctor:** Review today's queue, author SOAP clinical notes, and print medical prescriptions.
3. **Receptionist:** Check in arriving patients and record cash fee collections.
4. **Patient:** Search available specialists, reserve a slot, and test real-time cancellation deadlines.
5. **Super Admin:** Review incoming clinic verification requests and inspect the system audit trail.

---

## Test Suite and Verification

The codebase adheres strictly to **Test-Driven Development (TDD)** to ensure behavioral correctness across critical clinical paths:

```bash
# 1. Strict static type analysis (Zero TypeScript diagnostics)
npm run typecheck

# 2. Comprehensive unit and integration testing (Vitest)
npm run test:unit

# 3. High-concurrency race condition benchmark (50 concurrent HTTP requests)
# Note: Requires the local server running in another terminal (npm run dev or npm run start)
npm run test:concurrency

# 4. End-to-end browser test automation & accessibility suite (Playwright)
npm run test:e2e

# 5. Standalone automated WCAG 2.1 AA accessibility audit (axe-core)
node scripts/a11y.mjs
```

### Verified Benchmark Results:

- **101 Passing Unit & Integration Tests (101/101):** Validates half-open time interval calculations, daylight saving transitions (DST), appointment lifecycle state machine, and multi-tenant isolation.
- **Zero Double Bookings (0 Race Conditions):** 50 concurrent HTTP requests targeted at the exact same slot resulted in exactly 1 successful booking (201 Created) and 49 conflict rejections (409 Conflict).
- **PostgreSQL 17 RLS Verification:** Full test suite verifying tenant boundary isolation, RPC impersonation prevention, and strict denial of medical record access to non-treating staff.
- **Zero Automated A11y Violations:** Automated `axe-core` Playwright scans of the landing page and workspace dashboards confirm 100% compliance with WCAG 2.1 AA color contrast and focus requirements.

---

## Repository Layout

```text
clinicbook/
├── docs/                       # Academic reports, architectural specs, and screenshots
│   ├── ACADEMIC_REPORT.md      # Full university graduation engineering thesis
│   ├── COMPREHENSIVE_PROPOSAL.md # Technical implementation proposal and architecture
│   ├── ACCESSIBILITY_AUDIT_REPORT.md # WCAG 2.1 AA accessibility audit report
│   ├── AI_AGENT_EVE_BLUEPRINT.md     # Eve clinical triage AI system blueprint
│   └── screenshots/showcase/   # High-resolution application screenshots
├── public/                     # Static assets, local typography, and portraits
│   ├── fonts/                  # Self-hosted IBM Plex Sans Arabic and Inter fonts
│   └── images/                 # Verified doctor portraits and platform brand assets
├── src/
│   ├── app/                    # Next.js 15 App Router routes and API handlers
│   ├── components/             # Decomposed domain components
│   │   ├── clinical-pages.tsx  # Clinical EMR, consultations, and patient portal
│   │   ├── management-pages.tsx # Clinic operations, staff roster, and reports
│   │   ├── public-pages.tsx    # Landing page, doctor search, and profile views
│   │   └── shared.tsx          # Shared primitives (Radix, Tailwind, Motion)
│   └── lib/
│       ├── auth/               # Session management and RBAC guards
│       ├── services/           # Slots calculation engine and lifecycle transitions
│       ├── demo-db.ts          # Local SQLite storage and deterministic seeds
│       └── supabase/           # Isolated Supabase clients and database adapters
├── supabase/migrations/        # PostgreSQL schema, RLS policies, and atomic RPCs
└── tests/                      # Vitest unit, Playwright E2E, and Postgres test suites
```

---

## Academic Documentation and Research Context

This project represents an applied software engineering graduation thesis submitted for academic evaluation:

- **Academic Institution:** Antioch Syrian Private University (**ASPU**) — Faculty of Computer Engineering.
- **Authors:** Mosaab Amiri • Mohammad Alabrash.
- **Academic Supervisor:** Eng. Abdo Khoury.

### Primary Documentation Artifacts:

- 📄 **Comprehensive Academic Report:** [`docs/ACADEMIC_REPORT.md`](docs/ACADEMIC_REPORT.md) — [Printable Formatted HTML](docs/ACADEMIC_REPORT.html)
- 📑 **Integrated Project Proposal:** [`docs/COMPREHENSIVE_PROPOSAL.md`](docs/COMPREHENSIVE_PROPOSAL.md) — [HTML Version](docs/COMPREHENSIVE_PROPOSAL.html)
- 🤖 **Eve Clinical AI Blueprint:** [`docs/AI_AGENT_EVE_BLUEPRINT.md`](docs/AI_AGENT_EVE_BLUEPRINT.md)
- ♿ **Accessibility Audit Report (WCAG 2.1 AA):** [`docs/ACCESSIBILITY_AUDIT_REPORT.md`](docs/ACCESSIBILITY_AUDIT_REPORT.md)
- 🖼️ **Complete Visual Showcase Gallery:** [`docs/screenshots/README.md`](docs/screenshots/README.md)
- 🔒 **PostgreSQL RLS Verification Guide:** [`docs/POSTGRES_TESTING.md`](docs/POSTGRES_TESTING.md)

---

## Cloud Production Roadmap

Maintaining strict software engineering transparency, the table below delineates verified existing capabilities from pending production cloud milestones:

| Functional Area               |    Current Status     | Cloud Rollout Requirement                                                                |
| :---------------------------- | :-------------------: | :--------------------------------------------------------------------------------------- |
| **Slot Engine & Booking**     |      ✅ Verified      | Production-ready; operational locally with parity Supabase RPC stored procedures.        |
| **Clinical EMR & Digital Rx** |      ✅ Verified      | Ready; future enhancement includes cryptographic doctor signatures and FHIR/HL7 exports. |
| **Multi-Tenant RBAC**         |      ✅ Verified      | Complete; integrate third-party OAuth providers (Google/Apple) and MFA.                  |
| **Payment Gateway**           | ⚠️ Cash Point-of-Care | Full Stripe / regional payment gateway webhook integration.                              |
| **Patient Notifications**     |  ⚠️ Internal System   | Official SMS & WhatsApp Business API gateway integration for automated reminders.        |
| **Document Storage**          |   ⚠️ Local Storage    | Supabase Storage integration with signed access URLs for medical imaging attachments.    |

---

<div align="center">
  <sub>Engineered with precision and uncompromising standards • ClinicBook © 2026</sub>
</div>
