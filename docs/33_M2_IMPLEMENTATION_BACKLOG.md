# 33 — M2 Implementation Backlog

**Status:** M2 planning output — **no application code exists and none is written in M2**
**Purpose:** an implementation-ready backlog for M3 (experimental foundation) and the milestones after it.
**Reading order:** §33.1 repository structure → §33.2 vertical slice → §33.3 local/server data split → §33.4 rules-engine interface → §33.5 backlog items → §33.6 test matrix → §33.7 security baseline → §33.8 dependency graph.

---

## 33.1 Proposed repository structure

Reflects the approved modular monolith (`07`) and the shared, dependency-free rules package (`06` §6.5).

```
gradtools/
├── apps/
│   └── web/                     React SPA (Vite + TypeScript)
│       ├── src/
│       │   ├── routes/          route components, one per screen
│       │   ├── features/        feature slices (sgpa, attendance, results, timetable…)
│       │   ├── components/      design-system components (05)
│       │   ├── lib/             storage adapters, api client, formatting
│       │   └── styles/          design tokens (05 §5.2–5.6)
│       └── index.html
│
├── services/
│   └── api/                     Express + scheduler + workers (one deployable)
│       ├── src/
│       │   ├── http/            app wiring, middleware, error envelope
│       │   ├── routes/          route handlers, one file per resource
│       │   ├── modules/         identity · student-data · academic-engine
│       │   │                    content · documents · ingestion · notifications · admin
│       │   ├── providers/       ResultProvider implementations (DEC-011)
│       │   ├── db/              drizzle schema, migrations, seeds
│       │   ├── jobs/            scheduler + workers
│       │   └── observability/   logging, redaction, health
│       └── Dockerfile           (created in M3, not now)
│
├── packages/
│   ├── academic-rules/          PURE. zero dependencies. zero I/O. (§33.4)
│   ├── shared-types/            Zod schemas + inferred types = the API contract
│   ├── validation/              shared validators used by both web and api
│   └── config/                  env schema + boot-time validation
│
├── fixtures/                    captured source responses, sample PDFs, golden outputs
├── tests/                       cross-cutting: e2e (Playwright), a11y, contract
└── docs/                        these 33 documents
```

**Deviation from the suggested structure, with reason:** the brief proposed `apps/web/` and `services/api/` as siblings, which is adopted. `tests/` holds only cross-cutting suites — unit and integration tests live beside the code they test, because tests that live far from their subject rot. E2E, accessibility and contract tests span packages and belong at the root.

**Why four packages rather than one `shared`:** `academic-rules` must have **zero dependencies** (enforced by lint, `19` §2). Bundling it with `shared-types` (which depends on Zod) would break that invariant on the first import. `validation` and `config` are separated for the same reason — `config` imports Zod and Node built-ins and must never be pulled into the browser bundle.

**Not created in M2.** This is a plan. No directories, no `package.json`, no Dockerfile, no CI config.

---

## 33.2 The experimental vertical slice (M3 + M4)

The first implementation milestone builds a **coherent working application**, not a platform skeleton.

```
Student
  ↓ (local, no account)
Profile  →  Dashboard  →  SGPA / CGPA
                       →  Attendance  →  Bunk calculation
                       →  Manual results
                       →  Basic timetable
```

**In the slice:**

| Capability | Requirement IDs |
|---|---|
| Local profile (college, scheme, branch, semester, optional name/USN) | FR-100 |
| Dashboard with honest empty states | FR-021, FR-041 |
| SGPA calculator with derivation and clause citation | FR-001, FR-003, FR-008, FR-009 |
| CGPA + percentage + class | FR-002, FR-004, FR-005 |
| Marks-needed | FR-006 |
| Attendance tracking | FR-020, FR-021 |
| Bunk / recovery calculation | FR-022, FR-023, FR-024, FR-025 |
| Manual result entry via `ResultProvider` | FR-040, FR-046 |
| Backlog derivation from results | FR-042 |
| Basic weekly timetable | FR-102 |
| Demo data, unmistakably labelled | FR-106 |

**Explicitly out of the slice:**

| Excluded | Reason |
|---|---|
| Accounts and sign-in | Stage 1 has accounts disabled (`25` §10) |
| Server-side student profiles | Nothing in the slice needs a server (§33.3) |
| Individual VTU result retrieval | Outside current scope (`DEC-004`, `DEC-011`) |
| Public PYQ redistribution | Gated on `OQ-008` (`DEC-010`) |
| Any production AI dependency | Embeddings are M7; nothing in the slice uses a model |
| Notifications | Alpha feature; needs accounts |
| Ingestion | M6; needs `OQ-006` |
| Admin UI | M8 |

**Success test for the slice:** a student opens the site, sets up a profile in under a minute, records attendance for six courses, asks whether they can miss Thursday's class, enters last semester's result, sees their CGPA — and every number can show its formula and its regulation clause. If that works end to end on a phone, M3+M4 succeeded.

---

## 33.3 Experimental data model — local vs server

Stage 1 accounts are disabled and the requirement is local-first, so the slice is deliberately **client-only for all student data**.

| Data | Stage 1 | Alpha | Notes |
|---|---|---|---|
| Profile (scheme, branch, semester, name, USN) | **Local only** (IndexedDB) | Local + server if account | Never leaves the device in Stage 1 |
| Attendance records | **Local only** | Local + server if account | |
| Semester results | **Local only** | Local + server if account | |
| Timetable | **Local only** | Local + server if account | |
| Preferences (theme, density) | **Local only** | Local + server if account | |
| Calculations | **Client-side**, pure functions | Client + **server recompute** before persistence | `07` TB-1 |
| Subjects, syllabus, rule sets | **Server-backed, read-only, public** | Same | Reference data — no personal data involved |
| Demo data | **Server-seeded, labelled** | **Absent** | `25` §10 |
| Documents, papers | Disabled | Private tier, then gated public | `DEC-010` |
| Announcements | Disabled | Server-backed | `OQ-006` |
| Accounts, sessions | **Disabled** | Server | |

**Rule for M3:** *do not build server-side student profiles.* The approved architecture requires a server only for reference data in Stage 1. Building account infrastructure that nothing uses would be speculative work, and it would contradict the Stage 1 privacy claim that no server holds student data.

**What the API does exist for in Stage 1:** serving schemes, rule sets, subjects and syllabus as public read-only reference data, plus `/health`. That is the entire Stage 1 API surface — small on purpose, and it is what makes the local-first claim literally true.

**Storage abstraction:** the web app writes through a `StudentStore` interface with one implementation (`IndexedDbStore`) in Stage 1. A future `SyncedStore` is a second implementation. One interface, one implementation — justified because the Alpha sync path is a known requirement with a known shape, not speculation.

---

## 33.4 `packages/academic-rules` — the interface

The critical architectural boundary. **Pure, deterministic, zero-dependency, independently testable, usable from browser and server, version-aware.**

### Invariants (enforced by lint and CI)

1. No imports outside the package. No Node built-ins, no browser globals, no framework, no Zod.
2. No I/O, no clock, no randomness, no environment access.
3. Every exported function takes an explicit `RuleSet` — never a default, never a module-level constant.
4. Every function returns a discriminated result; no exceptions for expected outcomes; never `NaN`, `Infinity` or a bare `null`.
5. Every function cites its regulation clause in a doc comment.
6. No VTU-specific number appears in the package source — every threshold, band and formula identifier comes from the `RuleSet`.

Point 6 is what makes the package genuinely scheme-agnostic: adding the 2021 scheme is a data row, not a code change (`16` §13).

### Types

```
RuleSet {
  id, schemeId, collegeId?, version, effectiveFrom, effectiveTo?
  gradeBands:    { letter, points, minPct, maxPct }[]
  specialGrades: { letter, points, countsInCgpa, meaning }[]
  cieMax, cieMinPct, seeMax, seeMinPct, overallMinPct
  attendanceRequiredPct, attendanceCondonablePct, attendanceDxFloorPct
  sgpaFormulaId, cgpaFormulaId, percentageFormulaId
  classBands:    { label, minPct, maxPct }[]
  rounding:      { dp, mode, stage }
  sourceUrl, sourceClause, verifiedAt
}

RuleResult<T> =
  | { ok: true;  value: T; explanation: Explanation }
  | { ok: false; reason: 'insufficient_input' | 'ineligible' | 'unreachable' | 'invalid_input';
      detail: string; explanation: Explanation }

Explanation {
  formula: string          // "SGPA = Σ(Ci × Gi) / Σ(Ci)"
  clause: string           // "22OB 6.6(2a)"
  sourceUrl: string
  inputs: Record<string, number>
  steps: { label: string; value: number }[]
  ruleSetVersion: number
}
```

`Explanation` is returned on **every** call, success or failure. This is what makes "show how this was calculated" (FR-008) a property of the engine rather than UI decoration — the UI structurally cannot display a number without its derivation.

### Public API

```
calculateSGPA(courses: { credits, gradeLetter }[], ruleSet)          → RuleResult<number>
calculateCGPA(semesters: { credits, sgpa }[], ruleSet)               → RuleResult<number>
calculatePercentage(cgpa: number, ruleSet)                           → RuleResult<number>
calculateClass(percentage: number, ruleSet)                          → RuleResult<string>

gradeFromMarks(totalMarks, maxMarks, ruleSet)                        → RuleResult<{letter, points}>
gradePointsFor(letter, ruleSet)                                      → RuleResult<number>
countsInCgpa(letter, ruleSet)                                        → boolean

calculateAttendance(attended, conducted)                             → RuleResult<{pct, status}>
calculateClassesCanMiss(attended, conducted, ruleSet, remaining?)    → RuleResult<number>
calculateClassesMustAttend(attended, conducted, ruleSet)             → RuleResult<number>

calculateRequiredMarks(cieObtained, target, ruleSet)
    → RuleResult<{ requiredSee, bindingConstraint }>
calculateRequiredSGPA(currentCgpa, creditsDone, creditsRemaining, targetCgpa, ruleSet)
    → RuleResult<number>

deriveBacklogs(semesters, ruleSet)                                   → RuleResult<Backlog[]>
```

**Every signature ends in `ruleSet`.** There is no overload without it, which is how `DEC-009` (percentage formula must be rule-set-resolved) is enforced at the type level rather than by convention.

**Explicitly forbidden:** VTU formulas inside UI components, inside route handlers, or duplicated in the API. The API imports the same package the browser does.

---

## 33.5 Backlog items

**Legend** — Stage: `EXP` = experimental slice, `ALPHA` = Alpha. Par: can be parallelised.

---

### M2.1 — Repository foundation
**Objective:** a working monorepo with tooling, before any feature code.
**Dependencies:** none. **Stage:** EXP. **Par:** no — everything depends on it.
**Files/modules:** `pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`, `.eslintrc`, `.prettierrc`, `.gitignore`, `.env.example`, `README.md`, package scaffolds.
**Implementation notes:** pnpm workspaces; TypeScript strict; ESLint with `typescript-eslint`, `jsx-a11y`, `security`; custom lint rules for the `academic-rules` zero-dependency invariant, the no-`dangerouslySetInnerHTML` rule, and the route-guard rule (`26` §6). `git init` + Conventional Commits.
**Acceptance:** `pnpm install`, `pnpm lint`, `pnpm typecheck` all pass on an empty repo; the custom lint rule fails a deliberate test import into `academic-rules`.
**Tests:** lint-rule self-tests.
**Security:** `.gitignore` covers `.env*`; gitleaks pre-commit hook; no secrets committed.
**Performance:** n/a.
**Blocking:** everything.

---

### M2.2 — Frontend foundation
**Objective:** SPA shell, routing, design tokens, base components.
**Dependencies:** M2.1. **Stage:** EXP. **Par:** yes, with M2.3/M2.4.
**Files/modules:** `apps/web/src/{routes,components,styles,lib}`; token CSS from `05` §5.2–5.6; app shell with bottom tabs (<768px) and sidebar (≥1024px); ~15 components from `05` §5.7; theme switching with the pre-paint inline script.
**Implementation notes:** Vite + React + TypeScript; React Router; Zustand for local UI state; Radix primitives for dialog/popover/select/tabs only. Tokens as CSS custom properties; Tailwind configured to expose exactly those with arbitrary values lint-blocked. **Stage 1 navigation is Dashboard / Academics / Attendance only** — unbuilt sections are absent, not disabled (`04` §4.3).
**Acceptance:** shell renders at 320px through 1440px with no horizontal page scroll; theme persists and does not flash; every component has documented states.
**Tests:** component tests for each primitive; axe scan zero violations; 320px reflow test.
**Security:** no `dangerouslySetInnerHTML`; CSP-compatible (no inline styles beyond the theme bootstrap).
**Performance:** initial bundle <200KB gzipped; size-limit in CI.
**Blocking:** M2.6, M2.7, M2.17.

---

### M2.3 — Backend foundation
**Objective:** Express app with middleware, error envelope, config validation, health.
**Dependencies:** M2.1. **Stage:** EXP. **Par:** yes.
**Files/modules:** `services/api/src/http/{app,middleware,errors}`, `routes/health`, `packages/config`.
**Implementation notes:** helmet, CORS allowlist, cookie-parser, body limits (1MB JSON), Zod validation middleware, standard error envelope (`10` §3) with `reference` IDs, pino with the redaction list. **Boot fails on missing/invalid env** (`25` §4). `/health` performs **no dependency checks**; `/health/ready` checks the database.
**Acceptance:** app boots only with valid config; all required security headers present; a malformed request returns the documented envelope; no PII in logs.
**Tests:** header verification; error envelope per code; log-redaction negative test; boot-failure test on a missing variable.
**Security:** the whole item is security baseline (§33.7).
**Performance:** p95 <300ms for trivial routes.
**Blocking:** M2.4, M2.14.

---

### M2.4 — PostgreSQL foundation
**Objective:** schema, migrations, seeds for **reference data only**.
**Dependencies:** M2.3. **Stage:** EXP. **Par:** partly.
**Files/modules:** `services/api/src/db/{schema,migrations,seeds}`.
**Implementation notes:** Drizzle schema for `universities`, `schemes`, `colleges`, `branches`, `rule_sets`, `subjects`, `syllabus_modules` (`09` §9.4). Student tables are **defined but unused in Stage 1** (§33.3). Include from the start: the `rule_set_active_requires_verification` constraint, the `one_active_rule_set` unique index, and the `source_enable_requires_robots_check` constraint on `external_sources`. Separate `gradtools_app` (DML) and `gradtools_migrate` (DDL) roles.
**Acceptance:** migrations apply cleanly to an empty database; the verified 2022 rule set seeds with `verified_at`, `source_url` and `source_clause`; attempting to activate an unverified rule set **fails at the constraint**; attempting to enable a robots-disallowed source **fails at the constraint**.
**Tests:** migration apply/re-apply; every constraint has a test that deliberately violates it; seed integrity test asserting `percentage_formula = 'cgpa_x_10'` (test P-3, §33.6).
**Security:** parameterised queries only; app role has no DDL; no student data in Stage 1.
**Performance:** indexes from `09` §9.8 only.
**Blocking:** M2.14, M2.13.

---

### M2.5 — Shared `academic-rules` package
**Objective:** the pure rules engine (§33.4). **The highest-value item in the backlog.**
**Dependencies:** M2.1. **Stage:** EXP. **Par:** **yes — fully independent of everything else.**
**Files/modules:** `packages/academic-rules/src/{grades,sgpa,cgpa,percentage,attendance,targets,backlogs,types,formulas}`.
**Implementation notes:** implement §33.4 exactly. Formula registry maps `percentageFormulaId → implementation`; `cgpa_x_10` is the only one assigned to an active rule set (`DEC-009`). Rounding once, at the end, half-up, 2dp. Truncate fractional percentages toward zero before band lookup (`ED-17`). F credits count in ΣCi; DX credits do not count in CGPA.
**Acceptance:** the full test matrix in §33.6 passes; 100% branch coverage; the zero-dependency lint rule passes; identical results in Node and browser.
**Tests:** golden (regulation Annexure-I), boundary, property-based, percentage regression P-1…P-8, differential.
**Security:** no I/O means no injection surface; the package cannot leak data.
**Performance:** <50ms per calculation (trivially met — it is arithmetic).
**Blocking:** M2.7, M2.8, M2.9, M2.10, M2.11, M2.13.
**Note:** this item can begin **immediately and in parallel with M2.1** if needed, since it depends on nothing but TypeScript.

---

### M2.6 — Student profile (local)
**Objective:** local-first profile creation and editing.
**Dependencies:** M2.2. **Stage:** EXP. **Par:** yes.
**Files/modules:** `apps/web/src/features/profile/*`, `lib/storage/{StudentStore,IndexedDbStore}`.
**Implementation notes:** three-step setup (`03/UF-02`), every step skippable. **No DOB field anywhere** (`DEC-008`). **No network call during setup** — this is testable and must be tested. Ephemeral-mode banner when storage is unavailable.
**Acceptance:** profile persists across reloads; setup completes with all optional fields blank; zero network requests during setup; ephemeral mode works with storage disabled.
**Tests:** persistence; storage-unavailable path; **a test asserting no network activity during setup**; a schema test asserting no date-of-birth field exists.
**Security:** local only; nothing transmitted.
**Performance:** setup renders <100ms.
**Blocking:** M2.7, M2.10, M2.17.

---

### M2.7 — SGPA / CGPA
**Objective:** the calculator screens with derivations.
**Dependencies:** M2.5, M2.2, M2.6. **Stage:** EXP. **Par:** yes with M2.10.
**Files/modules:** `apps/web/src/features/academics/{sgpa,cgpa}/*`.
**Implementation notes:** course rows (subject optional, credits select, grade select showing letter and points). Live result, no loading state, no network. "Show how this was calculated" renders the `Explanation` returned by the engine. CGPA screen shows percentage and class, and includes the **discrepancy explainer** naming the `(CGPA − 0.75) × 10` formula and citing 22OB 6.7 (`28` §5).
**Acceptance:** matches the regulation worked example; empty state says "Add at least one course", never `0.00` or `NaN`; derivation shows formula, inputs, steps and clause; DX selection explains CGPA exclusion.
**Tests:** component tests; E2E-1; the derivation panel renders every `Explanation` field.
**Security:** no user input reaches a query — it is all client-side arithmetic.
**Performance:** <50ms recompute on input.
**Blocking:** M2.17.

---

### M2.8 — Marks
**Objective:** marks-needed and target-CGPA calculators.
**Dependencies:** M2.5, M2.2. **Stage:** EXP. **Par:** yes.
**Files/modules:** `apps/web/src/features/academics/marks/*`.
**Implementation notes:** implement all three simultaneous thresholds (`16` §9). Ineligible branch when CIE < 40% of CIE max, citing 22OB 6.3(1) and offering the re-registration explanation (6.3(8)). Unreachable branch states the arithmetic rather than clamping to 100. Always name the **binding constraint**.
**Acceptance:** the seven-row table in `16` §9 reproduces exactly; ineligible and unreachable branches render distinctly; no clamping.
**Tests:** the `16` §9 table as cases; property tests for soundness and minimality; E2E-3.
**Security:** client-side only.
**Performance:** <50ms.
**Blocking:** M2.17.

---

### M2.9 — Backlog
**Objective:** derive and display backlogs from saved results.
**Dependencies:** M2.5, M2.13. **Stage:** EXP (derivation) / ALPHA (full tracking UI). **Par:** yes.
**Files/modules:** `apps/web/src/features/results/backlogs/*`, `packages/academic-rules/src/backlogs.ts`.
**Implementation notes:** derive from `F`, `DX`, `AB`, `IC`. Distinguish `reason` — attendance DX versus CIE shortfall — because the remedy differs (22OB 6.3(7)–(8)). Attempt counting per 6.3(9). **`AB` grade-point behaviour is `OQ-018` and unresolved** — the rule set defines it; the engine must not hard-code a value, and no test asserts a specific `AB` grade point until the rule has verified provenance.
**Acceptance:** backlogs derive correctly from a result set; reasons distinguished with the correct remedy text; `AB` handling reads from the rule set.
**Tests:** derivation cases for each reason; a test asserting `AB` behaviour is rule-set-driven (not that it equals a particular number).
**Security:** local.
**Performance:** trivial.
**Blocking:** none.

---

### M2.10 — Attendance
**Objective:** per-course attendance tracking.
**Dependencies:** M2.5, M2.6. **Stage:** EXP. **Par:** yes with M2.7.
**Files/modules:** `apps/web/src/features/attendance/*`.
**Implementation notes:** rows of (course, attended, conducted). Validation: attended ≤ conducted, inline and non-blocking. Three status states with colour **plus** text **plus** distinct icon shape (`05` §5.2). Autosave. Threshold defaults to the rule set's 85%.
**Acceptance:** percentages correct; statuses match `16` §7 thresholds; attended > conducted is rejected with a clear message; autosave works without a save button.
**Tests:** calculation cases; validation; status boundaries at 74.9/75/84.9/85; E2E-2.
**Security:** local only.
**Performance:** <50ms.
**Blocking:** M2.11, M2.17.

---

### M2.11 — Bunk manager
**Objective:** can-miss and recovery calculations.
**Dependencies:** M2.10, M2.5. **Stage:** EXP. **Par:** no — needs M2.10.
**Files/modules:** `apps/web/src/features/attendance/bunk/*`.
**Implementation notes:** `calculateClassesCanMiss` with an optional projection of remaining classes. `calculateClassesMustAttend` with an explicit **unreachable** result reporting maximum attainable percentage. Condonation shown as **discretionary and document-supported**, never automatic (`16` §7). **Never advise skipping** — state arithmetic only (`19` §11, `28` §6).
**Acceptance:** the five-row table in `16` §9 reproduces exactly; never returns a negative; unreachable case states max attainable and the condonation position; no copy anywhere recommends skipping a class.
**Tests:** the `16` §9 attendance table; property tests (non-negativity, inverse); a copy-compliance test against `28` prohibited phrasing.
**Security:** local.
**Performance:** <50ms.
**Blocking:** M2.17.

---

### M2.12 — Timetable
**Objective:** basic weekly timetable.
**Dependencies:** M2.6, M2.2. **Stage:** EXP (basic). **Par:** yes.
**Files/modules:** `apps/web/src/features/timetable/*`.
**Implementation notes:** weekly grid on desktop, day-at-a-time with swipe **and buttons** on mobile. Slot: day, start, end, course, room, type. `end > start` validated. Link to attendance is **deferred** — marking a slot attended is a P2 nicety and adds coupling the slice does not need.
**Acceptance:** slots persist; overlapping slots warned but not blocked; mobile day view navigable by button as well as swipe.
**Tests:** CRUD; time validation; mobile navigation without gestures.
**Security:** local.
**Performance:** grid renders <100ms.
**Blocking:** none.

---

### M2.13 — Manual result import (`ResultProvider`)
**Objective:** result entry through the provider abstraction.
**Dependencies:** M2.5, M2.6. **Stage:** EXP. **Par:** yes.
**Files/modules:** `services/api/src/providers/{ResultProvider,ManualEntryProvider,PasteParseProvider}` (interface + client-side use in Stage 1), `apps/web/src/features/results/*`.
**Implementation notes:** implement the `ResultProvider` interface (`15` §15.5.1) with `manual-entry` now; `paste-parse` is P2. Every stored result records `providerKey`, `authority = 'student_asserted'` and `parserVersion` (`DEC-011`). Grade **derives** from marks via the rule set; a user override is permitted and flagged `user_override`. `sgpaComputed` vs `sgpaAsserted` discrepancy is **shown, not resolved** (`08`).
**Acceptance:** a semester result saves and SGPA/CGPA/backlogs update; a grade override is recorded as such; a discrepancy between entered and computed SGPA is displayed to the student; every result carries provider metadata.
**Tests:** entry and derivation; override flagging; discrepancy display; provider-metadata presence; E2E-4.
**Security:** in Stage 1 nothing is transmitted. **For Alpha:** server recompute before persistence (`07` TB-1), never trusting client values.
**Performance:** <100ms.
**Blocking:** M2.9, M2.17.

---

### M2.14 — Syllabus foundation
**Objective:** reference data model and read-only browsing.
**Dependencies:** M2.4, M2.3. **Stage:** EXP (read-only). **Par:** yes.
**Files/modules:** `services/api/src/modules/content/*`, `routes/subjects`, `routes/schemes`, `apps/web/src/features/syllabus/*`.
**Implementation notes:** public, cacheable, no auth. `GET /schemes/:id/rules` publishes the rule set with clause citations — this is what lets the client derivations cite sources without hard-coding them. Subject and module seeding is **manual, verified data-entry work** and is on the critical path (`02` §2.6) — **start it in M3, not M5.**
**Acceptance:** subjects browsable by scheme/branch/semester; every seeded subject carries `source_url` and `verified_at`; the rules endpoint returns the active rule set with citations.
**Tests:** contract tests against the shared Zod schema; caching headers; a test that no seeded subject lacks provenance.
**Security:** public read-only; no personal data; no auth surface.
**Performance:** cached, `max-age=300, stale-while-revalidate=3600`.
**Blocking:** M2.15, and (later) M7 intelligence.

---

### M2.15 — Paper/document foundation
**Objective:** document model and validation pipeline — **private tier only**.
**Dependencies:** M2.4, M2.14. **Stage:** ALPHA (M5). **Par:** yes.
**Files/modules:** `services/api/src/modules/documents/*`, `jobs/document-processing`.
**Implementation notes:** implement `publication_tier` defaulting to `private` with the rights `CHECK` constraint (`DEC-010`). Full hostile-input validation (`17` §3): magic bytes, size and page caps, **decompression-ratio guard**, active-content rejection, extraction in a **resource-limited child process**. Serving from a separate origin (`OQ-014`).
**Acceptance:** every security fixture is rejected correctly; a malformed PDF kills only the child process; no document reaches the public tier without a recorded rights determination.
**Tests:** decompression bomb; wrong type with `.pdf` name; embedded JavaScript; oversized; malformed; the `CHECK` constraint violated deliberately.
**Security:** the highest-risk item in the backlog. See `13` §T-03 and §33.7.
**Performance:** processing is queued, never synchronous; concurrency 1–2.
**Blocking:** M7.

---

### M2.16 — Notification foundation
**Objective:** subscription model and delivery scaffolding.
**Dependencies:** M2.4, accounts (M6+). **Stage:** ALPHA. **Par:** yes.
**Files/modules:** `services/api/src/modules/notifications/*`.
**Implementation notes:** Web Push (VAPID). **Only a validated, published `ChangeEvent` can trigger a send** — enforced by the `publish_requires_validation` constraint. Daily cap of 5 per student **and** a global hourly cap. Quiet hours. Copy rules from `20` §5 and `28` §7.
**Acceptance:** no notification can originate from unvalidated data; caps enforced; dead endpoints revoked on 404/410; payloads contain no academic data or PII.
**Tests:** constraint test; deduplication; quiet-hours batching across a timezone boundary; global-cap burst test; **template copy-compliance test** against prohibited phrases.
**Security:** push targets only self-registered subscriptions; no user-initiated broadcast exists.
**Performance:** fan-out with a concurrency limit.
**Blocking:** none.

---

### M2.17 — Experimental dashboard
**Objective:** the coherent first screen.
**Dependencies:** M2.6, M2.7, M2.10, M2.11, M2.13. **Stage:** EXP. **Par:** no — it integrates the slice.
**Files/modules:** `apps/web/src/features/dashboard/*`.
**Implementation notes:** three regions — attendance status, current CGPA, one context-sensitive next action. **Dense stat rows, not a wall of cards** (`05` §Stat row). **The empty dashboard is the primary design case**, not an afterthought: three empty states, each one tap from being filled. No invented metrics, no streaks, no gauges.
**Acceptance:** answers Persona A's three questions without scrolling on a 360×740 viewport; empty state has exactly one action per region; every figure links to its source screen.
**Tests:** empty, partial and full states; mobile viewport; axe; no fabricated metric present.
**Security:** local data only.
**Performance:** part of the initial bundle; FCP <2s on 4G.
**Blocking:** the slice's completion criterion.

---

### M2.18 — Testing infrastructure
**Objective:** the harness, before features accumulate.
**Dependencies:** M2.1. **Stage:** EXP. **Par:** yes — **should be early.**
**Files/modules:** `vitest.config.ts`, `playwright.config.ts`, `tests/{e2e,a11y,contract}`, CI workflow.
**Implementation notes:** Vitest + fast-check; Supertest against a **real Postgres in Docker**, never a mock or SQLite; Playwright on Chromium and WebKit, desktop and 360×740; axe-core; Lighthouse CI; size-limit. Fast checks ordered first (`22` §12).
**Acceptance:** full pipeline runs under ~12 minutes; a deliberately broken rule fails the suite; coverage reporting distinguishes `academic-rules` (must be 100% branch).
**Tests:** the harness's own smoke tests.
**Security:** CI runs `pnpm audit` and gitleaks, blocking on high/critical.
**Performance:** Lighthouse and bundle budgets enforced in CI.
**Blocking:** quality of everything else.

---

### M2.19 — Security baseline
**Objective:** the minimum secure foundation (§33.7).
**Dependencies:** M2.3. **Stage:** EXP. **Par:** partly.
**Files/modules:** `services/api/src/http/middleware/*`, `observability/redaction.ts`, CSP config.
**Implementation notes:** see §33.7. In Stage 1 there are no accounts, so authorization is trivial — but the **route-guard lint rule and the authorization test table exist from day one**, so the first authenticated route cannot be added without them.
**Acceptance:** every §33.7 control implemented and tested.
**Tests:** the security suite in `22` §5.
**Security:** the item is the baseline.
**Performance:** negligible middleware overhead.
**Blocking:** any account work.

---

### M2.20 — Observability baseline
**Objective:** know when something breaks.
**Dependencies:** M2.3. **Stage:** EXP (minimal) / ALPHA (full). **Par:** yes.
**Files/modules:** `services/api/src/observability/*`.
**Implementation notes:** pino with redaction; request IDs matching client-facing error references; `/health` and `/health/ready`; Sentry with `sendDefaultPii: false` and a `beforeSend` scrubber. Stage 1 needs logging and health only — **alerting is Alpha**, because there is nothing to page about when there are no users and no student data.
**Acceptance:** every request logged with ID, route, status, duration; no PII in any log line; Sentry scrubber verified.
**Tests:** log-redaction negative test; Sentry scrubber test with a synthetic USN and email.
**Security:** `24` §2 redaction list.
**Performance:** structured logging overhead negligible.
**Blocking:** none.

---

### M2.21 — Deployment foundation
**Objective:** get the experimental site reachable.
**Dependencies:** M2.2, M2.3, M2.4, human approval of `DEC-013`. **Stage:** EXP. **Par:** no — last.
**Files/modules:** `services/api/Dockerfile`, CI deploy workflow, environment configuration.
**Implementation notes:** multi-stage Docker on `node:22-slim` with `poppler-utils` (required) and `tesseract-ocr` (optional), non-root user, `HEALTHCHECK`. Static web build to a CDN host. Migrations as a **separate deploy step** under the DDL role. Experimental environment: `INGESTION_ENABLED=false`, accounts disabled, `noindex`, demo data labelled.
**Acceptance:** site reachable over TLS; API healthy; migrations applied; security headers verified **against the live deployment**; demo data visibly labelled; robots `noindex` present.
**Tests:** post-deploy smoke tests; live header verification.
**Security:** secrets only in the host secret store; boot-time env validation; no secret in the client bundle (build-time check).
**Performance:** FCP <2s on 4G measured against the deployed site.
**Blocking:** Stage 1 launch.

---

## 33.6 M2 test matrix

Full strategy in `22`. This is the specific matrix that must exist **before** implementation begins.

### SGPA
| Case | Expectation |
|---|---|
| Regulation Annexure-I worked example | Matches to 2dp |
| Single course | SGPA = that course's grade points |
| F grade present | Credits **included** in ΣCi; 0 points contributed |
| DX grade present | **Excluded** from CGPA (22OB 6.2(1)) |
| Zero courses | `ok:false, reason:'insufficient_input'` — not `0.00`, not `NaN` |
| Zero total credits | `ok:false` — no division by zero |
| All grade letters | Each maps to the correct point value |

### CGPA
| Case | Expectation |
|---|---|
| Single semester | CGPA = that SGPA |
| Multiple semesters | Credit-weighted per 22OB 6.6(2b) |
| Semester with zero credits | Excluded, no division by zero |
| Rounding | Once, at the end, 2dp, half-up |

### Percentage (`DEC-009` — mandatory)
| ID | Case | Expectation |
|---|---|---|
| P-1 | **CGPA 8.20** | **82.0** — the regulation's own worked example (22OB 6.7) |
| P-2 | **CGPA 8.20** | **≠ 74.5** — negative assertion that the 0.75 offset is not applied |
| P-3 | Seeded 2022 rule set | `percentage_formula === 'cgpa_x_10'` |
| P-4 | All active rule sets | **None** uses `cgpa_minus_0_75_x_10` |
| P-5 | `calculatePercentage(cgpa)` without a rule set | Does not compile / throws — no defaulting |
| P-6 | Sweep | 4.00→40.0, 6.00→60.0, 7.00→70.0, 8.20→82.0, 10.00→100.0 |
| P-7 | Chain | 8.20→82.0→FCD; 6.50→65.0→FC; 5.00→50.0→SC |
| P-8 | Hypothetical offset rule set | Yields 74.5 for 8.20 — proves the value is data-driven, not hard-coded |

### Attendance and bunk
| Attended | Conducted | Threshold | Current | Can miss | Must attend |
|---|---|---|---|---|---|
| 45 | 50 | 85% | 90.0% | 2 | 0 |
| 42 | 50 | 85% | 84.0% | 0 | 4 |
| 40 | 50 | 85% | 80.0% | 0 | 17 |
| 30 | 50 | 85% | 60.0% | 0 | unreachable + max attainable |
| 38 | 50 | 75% | 76.0% | 0 | 0 |
| 0 | 0 | 85% | insufficient_input | — | — |

Plus boundaries at 74.9 / 75 / 84.9 / 85 / 85.1, and property tests: non-negativity, and the inverse property (after attending `must_attend`, the threshold is met).

### Required marks
The seven-row table in `16` §9, including the ineligible row (CIE 18) and the unreachable row (CIE 35, target O). Every row asserts the **binding constraint** is correctly named. Property tests: soundness (the returned SEE achieves the target) and minimality (one mark less does not).

### Backlog handling
Derivation for each reason (`failed`, `attendance_dx`, `cie_shortfall`, `absent`, `incomplete`); attempt counting per 6.3(9); DX remedies distinguished. **`AB` grade-point behaviour is asserted to be rule-set-driven, not asserted to a specific value** (`OQ-018` unresolved).

### Manual result import
Grade derivation from marks; user override flagged; discrepancy between asserted and computed SGPA displayed; provider metadata (`providerKey`, `authority`, `parserVersion`) present on every result; malformed input rejected without data loss.

### RuleSet versioning
An unverified rule set cannot be activated (constraint); two active rule sets for one scheme/college cannot coexist (unique index); a stored result retains its original `rule_set_id` after a new version is activated; a rule change does not retroactively alter historical records.

### Invalid inputs, rounding, edge cases
Negative marks, credits or counts; attended > conducted; marks above maximum; non-numeric input; semester outside 1–8; empty collections; very large values. **Every one returns a discriminated failure — none returns `NaN`, `Infinity` or a silently clamped number.** Rounding applied once at the end, verified against intermediate-rounding drift.

---

## 33.7 M2 security baseline

The minimum before the first implementation milestone is complete. Not enterprise security — but no knowingly insecure foundations.

| # | Control | Stage 1 | Notes |
|---|---|---|---|
| 1 | **Input validation** | Required | Zod on every body, query and param; no handler reads unvalidated input |
| 2 | **Safe API contracts** | Required | Shared Zod schemas; contract tests assert responses match |
| 3 | **Authorization boundaries** | Structure required | No accounts in Stage 1, but the **route-guard lint rule and the authorization test table exist from day one**, so the first authenticated route cannot ship without them |
| 4 | **Secure session design** | Designed, not built | Opaque token, SHA-256 stored, `HttpOnly`/`Secure`/`SameSite=Lax`, single-use magic link in one transaction (`11`). Built when accounts are enabled |
| 5 | **Secure headers** | Required | helmet: CSP without `unsafe-inline`/`unsafe-eval`, HSTS, `nosniff`, `frame-ancestors 'none'`, `Referrer-Policy` |
| 6 | **XSS prevention** | Required | React escaping; `dangerouslySetInnerHTML` lint-banned; JSON-only API; strict CSP; no third-party scripts at all |
| 7 | **SQL injection prevention** | Required | Drizzle parameterisation; raw SQL banned in handlers; app DB role has no DDL |
| 8 | **Rate limiting foundation** | Required | `express-rate-limit` with a Postgres store; per-IP global limit active in Stage 1; per-account dimensions added with accounts. **Deterministic — no AI** |
| 9 | **File-upload restrictions** | Not in Stage 1 | Uploads are M5. Full pipeline in `17` §3 before any upload endpoint exists |
| 10 | **Secret management** | Required | Host secret store; boot-time env validation; `.env` gitignored; gitleaks pre-commit and CI; build-time check that no secret reaches the client bundle |
| 11 | **Safe logging** | Required | pino redaction list; **negative test** asserting PII never appears in output |
| 12 | **No sensitive data leakage** | Required | Error envelope with reference IDs; no stack traces to the client; Sentry `beforeSend` scrubber; 404 rather than 403 for non-owned resources |
| 13 | **Admin/student separation** | Structure required | Environment allowlist, no role table, no runtime privilege mutation; **admins cannot read individual student records** (`11` §5). Built with the admin UI in M8 |

**Deliberately not built yet:** WAF (`OQ-015`), formal pen-test, SIEM, MFA, per-user feature flags. Each is either premature at zero users or blocked on an open question.

**Deliberately built early despite no immediate need:** the route-guard lint rule, the authorization test table, and the log-redaction test. All three are cheap now and become expensive to retrofit once dozens of routes exist — and each is the structural defence against a defect class (`13` §T-01, §T-16) rather than a fix for a present bug.

---

## 33.8 M2 dependency graph

```
M2.1 Repository foundation
 ├──────────────────────────────────────────────► M2.5 academic-rules  (fully parallel,
 │                                                                      no other deps)
 ├──► M2.2 Frontend foundation ──┬──► M2.6 Profile ──┬──► M2.7 SGPA/CGPA ──┐
 │                               │                   ├──► M2.10 Attendance ─┼──► M2.17
 │                               │                   │        │            │   Dashboard
 │                               │                   │        └► M2.11 Bunk┤
 │                               │                   ├──► M2.12 Timetable  │
 │                               │                   └──► M2.13 Results ───┤
 │                               └──► M2.8 Marks ─────────────────────────┘
 │                                                              │
 │                                                              └──► M2.9 Backlog
 │
 ├──► M2.3 Backend foundation ──┬──► M2.4 PostgreSQL ──► M2.14 Syllabus ──► M2.15 Papers
 │                              ├──► M2.19 Security baseline                    (ALPHA)
 │                              └──► M2.20 Observability          M2.16 Notifications
 │                                                                              (ALPHA)
 ├──► M2.18 Testing infrastructure  (early — quality of everything depends on it)
 │
 └──► M2.21 Deployment foundation   (last; needs 2.2 + 2.3 + 2.4 + DEC-013 approval)
```

**Critical path:** `M2.1 → M2.2 → M2.6 → M2.10 → M2.11 → M2.17`.

**Highest parallelism:** M2.5 (`academic-rules`) depends only on TypeScript and can be built first, alongside or even before the repository scaffolding. It is also the highest-value item. **Recommended start point.**

**Frontend and backend tracks are independent** until M2.14, because Stage 1 student data is entirely local (§33.3). This is a deliberate property of the local-first decision: the API is not on the critical path for the vertical slice.

**Items that are ALPHA, not experimental:** M2.15 (papers), M2.16 (notifications), and the full extent of M2.19/M2.20. They appear here so the foundations laid in M3 do not preclude them.

---

## 33.9 Cross-review against the architecture documents

| Checked against | Result |
|---|---|
| `07` System architecture | Consistent — modular monolith, module names match, `ResultProvider` boundary reflected in M2.13 |
| `09` Database schema | Consistent — M2.4 seeds reference data only; all three policy constraints implemented from the start |
| `10` API specification | Consistent — Stage 1 exposes only public reference endpoints and health, a documented subset |
| `11` Auth | Consistent — accounts disabled in Stage 1; session design specified but not built; guard structure exists early |
| `12` Privacy | Consistent — no server-side student data in Stage 1; no DOB anywhere; M2.6 test asserts no network call during setup |
| `13` Security | Consistent — §33.7 implements the baseline; upload pipeline deferred with uploads |
| `16` Academic rules | Consistent — §33.4 signatures all take an explicit `RuleSet`; `AB` left rule-set-driven per `OQ-018` |
| `17` Documents | Consistent — M2.15 is private-tier only, with the rights constraint |
| `22` Testing | Consistent — §33.6 is the concrete instance of the strategy; percentage regression tests included |
| `25` Deployment | Consistent — M2.21 matches the environment table; `INGESTION_ENABLED=false` |
| `30` Alpha scope | Consistent — every backlog item labelled EXP or ALPHA |
| `31` Roadmap | Consistent — M2.x items map onto M3/M4 (slice) and M5–M8 (later) |

**Contradictions found and fixed during this cross-review** are recorded as C-13 … C-22 in `32` Part D.

---

## 33.10 Tooling inventory (M2 inspection)

Inspected, not assumed. Re-checked at M2 because a new technical area (implementation) has appeared.

### Local toolchain — verified present

| Tool | Version | Needed for | Status |
|---|---|---|---|
| Node | 22.22.0 | Runtime for web build and API | **Ready** — matches the `node:22-slim` target |
| pnpm | 10.26.1 | Workspaces (M2.1) | **Ready** |
| Docker | 29.5.2 | API image; Postgres for integration tests (M2.18) | **Ready** |
| psql | 18.3 | Local database, migration work | **Ready** — client newer than the Postgres 16 target, which is fine |
| `pdftotext` | 4.00 (poppler) | PDF extraction (M2.15) | **Ready** — already proven on the VTU regulation PDF in Phase 1 |
| `tesseract` | — | OCR fallback for scanned papers | **NOT INSTALLED** — optional by design (`06` §6.6); install before M5, and the feature degrades gracefully without it |

**No blocking toolchain gaps for M3.** The only missing binary is optional and not needed until M5.

### Repository state

`git` is **not initialised** and no `.claude` project configuration exists. Both are M2.1 tasks, not defects.

### Claude Code capabilities

| Capability | Verdict for M3 |
|---|---|
| `WebSearch` / `WebFetch` | **Use** — verifying VTU subject/credit tables during the M2.14 seeding work, which is manual verified data entry on the critical path |
| Bash + `pdftotext` | **Use** — same pattern that extracted the regulation in Phase 1; needed for subject and syllabus seeding from scheme PDFs |
| `code-review`, `security-review` | **Use from M3 onward** — `security-review` on every PR touching auth, uploads or the API surface |
| `pr-review-toolkit` agents (code-reviewer, silent-failure-hunter, type-design-analyzer, pr-test-analyzer) | **Use selectively** — `silent-failure-hunter` is well matched to the rules engine's discriminated-result contract, where a swallowed error would surface as a wrong number |
| `ponytail-review` | **Use** — guards against speculative abstraction, which is the specific failure mode this backlog is written to avoid |
| UI/UX skills (`ui-ux-pro-max`, `impeccable`, `minimalist-ui`, `frontend-design`) | **Use at M2.2** — the design system in `05` is specified; these help implement it rather than redesign it |
| `scrapling-official` | **Defer to M6** — and only after `OQ-006` |
| Figma MCP | **Not needed** — the design system is specified in text; introducing a design tool now adds a step without adding information |
| Vercel MCP + skills | **Not applicable** — `DEC-005` requires a long-running container, which is not the Vercel model |
| Netlify, Notion, Canva, Google Drive, SlidesGPT MCPs | **Unavailable** — require OAuth; this session is non-interactive. Authorize via claude.ai connector settings or `/mcp` in an interactive session if wanted |
| PostgreSQL MCP, browser-automation MCP, PDF MCP | **Do not exist here** — replaced by `psql`, Playwright and `pdftotext` respectively, all verified present |

**Net change since Phase 1:** the local toolchain check is new and its result is the most useful M2 tooling finding — M3 can begin without installing anything.

## 33.11 What M2 deliberately does not decide

| Deferred | Until |
|---|---|
| Enabling any external source | `OQ-006` terms review |
| Publishing any document publicly | `OQ-008` rights determination |
| `AB` grade-point value | `OQ-018` verified provenance |
| Final Alpha hosting and database provider | Alpha planning; recommendation recorded as `DEC-013` |
| Whether OCR is the main path | `OQ-019`, measurable only with real papers |
| Embedding model viability | `OQ-022`, measurable in M3 |
| Whether attendance entry is sustainable | Stage 2 evidence (assumption `A2`) |

None of these blocks the vertical slice. That is the point of the slice's boundaries.
