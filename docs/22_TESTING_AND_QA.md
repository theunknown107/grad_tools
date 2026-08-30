# 22 — Testing and QA

**Status:** Phase 1 draft
**Principle:** test effort is allocated by **consequence of failure**, not by code volume.

---

## 22.1 Risk-weighted coverage targets

| Area | Consequence of failure | Coverage target | Test types |
|---|---|---|---|
| `packages/academic-rules` | A student acts on a wrong number — unrecoverable trust loss | **100% branch** | Unit, property-based, golden, differential |
| Authorization | Cross-student data disclosure | **100% of endpoints** | Matrix, integration |
| Upload validation | Server compromise | **100% of checks** | Security fixtures |
| Ingestion parsers | Wrong data published as sourced | High | Fixture, golden, robustness |
| Rate limiting | Abuse, source hammering | High | Integration |
| API contract | Client breakage | 100% of endpoints | Schema-contract |
| Student data CRUD | Data loss | High | Integration |
| Document extraction | Wrong analysis | Medium | Fixture |
| UI components | Cosmetic | Moderate | Component, E2E on critical paths |
| Admin tooling | Operator inconvenience | Moderate | Smoke |

Overall line coverage is **not** a target. A repository at 85% coverage with an untested grade-band boundary is worse than one at 60% with the rules engine exhaustively tested.

## 22.2 Test stack

| Layer | Tool | Runs |
|---|---|---|
| Unit, property, component | Vitest + fast-check + Testing Library | Every commit |
| API integration | Vitest + Supertest, real Postgres in Docker | Every commit |
| E2E | Playwright (Chromium, WebKit, mobile viewport) | Every PR |
| Accessibility | axe-core via Playwright | Every PR |
| Performance | Lighthouse CI | Every PR |
| Security | `pnpm audit`, secret scanning, header checks | Every PR |
| Load | k6 | Before Alpha, and before the pilot |

**Integration tests run against a real PostgreSQL instance, never a mock or SQLite.** Constraints, transactions and `SKIP LOCKED` semantics are exactly what needs testing, and none of them exist in a substitute.

### 22.2.1 As built in M5a

Vitest runs three **projects**, because they need different environments and one
of them needs a database:

| Project | Environment | Tests | Requires |
|---|---|---|---|
| `packages` | node | 410 | — |
| `web` | jsdom | 54 | — |
| `api` | node | 238 | real PostgreSQL |

Total: **702 tests, all passing.**

`Docker in Docker` was not available on the development machine, so the API
suite runs against a **disposable local PostgreSQL 18 cluster** on port 55432
with `trust` auth bound to loopback — a real PostgreSQL instance, which is what
the rule above actually requires. `services/api/README.md` documents both the
Docker command and the no-Docker fallback.

The suite is configured by `TEST_DATABASE_URL`. When it is unset the API project
**skips with a loud warning** rather than failing, so a contributor without a
database still gets a usable run. A skipped suite is explicitly **not** a passing
one, and the milestone gate requires it to actually execute.

Each run drops and recreates the `public` schema, so migrations are always proven
from a genuinely clean database rather than from residue of a previous run.

What the API suite covers: migration idempotency, schema shape, **absence of every
student table**, provenance `NOT NULL` and URL-format checks, publication gating,
rule-set activation gating, foreign keys, uniqueness, the attendance-floor check,
seed idempotency, seed verified-only publication, seeded credit totals, health and
readiness, every reference endpoint, empty-list-not-404 semantics, unpublished rows
never being served, the error envelope, malformed and out-of-range parameters,
internal-detail leakage, security headers, framework fingerprinting, correlation
ids, cache headers, CORS allowlist behaviour in both directions, SQL-injection
payloads through path and query parameters, absence of write methods, the 1 MB body
limit, and log redaction.

**Added in M4.1:** rule-set precedence across all six cases (scheme-wide only,
college-specific only, both active, inactive college set, unverified college set,
no match) plus a determinism check that repeats the both-present lookup eight
times; `module_count` served as `null` rather than a default; `colleges`
publication gating; subject lookup by UUID, with a code now rejected as a `400`
instead of silently resolved.

**Added in M5** (149 tests).

*Documents* — every rejection path has a synthetic fixture: empty, oversized,
not-a-PDF, decompression bomb, embedded active content, encrypted, truncated.
Plus filename safety (traversal, control characters, Windows device names),
content-addressed storage keys, storage-root escape, duplicate detection, and
extraction reporting text_available / ocr_required / extraction_failed.

*Sources* — the permission gate refused for each of eight independent reasons;
SSRF coverage over loopback, RFC1918, link-local, cloud metadata, CGNAT and
IPv4-mapped IPv6; scheme refusal; adapter golden output; malformed and hostile
markup; change detection for new / modified / removed, including the property
that an unchanged poll records nothing.

*Gates (real PostgreSQL)* — every constraint in migration 0004, asserted by
attempting the forbidden write and expecting the database to refuse it.

**The schema is prepared once**, in `test/global-setup.ts`, rather than per
file. Two files each dropping the schema in their own `beforeAll` let their
hooks interleave, and one found its tables gone mid-setup. One owner, once,
before anything else runs.

**Added in M5.1** (26 tests). Both narrowed gates, from both sides:
`manual_upload` and `manual_entry` refused at the permission check and refused
by the constraint even with every other gate open; an enabled source refused
when switched to a manual method; a manual source still recordable while
disabled. On the document side, quarantined documents refused as `host` and as
`link`, refused when flipped from private, and hidden from **both** read paths —
the by-id path is asserted separately from the listing, because that is where a
visibility filter gets forgotten.

Several existing M5 tests had to state `state: 'validated'` explicitly once the
new constraint landed. That is the constraint working: they were inserting
public documents in quarantine, which is the state the fix forbids.



**Added in M6:** the student academic core — 32 tests over the pure analytics
module and 22 over the screens, all with **synthetic students only**.

The analytics tests pin the RULES, not the arithmetic: SGPA, CGPA and percentage
come from `@gradtools/academic-rules`, and a test that re-derived them would be
testing a second implementation into existence. One is an explicit regression
guard that the discredited `(CGPA − 0.75) × 10` formula stays unreachable.

Covered: the eight-semester shape · a student starting part-way through ·
lifecycle changes · rule-set pinning and the pre-M6 fallback · asserted-vs-computed
SGPA and its tolerance · CGPA and percentage · subject trend, including that a
subject taken once has none · the strong/weak rule, including that even
performance classifies nobody · "not enough history yet" · backlog states and
that `attempted` is not `cleared` · graduation progress with and without a known
total · local persistence across a remount · and two students at the same
repository boundary seeing nothing of each other.

**Browser QA (M6), real Chromium at 320 / 390 / 768 / 1280** against the built
app with a synthetic third-year student seeded into IndexedDB at run time:

| Check | Result |
|---|---|
| axe-core WCAG 2.1 A + AA, every viewport, four screens | 0 violations — **after two fixes** |
| Horizontal overflow | 0 at every viewport — **after two fixes** |
| Empty state before anything is entered | All eight semesters, and both refusals shown |
| Populated degree | CGPA 8.32, 4 completed / 1 in progress / 3 planned |
| Semester selector | Moves the current semester; only one at a time |
| Long subject name | No overflow |
| Keyboard | Reaches controls; Enter opens the subject list |
| Console errors | 0 |

It found two real defects that unit tests could not:

1. **`scrollable-region-focusable`** — a table that scrolls horizontally was not
   reachable by keyboard, so its off-screen columns were a dead end. `TableScroll`
   is now focusable.
2. **196px of horizontal page scroll at 320px** — traced, by experiment rather
   than by guessing, to a single 1px visually-hidden `<span>`. The usual
   visually-hidden recipe positions the box absolutely, which leaves it at its
   static position; inside a table wider than the viewport that position is
   off-screen and extends the page's scrollable area. Replaced with a
   `clip-path` version that cannot move.

**Added in M5A.7:** a parser-v2 regression suite of 25 tests, **pinning every
defect from both sides**. Each case asserts what v1 does — the bug, reproduced —
and then what v2 does. Keeping v1 in the assertion is what stops the fix quietly
regressing: change v2 back and the v2 half fails; edit the frozen baseline and
the v1 half fails.

The fixtures reproduce the geometry measured on real papers at real proportions
— a 565pt page with its marks column at x≈484, which is exactly what makes v1's
0.7 boundary land inside the question text. No PDF, no OCR engine, no corpus.

| Fixture | Pins |
|---|---|
| A | Text reaching toward the marks column; column measured, not assumed |
| B | A question number centred across its parts; marks on a different line from the label |
| C | MCQ numbered instructions — including that **both** cues are required, and a Kannada block |
| D | Two model papers in one document |
| E | A cell whose marks were lost: kept, not dropped |
| F | A page with no marks column: every word kept, nothing called clear |
| G | Mathematics with damaged OCR: structure kept, notation unrepaired |

**Browser QA (M5A.7), run against a real API holding v1 and v2 runs of nine
papers:**

| Check | Result |
|---|---|
| axe-core WCAG 2.1 A + AA at 320/390/768/1280 | 0 violations |
| Horizontal overflow | 0 at every viewport |
| "full-wave **bridge** rectifier" visible on screen | yes — the defect, fixed, in the browser |
| Parser version and earlier-run notice | both shown |
| Reviewer attribution | "by local-operator" rendered on an accepted record |
| Review on a v2 record | works |
| Keyboard opens the correction form | yes |
| Console errors | 0 |

**Added in M5A.6:** the review workbench — 21 API tests against real
PostgreSQL and 12 web tests. Covered: accept, correct, reject; machine value
preserved; reviewed value persisted; effective value resolution; a second
correction replacing the first; accept clearing an earlier correction; MCQ item
and OPTION review; sub-question Bloom's/CO review; an unknown record kind; a
field that is not correctable; a wrong-typed correction; a review with no
reviewer; parser-version isolation; queue ordering, contents, bounds and
current-run-only; and the five audit questions.

**Browser QA (M5A.6), run against a real API holding 14 extracted papers and 71
adjudicated records:**

| Check | Result |
|---|---|
| axe-core WCAG 2.1 A + AA at 320/390/768/1280 | 0 violations — **after a fix** |
| Horizontal overflow | 0 at every viewport |
| Accept, correct, reject | All three recorded; rejected record stays visible |
| MCQ correction form | Item number, question text, options — and no module/marks/Bloom/CO |
| Machine value visible after correction | 5 struck-through values, 11 "Machine read:" lines |
| Keyboard | Controls reachable and operable |
| Console errors | 0 |

It found a real accessibility defect that unit tests could not: `opacity: 0.62`
on a rejected record dropped **15 nodes** below AA contrast. Replaced with a
dashed edge — the state is already carried in words, so the fade was decoration
that cost readability.

**Added in M5A.5:** question persistence and review, **against real
PostgreSQL** — 34 tests. A real database is the point: the unique key that makes
persistence idempotent, the composite foreign key that stops a descriptive
question attaching to an MCQ paper, the partial index that permits one current
run, and the CHECKs that make a review attributable are all database
guarantees, and none of them exists in a mock.

Covered: paper/question/sub-question persistence · bounding boxes · confidence ·
review states · machine vs reviewed values · duplicate processing · parser
versioning · native/OCR provenance · descriptive fields · MCQ fields · unknown
format · mathematics stored unrepaired · Kannada stored without repairing the
numbering · the HTTP surface · hostile extracted text.

Plus 6 tests for installed OCR languages, after a silent degradation found in
real-document validation (docs/17 §17.17), and 9 web tests for the questions
panel.

**Browser QA (M5A.5), actually run, not inferred from unit tests:** the built
app served against a real API holding one real extracted paper, driven in
Chromium at 320 / 390 / 768 / 1280.

| Check | Result |
|---|---|
| axe-core, WCAG 2.1 A + AA, four viewports | 0 violations |
| Horizontal overflow | 0 at every viewport — **after a fix** |
| Keyboard: focus the toggle, press Enter | Collapses correctly |
| Console errors | 0 |

It found a real defect that unit tests could not: the Documents page scrolled
horizontally by 42px at 320px, present since M5A. A file input carries a large
intrinsic min-content width and a grid column sized to `auto` cannot shrink
below it. Fixed with `grid-template-columns: minmax(0, 1fr)` on both grids and
an explicit width on the input.

**Added in M5A.4:** positional geometry and the structural parser, tested with
**synthetic TSV fixtures built in the test file** — both column orders, both
coordinate systems, marker rows, cross-block row grouping, page boundaries,
sub-question labels, marks/Bloom's/CO column association, the numbered
instruction block, conflicting geometry, and `unknown` extracting nothing.

No PDF, no OCR engine and no database is needed, so the whole layer is
deterministic in CI. The fixtures caught a real defect the real papers had
hidden: `L2` was being stripped to `2` and stored as marks.

**Added in M5A.3-final:** the worker loop, tested against a real database but
with an injected clock and sleep so the suite never waits on real time — idle
sleeping, scheduled recovery, recovery-before-first-claim, prompt stop on abort,
and surviving an unexpected error without dying.

**Shutdown policy is tested directly rather than by signal.** Windows Node has
no catchable SIGINT for a spawned child, so end-to-end signal delivery cannot be
verified on this machine. The decision was extracted into `createShutdownHandler`
and proven there — first signal drains, second exits, never aborts twice — and
`main.ts` is one line per signal. **The signal path itself remains verified only
on the logic level; it is untested on Linux, where the worker will deploy.**

Manually verified with two real worker processes against one database: 4 jobs,
split 2/2, `attempts = 1` on every job — no job claimed twice.

**Added in M5A.3:** the OCR lifecycle. Format detection and configuration
selection are pure functions and are tested exhaustively without a PDF, an
engine or a database — including the three cases that broke earlier detectors: a
descriptive paper worth 50 marks, an MCQ keyword mangled by OCR into a Kannada
glyph, and a paper whose instructions are entirely in Kannada.

Queue and worker are tested against **real PostgreSQL**, because `FOR UPDATE
SKIP LOCKED` is the whole concurrency guarantee and no mock reproduces it. Two
workers racing for one job is tested by actually issuing two concurrent claims.

**Tesseract itself is stubbed in the worker tests.** Running it would make the
suite depend on a machine's installed binaries and add seconds per test; the
engine is qualified by measurement (docs/17 §17.11d), and what these tests own
is the lifecycle around it. The real end-to-end run over actual scans is
recorded in docs/17 §17.15.

**M5A.2 added no OCR tests, deliberately.** The qualification needs the
gitignored corpus, ~100 MB of engine and language data, and a rasterizer — none
of which belong in CI, and all of which would make the suite depend on a
machine's installed software. It is recorded as measurement in docs/17 §17.11d.
The 20 real PDFs remain uncommitted; every automated test still uses synthetic
fixtures.

**Added in M5A.1:** the extraction-outcome semantics — a scan is described as a
processing outcome with informational tone and labelled by its outcome rather
than as "Read", a genuine failure still reads as a failure, and the words
"error", "failed" and "damaged" never appear on a scanned document. The OCR
benchmark itself is **not** a test: it needs the gitignored corpus and external
engines, so it is recorded as measurement in docs/17 §17.11b rather than
pretending to be reproducible in CI.

**Added in M5A:** the private document workflow end to end against real
PostgreSQL — import, quarantine, validation, storage, extraction, section
persistence, duplicate detection, rejection, state transitions — plus the
privacy properties (an imported document never reaches the public listing, and
cannot be turned into a `host` or `link` document by any update) and the
security ones (traversal filenames sanitised, no file-serving route, no storage
key or filesystem path in any response, and an import endpoint that takes bytes
so it cannot be made to fetch a URL).

**Real documents are used for validation, never as fixtures.** A supplied corpus
of 65 academic PDFs is gitignored and exercised manually; every automated test
uses synthetic PDFs generated by `test/fixtures/pdfs.ts`, so the suite stays
deterministic and carries no third-party material (`32/OQ-008`). The real corpus
is what found two validator false positives that no synthetic fixture would have
revealed (docs/17 §17.11a).

**Added in M4.2:** the taxonomy/verified-reference split is pinned from both
sides — `universities` and `branches` must not grow provenance columns, and
`schemes`, `colleges`, `rule_sets`, `subjects` and `syllabus_modules` must not
lose them — plus `active` filtering on both taxonomy endpoints and an assertion
that the seed contains exactly the approved taxonomy and nothing more.

## 22.3 Academic rules engine — the highest standard

### Golden tests
The worked SGPA/CGPA example from the regulation's Annexure-I is encoded verbatim. Disagreement with VTU's own published example means our implementation is wrong. *(Transcription from the source PDF is a Milestone 4 task.)*

### Boundary tests
Every band edge and threshold, tested at value−1, value, value+1:

| Boundary | Values |
|---|---|
| Grade bands | 39/40, 49/50, 54/55, 59/60, 69/70, 79/80, 89/90, 100 |
| CIE eligibility | 19, 20, 21 (of 50) |
| SEE minimum | 34, 35, 36 (of 100) |
| Overall pass | 39, 40, 41 |
| Attendance | 74.9, 75, 84.9, 85, 85.1 |
| Class bands | 39.9, 40, 49.9, 50, 59.9, 60, 69.9, 70 |

The 54/55 and 59/60 boundaries are called out specifically: the B and C bands are 5 points wide while the others are 10, and a uniform-band assumption fails exactly there (`16` §3).

### Property-based tests
Ten properties, defined in `16` §11. The two strongest:

```
∀ cie, target:  result = marksNeeded(cie, target)
                result.ok ⟹ achievesTarget(cie, result.value)          [soundness]
                result.ok ⟹ ¬achievesTarget(cie, result.value − 1)     [minimality]
```

These verify the calculator against the *definition* of correctness rather than against hand-computed examples, which is the only way to be confident across an input space this large.

### Percentage-formula regression tests (mandatory, `DEC-009`)

The obsolete `(CGPA − 0.75) × 10` formula is the single most likely wrong value to reach a student, because every third-party source publishes it. These tests exist specifically to make that regression impossible to ship:

| # | Test | Assertion |
|---|---|---|
| P-1 | Regulation worked example | `percentage(8.20, ruleSet2022) === 82.0` — the exact example printed in clause 22OB 6.7 |
| P-2 | **Obsolete-formula rejection** | `percentage(8.20, ruleSet2022) !== 74.5` — asserts the 0.75 offset is *not* applied |
| P-3 | Seed integrity | The seeded 2022 rule set's `percentage_formula` equals `cgpa_x_10`; fails if a seed edit changes it |
| P-4 | No active rule set uses the offset | Queries all `active` rule sets; **none** may have `percentage_formula = 'cgpa_minus_0_75_x_10'` |
| P-5 | Rule-set required | `percentage(cgpa)` without a rule set fails to compile / throws — no defaulting |
| P-6 | Boundary sweep | CGPA 4.00→40.0%, 6.00→60.0%, 7.00→70.0%, 8.20→82.0%, 10.00→100.0% |
| P-7 | Class equivalence chain | 8.20 → 82.0% → FCD; 6.50 → 65.0% → FC; 5.00 → 50.0% → SC |
| P-8 | Formula isolation | A hypothetical rule set carrying the offset formula produces 74.5 for 8.20 — proving the registry is honoured and the value is data-driven, not hard-coded |

P-2 and P-4 are **negative assertions**, which is unusual and deliberate: they fail loudly if the widely-published wrong formula ever reaches the 2022 path, including through a seed change, a copy-paste from another calculator, or a well-meaning "fix" from a contributor who checked a popular website instead of the regulation.

P-8 verifies the registry actually works. Without it, P-1–P-4 could all pass on a hard-coded `× 10` that ignores the rule set entirely — which would break the moment a second scheme is added.

### Differential tests
Identical inputs run through the client and server paths must produce identical output. A mismatch is a Sev-2 defect (`07` §7.3).

### Real-grade-card tests
Reported SGPA on real grade cards compared against ours. **The only test that validates our reading of the regulation against VTU's actual practice** — and therefore the most valuable one in the project. Required before Alpha.

**Partially satisfied in M4** (`32/OQ-024`). One real artifact — a semester-4
provisional result, [exam session withheld], 9 courses — is validated by
`packages/academic-rules/test/real-grade-card.test.ts`. It confirms the mark
structure, the passing thresholds, a no-SEE course, and the scale of the printed
external column.

**It does not satisfy the sentence above.** A provisional result prints no SGPA,
no CGPA, no credits and no letter grades, so the SGPA comparison this section
actually describes has still never been run. The fixture asserts the absence of
those columns, so the gap cannot be quietly forgotten. Closing it needs a
consolidated marks card.

## 22.4 Authorization testing

Table-driven, generated from the route registry so a new endpoint cannot escape it:

```
for each route in routeRegistry:
  for each actor in [anonymous, wrong-owner, correct-owner, admin]:
    assert response status == expected[route][actor]
```

**A route absent from the expectations table fails the suite.** This is the structural defence against the IDOR class (`13` §T-01) — the test cannot be forgotten, because adding a route without an entry breaks the build.

Additional cases: expired session, revoked session, replayed consumed login token, session fixation attempt, admin endpoint accessed by a non-allowlisted account, ownership failures returning 404 rather than 403.

## 22.5 Security testing

| Test | Assertion |
|---|---|
| SQL injection | Payloads in every string input produce no error and no data leak |
| XSS | Script payloads in stored fields are escaped on render |
| Path traversal | `../` in any path parameter is rejected |
| Upload: wrong type | A PNG renamed `.pdf` is rejected at the magic-byte check |
| Upload: decompression bomb | Rejected without memory exhaustion |
| Upload: embedded JavaScript | Rejected |
| Upload: oversized | Rejected at the proxy |
| Upload: malformed PDF | Extraction child process dies; parent stays healthy |
| CSRF | Cross-origin POST without a valid origin is rejected |
| Headers | Every required security header present with the correct value |
| Log redaction | Email, USN, name, tokens and marks never appear in log output |
| Rate limits | Each dimension enforced; 429 carries `Retry-After` |
| Secret exposure | No secret in the client bundle (build-time check) |
| Enumeration | Sign-in responses identical for registered and unregistered addresses |

The log-redaction test asserts a **negative** across generated log output, which is unusual and necessary: NFR-011 is otherwise unverifiable and would silently rot.

**Executed in M5a** (the rest await the features they test): SQL injection through
path and query parameters, path-traversal-shaped identifiers rejected by the
`referenceIdSchema` regex, security headers, CORS allowlist in both directions,
body-size limit, safe error bodies with no stack/SQL/path leakage, readiness
exposing only status, and log redaction.

The redaction test drives the **shipped** `createLogger` factory through a capture
stream (`ED-29`). A test that re-declared the redaction path list would assert
nothing about production behaviour, which is the exact rot this section warns
about.

Not yet applicable: XSS on stored fields, upload checks, CSRF, rate limits and
sign-in enumeration — none of those code paths exist. `pnpm audit` and bundle
secret scanning are **NOT RUN** as gates yet; there is no CI pipeline.

## 22.6 Ingestion testing

All fixture-based; **no test makes a network request**, which keeps CI fast and guarantees CI never touches an external source.

| Test | Assertion |
|---|---|
| Golden parse | Fixture → exact expected normalized output |
| Truncated HTML | Fails cleanly; never emits partial data |
| Empty response | Fails cleanly |
| Structure changed | Fails cleanly, marks unhealthy, blocks publishing |
| Encoding variants | Handled or rejected, never mangled |
| Change detection | Two fixtures differing by one item → exactly one change event |
| Canonicalisation | Cosmetically different, semantically identical pages → identical hash |
| Anomaly detection | 90% of items changed → publication blocked |
| Robots enforcement | Enabling a disallowed source fails at the constraint |
| Backoff | Simulated 429 produces the correct delay schedule |
| Provenance completeness | Every published record has all provenance fields |

Every real-world parser failure is added to the fixture corpus (`14` §9), so the suite grows to match reality rather than to match imagination.

## 22.7 E2E tests

Only the paths whose breakage would make the product unusable:

| # | Journey |
|---|---|
| E2E-1 | First visit → calculate SGPA → see the derivation with its clause citation |
| E2E-2 | Set up profile → add attendance → bunk planner returns a correct figure |
| E2E-3 | Marks-needed, including the ineligible and unreachable branches |
| E2E-4 | Enter a semester result → SGPA/CGPA/backlogs update |
| E2E-5 | Create an account → sign in via magic link → merge choice presented |
| E2E-6 | Export data → delete account → confirm data is gone |
| E2E-7 | Browse a subject → open a paper → view module priority with evidence |
| E2E-8 | Enable notifications → receive a test push |
| E2E-9 | Offline: calculators and attendance still work with the API unreachable |

Run on Chromium and WebKit, desktop and a 360×740 mobile viewport. E2E-9 is included because offline capability is an architectural promise (`07` §7.7), and untested promises are assumptions.

## 22.8 Accessibility testing

| Test | Method | Gate |
|---|---|---|
| Automated axe scan | Playwright + axe-core, every page | Zero violations |
| Contrast | Automated token-pair check, both themes | AA |
| Keyboard | Scripted traversal of every critical flow | 100% operable |
| Focus visibility | Visual regression | Always visible |
| Screen reader | Manual: NVDA (Windows), VoiceOver (iOS) | Before Alpha |
| Reduced motion | Verify animations are suppressed | Pass |
| Zoom | 200% with no loss of content or function | Pass |

Automated tools catch perhaps 40% of real accessibility defects, so the manual screen-reader pass before Alpha is not optional. See `27`.

## 22.9 Performance testing

| Test | Target |
|---|---|
| Lighthouse mobile | Performance ≥ 90, Accessibility 100, Best Practices ≥ 95 |
| Bundle size | < 200 KB gzipped initial; CI fails on a > 10% regression |
| API p95 | < 300 ms under normal load |
| Calculator latency | < 50 ms |
| Load test | 100 concurrent users, 5 minutes, error rate < 1% |
| Result-day simulation | 10× normal read traffic; verifies CDN and cache absorb it and that **upstream source requests do not increase** |

The last row tests an architectural invariant, not a performance number: user demand must never translate into upstream load (`14` §5).

## 22.10 Data quality tests

Run against production data on a schedule, alerting on failure — these catch problems that unit tests structurally cannot:

| Check | Assertion |
|---|---|
| Provenance completeness | No published external record lacks provenance |
| Rule-set verification | No active rule set lacks `verified_at` |
| Orphans | No `semester_subjects` without a parent record |
| Attendance sanity | No record with attended > conducted |
| Grade consistency | Every stored grade matches recomputation from its marks under its rule set |
| Backlog consistency | Every active backlog corresponds to a failing `semester_subject` |
| Duplicate documents | No two documents share a SHA-256 |
| Source health | No source unhealthy for more than 48 h without acknowledgement |

The grade-consistency check is the most valuable: it would detect a rules-engine regression across the entire existing dataset, including records written before the regression was introduced.

## 22.11 Test data

| Purpose | Data |
|---|---|
| Unit tests | Inline fixtures |
| Integration | Seeded per test in a transaction, rolled back after |
| E2E | Dedicated seed script, isolated database |
| Parsers | Captured real responses, committed |
| PDFs | Synthetic for security tests; real papers for accuracy tests where licensing permits (`17` §11) |
| Grade cards | Real, with consent, **anonymised** — USN and name removed before committing |

**No real student data ever enters the repository or a non-production environment un-anonymised.** Grade-card fixtures keep marks and credits (the parts under test) and drop identity entirely.

## 22.12 CI pipeline

```
PR opened
  ├─ lint + typecheck               ~1 min
  ├─ unit + property tests          ~2 min
  ├─ integration (Postgres service) ~3 min
  ├─ build (bundle-size check)      ~1 min
  ├─ E2E (Playwright)               ~5 min
  ├─ accessibility (axe)            ~2 min
  ├─ security (audit + secrets)     ~1 min
  └─ Lighthouse CI                  ~2 min
                                    ≈ 12 min total

Blocking: any failure. No merge on red.
```

Fast checks run first so obvious failures surface in a minute rather than twelve.

## 22.13 Definition of done (per feature)

A feature is done when **all** hold:

1. Requirement exists in `02` with an ID
2. Design exists where the UI is non-trivial
3. Implementation complete
4. Tests written and passing at the risk-weighted level for its area
5. Error states implemented and tested
6. Security impact reviewed against `13`
7. Accessibility verified (automated plus keyboard)
8. Performance impact measured for anything on the critical path
9. Provenance present for any external academic data
10. Documentation updated — including these documents when behaviour changes
11. Acceptance criteria in `02` demonstrably pass

**"It works on my machine and the UI looks right" satisfies none of items 4–11.**

## 22.14 Release gates

| Gate | Experimental | Alpha |
|---|---|---|
| All tests green | Required | Required |
| Rules engine 100% branch coverage | Required | Required |
| Authorization matrix complete | N/A (no accounts) | Required |
| Accessibility: zero automated violations | Required | Required |
| Manual screen-reader pass | Recommended | **Required** |
| Security review | Recommended | **Required** |
| Load test passed | Not required | Required |
| Backup restore rehearsed | Not required | **Required** |
| Data quality checks passing | Required | Required |
| Real-grade-card validation | Not required | **Required** |

## 22.15 M7 — announcements and notifications

**95 tests across three files.** 40 API tests against real PostgreSQL, 29 domain
tests, 26 component tests.

### What the API tests assert

- The publication gate: an unverified row is not in the feed, and is **404** by
  id — verified live as well as in tests (`404` before publish, `200` after).
- Dedup by `(source_id, external_id)`, then by `(source_id, content_hash)`.
- Unchanged content moves only `last_seen_at`; **changed content withdraws
  verification** and unpublishes.
- URL refusals: `javascript:`, `data:`, private hosts, credentialed URLs.
- The deadline-before-publication CHECK.
- **The VTU gate**: the source registry row reports `enabled = false`,
  `terms_status = 'unknown'`, `access_method = 'none'`, and attempting to enable
  it **throws**. This test exists so that a future change which quietly opens the
  source fails the suite rather than shipping.
- The feed endpoint accepts no student-context parameter.

### What the domain tests assert

Relevance as a **conjunction** (every non-null axis must match); `NULL` meaning
"not targeted"; an unknown student value still showing the notice; deadline
arithmetic on calendar days; **urgent only from a real deadline**; passed
deadlines dropping back; read-then-changed becoming unread; dismissed surviving
updates; one record per announcement id.

### Browser QA (real Chromium, `@axe-core/playwright`)

Run against a built bundle, a real API and a real PostgreSQL database seeded
with demo fixtures.

| Checked | Result |
|---|---|
| axe violations — 3 routes × 320/390/768/1280 | **0** |
| Horizontal overflow, all widths | **0** |
| Console errors | **0** |
| Dashboard summary, list, filters, notification centre | Rendered |
| Relevance filter | 11 notices for a matching student, 9 for a different one |
| Unread count → mark read → mark all read → reload | 9 → 8 → none, and persisted |
| Browser-notification permission on load | Not requested |
| External link | Shows the host, `noopener noreferrer nofollow`, `_blank` |
| Long body (1,559 chars) at 320px | No overflow |
| Empty feed | "No announcements yet…" |
| Unreachable API | "Could not reach the GradTools server. Try again" — distinct from empty |
| Keyboard | Space toggles the filter checkbox |
| Demo labelling | 11 of 11 labelled; no notice claims to be official VTU |

The QA harness is scratch tooling and is **not committed** — it is rebuilt from
this description when a milestone needs it, rather than kept as untested code in
the repository.

## 22.16 M8 — the question-paper library

**80 tests across three files.** 30 API tests against real PostgreSQL, 26
domain tests, 24 component tests. No database test is skipped.

### What the API tests assert

- `host` and `link` appear; **`private` and `blocked` do not**, in the listing
  and by id, where the answer is **404 rather than 403**.
- A syllabus document does not appear in a question-paper library.
- An unvalidated paper **cannot be stored** as publicly visible — the database
  refuses the row, which is stronger than filtering it out.
- The file route serves `host` only: 404 for `link` (no proxy), `private` and
  `blocked`.
- **Traversal has no input**: `../../etc/passwd`, `..%2f..%2f`, `C:\Windows`,
  `aa/bb/cc` and malformed ids are all refused before a key is resolved.
- `%` in a search is a character, not a wildcard.
- Filters compose; an out-of-range value is ignored rather than fatal.
- A catalogued subject supplies scheme, branch and semester; a missing year
  stays null.
- Unknown years sort **last**, in both directions.
- The `documents` CHECKs hold: contradictory taxonomy, hosting without rights,
  and a ninth semester are all refused.
- The library returns the same result whatever a caller claims about
  themselves, and a searched response is `private, no-store`.

### What the domain and component tests assert

A blocked paper gets no action even when it has a source URL; a link paper
never offers a local open; absent metadata renders as nothing rather than a
placeholder; the demo label follows the record's source, not its title; the
semester hint reorders without filtering and **preserves the server's chosen
order** within each group; no sort option claims importance; the extraction
caveat is present and carries no accuracy figure; hostile titles render as text.

### Browser QA (real Chromium, `@axe-core/playwright`)

Against a built bundle, a real API and a real PostgreSQL database.

| Checked | Result |
|---|---|
| axe violations — `/` and `/papers` at 320/390/768/1280, plus both detail pages | **0** |
| Horizontal overflow, all widths | **0** |
| Console errors | **0** app errors (two 404s, from the deliberate private/blocked probes) |
| Papers listed / demo-labelled | 8 of 8 |
| Private and blocked papers in the list | **0** |
| Search `BCS403` → 2; no-match → empty state | as expected |
| Filters: semester 4 → 4, year 2025 → 3, format mcq → 1, composed → 1 | as expected |
| Sort oldest → 2022 paper; newest → 2025 paper | order respected |
| Hosted paper | viewer frame loads, "Open in a new tab" present |
| Link-only paper | "GradTools does not have a copy", **no frame**, original link shown |
| Private / blocked by direct URL | "not in the library", no frame |
| External link | host shown, `noopener noreferrer nofollow`, `_blank` |
| Dashboard section and Browse all | present |
| Keyboard | typing filters the list; Tab moves to the next control |

### Real-document QA (§41)

Five papers from the local corpus, imported through the private route. **None
is committed; the corpus is gitignored.**

| Paper | Outcome |
|---|---|
| Four native descriptive papers, one of them mathematics | Parsed: 10, 10, 18 and 22 questions |
| One scan | `ocr_required`, and the extract route refused with a plain sentence rather than an error |
| All five | `private` / `user_private` / `document_kind = 'unknown'`, **404 from the library by id and by file**, library total unchanged |

The QA harness is scratch tooling and is not committed.

## 22.17 M9 — authentication, authorization and sync

**68 new tests.** 22 authorization (real PostgreSQL, real RLS), 29 sync rules,
17 auth UI. Suite total 1,268, no skips.

### The authorization matrix, against real row-level security

Not a mock and not an application stub: a real PostgreSQL carrying the **same**
`0001_student_cloud.sql` applied to Supabase, with `0000_local_substrate.sql`
supplying the `auth` schema and roles the platform provides. The connection is
`authenticator` — no `bypassrls` — exactly as in production.

| | Result |
|---|---|
| A reads / updates their own profile | Allowed; revision bumped by the database |
| A reads their own semesters | Sees exactly one — theirs |
| A updates B's semester by naming its id | `conflict`; B's row untouched at revision 1 |
| A deletes B's semester | B's row untouched, `deleted_at` still null |
| A enumerates B's records | B's ids absent |
| A exports | B's ids and name absent from the payload |
| A reassigns their own row to B | Refused — `WITH CHECK` |
| Directly at the database as A | B's row returns 0 rows |
| Unauthenticated, all six routes | 401 |
| Forged vs malformed vs absent token | Identical message |
| `anon` at the database | `permission denied` |
| The admin connection | `assertCloudRoleIsSafe` **rejects it** |
| Reference data and papers | Still public |
| `/me` responses | `private, no-store`, `Vary: Authorization` |

### The same policies, against the live Supabase project

Every row above was also exercised directly against the real project before any
code was written on top of them (docs/09 §9.18). The local tests exist so a
change that weakens them fails in CI.

### The sync rules

29 tests over pure functions, guarding the decisions that lose data:

- A conflicted push updates **no** bookkeeping — otherwise the next push would
  consider the local edit already sent and it would vanish silently.
- A pull never overwrites a record edited in both places; it asks.
- A cloud deletion of a locally-edited record asks rather than deleting.
- Tombstones are pushed, so a deletion does not come back on the next pull.
- Nothing destructive is ever the recommended first-sync choice.
- `SYNC_LABEL` has a distinct, non-reassuring string per state, and starts at
  `local_only` rather than `synced`.

### Account isolation

Tested against a **real IndexedDB** (`fake-indexeddb`), because the isolation
*is* the key layout — a mocked repository would prove nothing. Two accounts,
two key spaces, no overlap; signing out leaves the account's data in place.

### Browser QA (real Chromium, `@axe-core/playwright`)

Against a built bundle with the real Supabase project configured.

| Checked | Result |
|---|---|
| axe violations — `/sign-in`, `/account`, `/` at 320/390/768/1280 | **0** |
| Horizontal overflow | **0** |
| Console errors | **0** |
| Google, Apple and email options present | yes |
| Password masked, `new-password` on create, `current-password` on sign-in | yes |
| Recovery answer for an unregistered address | "If that address has an account…" — a **real round trip to Supabase Auth** |
| Account page while signed out | says not signed in; no delete offered |
| Local features with no account | calculators and degree reachable, no auth wall |
| Offline: local page renders, client-side navigation works | yes |
| Offline: the word "Synced" anywhere | **never** |
| Keyboard: Tab reaches the password field | yes |
| Bundle contains a service-role key, a real `sb_secret_`, or a database URL | **none** |
| Bundle contains the publishable key | yes — browser-safe by design |

### What browser QA did NOT cover

**No sign-in was performed.** Google, Apple and email sign-in were not exercised
end to end, no account was created, and no session was established in a browser.
The screens render and the recovery endpoint answers; everything past that is
`NOT VERIFIED` (M9 §63).

## 22.18 M9.1 — the sync correction pass

**23 new tests.** 19 result-sync integration (real PostgreSQL, real RLS), 4 sync
domain. Suite total **1,291, no skips**.

### What the integration tests prove

| | |
|---|---|
| Full round trip | A result plus three subject rows push, and every code, title, credit and grade comes back identical |
| Per-subject revisions | An edit to one subject conflicts alone; its sibling still applies |
| Tombstones | A deleted subject comes back from a pull as a tombstone, not as an absence |
| Cascade | Deleting a result removes its subject rows |
| **Delete before first sync** | A never-synced record pushed as deleted creates **nothing**, and is idempotent on retry |
| **Ownership invariant** | A subject row attached to another student's result is `rejected` by the API and refused by the database when the API is bypassed |
| Cross-user | A's pull contains none of B's subject rows |
| Reassignment | A cannot move their own subject row to B |
| Export | Contains A's result and its subjects, and none of B's |
| **Partial push** | `[good, bad, good]` → `[applied, rejected, applied]`, both good records committed |

### One owner for the test schema

Both API cloud test files were dropping and recreating the schema in their own
`beforeAll`, which interleaved: whichever ran second removed the other's
fixtures mid-run. The reset moved to `global-setup.ts` — the same lesson, and
the same fix, as the reference database in §22.2.

### Browser QA (real Chromium)

| Checked | Result |
|---|---|
| A result with three subjects renders: codes, grades, SGPA | all present |
| axe violations — `/results`, `/account` at 320/390/768/1280 | **0** |
| Horizontal overflow | **0** |
| Console errors | **0** |
| Account page while signed out; the word "Synced" | correct; never shown |
| Storage scopes | `anon` and `u:<id>` keys never overlap |

## 22.19 M9.2 — real provider verification

M9 and M9.1 tested the architecture. This records what was exercised **against
live infrastructure**, and keeps the categories separate rather than collapsing
them into "authentication tested".

### The labels, kept apart

| Label | What it covers |
|---|---|
| UNIT / MOCK TESTED | 1,291 tests, no provider |
| REAL SUPABASE TESTED | The live project: auth settings, JWKS, RLS matrix, composite-key invariant |
| REAL EMAIL TESTED | A real sign-in through the real form, real token, real session |
| REAL BROWSER SESSION TESTED | Chromium: persistence, refresh, second tab, sign-out, sign back in |
| REAL MULTI-DEVICE TESTED | Two independent pulls of one account; cross-account isolation |
| REAL GOOGLE TESTED | **Nothing.** Provider not configured |
| REAL APPLE TESTED | **Nothing.** Provider not configured |

### The chain, exercised end to end

```
real form  →  live Supabase Auth  →  real ES256 token
           →  Express, verifying against the live JWKS
           →  RLS-scoped PostgreSQL  →  the right student's rows
```

| | Result |
|---|---|
| Real token verified against the live JWKS | accepted |
| Tampered signature | `JWSSignatureVerificationFailed` |
| Malformed token | `JWSInvalid` |
| `GET /me` with a real token | identity, from `sub` |
| `GET /me` with no token / a forged one | 401, identical message |

### Real sync, one account

29 records pushed — 5 semesters, 3 semester subjects, 4 results, **10 result
subjects**, 3 attendance, 3 timetable, 1 backlog — all applied. A cold pull as a
second device returned every collection with the right counts, and `BCS403` came
back grade `S`, 3 credits. **No collection disappeared.**

### Real cross-user denial, through the API

| | Result |
|---|---|
| B reads `/me` | B's own profile |
| B pulls | 0 records; none of A's ids |
| B pushes to one of A's record ids | `conflict`; A's row unchanged at 30 |

### Real conflict

A's device wrote 30→31 (`applied`). A stale device wrote 30→32 with the same
base revision: **`conflict`**, carrying the server's value of 31. Two different
subjects of one result updated independently — both `applied`.

### Real account deletion

B's account deleted through `DELETE /api/v1/me`: `{"deleted":true,"existed":true}`,
and afterwards **auth user 0, profile 0, semesters 0, attendance 0**. No orphans.

This exposed a real gap first: `SUPABASE_ADMIN_DB_URL` was defined in config and
**had no consumer**, so deletion could never have worked on any deployment. Now
wired through `createAccountDeleter`.

### Real export

Contains all seven collections with the right counts. Does **not** contain B's
name, a JWT, or the words password / secret / service_role.

### Browser QA, with a real session

| Checked | Result |
|---|---|
| axe violations — `/sign-in`, `/account`, `/first-sync`, `/results` at 320/390/768/1280 | **0** |
| Horizontal overflow | **0** |
| Console errors | **0** |
| Session survives refresh; shared with a second tab | yes |
| First-sync: counts shown, "nothing uploaded yet", keep-local offered | yes |
| Suggested first-sync choice | "Keep this device only" — non-destructive |
| Offline with a real session: screens render, still signed in | yes |
| Offline: the word "Synced" | **never** |
| Tampered session: stack trace / token / SQL on screen | **none** |
| Two accounts: each scope holds its own and lacks the other's | yes, 2 distinct key spaces |

### Log review, over real auth traffic

Absent from the logs: any JWT, `Authorization`, bearer token, refresh token,
access token, the word password, the publishable key, a service-role key, a test
credential, a test email address, **any auth user id**, and any OAuth code.

### Bundle scan, on the production build

696,386 characters across the built assets. Absent: service-role key,
`service_role`, a JWT-shaped secret, a Postgres URL with a password, the
server-only variable names, an OAuth client secret, an Apple private key, a
refresh token, a test credential. Present, as intended: the publishable key.

## 22.20 M9.3 — the frontend redesign

**1,291 tests still pass, and none was weakened to accommodate the redesign.**
Eight assertions changed because the copy or structure they targeted changed;
each was rewritten to assert the same property in the new design rather than
deleted:

| Was asserting | Now asserts |
|---|---|
| `Semester 5 · In progress` as text | The page `h1` names the semester, with the status as a separate label |
| `no results saved yet` | `no results yet` — a sentence, not a card |
| The dashboard shows `Subjects` | Same, scoped to the metric strip rather than a panel |
| `below requirement` in the attention list | The short course, its ratio and its percentage |
| `You can miss` inside a sub-panel | `Can miss 2 classes` on the row itself |
| `These two figures disagree` per semester | `these disagree` per semester **plus** the reason stated once on the page |
| `View all` on the dashboard feed | `All announcements` |
| A paper row's full fact string | The facts that vary, and **not** branch or scheme |

### Browser QA (real Chromium, `@axe-core/playwright`)

12 pages × 4 viewports (320/390/768/1280), against a realistic synthetic
student — semester 5 CSE, four completed semesters, six subjects, varied
attendance, a timetable, a backlog.

| Checked | Result |
|---|---|
| axe violations | **0** across all 48 page/viewport combinations |
| Horizontal overflow | **0** |
| Console errors | **0** |
| Focus ring on the first five tab stops | present on all |
| Mobile bar | Home · GPA · Attendance · Papers · Account |
| Touch target height | 59px (44 minimum) |
| Elements animating under `prefers-reduced-motion` | **0** |

### Visual QA

Screenshots were rendered and inspected at 1280 and 390 for all twelve pages,
before and after, and kept in `tests/screenshots/` (gitignored). An automated
audit of the built CSS and every component then checked the prohibited-pattern
list: AI-purple, neon, decorative gradients, glassmorphism, huge radii, large
shadows, dot-grid, parallax, scroll-driven animation, emoji, sparkle icons,
marketing language, pricing tiers, testimonials, hero sections and unsafe HTML.

**All absent.** Two earlier matches were investigated and cleared: the only
`linear-gradient` is the CSS-drawn `<select>` chevron, and every occurrence of
`dangerouslySetInnerHTML` is a comment stating it is not used.
