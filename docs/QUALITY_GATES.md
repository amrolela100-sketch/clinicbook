# Quality gates — audit #25

## What the repository now enforces

| Gate               | Command                                      | Contract                                                                             |
| ------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------ |
| Formatting         | `npx prettier --check .`                     | Prettier 3.9.10, repository `.prettierrc.json`                                       |
| Types              | `npm run typecheck`                          | `next typegen` then `tsc --noEmit`; generated route types are always current         |
| Lint               | `npm run lint`                               | ESLint 9 flat config, `next/core-web-vitals` + `next/typescript`, `--max-warnings 0` |
| Logic and coverage | `npm run test:coverage`                      | Vitest 5.1.0 with V8 coverage and enforced thresholds                                |
| Dependencies       | `npm run audit` / `npm run audit:production` | Fails on high/critical advisories                                                    |
| Production build   | `npm run test:production`                    | `next build` + `next start` against loopback Supabase/Redis fixtures                 |
| Browser regression | `npm run test:e2e`                           | Playwright demo suite on an isolated database                                        |

`npm run test:all` runs typecheck, lint and the coverage gate in one command.

## Coverage thresholds

`vitest.config.mts` measures `src/lib/**`, `src/app/api/**` and `agent/**` with
the V8 provider and enforces the audit's limits:

| Metric     | Threshold | Observed at `1c84859` (2026-11-13) |
| ---------- | --------- | ---------------------------------- |
| Statements | 70%       | 78.43%                             |
| Branches   | 60%       | 60.84%                             |
| Functions  | 70%       | 82.51%                             |
| Lines      | 70%       | 80.01%                             |

The configured exclusions are `src/lib/types.ts`,
`src/lib/supabase/database.types.ts` and `agent/types.ts`. The first two contain
type declarations; `agent/types.ts` also contains the executable identity
helpers `defineTool` and `defineAgent`. Therefore this is **not coverage of
every runtime module**. UI components and page files outside the include globs
are also outside the percentage. This scope disclosure does not change the
coverage configuration or thresholds.

Branch coverage sits close to its floor. The thinnest areas are the Supabase
adapters, the session route and the agent tools. Adding untested production
branches can lower coverage; adding a test by itself does not enlarge the
production-code denominator. Keep the scope explicit and do not relax the
thresholds to make a future change easier.

## Lint policy

The flat config keeps the Next.js web-vitals and TypeScript rule sets and adds
explicit safety rules: `eqeqeq`, `no-debugger`, `no-eval`, `no-implied-eval`
and `no-new-func`. Two narrow allowances are documented in the config itself:

- `no-undef` is off for TypeScript files, because the TypeScript compiler
  already resolves undefined symbols and the core rule misreads type-only names.
- `@typescript-eslint/no-explicit-any` is off for `tests/**`, whose adapters model
  fluent third-party clients with heterogeneous callback values. Production
  code keeps the strict rule.

The lint gate found and fixed real issues rather than being silenced: unused
imports, a `prefer-const` violation, three loose `!=` comparisons in the
Supabase data mapping, useless regular-expression escapes, an unstable React
effect dependency, and three `<img>` elements replaced with `next/image`.

## Dependency findings

- `eslint` 9.39.5, `eslint-config-next` 15.5.29, `@eslint/js` 9.39.5,
  `@eslint/eslintrc` 3.3.7, `globals` 16.5.0.
- `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` 8.72.2.
  `eslint-config-next` 15.5.29 resolves the 6.x line, which cannot load under
  ESLint 9 (`allowShortCircuit` is missing) and also carries a vulnerable
  `minimatch` range. Pinning 8.72.2 resolves both.
- `@vitest/coverage-v8` 5.1.0 matches the installed Vitest exactly.
- `npm audit` and `npm run audit:production` report **0 known advisories**.

## Verification — 2026-11-13

Implementation baseline: `1c84859d8093e41ee2ac1d78e2b7c4fc1f09660e`.
The numbers are a snapshot, not permanent badges or a final-release evidence
bundle. Requirements and tested boundaries are mapped in [TRACEABILITY.md](TRACEABILITY.md).

| Check                                        | Result                                        |
| -------------------------------------------- | --------------------------------------------- |
| `npm run test:coverage`                      | 269/269 tests across 21 files; thresholds met |
| `npm run lint`                               | No errors, no warnings                        |
| `npm run typecheck`                          | Pass                                          |
| `npm run audit` / `npm run audit:production` | 0 advisories                                  |
| `npm run test:e2e`                           | 38/38 browser tests                           |
| `npm run test:production`                    | 16/16 production build/browser tests          |
| Prettier check on the changed files          | Pass                                          |

Tools: Node **22.23.2**, Next.js **15.5.29**, React **19.3.0**, Vitest **5.1.0**,
Playwright **1.64.0**, TypeScript **5.9.3**, ESLint **9.39.5**, Prettier
**3.9.10**.

## Scope and limits

These gates describe local and CI behaviour for this repository. They do not
measure clinical correctness, real Supabase Auth/Realtime behaviour, Upstash
latency, database upgrade safety or representative production load. A green
pipeline is necessary, not sufficient, for operating real patient data.

The CI workflow now runs the lint, coverage-threshold, audit and production
build gates, and also runs on the `production-hardening` branch. The workflow
file was published successfully and its new gates were confirmed on the remote
branch.
