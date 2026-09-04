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
provisional result carrying 9 courses — was validated **privately**. It
confirmed the mark structure, the passing thresholds, a no-SEE course, and the
scale of the printed external column.

`packages/academic-rules/test/synthetic-grade-card.test.ts` now guards those
conclusions against a **synthetic** fixture. The real record is not committed
(docs/12), so these tests are regression guards rather than evidence — the
distinction is stated in the test file itself so a future reader does not
mistake invented rows for a document VTU issued.

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

## 22.21 M9.4 — the reference-driven redesign

### What the suite says

**39 files, 1294 tests, all passing.** Three are new; **none was changed,
weakened, skipped or deleted.** That the other 1291 passed untouched is the
useful result: the redesign is a token revaluation, so it could not have moved
anything a behavioural test asserts, and the suite confirms it did not.

The three new tests cover the one piece of new logic — which class the Today
list marks as next:

| Test | Why it exists |
|---|---|
| Marks exactly one class, the first not finished | An accent on three rows is a palette, not a pointer |
| Marks the class in progress, not the one after it | At 11:30 a student wants the room they should be walking into |
| Marks nothing once the day is over | A highlight that outlives the day lies about where the student should be |

They needed `vi.useFakeTimers({ shouldAdvanceTime: true })`. A frozen clock
makes every Testing Library `findBy*` hang until it times out, because those
queries poll on real timers — the first attempt failed three times at 20s each
for exactly that reason.

### Browser QA — MANUALLY VERIFIED

Real Chromium, production build, a synthetic semester-5 student seeded into
IndexedDB, the clock pinned to a Monday morning so the Today list has classes in
it. **Both themes**, twelve routes, four widths:

| | Dark | Light |
|---|---|---|
| Routes x viewports | 12 x 4 | 12 x 4 |
| axe violations (WCAG 2.0/2.1 A + AA) | **0** | **0** |
| Horizontal overflow | **0px** | **0px** |
| Console errors | **0** | **0** |

Running the sweep in both colour schemes is new in M9.4 and is now the standard.
A palette can pass contrast in one theme and fail in the other, and the only
defect the redesign introduced — `.primaryLink` at 2.72:1 — was a
dark-theme-only failure that a single-theme sweep would have shipped.

### Visual QA — VISUALLY VERIFIED

Screenshots were inspected against the reference images, not merely captured.
Checked: type hierarchy and weight, the ambient radial, glow restraint (the
primary action and the brand mark, nothing else), border and radius consistency,
the metric strip in both its module and strip forms, the bottom bar's active
pill, the next-class accent, and empty and loading states.

### NOT VERIFIED

- **No real device.** All viewport work is emulated Chromium. Nothing here is
  real-device verified; `env(safe-area-inset-bottom)`, `backdrop-filter`
  performance on a mid-range phone, and how the ambient radial reads on an OLED
  panel are all untested on hardware.
- **No browser but Chromium.** `backdrop-filter` and
  `prefers-reduced-transparency` are unverified in Safari and Firefox. Both
  degrade to a solid bar by design, so the failure mode is known even though the
  behaviour is unobserved.

## 22.22 M9.5 — the layout redesign

### The suite

**39 files, 1295 tests, all passing.** One test was rewritten because the thing
it read no longer exists, and one was added.

| Test | What happened |
|---|---|
| `renders the Stage 1 destinations and omits unbuilt ones` | **Rewritten, not weakened.** It read `navs[0]` — the sidebar. The property is unchanged (every built destination reachable from the shell, nothing unbuilt as a dead link); it now reads every `<nav>` in the shell and opens Academics to check the second tier |
| `marks the open area and the current destination` | **New.** Two tiers means two `aria-current` markers, and a horizontal bar is only navigable if it says which of eleven chips is the current page |

### Browser QA — TESTED

Real Chromium, production build, a synthetic semester-5 student in IndexedDB,
clock pinned to a Monday morning. **Both themes, twelve routes, nine widths** —
320, 360, 390, 430, 768, 1024, 1280, 1440, 1920:

| | Dark | Light |
|---|---|---|
| Page loads (12 routes x 9 widths) | 108 | 108 |
| axe violations (WCAG 2.0/2.1 A + AA) | **0** | **0** |
| Horizontal overflow | **0px** | **0px** |
| Console errors | **0** | **0** |

### Three defects the sweep caught

Recorded because all three were invisible in the four-width sweep M9.4 used.

| Defect | Where | Why it happened |
|---|---|---|
| `link-name` on every route below 480px | Brand link | The wordmark was hidden with `display: none`, which removes it from the accessibility tree; the mark beside it is `aria-hidden`, so the link had no accessible name at all. Now visually hidden with `clip-path` |
| `Accou` — a clipped area tab | Top bar at 390px | Two circular actions plus three area tabs plus the brand exceeded the row. The account circle is hidden below 1024px, and both tiers now scroll |
| **Subject codes broken one character per line** | Timetable week grid at 900–1080px | Six columns of a 900px page leave a code ~45px, and `overflow-wrap: anywhere` did exactly what it was asked to. The week grid now starts at 1100px and stacks the time above the subject inside a column |

The timetable defect **predates M9.5** — the grid has started at 900px since it
was built. It was never seen because no sweep had tested a width between 768 and
1280.

### NOT VERIFIED

- **No real device.** All nine widths are emulated Chromium.
- **No browser but Chromium.** `backdrop-filter`, `prefers-reduced-transparency`
  and scroll-snap-free horizontal nav scrolling are unverified in Safari and
  Firefox.
- **No keyboard-only pass by hand.** Focus order, `aria-current` and focus rings
  are asserted by axe and by unit test, not by a person tabbing through.

## 22.23 M9.5.1 — comparative visual QA

The automated sweep is unchanged and still passes; what M9.5.1 added is the
question it cannot answer. For every route, at every pass: capture, **open the
screenshot**, compare it against the reference images, name the largest
mismatches, fix, capture again.

### What that found, in order

| Route | Mismatch | Fix |
|---|---|---|
| Every page | Content sat directly on the page ground; the references never do | `Panel` draws a surface again |
| Navigation | Tabs 4px apart in a 56px bar — a converted sidebar, not product navigation | 64px bar, 8px gaps, 16px padding, 38px tall |
| Dashboard | Metric strip dissolved into two hairlines on desktop, making the five figures the least substantial thing on screen | Module at every width |
| Dashboard | Fifth metric wrapped to its own line beside the rail | Column cap 132 → 124px |
| Attendance | The course list was bare while the form above it was a surface | List into a flush panel |
| Question papers | 50 rows floating on the ground | One panel, 50 dense rows |
| Notifications | Eleven checkboxes spread across 1770px | `--settings-max: 860px` |
| Mobile, all routes | Area tabs cut mid-word at the scroll edge | Fade mask on both tiers |

### A regression caught by inspection, not by tests

Refactoring the mute-list grid replaced the first selector in a shared
`.list, .compactList, .muteList` rule, which silently gave the announcements
and paper lists a 190px column grid. Every test still passed, axe was clean and
there was no overflow — **the automated suite could not see it**. Reading the
resulting CSS did. Reverted before it shipped.

That is the argument for this section: the engineering gates are necessary and
they are not sufficient.

### Results

**39 files, 1295 tests, all passing** — none rewritten this pass; the changes
were presentational and the suite asserts behaviour. Both themes, 12 routes,
9 widths (320/360/390/430/768/1024/1280/1440/1920): **0 axe violations, 0
horizontal overflow, 0 console errors** in each theme.

## 22.24 M9.5.2 — the icon pass, and the QA environment it exposed

### Results

`pnpm verify`: **39 files, 1295 tests, 0 failed.** No test changed — the pass was
presentational and the suite asserts behaviour.

Both themes × 12 routes × 9 widths (320/360/390/430/768/1024/1280/1440/1920) —
**216 page loads per theme**: 0 axe violations, 0 horizontal overflow, 0 console errors
in each.

Instrumented icon audit across 12 routes: 165 SVG instances, **one** `stroke-width`
(1.5), **one** `viewBox` (`0 0 24 24`), 0 missing `aria-hidden`/`focusable`, **31
icon-only controls all with accessible names**, and every rendered size one of the five
tokens.

### The defect the gates could not see

`gpa` drew a sigma inside a rounded box; at 16px the sigma was 3.6px wide and mushed into
a blob. **Tests passed, axe passed, nothing overflowed.** It was found by opening the
screenshot. Second time this milestone series that the engineering gates were necessary
and not sufficient (cf. §22.23).

### The QA environment is now written down

Two routes — Question papers and Profile — fetch from the API during the sweep. This
pass lost real time to two failure modes that do not announce themselves:

1. **The API was down.** The sweep reported console errors, but as
   `ERR_CONNECTION_REFUSED` on a URL that looks unrelated rather than as "this QA run is
   meaningless".
2. **The API was up on a port it did not trust.** `WEB_ORIGIN` defaults to the Vite dev
   server's `:5173`, which does not cover the harness's `:4322`. Requests were refused by
   CORS and the pages fell back to error states that look like ordinary empty states in a
   screenshot. Every ad-hoc probe written on another port hit this — and two intermediate
   findings in this pass ("micro and small icons never render", "0×0 icons") were
   artefacts of exactly that, not product defects.

`tests/README.md` now carries the full procedure: start the cluster, start the API
against `gradtools_m8` with `WEB_ORIGIN` including `http://localhost:4322`, and **confirm
three endpoints return 200 with the CORS header before sweeping**.

**The check that matters is not the exit code.** A green sweep with a dead API is a sweep
of two error states. Papers must read `Showing 50 of NNNN` and Profile's Scheme select
must name a scheme.

## 22.25 M10A — testing the refusals

**40 files, 1315 tests, all passing.** 20 are new; one was rewritten.

The new file, `apps/web/test/intelligence.test.ts`, is mostly about what the
layer **declines** to do. Most of the ways an analytics layer goes wrong are not
arithmetic errors — they are moments where it treats a missing semester as a bad
one, re-grades a result under rules it was not graded under, or invents an
aggregate nobody defined. Each of those would pass a review that only checked
the maths, so each has a test.

| Test | The defect it prevents |
|---|---|
| No trend on one semester | A line drawn through a single point |
| Change across a gap is null | Reporting S3 as "+1.0 on the previous semester" when S2 was never entered |
| A missing semester is not the lowest | An absent record read as a poor one |
| Unavailable rule set excluded, not re-graded | The M6 defect returning through the analytics door |
| Ungradeable result excluded | An unusable grade letter silently becoming 0.00 |
| Deltas use computed, never asserted | Mixing a grade-card number into one row and a computed one into the next |
| No `mean`/`meanSgpa`/`average` property | A second aggregate competing with CGPA |
| Percentage is CGPA × 10, never 77.5 | The `(CGPA − 0.75) × 10` formula third-party calculators still publish |
| No key matching `/percentile\|rank\|cohort\|peer/` | Peer comparison arriving by accident |
| In-progress semester is not "missing data" | Telling every student mid-semester their records are incomplete |

### The rewritten test

`semesters.test.tsx > shows a third-year student their history…` counted spans
reading "In progress" across the whole page and expected exactly one. The new
history panel legitimately names the current semester too, so the count became
two. **The assertion was scoped to the Semesters panel, not loosened to `toBe(2)`** —
the invariant under test is "exactly one semester carries each lifecycle state",
and counting page-wide would have turned it into "how many panels mention the
present".

### Browser QA

Both themes, 12 routes, 9 widths (320–1920): **0 axe violations, 0 horizontal
overflow, 0 console errors** in each. The API was up on `:3001` with the QA
origin allowed, so Papers and Profile rendered live data (tests/README.md).

### A fixture bug, not a product bug

The seeded QA student used `status: 'not_started'` for semesters 6–8. The only
valid statuses are `planned | in_progress | completed`, so those semesters were
not recognised as unreached and rendered as empty history rows. Same class as
the invented VTU grade `S` in M9.3: **the harness's data was wrong, and the
screenshot is what showed it.** Fixed in the fixture.

### NOT VERIFIED

- **No real academic record has been through this.** Every test and every
  screenshot uses synthetic data. Correct arithmetic on invented semesters is
  not evidence that a real grade card produces sensible output.
- **No student has read these screens.** Whether "Based on 4 graded semesters of
  8" is reassuring or alarming is unmeasured.
- Real-device, non-Chromium and hand keyboard passes remain outstanding as in
  M9.5.2.

## 22.26 M10B — question intelligence

**42 files, 1354 tests, all passing.** 39 are new: 25 for normalisation and
similarity, 14 for search against **real PostgreSQL** (§48).

### Four real defects found by test, not by review

| Defect | Consequence had it shipped |
|---|---|
| Run-collapse included `.`, so the `…` fold produced a single dot | Ellipses silently destroyed in the matching key |
| Tokeniser split on `\p{L}\p{N}`, excluding combining marks | **Kannada shattered into fragments** and mostly discarded |
| `<> ''` did not exclude whitespace-only text | Blank result rows — and 65 of 126 current corpus questions have empty text, so this was the common case |
| Response selected a column `documents` does not have | 500 on every search request |

### Two defects found by looking at the screenshot

Sort and Format controls remained visible in Questions mode while doing nothing,
and the search hint described paper matching. A control that does nothing is
worse than a missing one: it teaches a student the filters are unreliable.

### The flake, fixed

`reference.test.tsx` failed three times in one session and passed alone every
time. Two timeouts govern these tests and only one was configured: Vitest's
`testTimeout` (20 s) is not Testing Library's `asyncUtilTimeout` (**1 s by
default**). The query takes ~400 ms alone and over 3,800 ms under full-suite
load. Now 5 s, in `apps/web/test/setup.ts`.

### Browser QA

Both themes, 12 routes, 9 widths: 0 axe violations, 0 overflow, 0 console
errors. Questions mode was driven separately (click the label, not the visually
hidden radio) at 390 and 1280: **0 axe violations, 0 overflow** in each.

### NOT VERIFIED

- **Question search was not exercised end-to-end in the browser.** The local API
  process predates the route by 2.5 hours, so the screen rendered its error
  state. The endpoint itself is proven by 14 tests against real PostgreSQL; what
  is unverified is the populated list in a browser.
- **No repetition or similarity behaviour is verified on real data** — the
  corpus cannot produce a repeat.
- **No human ground truth** exists for any extraction (§44).

## 22.27 M10B.1 — populated question search, verified in a browser

M10B closed with "question search was never seen populated in a browser". That
gap is now closed.

### The environment

`gradtools_m8` (the API's usual database) has 63 extracted questions, but 60
belong to a **private** document and the 3 visible ones have empty text — zero
searchable. `gradtools_corpus` holds the real extraction but predates the
library schema.

So a verification database was built: `gradtools_m10b_verify`, migrated to
current schema, seeded, and populated by copying the **real corpus** rows
(documents, extractions, questions) with library metadata applied. One document
(`BCY358A`) was deliberately left `private` so isolation is testable on real
data. **No PDF moved, nothing was committed, and no question text was altered.**

The corpus's one `accepted` record predates the attribution constraint and was
attributed on copy as `agent-adjudicated (M5A)` — which is what it is. It is
**not** human ground truth (§19, `OQ-031`).

### What the browser showed — BROWSER VERIFIED

| Check | Result |
|---|---|
| Questions mode loads, populated | **20 rows** for `explain`, matching the API's `total=20` |
| Narrowing | `anodizing` → **1 row**, matching the API |
| Clearing | back to **30 rows** (the hook's page size, of 47 searchable) |
| Question text visible | Yes, including its real OCR damage |
| Subject / sitting / module / marks | `BCHEM102 · June/July · Module 2 · 6 marks` |
| Provenance | `from a scan` on OCR rows |
| Confidence | `Needs checking` on low-confidence rows; high is silent |
| Open the paper | `/papers/a23afe64…` → detail page `h1 = BCHEM102`, the right document |
| Keyboard | Search → subject select → each result link, in order |
| axe / overflow / console | **0 / 0px / 0** at both 390 and 1280 |

### Security, probed through the live UI — BROWSER VERIFIED

| Probe | Rows | Reading |
|---|---|---|
| `%` | 1 | A wildcard would have returned 30. It is escaped to a literal |
| `_` | 2 | Same |
| `' OR 1=1 --` | 0 | No injection; parameterised |
| `<script>alert(1)</script>` | 0 | And **0 script elements** injected into `main` |
| 300-character query | 0 | Capped server-side at 100, no error |

### A defect found by looking, not by testing

Module rendered as a bare `4` between a sitting and a mark count, reading as a
stray digit. Now `Module 4`. Tests passed, axe passed, nothing overflowed — the
screenshot is what showed it.

### NOT VERIFIED

- **No native-text result exists to verify** (§5). Every native current
  extraction has empty text (`OQ-047`), so all 47 searchable questions are
  OCR-derived. The UI's `native` branch is therefore **code verified only**.
- **Semester and Year filters were exercised through the API, not the UI.** The
  library offers a filter only when more than one value would return something
  (M8 §10); all nine documents share semester 1 and year 2024, so neither
  control renders. API: `search=explain&semester=1` → 20, `&year=2024` → 20.
- No human ground truth for any record.

## 22.28 M10B.2 — sub-question search

**42 files, 1360 tests, all passing.** Six are new; none was weakened.

| Test | The defect it prevents |
|---|---|
| Finds a question whose text lives on a sub-question | OQ-047 itself — a native paper being invisible |
| A container with no text stays out of results | An empty parent rendering as a blank row |
| A missing label becomes `1(?)` | A fabricated `1(c)` (M10B §19) |
| No row holds two parts' text | Synthesising a parent by concatenating its children |
| Parent questions with their own text still return | The union regressing OCR papers |
| A superseded extraction's sub-questions are excluded | Parser versions merging (M10B §24) |

The fixture now builds real container-shaped papers: a parent with empty text and
three parts, one of them deliberately unlabelled.

### Browser — BROWSER VERIFIED

Real Chromium at 390 and 1280, against the real corpus:

| | |
|---|---|
| Native question found | `2(a)`, `2(b)` for "radius of curvature" |
| Mathematical Unicode | Preserved exactly as extracted |
| Provenance | `BMATC101 · June/July · Module 1 · 6 marks · from the PDF text` |
| OCR unchanged | `db. What is Anodizing?…` still `from a scan`, still `Needs checking` |
| Open the paper | → `h1 = BMATC101`, the right document |
| axe / overflow / console | **0 / 0px / 0** at both widths |

### One UI change

Native provenance was previously identified by the **absence** of "from a scan",
which is not something a reader can notice. Native rows now say `from the PDF
text`. Neither phrase claims accuracy; both say where the characters came from.

### NOT VERIFIED

- **Mathematical fidelity is not verified.** Native maths survives as Unicode
  and renders, but nobody has checked a rendered formula against the paper.
  `OQ-030` (Kannada) and `OQ-031` (human ground truth) remain open.
- The verification database is a local copy of the corpus with library metadata
  applied; the production `documents` rows for these papers do not exist.

## 22.29 Academic reference integration

**43 files, 1382 tests, all passing.** 19 new; none weakened.

The figures above are the measured output of `pnpm verify`, not an estimate
written ahead of the run — which is how the previous draft of this section came
to say 1378.

`packages/academic-rules/test/course-result.test.ts` — 17 tests, and the ones
that matter are about refusals:

| Test | The mistake it prevents |
|---|---|
| Passes at 18, fails at 17 | The product's "below 18" drifting from `seeMinPct` |
| CIE-only course passes with external 0 | **Telling a student they have a backlog in a course VTU passed** |
| SEE head is `not_applicable`, never `passed` | "Passed every head" being true of a course never examined |
| External 0 fails *when the course has a SEE* | `hasSee` being inferred from the marks |
| Course carried despite a comfortable total | Reading the total instead of the SEE head |
| CIE-only course still fails on a low CIE | "No SEE" being read as "cannot fail" |

`apps/web/test/app.test.tsx` — a parameterised test renders an 8-subject and a
9-subject semester and asserts no padding row is invented.

**Coverage:** `course-result.ts` at 100% statements/branches/functions/lines.

### NOT VERIFIED

- **No UI change was made**, so there is nothing new to browser-QA. The existing
  sweeps are unaffected.
- **The rule is not yet reachable from the product**: `ResultSubject` cannot
  store internal or external marks, so nothing can call `evaluateCourseResult`
  with real data yet (`OQ-049`).
- The mark shapes in the tests are **invented**, modelled on the artifacts'
  structure. No real marks appear anywhere in the repository.

## 22.30 Theme QA (M9.6A)

Two layers, because neither alone is sufficient.

### Contrast, computed from the stylesheet

`apps/web/test/theme.test.ts` **parses `tokens.css`** and computes WCAG ratios
for all five accents against four grounds — dark bg, dark surface, light bg,
light surface — plus white-on-fill for the primary button. 25 ratios, measured
range **4.87:1 to 11.41:1**, all clearing AA.

Parsing the shipped stylesheet rather than a fixture is the point: a hue edited
in CSS is re-checked without anyone remembering to update the test.

### The palettes, in a real browser

Computed contrast proves the TOKENS are sound. It cannot prove they reach the
pixels — a component with a hard-coded colour, or a rule that only ever matched
the default accent, passes the unit test and still ships a broken palette.

`tests/theme-qa.mjs` drives the built application through all ten appearance ×
accent combinations at 390 and 1280, on Dashboard, Results and Account:

**60 page checks across 10 palettes — CLEAN.** No axe violations
(wcag2a/2aa/21a/21aa), no horizontal overflow, no console errors, and every
palette confirmed applied by reading `data-theme`, `data-accent` and the
computed `--accent` back off the document.

Each context sets Playwright's `colorScheme` to the **opposite** of the
appearance under test, so a bug where `data-theme` is ignored cannot hide
behind a matching system preference.

Screenshots land in `.qa/theme/`, **gitignored** — regenerate them.

### The port trap, again

The first run reported CORS failures on every palette. Cause: the harness
served on 4322 in `visual-qa-seeded.mjs` but this new script used 4323, which
`WEB_ORIGIN` does not name — precisely the failure tests/README warns about.
Fixed by serving on 4322. Worth repeating because the symptom (console errors
on every page) looks nothing like the cause.

### NOT VERIFIED

- **The screenshots are of EMPTY states.** `theme-qa.mjs` does not seed
  IndexedDB the way `visual-qa-seeded.mjs` does, so metrics, tables and charts
  were not rendered in any palette. Token coverage on populated data is
  therefore unproven; the seeded sweep still runs in two schemes only.
- Only 390 and 1280 were swept for themes. 320/768/1440/1920 were not.
- `system` appearance was not swept in the browser; it is covered by unit tests
  only.

## 22.31 M9.6B component tests

`apps/web/test/interaction-components.test.tsx` — 17 tests over Select,
DropdownMenu, IslandTabs, UploadModal and EmptyState. Every assertion is about
BEHAVIOUR or ACCESSIBLE STATE: what the keyboard does, what a screen reader
would be told, what survives Escape. None asserts a class name, because a
component can carry every class and still be unusable without a mouse.

The ones that matter:

| Test | The mistake it prevents |
|---|---|
| Select opens on the current value | A semester picker that re-orients the person every time |
| Arrow keys skip a disabled option | Parking the highlight on something unusable |
| Escape closes without committing | A value changing because someone looked at it |
| Menu never activates a disabled item | An action firing from a row that looked dead |
| Tabs: only the selected tab is tabbable | Tab-trapping a keyboard user in a tab strip |
| Upload rejects an oversized file **out loud** (`role="alert"`) | A rejection that only turns a border red |
| Upload re-checks the type on the File | Trusting `accept`, which drag-and-drop bypasses |

The type-rejection test uses `fireEvent`, not `userEvent.upload`, and says why:
**userEvent honours `accept` and silently drops a non-matching file**, which is
precisely the filter the test needs to bypass. Real drag-and-drop bypasses it
too, which is why the component re-checks.

### Papers filter tests were UPDATED, not deleted

M9.6B replaced the native `<select>` filters with a listbox combobox, breaking
three tests in `papers-ui.test.tsx`. They were rewritten to drive the new
control the way a person does — open it, then read or choose a row. **The
assertions are unchanged**: same values offered, same query parameter sent,
same prohibition on a sort that claims importance.

## 22.32 M9.6B browser QA

`tests/m96b-qa.mjs` — 14 routes × 6 widths (320/390/768/1280/1440/1920) × 2
themes = **168 page checks**. Seeds a synthetic semester-5 student first,
because an empty dashboard exercises none of the metric, table or chart styling
— which is exactly where a theme regression hides.

**Result: CLEAN.** 0 axe violations (wcag2a/2aa/21a/21aa), 0 horizontal
overflow, 0 frontend console errors.

### Two real defects it caught

1. **A crash on `/results`.** `result.sgpaAsserted` came out of IndexedDB as
   `undefined`; the guard was `!== null`, so `formatGpa(undefined)` threw and
   took the whole page down. The type says `number | null`, but nothing
   type-checks a stored record at runtime, and a row written before the field
   existed carries `undefined`. Fixed with `?? null`, matching what
   `domain/academics.ts` already did.
2. **A contrast failure** on the bottom nav at 390/light — see docs/05 §5.22.

Neither was reachable from unit tests: the first needs real stored data, the
second needs real compositing of a translucent bar over scrolled content.

### NOT VERIFIED

- Only the **violet** accent was swept here. The other four are covered by
  `theme-qa.mjs` at two widths on three routes, not across all 14 routes.
- `system` appearance is unit-tested only; the sweep pins explicit light/dark.
- The API was **down** during the sweep, so Papers and Profile rendered their
  error states. Their populated layouts are not covered by this run.
- No screen-reader was driven. ARIA roles and names are asserted; the actual
  announcement text was not heard.

## 22.33 M9.6D populated QA — with the API actually running

The M9.6B/C sweeps ran with the API down, so Papers and Profile were swept in
their error states. That was recorded as NOT VERIFIED and is now fixed.

**Procedure (tests/README.md):** Postgres on 55432; API started against
`gradtools_m8` with `WEB_ORIGIN="http://localhost:5173,http://localhost:4322"`;
CORS header confirmed to name the QA origin before sweeping.

**Confirmed live, not assumed:** `/question-papers` returns **2008** papers,
`/questions/search` returns hits, `/schemes` and `/filters` both 200.
Announcements returns **0** — that is the seeded database's real state, not a
failure, and the announcements pages correctly render their empty state.

**Result: 168 page checks, CLEAN** — 14 routes × 6 widths × 2 themes, 0 axe
violations, 0 horizontal overflow, 0 console errors, and **zero
API-unavailable messages**, which is the number that says the sweep was real.

### The seed now meets the milestone's shape requirement

Four completed semesters, one in progress, an **8-subject** semester and a
**9-subject** one (the variable-count case the real artifacts exposed), one
carried subject, a full week of timetable, and attendance deliberately crossing
both the 85% requirement and the 75% DX floor so the warning and danger states
both render.

### NOT VERIFIED

- **Announcements and Notifications were swept EMPTY.** The database holds no
  announcements, so their populated layouts remain unverified.
- Only the **violet** accent was swept.
- `system` appearance is unit-tested only.
- No screen reader was driven; ARIA is asserted, not heard.

## 22.34 M9.6E QA — populated and empty

Two sweeps, because they catch opposite failures.

| | `m96b-qa.mjs` | `empty-qa.mjs` |
|---|---|---|
| Data | Seeded synthetic student | **None** |
| Matrix | 14 routes × 6 widths × 2 themes = **168** | 14 routes × 2 widths × 2 themes = **56** |
| Catches | Metric, table and chart regressions | Empty states that look broken rather than deliberate |
| Result | **CLEAN** | **CLEAN** |

Both: 0 axe violations, 0 horizontal overflow, 0 console errors. The API was
**up** for the populated sweep (2008 papers, live question search), confirmed
before sweeping.

### A fixture gap the sweep exposed

My Degree rendered every figure blank. The cause was **the fixture, not the
product**: the seeded results carried no `ruleSetId`, and the engine correctly
refuses to grade a result whose rule set it cannot resolve — a regulation
change must never silently re-grade the past (M6 §6). The product behaviour was
right and the seed was wrong. Fixed, and the page now shows CGPA 7.73, 77.3%,
79 credits and 4 of 8 semesters.

This is worth recording because the failure mode is inverted from the usual
one: a green sweep of a page that is silently refusing to compute looks exactly
like a green sweep of a page with nothing to compute.

### NOT VERIFIED

- **Announcements and Notifications are still swept EMPTY** in both sweeps. The
  seeded database holds no announcements, and none were invented for QA —
  fabricating official notices is prohibited (docs/19).
- Only the **violet** accent was swept.
- `system` appearance is unit-tested only.
- No screen reader was driven.
- Interaction QA (§40) was exercised through unit tests — Select, DropdownMenu,
  IslandTabs, UploadModal, Tooltip, Sheet, theme and search all have keyboard
  tests — **but not driven by hand in the browser**.

## 22.35 Route integrity (M9.6F)

`apps/web/test/routes.test.ts` parses the route table in `App.tsx` and checks
every hard-coded `to:` destination in the global search and the public footer
against it.

**It exists because two links were shipped broken.** M9.6B wrote both
destination lists from memory rather than from the route table, and `/degree`
and `/gpa` do not exist — the real routes are `/semesters` and `/academics`.
"My degree" and "SGPA & CGPA" therefore landed a student on the not-found page
from both the search modal and the footer.

Nothing caught it, and it is worth being precise about why:

- **Type checking cannot.** A route is a string.
- **The browser sweep cannot.** It visits routes directly rather than following
  links, so a dead link is never exercised.
- **Unit tests did not.** Each component was tested against its own list, so
  the list and the assertion were wrong together.

The test was verified to fail before the fix — it reports
`expected [ '/degree' ] to deeply equal []`, naming the broken link rather than
just counting.

## 22.36 Interaction QA (M9.6G)

`tests/interaction-qa.mjs` — **31 scripted interactions in a real Chromium**,
driving actual clicks, typing and key presses and asserting what happened
afterwards.

### What this catches that the unit tests cannot

The unit suite runs in jsdom, which has no layout, no compositing, no real
scroll and no true focus. It therefore cannot see a control covered by the
bottom nav, a popover opening off-screen, or a keyboard path that works in
isolation but not on the assembled page. This drives the built application.

Covered: global search (Ctrl+K, `/`, type-filter, Arrow+Enter navigation,
Escape), theme (light switch, accent change **surviving a reload**, System
removing `data-theme`), Results tabs and the row-action menu, My Degree spine
selection and its eight nodes, Timetable Today/Week and the next-class marker,
Papers mode tabs and the Select listbox, Notifications mark-all-read **and its
persistence across a reload**, Announcements relevance filtering and the
synthetic labelling, Profile section switching, the Documents upload modal
opening and closing on Escape, the public dropdown navigation, skip-link focus
order, and on a phone: the detail sheet opening from a row, closing on Escape,
the bottom nav **not covering content at full scroll**, and its active marker.

### It found a defect on its first run

The mobile detail-sheet check failed. Cause: `aria-haspopup="dialog"` is
carried by three controls — the theme trigger, the notification bell and the
subject row — so an unscoped `.first()` clicked the header. Scoped to `#main`.
That is a test-authoring fault rather than a product one, but it is exactly the
kind of ambiguity a real page has and an isolated component test does not.

### Honest scope

**Nobody looked at these screens while the script ran.** This is scripted
browser interaction, not a human pass. It is reported as such throughout.

## 22.37 Accent and system-appearance QA (M9.6G)

`tests/accent-qa.mjs` — **50 page checks across all ten palettes** (5 accents ×
2 appearances) on the five showcase pages, populated. Every check reads
`data-accent`, `data-theme`, the computed `--accent` and `--a-glow-rgb` back
off the document, then runs axe. **CLEAN.**

Earlier milestones swept violet only, with the other four covered by the
token-level contrast test. That test proves the *stops* are sound; it cannot
prove they reach the pixels, which is where a hard-coded colour or an unmatched
selector would show.

### System appearance, verified for real

Previously unit-tested only. The script now flips **Chromium's own colour-scheme
emulation** with nothing written to storage — so `system` is in force — and
reads the painted background back:

| OS setting | `data-theme` | painted body background |
|---|---|---|
| light | *absent* | `rgb(244, 246, 251)` |
| dark | *absent* | `rgb(5, 7, 13)` |

Two genuinely different grounds, with the attribute absent in both. That is the
three-state contract behaving, not merely a unit test asserting it.

## 22.38 The result model (OQ-049)

`apps/web/test/results.test.ts` — 31 tests over `domain/results.ts`.

Two mark rows in that file are **identical** — internal high, external zero —
and have opposite correct answers depending on whether the course has a
semester-end examination. No arithmetic separates them. A model that fills
`hasSee` in from the marks passes every plausible-looking test and tells a real
student they have a backlog in a course the university passed them in, so both
readings are pinned side by side.

| Pinned | Why it is the case that matters |
|---|---|
| A legacy row keeps its grade and credits, and gains marks fields that are **null, not 0** | A zero would say the student scored nothing |
| A `numeric` column arriving as `"4.0"`, and a `date` as a `Date` | Both are how the cloud actually delivers them; rejecting either empties the record on the second device |
| A row with marks, a status and no grade or credits | The ordinary provisional card — and the row the old model could not hold |
| `total ≠ internal + external` is refused | Refused, never repaired: every derived figure would be wrong |
| One side present, the other missing → **no** issue | Demanding the absent number is how a model teaches people to type a zero |
| External 17 → backlog · external 18 → not | 35% of the 50-mark contribution is 17.5; the boundary is pinned in both directions |
| CIE-only, external 0 → **not** a backlog | The SEE head is `not_applicable`, not `failed` |
| The identical row with `hasSee: true` → backlog | Same three numbers, opposite answer |
| `hasSee: null` → backlog `null` | "Not known" is an answer; a guess is not |
| An internal of 96 accepted when `hasSee` is false, refused when true | A CIE-only course is assessed over the whole 100 (22OB 6.1(3)) |
| A pinned rule set this build lacks → nothing computed, and the **source grade still shown** | No substitution (M6 §6); a fact the card stated is not discarded to protect a calculation |
| A source grade and a calculated one both reported, flagged when they differ | Neither overwrites the other |
| **No** calculated grade for a carried course | `gradeFromMarks` bands a percentage; a failed head is not graded on its percentage, and no verified rule for that letter exists here |
| 8 subjects and 9 subjects both graded | Real semesters; nothing assumes either |
| One subject without a grade → **no** SGPA, and the row named | A partial SGPA is a wrong SGPA |

## 22.39 The result workflow (OQ-049)

`apps/web/test/results-workflow.test.tsx` — 12 tests driving the page.

Entry of a provisional row storing nulls where the card is silent; a
contradictory total blocking the save with the typed value left alone; SEE
applicability recorded from the control rather than inferred; rows added and
removed with no fixed count; a saved semester edited **in place** rather than
duplicated; and a pre-OQ-049 record still rendering, with its marks columns
honestly empty.

Two of these came from the browser sweep rather than from reasoning:

- **A second result for a semester that already had one saved silently.**
  `buildSemesterViews` matches a semester by number and takes the first, so the
  duplicate contributed nothing to the SGPA, the CGPA or the degree timeline
  while looking on the results page exactly like a saved semester. Now refused,
  with the row menu's Edit named as the way to change one.
- **The row-action menu gained Edit**, so `tests/interaction-qa.mjs` was
  corrected to assert both items rather than that Delete is first.

## 22.40 OQ-049 browser QA

`tests/results-qa.mjs`. Real Chromium, the built app, the API running, and a
synthetic student — invented codes and marks; **no real academic record is used
for QA**.

The seed is the point. `visual-qa-seeded.mjs` seeds results carrying credits and
grades and no marks, which since OQ-049 is a **legacy** record — it is left
exactly as it was, so that sweep goes on proving those still render. This one
seeds what copying a real card produces:

| | |
|---|---|
| S1, S2 | 8 subjects, fully graded — an SGPA and a CGPA exist |
| S3 | 8 subjects, one carried (SEE contribution 17) |
| S4 | **9 subjects, provisional** — marks and statuses, no grades, a CIE-only course, a missing credit, and a row whose SEE applicability is unknown |

4 widths (320, 390, 768, 1280) × 4 routes, plus the editor open at each width,
in **both themes**, then 16 scripted interaction checks: the duplicate-semester
refusal, a contradictory total refused and left uncorrected, a corrected row
saved, a semester edited in place, nine rows in S4 and eight in S1 with no
padding, and the mobile sheet at 390px read for the SEE row.

**Result: CLEAN in both themes** — 0 axe violations, 0 horizontal overflow, 0
console errors, 16/16 interaction checks.

The sweep's own finding worth recording: the row-action menu closes on scroll,
and Chromium delivers that scroll event on the frame *after* the click that
opened it — so letting the click do the scrolling opens the menu and closes it
in one gesture. The harness scrolls first, as a person does. This is existing
M9.6 behaviour, not a regression, and M9.6 stays frozen.

## 22.41 Subject identity (M10A.1)

`apps/web/test/subjects.test.ts` — 22 tests over `domain/subjects.ts`.

**Not one test asserts that two titles match.** They assert that two CODES do,
that every wording survives, and that a different code never merges however
similar its name. That is the whole design: a real timetable and a real card
name `BPHYS102` "Applied Physics for CSE stream" and "PHYSICS FOR CSE STREAM",
and any comparison loose enough to join those also joins "Mathematics-I" to
"Mathematics-II".

| Pinned | Why |
|---|---|
| `bcs 301`, `  BCS301  `, `BCS301` → one identity | One code typed three ways is one subject |
| `BESCK104B` ≠ `BESCK104C` | Real letter-suffixed electives; suffix-stripping would merge them |
| Four sources, four wordings, **one** subject, no wording lost | The milestone in one assertion |
| Identical titles under two codes → **two** subjects | Titles are never compared |
| The code is not stored as a title | Screens fall back to the code; storing that would fake a name |
| One wording recorded once across many sources | Otherwise the UI offers a "variant" that reads the same |
| Canonical title from the catalogue only | A student's wording is a source title, never an endorsed one |
| Two disagreeing catalogue rows → canonical **null**, both kept | Picking one invents an answer |
| Hand-typed credits ignored; catalogue-backed accepted | A guess must not spread across four screens |
| `hasSee: false` distinct from `null` | Unknown does not become false |
| Credits unknown stay null, never `0` | Zero says the course carries no weight |
| Display prefers the viewing screen's own wording | So a row matches the paper in the student's hand |
| Falls back to catalogue, then to the code — never an empty cell | The timetable's real case |

## 22.42 Reference-data coverage (M10A.1)

`pnpm --filter @gradtools/api reference:coverage` — a report, never a seed.

`credits` and `has_see` are `NOT NULL` in the reference schema, so a naive count
reports total coverage of everything. A value is counted only where its row is
`verification = 'verified'` — which is also what publication requires, so only
verified values ever reach a student. **Measured against the seeded database:**

| scheme / branch | sem | subjects | verified | published | SEE=true | SEE=false |
|---|---|---|---|---|---|---|
| vtu-2022 / cse | 1 | 10 | 10 | 10 | 10 | **0** |
| vtu-2022 / cse | 2–8 | **0** | 0 | 0 | 0 | 0 |

Three findings, none of them fixed by inventing data:

- **Semesters 2–8 hold no subjects at all.** Reference-backed credits and SEE
  applicability exist for semester 1 and nowhere else.
- **No published subject has `has_see = false`.** The catalogue can currently
  only ever answer "this course has a SEE" — and a real card carries a CIE-only
  Physical Education row, so the one value that most needs reference backing
  (`DEC-037`) has to be answered by the student today.
- **L/T/P has no column, for a reason worth keeping.** A real college timetable
  prints hours *as taught* and hours *as per the VTU scheme*, and they differ
  (one subject: 3+0+2 taught against 2+0+2 scheme). That is two facts; a single
  L/T/P column would silently pick one.

## 22.43 Subject-identity browser QA (M10A.1)

`tests/subject-identity-qa.mjs`. The seeded student has **one** subject recorded
four times — a result card in capitals, a timetable holding a bare code, an
attendance row abbreviating it, a backlog using an ampersand — under three
spellings of the code.

The failure this looks for is not a crash. It is the interface quietly
presenting that as four subjects, which looks entirely normal on any one screen.

5 routes × 4 widths (320, 390, 768, 1280) × both themes, then 6 identity checks:
the timetable now names the subject *and* keeps the code; the result detail
sheet lists the other wordings without replacing the card's own; and a subject
every source agrees on gets **no** variants line at all.

**Result: CLEAN in both themes** — 0 axe violations, 0 horizontal overflow, 0
console errors, 6/6 identity checks. The other four harnesses still pass.

## 22.44 Reference knowledge states (M10A.2)

`services/api/test/reference-knowledge.test.ts` — 6 tests, real PostgreSQL, real
migrations, real seed. They pin that a subject can exist with its SEE
applicability unknown, that an omitted `has_see` is **NULL rather than `true`**,
that omitted credits are NULL rather than `0.0`, that the API contract carries
the unknown out to a client, that publishing an unverified row is still refused,
and that a subject with one unknown property stays visible.

Client-side, `apps/web/test/subjects.test.ts` gained the matching case: a
catalogue row with `hasSee: null` and `credits: null` must survive the identity
index as null. The danger there is not a type error — `hasSee ? a : b` compiles
perfectly and answers "no" for null. It is the shorter expression, and it is
wrong.

### The measured coverage, after M10A.2

`pnpm --filter @gradtools/api reference:coverage`:

| scheme/branch | sem | subjects | credits known | SEE true | SEE false | SEE unknown | L/T/P known | L/T/P unknown |
|---|---|---|---|---|---|---|---|---|
| vtu-2022/cse | 1 | 10 | 10 | 0 | 0 | **10** | 0 | 10 |
| vtu-2022/cse | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| vtu-2022/cse | 3–8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

**SEE coverage went from an apparent 10/10 to a measured 0/10, and that is the
milestone working.** Those ten rows asserted `true` as a literal written once
for the whole list rather than read per course. The source very likely contains
the fact — csesch.pdf carries exam weightage columns — but it was never
extracted per subject and nothing in the repository records it. An assertion
nobody checked is not a verified fact, and here the unchecked assertion pointed
at the answer that produces false backlog claims.

Provenance is one source for every row: `https://vtu.ac.in/pdf/2022syll/csesch.pdf`,
verified by the project lead via `pdftotext` extraction. Credits were checked
against the document's own printed total of 20; SEE applicability never was.
That difference is exactly why one field stayed and the other became null.

## 22.45 Reading a source without letting it lie (M10A.3)

`services/api/src/reference/source-scan.ts`, tested by
`services/api/test/source-scan.test.ts` — 16 tests. Pure functions over text:
nothing opens a file, touches a database, or decides that anything is true.

### The one-character trap

VTU has two code families in circulation, and they are different schemes:

```
BMATS101     the 2022 scheme, which GradTools models
1BMATC101    a later scheme, effective 2025-26
```

**`1BMATC101` contains `BMATC101`.** A 2022 pattern run over a later-scheme
document matches the tail and reattributes the course — and the result looks
entirely plausible, because both are real VTU codes.

| Pinned | Why |
|---|---|
| `1BMATC101` reads whole, never as `BMATC101` | The trap itself |
| Every code a paper serves is kept | `1BECHE105/205` is one exam in two semesters |
| `BESCK104B` ≠ `BESCK104C` | Real sibling electives |
| A document with **any** `1B` code cannot speak for 2022 | Being generous is the mistake |
| A document declaring no code speaks for nothing | An empty match is not licence to guess from the filename |
| Filename vs page disagreement is **reported, not resolved** | Neither side outranks the other without a human (§14) |

### The inventory

`pnpm --filter @gradtools/api source:inventory [dir]` reads the first page of
every candidate PDF and reports what it declares. It writes nothing and reaches
no network. Measured against the local, gitignored sample directory:

| | |
|---|---|
| PDF files | 65 |
| With a text layer | **9** |
| Image-only scans | 56 — readable only through OCR, which is unreviewed (M10B.3) |
| Declaring a later (`1B…`) code | **6** |
| Every declared code 2022-family | **1** |
| Filenames claiming a code not on the page | **2** |
| Model papers rather than records of a sitting | 8 of 9 |

`1BBEE105.pdf` prints `(BEE105)` on the page; `1BPLC205E.pdf` prints
`(1BPLC105E/205E)`. Both disagreements are printed, and neither is resolved.

**What a question paper can evidence:** subject code, course title, semester,
and that a semester-end examination exists. **What it never carries:** credits,
L/T/P, or scheme membership — so the credit and L/T/P gaps cannot be closed from
this material at all, whatever its quality.

## 22.46 The scheme, as ingested (M10A.4)

`services/api/test/scheme-ingestion.test.ts` — 9 tests, real PostgreSQL, real
migrations, real seed.

These do not test that rows loaded. Rows loading is the easy part and proves
nothing about whether they are TRUE.

### The extraction check

A student takes the core rows plus **one** course from each OR-group, so the
seeded rows cannot simply be summed — they include every alternative. One
student's path through semester I:

```
core                              4 + 4 + 3   = 11
one ESC-I elective                            =  3
one ETC-I or PLC-I elective                   =  3
one AEC, one HSMC, one AEC/SDC    1 + 1 + 1   =  3
                                                --
                                                20
```

and the document's own TOTAL row prints **20**. Semester II likewise. A misread
credit anywhere in the core or group rows breaks this — it is the cheapest
available evidence that the table was read correctly rather than plausibly.

| Also pinned | Why |
|---|---|
| Every row carries the document hash and a page | A URL names a location; revisions re-use locations |
| Only `scheme_`-prefixed hour columns exist | Delivered hours are a different fact and must not land here |
| Re-seeding does not multiply rows | Idempotency, over the seeded codes |
| One row per (scheme, branch, code) | The M10A.1 identity, enforced by the database |
| No `1B…` code in the 2022 catalogue | A later scheme's course cannot appear here (OQ-053) |
| No `…x` placeholder seeded | `BESCK104x` is a family, not a course a student can take |
| `BESCK104B` and `BETCK105I` present, with the document's titles | The two electives on the real card that the catalogue lacked |

Two assertions elsewhere were **updated by evidence, not weakened**:
`reference-knowledge.test.ts` expected `hasSee` to be null for semester 1 — the
scheme document supplies it, so it now expects `true`, while the inserts either
side still prove unknown is representable. `api.test.ts` pinned a literal count
of 10 subjects; it now asserts the filter, since a literal there just gets
edited again next time the catalogue legitimately grows.

### The source inventory, extended

`source:inventory` now also cross-checks a corpus against the verified
catalogue when given `DATABASE_URL` and `CORPUS_DATABASE_URL`. Measured:

| Stored code | Verdict | Backing file |
|---|---|---|
| BENGK106, BKSKK107, BMATS101, BPHYS102 | in the catalogue | June/July 2024 scans, except BPHYS102 |
| BESC104C | **not in the catalogue** | `cmp-1BESC104C.pdf` |
| BMATC101 | **not in the catalogue** | `cmp-1BMATC101.pdf` |
| BCHEM102, BCIVC103, BCY358A | not in the catalogue | June/July 2024 scans |

"Not in the catalogue" is **not** proof of an error — this catalogue covers CSE
semesters I–II only, so a real code from another stream or a later semester
lands there too. It is a list to check, not a list of defects.

## 22.47 The daily attendance loop

`apps/web/test/attendance-marking.test.ts` (11) and
`apps/web/test/attendance-workflow.test.tsx` (7).

Attendance is a **ratio**, and the two ways of getting an increment wrong are
symmetrical: counting a present day as `attended` only quietly improves the
percentage, and counting an absent day as nothing quietly preserves it. Both
treat attendance as a score. A class that happened raises `conducted` either
way, and that is the assertion the rest hangs from.

| Pinned | Why |
|---|---|
| Attended → `31/41`; missed → `30/41` | The ratio, in both directions |
| The percentage moves the right way, from `calculateAttendance` | The row and the mark cannot disagree |
| Nothing else on the record changes | Identity and subject are not the increment's business |
| `updatedAt` is stamped | So a sync can see the change |
| **Property:** over every ratio to 30/30, `attended <= conducted` | No sequence of taps can manufacture >100% |
| Undo restores the previous record | Not `count - 1`, which reaches −1 when tapped twice |
| A first class starts a record from nothing | Otherwise a one-tap action is a three-screen errand |
| `BCS 501` on the timetable finds `bcs501` in attendance | One subject (M10A.1); a second record would halve the count |
| A record with `attended > conducted` is not countable | Recognisable rather than rendered |

### In a real browser

`tests/interaction-qa.mjs` gained three checks, clicked rather than asserted:
marking a class moves the figure and offers undo; undo restores it; and today's
timetable can mark a class without leaving the page. On a day with no seeded
classes the timetable check passes with nothing to mark, which is correct rather
than a failure.

## 22.49 Reading a PDF (M10A.6A)

`apps/web/test/pdf-layout.test.ts` (15) and `apps/web/test/pdf-text.test.ts` (9).

A PDF has no rows. It has glyphs at coordinates, emitted in whatever order the
producer chose — for a table, frequently column by column. So the layout tests
do not ask "does it join text", they ask **does it still produce the right rows
when the items arrive in the wrong order**.

| Pinned | Why |
|---|---|
| A table emitted column-first rebuilds correctly | The case the module exists for |
| Rows come out top to bottom | `Semester : N` must precede the rows it applies to |
| A row is anchored to its FIRST item, not chained | Chaining lets a wide row drift into the row beneath it |
| `MATHE` + `MATICS` → `MATHEMATICS` | pdf.js splits words; a space here destroys the title |
| One identical 4pt gap: a space at 6pt, not at 24pt | A fixed threshold is wrong for one of them |
| Zero-width positioning runs ignored | They would widen rows for no reason |

### Against a real engine

`pdf-text.test.ts` builds PDFs **byte by byte from PDF operators** rather than
shipping binary fixtures — a reader can see exactly what the parser is fed,
including the coordinates, and change one number to make a new case. It runs in
the **node** environment because pdf.js only takes its main-thread path when it
detects Node; under jsdom it tries to construct a Worker and the read hangs.

Covered: a column-first table, 8- and 9-subject cards, a two-page document that
keeps the page each row came from, a total that does not add up, a non-result
PDF, a corrupt file, an oversized file, a `<script>` tag carried through as
text, and a page with no text layer at all.

**Two real defects were found while wiring this up**, neither of which any unit
test would have caught later:

- pdf.js v6's default build calls `Promise.try` — Chrome 128+, Safari 18.2+,
  Node 23+ only. On anything older the failure happens inside the worker message
  handler, the promise never settles, and a student watches a spinner forever.
  The **legacy build** now ships.
- `isEvalSupported` was carried over from older pdf.js and is not a v6 option.
  There is nothing to switch off: v6 removed its eval path entirely.

## 22.50 Import, review, confirm (M10A.6A)

`apps/web/test/result-import-workflow.test.tsx` (10) drives the screen with the
PDF read stubbed — what extraction produces is proved elsewhere; this asks
whether a student can see what was read, correct it, and end up with an ordinary
result.

**The assertion that matters is the negative one:** nothing is saved until the
confirm button is pressed. An extraction that is right nine times in ten and
silent about the tenth is worse than one a student checks, because the tenth
becomes an SGPA they cannot explain.

Also pinned: the printed marks are kept as source values with no grade invented;
the line the parser read is shown beside the fields it produced; a misread cell
is corrected in place rather than by re-uploading; a row can be removed; a
document that printed no semester asks rather than guessing and stays disabled
until answered — *even when the filename says `semester4.pdf`*; a scan is
reported rather than saved empty; a corrupt file gets a message; a semester that
already has a result is blocked; and a filename containing a script tag is
rendered as text.

### In a real browser

`tests/result-import-qa.mjs` — the only place pdf.js is exercised **as it
ships**. A file chosen in a file input, read by the bundled worker on the page's
own origin, parsed, reviewed, corrected, confirmed, then verified in Results,
after a reload, and on the dashboard and degree pages.

4 widths × both themes + 13 pipeline checks. **Result: CLEAN in both themes** —
0 axe violations, 0 horizontal overflow, 0 console errors.

**Two UI defects the sweep found**, both invisible to the unit tests:

- The "this does not look like a VTU result card" message was suppressed
  whenever the semester was unknown — which is precisely the state a non-result
  PDF lands in. The one message that mattered was hidden exactly when it
  mattered, and an invoice was offered a semester picker instead.
- A page-level catalogue fetch fired on every visit to Results and returned 400
  when a profile's `branch` held a display name rather than an id. It now lives
  in the import panel and asks by scheme only.

## 22.51 OCR word boxes as printed rows (M10A.6B)

`apps/web/test/ocr-layout.test.ts` (14). A PDF places text in user space, where
larger y is HIGHER on the page. An image numbers rows downward. Hand image
coordinates to a reader built for the first convention and the page comes out
upside down — subject rows arrive before the "Semester : 4" line that gives them
their semester, and a card that plainly states its semester parses as one with
none. Nothing crashes; the student is simply asked which semester their
clearly-labelled card is for.

**The defect this file was extended to prevent.** A row was keyed on the BOTTOM
edge of a word's ink box. A PDF positions text on its baseline, which every word
on a line shares exactly; OCR reports the box around the ink, which no two words
share. On a real recognised card `BQAS401` came back as (227, 254) and
`ALGORITHMS`, printed on the same line, as (231, 245) — the Q's tail putting
nine pixels between their bottom edges, more than the row tolerance allows. The
row split, the subject code was separated from its marks, and a card recognised
almost perfectly parsed as **zero subjects**. Rows are now keyed on the vertical
CENTRE, which moves by half a descender rather than a whole one, and moves the
same way for every word on the line. The observed boxes are pinned in the test.

Also pinned: confidence is summarised and never acted on — a low-confidence word
is COUNTED, not dropped, because dropping it removes the evidence that a row is
doubtful while leaving the row; and a page of junk is refused rather than
presented as rows a student then has to disprove.

## 22.52 The one image adjustment made before OCR (M10A.6B)

`apps/web/test/ocr-preprocess.test.ts` (8). The obvious preprocessing step is to
binarise: pick a cut point, darker is ink, lighter is paper. On a phone photo of
a result card that is the step that loses marks — lighting across a held page is
uneven, so a single global cut puts half the table on the wrong side of it, and
those rows do not arrive misread where a student would catch them. **They do not
arrive at all.**

What ships is a linear stretch between the observed 2nd and 98th percentiles: no
pixel is ever declared background, and the local decision is left to Tesseract,
which makes it per region. Pinned: a washed-out scan is pulled to the full range
monotonically; mid-tones stay distinguishable; a flat image is refused rather
than amplified into speckle; one black speck and one blown highlight do not
define the range.

## 22.53 Which reader a dropped file gets (M10A.6B)

`apps/web/test/result-file.test.ts` (12). A PDF with a text layer already holds
the exact characters the university printed, so **OCR is reached only when
extraction comes back with nothing**. A regression in that order would swap
certainty for a guess, silently, with plausible-looking output.

Pinned: a text PDF is never recognised however available the engine is, and
reports no confidence because confidence is an OCR idea; a scan is rendered page
by page; a scan with no engine to hand gets a sentence a student can act on;
a scan longer than a result card could be is refused before the engine is
bothered; junk is refused; and the confidence summary is weighted by word count
so a page holding three words cannot drag the figure about.

## 22.54 Recognition in a real browser, field by field (M10A.6B)

`tests/ocr-qa.mjs`. Three things are properties of the shipped page and of
nothing smaller:

1. **Every OCR asset comes from our own origin.** tesseract.js defaults its
   worker, core and language paths to jsDelivr, and the page making those
   requests has a student's result card open in it. The check is a network log,
   because a configuration that LOOKS local and a page that IS are different
   claims.
2. **What the engine reads off a card, per field** — a tally of correct, wrong
   and missing, never one accuracy percentage. A missing mark is a blank a
   student fills in; a WRONG one is an SGPA they cannot explain. Averaging the
   two hides exactly that difference.
3. **That the review says the figures came from a picture.**

**Result: CLEAN in both themes** — 15 checks, 0 problems, 0 axe violations, 0
horizontal overflow, 0 console errors across 320/390/768/1280.

On a synthetic card drawn by the browser (4 subjects, 2- and 3-digit totals, a
`0`/`6`/`8` cluster): every field correct — semester, code, title, internal,
external, total and status. **This is not a claim about real VTU cards.** It is
clean printed text at a known size, which is the easy end of the problem; a
photograph taken at an angle in poor light is the hard end, and the harness
covers only the part of it that can be generated. Three requests reached
`/ocr/`, all on our own origin; zero requests left it. A heavily blurred card
was **refused**, not half-read.

**The scanned PDF is checked here and nowhere else.** The harness builds a
one-page PDF whose only content is a JPEG of the card — what a scanner or a
"print to PDF from a photo" produces — because that path is pdf.js rendering to
a real canvas, which no unit test can stand in for. All four subject codes came
back. 17 checks in total.

## 22.55 A real result card, privately (M10A.6C)

`tests/real-result-qa.mjs`. Every other harness proves the pipeline on text
GradTools drew itself. That is the easy end. A real VTU result card carries
things no generator produces: a Kannada header the English model cannot read, a
diagonal watermark across the marks columns, subject titles that wrap onto a
second line, a date column that wraps mid-value, and — on a phone — the
browser's own chrome above the document.

**The document never enters the repository.** The card and its expected values
live in a gitignored `.qa/real/truth.json` that the person running the harness
writes for their own document. Without that file the harness reports
`REAL-DOCUMENT VERIFIED = NOT VERIFIED` and exits — a green run on a machine
that has no document is never reported as a pass. `REVEAL=1` prints mismatched
values to a terminal for whoever is doing the validation; that output is never
committed, logged or quoted.

Rows are scored **by subject code, not by position**: a dropped row would
otherwise shift every row beneath it and turn one missing subject into eight
wrong ones. The tally is correct / incorrect / missing, never averaged — a
missing mark is a blank a student fills in, a *wrong* one is an SGPA they cannot
explain.

**What it found, and what changed as a result**, is recorded in §31.33. The
harness also checks the two things that matter more than the score: whether the
student was told a row could not be read, and whether the screen says the
figures came from a picture.

## 22.56 The whole import workflow, in a browser (M10A.6C)

`tests/import-workflow-qa.mjs` — 55 checks, both themes, four widths. Four
things here cannot be tested any smaller:

- **A multi-select** is one `setInputFiles` call with four files of four
  formats, not four clicks. Sequential feeds hide races between files sharing
  one OCR worker.
- **A multi-page card** prints its semester on page one only; page two's rows
  must join that semester rather than becoming a semester of their own.
- **A duplicate and a revision** look identical to a parser. Only the saved
  record distinguishes them, and only the screen can put the choice to a person.
- **The calculation chain** has to run through the ordinary academic engine. An
  imported result needing its own calculator would be a second result model
  wearing the first one's clothes.

Covered: text PDF, PNG, WebP and a scanned PDF in one action; a bad file among
four good ones leaving the four usable; two files for one semester shown as a
conflict with saving refused; a saved semester blocked on re-import *even under
a different filename*; cancel leaving the store untouched; edit-after-import
through the semester's own actions menu; SGPA, CGPA, percentage and backlogs
following on Results, Analytics, Dashboard and Degree; hostile filenames and
markup-shaped document text rendered as text and nothing else; a 21MB image
refused before any engine starts; zero requests off-origin.

**WebP is verified end to end here** rather than claimed from a MIME switch.

**The harness caught the editor doing the right thing.** Raising one mark
without its total is refused, with the arithmetic shown and nothing recomputed —
the same rule the parser follows, applied where a person is doing the changing.
That refusal is now pinned.

### Retention, read off the device rather than off the code

Every key in local storage is inspected after an import. Two kinds of thing live
there: GradTools' own data, and **tesseract.js's cache of its language model**,
which it writes to the same `keyval-store` database under `./eng.traineddata`.
That cache is intentional — it is what stops a student re-downloading six
megabytes per import, and what makes the feature work offline. So the assertions
are made against GradTools' keys, the engine cache is named explicitly rather
than admitted by a size threshold, and anything unrecognised fails.

Measured after four files and three saved semesters: **3,091 bytes under one
GradTools key**, no binary values, no PDF or data-URL signatures, nothing in
local or session storage.

## 22.57 Which parser a document goes to (M10A.7)

`apps/web/test/document-type.test.ts` (12). Every VTU document says
"Visvesvaraya Technological University" and most of them say "semester". A
classifier built on either would route a question paper into the result importer
and an exam schedule into the calendar.

**The exam schedule is the case that matters, and it is not hypothetical.** The
university issues a *Draft Time Table for … Examinations* that is a table of
dates, names semesters and carries the university's identity — everything a
naive calendar rule accepts. Reading it as a calendar would fill a student's
term with exam sittings labelled as semester milestones.

Pinned: a lone signal can never carry a document (the floor is above the largest
single weight); a document whose two best readings are within a margin is
refused rather than guessed at; and a **more specific signature outranks a more
general one** — the regression below.

### The message a real document proved wrong

Run against five real documents, an exam schedule scored **nine** on the
class-timetable signals and **seven** on its own: its "Date, Day" column lists
weekday names in sequence and its heading carries sitting times. The generic
reading won, and the product told the student it was a class timetable. Both
answers refuse the document — nothing unsafe happened — but the sentence was
untrue. The exam signature is now decisive once it clears the floor, because no
weekly class timetable says "Draft Time Table", "Date, Day" or "Registrar
(Evaluation)".

## 22.58 Reading an academic calendar (M10A.7)

`apps/web/test/calendar-import.test.ts` (27). A real academic calendar is mostly
*not* events: it carries a notification number, a circular reference, a
signature block and a distribution list, and every one of those has a date on
it. A parser that turned each date into an entry would hand a student a term
full of rows like "05/12/2026 — Ref No. …".

**The rule under test: a date is necessary and never sufficient.** A row becomes
an event only when it also carries a description that survives the note filter.

Also pinned: dates in the formats these documents print, day-first; an
impossible day refused rather than stored; the year for a bare "11 Sep" taken
from the document's own academic year **or not at all**; a range kept as a range
rather than expanded into twenty rows; `OTHER_ACADEMIC` returned rather than a
false category; semester and academic year read from the document, with the
review asking when they are absent; a fingerprint of the text so the same
calendar under a different filename is one document; and the dashboard given
exactly one upcoming date with the countdown computed, never stored.

## 22.59 Document routing in a browser (M10A.7)

Added to `tests/import-workflow-qa.mjs` rather than to a new harness — **73
checks**, both themes, four widths, 0 axe / 0 overflow / 0 console errors.

Four documents go in as one action, none of them announced: a calendar is
detected, read, saved, and refused on a second upload; a reissued calendar is
shown as a revision naming the date that moved; an exam schedule, a class
timetable and an invoice are each refused with their own sentence. A scanned
calendar takes the same OCR route the result cards use. The dashboard shows one
upcoming date.

The harness also asserts what must **not** appear: the fixture's notification
number, reference line and distribution list all carry dates, and none may
become an event.

### Real documents (private)

`.qa/real/classify.mjs`, gitignored, prints a verdict per document and no
content. Against the five real documents on this machine:

| Document | Routed |
|---|---|
| Result card ×2 | result importer |
| Exam schedule | refused, *as an exam schedule* |
| Class timetable (clearer scan) | recognised as a timetable, refused |
| Class timetable (poorer photo) | refused as unidentifiable |

**None was routed to the wrong parser.** The last row is a limitation, not a
failure: that photograph does not recognise well enough for the classifier to
say more than "not identifiable", and the timetable parser does not exist yet
in any case.

## 22.60 Reading a timetable, which is a grid (M10A.8)

`apps/web/test/timetable-import.test.ts` (30). Every other importer here reads
LINES: one printed row is one record. A timetable is two-dimensional — `MAT`
means nothing until you know which column it sits in, and the column is a time
printed once in a header far above it. **So the fixtures are coordinates**,
because positions are the only thing the parser can read.

Pinned:

- **Time slots come from the document.** Colons and full stops both appear in
  one real header; a range's end tells its start which half of the day it is in,
  but does not lend it its own marker — `11:50-12.10pm` is late morning, while
  `1:05-02:00pm` really is the afternoon. What separates them is that a printed
  range runs forwards.
- **Initials mean what THIS document says.** They resolve through the subject
  table at the foot of the same page and through nothing else; an initial the
  document never defines keeps no code and is reported.
- **A cell is not always one class.** `PHYE1/POPE2` becomes two classes, one per
  batch. A lab across columns stays one class from the first column's start to
  the last one's end.
- **Breaks are not classes**; **two classes at one hour are reported, never
  resolved**; **two batches at one hour are not a conflict**.
- **Effective date decides which revision is active, never upload order.**

## 22.61 Timetable import in a browser (M10A.8)

Added to `tests/import-workflow-qa.mjs` — now **83 checks**, both themes, four
widths, 0 axe / 0 overflow / 0 console errors. A timetable arrives with three
other documents in one action; saving is refused until the batch question is
answered; no break reaches the stored week; the split cell gives this student
their own class and not the other batch's; the lab spans its columns; the same
file again is a duplicate; an older revision is flagged as older; and the week
view shows the imported classes with no manual entry.

Measured: **25 classes across six days**, lab ending 17:00, 4.5kB of slots and
267 bytes of provenance.

### Two bugs it found

**The class name swallowed the revision label.** `CLASS: …` and `TIME-TABLE
(R2)` sit side by side on the real document and land on one reconstructed row,
so two revisions of one class looked like two different classes — and the older
one stopped being recognised as older, which is the check that stops a stale
upload replacing a student's week.

**The fixture was off the page.** Eight time columns do not fit across a
portrait MediaBox, and text placed past it is not in the document at all. Half
the grid, the room and the effective date were silently absent and the parser
was reading exactly what it had been given. Timetables are landscape.

### The real timetable (private)

`.qa/real/classify.mjs`. Of the five real documents on this machine, both
timetable photographs behave as follows:

| Document | Outcome |
|---|---|
| Timetable, clearer scan | routed to the timetable parser, **0 classes** |
| Timetable, poorer photo | refused as unidentifiable |

The clearer one is precise about where it stops: the **time header reads, the
subject table does not**. Without that table the grid's initials have nothing to
resolve against, so every class is dropped for want of a subject code. Detection
is real-document verified; extraction from a photographed timetable is **NOT
VERIFIED** and is the honest limit of this milestone.

## 22.62 What a photographed timetable actually gives up (M10A.8.1)

The M10A.8 report recorded a real photographed timetable producing **zero
classes**. This is what was wrong and what changed, measured on the document
rather than reasoned about.

| | Before | After |
|---|---|---|
| Dictionary rows | 0 of 8 | **7 of 8** |
| Classes found | 0 | **12** |
| Days recognised | — | **6 of 6** |
| Revision, W.E.F., room | correct | correct |
| Time columns | 2 of 8 | 3 of 8 |
| Time to read | 24s | **7.6s** |

### Three causes

**The header wraps.** A column is printed as `10:00 -` above `10:55am`, so a
range lives across two or three printed lines. Row-by-row scanning found the one
column narrow enough to fit on a single line. The header is now a *block* of
consecutive rows, identified by carrying a clock and no day name.

**Blank runs are not columns.** pdf.js reports zero-content positioning runs with
a width spanning the gap they cross; letting them into the column grouping
bridged every gap and merged seven columns into one. The line reader already
drops them — the column reader had not learned it.

**The engine was reading a table as prose.** Its default page segmentation
returned the subject dictionary empty, so every class was dropped for want of a
code. Sparse mode returns seven of its eight rows.

### Two regressions the real result cards caught

Both were changes made *around* the fix, not by it, and both were found only by
re-running the real cards:

- A **DPI hint** added to silence `Estimating resolution as 185` changed what the
  engine read — one gained row and **one incorrect total**. Silencing a log must
  not alter a student's marks; it now applies only to the sparse pass.
- **Restoring page segmentation to AUTO** afterwards looked harmless and was not
  Tesseract's actual default of `SINGLE_BLOCK`. That also changed the reading.

Both cards are back to their exact baseline: 4 and 8 rows, **zero incorrect
marks**, 0 console errors.

### Sparse mode is not the default, deliberately

On the same real result cards, sparse mode dropped a nine-row card to four and
produced an incorrect mark. It runs only when the document classifies as a
timetable *and* the ordinary reading produced a poor grid. Result cards and
calendars never pay for it.

### A partial read says so

`apps/web/test/timetable-import.test.ts` (33) now pins `coverage`. A photograph
can give up a handful of perfectly correct classes and lose most of its columns,
and twelve right classes shown as "your week" is worse than an honest partial —
it looks complete, and a student would plan around the ones that are missing.

**Browser QA: 84 checks, both themes, four widths, 0 axe / 0 overflow / 0
console errors.** 1370 unit tests.

## 22.63 The theme matrix, widened (M10A.9)

`tests/theme-qa.mjs` — **305 page checks across ten palettes**, up from 60. Six
widths (320 / 390 / 768 / 1280 / 1440 / 1920) × five accents × light and dark,
over Dashboard, Results, Import, Timetable and Account. 0 axe / 0 overflow / 0
console errors.

### The accent picker offered five identical circles

Each swatch sets `data-accent` on **itself** to paint its own hue, and the CSS
comment said so. But the accent blocks were written `:root[data-accent='…']`,
so the attribute matched nothing on a button and every swatch inherited the
root's fill.

**Nothing could have caught it.** The tokens were right, the markup was right,
and the fault lived in the cascade between them — invisible to a unit test that
reads either one. The harness now reads the colours the browser actually paints
and fails if five swatches produce fewer than five.

### System mode, both directions

"System" is the *absence* of `data-theme`, which is what lets
`prefers-color-scheme` decide. The harness now runs with the browser set to
light and to dark, asserts the attribute is absent, and reads the rendered
ground — a build that hard-coded either answer would have passed the old check.

### Light default

A device with no stored preference now renders light (§26). Asserted in the
harness rather than only in the unit test, because the default is a property of
what the page does on first load.

## 22.64 The document hub in a browser (M10A.9)

Added to `tests/import-workflow-qa.mjs` — **89 checks**. `/import` is reached
directly, not through Results: it has a file input, it names all three document
types it accepts, and it still offers manual entry. The dashboard offers the
same action and **no longer points at question papers**.

Every routing, review, duplicate, revision, conflict, retention and privacy
check from M10A.7–M10A.8.1 continues to run in the same sweep.
