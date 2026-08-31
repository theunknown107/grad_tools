# 31 — Roadmap and Milestones

**Status:** Phase 1 draft
**Estimates:** part-time solo development with AI assistance. Every duration is a planning estimate, not a commitment.

---

## 31.1 Milestone overview

| # | Milestone | Effort | Gate |
|---|---|---|---|
| M0 | Discovery and tooling | 1–3 sessions | ✅ **Complete** |
| M1 | Documentation (these 32 files) | 1–2 sessions | ✅ **Complete — awaiting human approval** |
| M2 | Architecture approval and backlog | 1–3 sessions | Human approval + decisions resolved |
| M3 | Experimental foundation | 1–2 weeks | ✅ **Complete** — rules engine, vertical slice, site loads, navigation works |
| M4 | Core academic utilities | 1–2 weeks | 🟡 **Substantially delivered inside M3.** Two exit criteria outstanding, both blocked on external input (see §31.3) |
| M5a | Reference data foundation | 1–2 weeks | Express API + PostgreSQL serving verified reference data |
| M5 | Shared source + academic content foundation | 2–4 weeks | Source/rights layer, both tracks |
| M6 | **Student academic core** | 1–2 weeks | ✅ **Complete** — the eight-semester degree |
| M7 | **Announcements and notifications** | 1–3 weeks | ✅ **Complete** — framework delivered; VTU source still closed on `OQ-026` |
| M8 | **Question-paper library** | 1–2 weeks | ✅ **Complete** — the library works; `OQ-008` keeps it nearly empty of real papers |
| M9 | **Authentication and cloud** | 2–3 weeks | Optional sign-in; local-first still works |
| M10 | Academic intelligence | 1–2 weeks | No prediction claims; evidence shown |
| M11 | Admin and data quality | 1 week | Operator can diagnose any failure |
| M12 | Hardening | 1–2 weeks | Alpha readiness review passes |
| M13 | Pilot — experimental user test | 1–3 weeks | Evidence-based feature freeze |
| M14 | Alpha release | 1 week | Shareable Alpha |
| M15 | College demonstration prep | 1–2 weeks | Presentation-ready |

**Total: roughly 3–5 months part-time**, dominated by M7, whose duration depends on external factors outside the developer's control.

### Milestone reconciliation (recorded at the start of M5a)

Two inconsistencies had accumulated between this roadmap, the backlog in `33`, and what was actually built. Both are corrected here without renumbering anything, because milestone IDs are cited in commit messages and completion reports and renumbering would rewrite history.

**1. M3 absorbed most of M4.** M3 was defined as "experimental foundation" (the site loads, navigation works) and M4 as "core academic utilities" (the calculators). In practice the rules engine shipped *first*, in M3's opening increment, and the vertical slice then consumed the rest of M4's scope. M4's exit criteria are therefore mostly met already:

| M4 exit criterion | Status |
|---|---|
| 100% branch coverage on `academic-rules` | ✅ Met in M3 |
| Property-based tests pass | ✅ Met in M3 (15 properties) |
| Client and server agree | ✅ Trivially — one shared package, no duplicate implementation |
| The regulation's Annexure-I worked example passes | ❌ **Outstanding.** The Annexure has not been transcribed from the source PDF |
| Validated against real grade cards | ❌ **Outstanding.** Blocked on the human supplying anonymised grade cards |

M4 stays open at 🟡 rather than being marked complete, because those last two are the criteria that actually validate our reading of the regulation against VTU's practice. Closing M4 on the strength of the ones we could self-assess would be exactly the "verification theatre" this project exists to avoid.

**2. M5 bundled two unrelated bodies of work.** "Academic content" covered both the syllabus/reference-data model and the PDF/question pipeline. They share nothing but a chapter heading: the first needs a database and an API, the second needs document parsing and an unresolved licensing answer (`32/OQ-008`). They are now **M5a** (reference data foundation) and **M5b** (document pipeline), which also lets M5a proceed while M5b stays blocked.

### Milestone reconciliation (recorded after M6)

**3. M6 was assigned twice.** This roadmap listed *M6 — Result/notice ingestion*, and the milestone actually delivered as M6 was the **student academic core**. Both labels existed, which is one too many.

**M6 is the student academic core.** That is what was built, tested, documented and pushed under the name, and its commit and completion report both cite it. Renumbering it now would rewrite history in exactly the way this project has refused to do everywhere else.

Everything after it moves down, and two milestones that had no number are given one — the question-paper library (surfacing what M5A built to students) and authentication (which the local-first architecture has always anticipated but never scheduled).

| Was | Is now | Milestone |
|---|---|---|
| M6 | **M7** | Announcements and external-source ingestion |
| — | **M8** | Question-paper library |
| — | **M9** | Authentication and cloud |
| M7 | **M10** | Academic intelligence |
| M8 | **M11** | Admin and data quality |
| M9 | **M12** | Hardening |
| M10 | **M13** | Pilot — experimental user test |
| M11 | **M14** | Alpha release |
| M12 | **M15** | College demonstration prep |

**No commit message or completion report is edited.** A historical document citing "M7 intelligence" or "M9 hardening" meant what this table's left column says; the right column is where that work lives now. Cross-references in `29`, `30` and `33` have been updated to the new numbers.

**Naming note:** the authorization for this work called it "M4". It is recorded here as **M5a** because roadmap M4 already has a distinct, partly-open meaning. The two labels refer to the same work; M5a is the authoritative one.

## 31.2 Dependency graph

```
M0 ──► M1 ──► M2 ──┬──► M3 ──┬──► M4 ──────────────┬──► M9 ──► M10 ──► M11 ──► M12
                   │         │                     │
                   │         └──► M5a ─► M5b ─► M7 ─┤
                   │              ▲                │
                   └──► M6 ───────┘                │
                        (independent, can run      │
                         in parallel with M5)      │
                                                   │
   M8 ◄─── depends on M5 + M6 ─────────────────────┘
```

**Critical path:** M2 → M3 → M4 → M9 → M10 → M11 → M12. M4 is the highest-value work and should not be delayed by M5 or M6, which are riskier and less certain.

**Parallelism:** M5a (reference data), M5b (document pipeline) and M6 (ingestion) are independent of each other and of M4. If M6 stalls on an external blocker, M5a and M5b continue. M5b is itself blocked on `OQ-008` and `OQ-019`, which is the main reason it was split out of M5a.

## 31.3 Milestone detail

### M2 — Architecture approval *(gate: human)*
Resolve the open decisions in `32`; revise the documents accordingly; freeze the initial architecture; convert `02`'s requirements into an issue backlog; initialise the repository and CI skeleton.

**Exit:** human approval of the architecture and of the Alpha scope; every blocking decision in `32` answered.

### M3 — Experimental foundation
Monorepo, React SPA, Express API skeleton, Postgres with initial migrations, design-system tokens and the ~15 components from `05`, routing and the app shell, seeded demo data (labelled), test harness, deployment of the experimental environment.

**Exit:** the site loads under 2 s on 4G, navigation works, CI is green, demo data is unmistakably labelled.
**Explicitly out:** accounts, real data, ingestion.

**Status: complete.** Delivered in two increments:
- *Increment 1* — monorepo, strict TypeScript, lint, test harness, `@gradtools/academic-rules` at 100% coverage (337 tests).
- *Increment 2* — the experimental vertical slice: app shell, dashboard, SGPA/CGPA, attendance, bunk planner, manual results, timetable, profile. Design tokens, repository boundary, future identity boundary. 366 tests total, 0 axe violations, production build 92.9 kB gzipped.

**Not yet started:** the Express API and PostgreSQL. Stage 1 is genuinely local-first, so neither was needed for the slice, and both remain later milestones.

### M4 — Core academic utilities *(highest value)*
`packages/academic-rules` in full: grade mapping, SGPA, CGPA, percentage, class, marks-needed, target CGPA, attendance and bunk calculations. Result entry, backlog derivation, attendance UI, timetable. Local-first persistence.

**Exit:** 100% branch coverage; the regulation's Annexure-I example passes; property-based tests pass; **validated against real grade cards**; client and server agree.

**This milestone alone delivers a genuinely useful product.** If everything after it stalled, GradTools would still be worth using — which is the intended property.

**Status: 🟡 substantially delivered inside M3, two criteria outstanding.** See the reconciliation note in §31.1. The outstanding items are the Annexure-I transcription and real-grade-card validation, both of which need source material the project does not yet hold. They are tracked as `32/OQ-023` and `32/OQ-024`.

### M5a — Reference data foundation · ✅ **DELIVERED**
The first server-side system: Express API, PostgreSQL, migrations, deterministic seed, and the read-only reference API (universities, schemes, branches, subjects, syllabus modules, rule-set metadata). Frontend consumes reference data through an API-backed repository while student data stays local.

**Exit:** migrations apply from a clean database; only verified reference data is publishable; the frontend reads real reference data over HTTP; no student data reaches the server.
**Deliberately excluded:** authentication, student cloud persistence, admin UI, Redis, queues.

**Exit criteria met.** Migrations apply from a clean database and a second run
applies nothing; the seed is idempotent; publication and rule-set activation are
gated by database CHECK constraints; the frontend reads real reference data over
HTTP through `ReferenceRepository`; two tests assert student data never leaves the
browser; the integration suite asserts no student table exists. 527 tests pass,
76 of them against real PostgreSQL. Format, lint, typecheck and build are green;
browser QA reports 0 accessibility violations, 0 horizontal overflow and 0 console
errors.

**Carried forward, deliberately:** `syllabus_modules` and `colleges` ship with
**zero rows** because no verified source exists (`32/OQ-025`). The table, the
route and the frontend empty state are implemented and tested; only the content
is absent. This is the intended outcome, not an unfinished task — inventing
curriculum data would be worse than an honest gap.

**Also carried forward:** the M4 criteria `32/OQ-023` (Annexure-I transcription)
and `32/OQ-024` (validation against a real grade card) remain open. `OQ-024` is
the most valuable outstanding verification in the project.

### M5 — Shared source + academic content foundation · ✅ **DELIVERED**

**Roadmap change, recorded here (`DEC-021`).** M5b (documents) and M6 (external
sources) were previously sequential. They are now **two parallel tracks over one
shared layer**, because the thing they were queued behind is the same in both
cases: knowing where material came from and whether it may be shown.

```
                 ┌─────────────────────────────────────┐
                 │  Shared Source / Provenance /       │
                 │  Rights / Verification / Publication│
                 │  / Source Health                    │
                 └────────────┬────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
   M5A Document / paper pipeline    M5B Permitted external sources
```

Splitting them the old way meant either building the source model twice or
blocking one track on the other. Sharing it means a document and an announcement
answer "where is this from" and "may we show it" the same way.

**Historical milestone numbers are unchanged.** M5a (reference data, delivered)
keeps its name and its commit references. This milestone is **M5**, and its two
tracks are **M5A** and **M5B** — capitalised to distinguish them from the earlier
lowercase M5a/M5b.

**M5A — Document / paper pipeline.** Quarantine-first lifecycle: validation
against hostile input, content-addressed storage behind an object-store
interface, `pdftotext` extraction in a limited child process, structural
sectioning. No question segmentation and no module mapping — those need the
extraction proven first.

**M5B — Permitted external sources.** Source registry with robots, terms, rights
and verification gates as database constraints; adapter contract with pure
`parse`/`normalize`/`validate` and a gated `fetch`; change detection that records
rather than delivers.

**Exit met:** shared registry and rights model exist and are constraint-enforced;
HOST/LINK/PRIVATE/BLOCKED behave and are tested; every source is disabled by
default and none can be enabled past the gates; document quarantine and
validation reject every hostile fixture; extraction reports `text_available`,
`ocr_required` or `extraction_failed` without ever silently OCR-ing; the VTU
adapter framework exists and its source stays disabled; no result scraping
exists.

**Deliberately excluded:** question segmentation, module mapping, OCR, AI,
notification delivery, admin dashboard, authentication, Supabase, student cloud
persistence.

**Hardened in M5.1.** Two gates were narrowed after review. `enabled` now
requires `access_method = 'http_fetch'`, so a manual-delivery source can never
become an automated one; and a document must be `validated` or `extracted`
before it can be `host` or `link`, so quarantine holds for publication as well
as for processing. Neither gap had ever been exercised. 702 tests pass, 238
against real PostgreSQL.

**Carried forward:** `OQ-008` (redistribution) keeps the public tier
unreachable; `OQ-006` (VTU terms) keeps the announcements source disabled;
`OQ-019` (do real papers carry a text layer) is unanswerable until real papers
arrive — the pipeline is proven on synthetic fixtures.

### M5A — Document / paper pipeline · ✅ **DELIVERED (private path)**
The safe document lifecycle: import, quarantine, validation against hostile
input, content-addressed object storage behind an interface, `pdftotext`
extraction in a child process, and structural section persistence. A private
documents UI. No OCR, no question segmentation, no AI, no public file serving.

**Exercised on real documents.** 65 supplied academic PDFs went through the
shipped path; 9 yielded usable text, 54 were scans, 2 were HTML masquerading as
PDFs and were rejected by the magic-byte check. The exercise found and fixed two
validator false positives that were rejecting 7 legitimate papers (docs/17
§17.11a).

**Carried forward:** `OQ-019` is **PARTIALLY VERIFIED** — real papers are
confirmed to be a mixed corpus and scans dominated this sample, but one local
sample does not generalise and OCR quality is untouched (`OQ-019a`). `OQ-027`
(production object storage) and `OQ-028` (retention) remain open and are stated
in the UI rather than assumed.

### M5A.1 — OCR feasibility benchmark · ✅ **DELIVERED (evidence only)**
Two fully local OCR engines benchmarked over 10 scan-like documents. **No OCR
implemented.** Outcome: `OQ-019a` PARTIALLY VERIFIED, `DEC-021` recommends local
Tesseract when OCR is built, and `OQ-029` records that VTU uses more than one
question-paper format — found because a first rubric wrongly scored 4 correctly
read papers as POOR.

**Known before OCR can ship:** Kannada recovery is currently zero on both
engines, mathematics does not survive, and ~1.5–2 s/page does not fit the
synchronous path — OCR is the trigger for background processing that `ED-41`
anticipated.

### M5A.2 — OCR qualification · ✅ **DELIVERED (evidence only)**
20 scan-like documents through Tesseract at a corrected configuration. **No OCR
implemented.**

**Resolved:** Kannada works with `kan.traineddata` and `-l eng+kan` (3 922
codepoints, both scripts surviving, coherent question text) — M5A.1's "zero
recovery" was an artefact of having only `eng` installed. PSM 3 for descriptive
and PSM 6 for MCQ beat the single `--psm 6` preference. 150 DPI confirmed at
~1.07 s/page, 2.8× faster than 300 DPI.

**Segmentation is feasible for module, question number, marks and CO** — 15–20
complete rows per descriptive paper with all three attached. **Sub-question
letters are recovered only 3–4 times in 15–20 rows**, and mathematics does not
survive at all.

**`OQ-019a` stays PARTIALLY VERIFIED**, because two of the seven fields are not
dependable. `DEC-021` (local Tesseract) is confirmed and upgraded to **(B)
implement with a later quality loop**.

### M5A.3 — Production OCR pipeline · ✅ **DELIVERED**
Includes the long-running worker runtime (`pnpm --filter @gradtools/api worker`):
idle sleeping, startup and periodic stalled recovery, dependency check at boot,
anonymous worker ids, and drain-then-exit shutdown. Concurrency proven with two
real processes against one database.
OCR implemented: local Tesseract, 150 DPI, format-dependent PSM, `eng+kan` where
Kannada is detected, run as a background job on a PostgreSQL-backed queue with
`SKIP LOCKED`, retries with backoff, and stalled-job recovery.

Verified end to end on real scans: a poor-quality DBMS paper and a Kannada MCQ
paper both reached `ocr_extracted` (the latter correctly detected as
`mcq` / `eng+kan` / PSM 6), and a maths paper reached `ocr_needs_review` with
the caveat that formulas are not reconstructable.

**Deliberately still absent:** question segmentation, module mapping,
embeddings, prediction — sub-question identity is recovered only 3–4 times in
15–20 rows, so anything keyed on it would rest on the least reliable field
available (`OQ-019a`).

### M5A.4 — Positional extraction · ✅ **DELIVERED (prototype + evidence)**
A deterministic positional layer: one `PositionedToken` representation fed by
both `pdftotext -tsv` (native) and `tesseract tsv` (scans), line grouping by
vertical overlap, and a structural parser producing questions, sub-questions,
marks, Bloom's level and CO with bounding boxes and structural confidence
states. **No AI, no embeddings, no semantic classification.**

**The OQ-019a answer:** sub-question recovery goes from 3–4 of 15–20 rows on
flattened text to essentially complete on native PDFs and substantially improved
on scans. Marks/Bloom's/CO are recovered by column position rather than by regex.

**Two limits found and recorded:** positional extraction is a
descriptive-paper technique — MCQ gains little — and the worst scan yields
nothing rather than unreliable rows, by deliberate choice.

### M5A.5 — Structured question persistence + human review · ✅ **DELIVERED**
Parser output became durable academic data: `extracted_papers` →
`extracted_questions` → `extracted_sub_questions`, plus `extracted_mcq_items` as
a separate shape. Every record carries its document, page, bounding box, parser
version and extraction version.

**Machine values are immutable; human corrections live beside them**, so the
effective value is `reviewed ?? machine` and the original is never lost.
Reprocessing with a new parser version ADDS a version and leaves prior reviews
intact; re-running the same version does nothing at all.

**Three trust signals kept apart:** OCR confidence, structural confidence, human
review state. No numeric accuracy score anywhere.

Verified on seven real papers (native 20 Q / 47 sub reproduced exactly), 901
tests, and browser QA with 0 axe violations and 0 overflow at four viewports.

**Two real defects found by running it:** `pdftotext` ambiguity between Xpdf and
poppler silently disabled native positional extraction, and `-l eng+kan` without
the language pack degraded to English with no error at all.

**Kannada is NOT re-verified in this milestone** — the language pack is not
installed on the development machine.

### M5A.6 — Review workbench + corpus ground truth · ✅ **DELIVERED**
A review surface over extracted questions: accept, correct or reject each
question, sub-question and MCQ item, with the machine's original always visible
beside a correction. A queue orders what is left `review_required → low →
medium → high` — an ordering, never a score. Migration 0008 added the three
correctable fields the workbench needed (sub-question Bloom's and CO, MCQ
options) and the queue's priority function.

**14 real papers loaded, 71 records adjudicated across 4 of them.** Module 100%,
sub-question label 97%, MCQ item number 100%; question number 38% overall but
9/9 where the number sits on its cell's first row.

**Two parser defects measured, and deliberately NOT fixed here:** question text
is truncated at the marks column (0/12 native texts exact), and a vertically
centred question number is never recovered. Fixing the parser now would
invalidate the corpus built to evaluate parser changes.

**The confidence model was measured, not assumed:** `low`/`medium` are
dependable warnings; **`high` was accepted only 50% of the time**.

**The reviewer was an AI agent, not a human** — recorded as
`agent-adjudication`. Human ground truth remains outstanding.

### M5A.7 — Deterministic parser correction · ✅ **DELIVERED**
The three defects M5A.6 measured, fixed geometrically. No AI of any kind.

**A — text truncation.** v1's "right-hand 30%" boundary was measured 90–100pt
too far left on every paper in the corpus. v2 finds the marks column by looking
for what a column is: a narrow stack of short tokens repeated down the page. No
column found means no truncation, a flagged page, and nothing marked clear.

**B — centred question numbers.** The right-hand columns now anchor cells rather
than the parser working row by row, so a `Q.1` sitting beside part (b) owns the
whole run. `1BPHYS102` went from 15 numberless fragments to 5 correctly numbered
questions; numbered questions across the paper went 1 → 10.

**C — MCQ instructions.** Two structural cues must both agree — numbering
restarts at 1, and nothing before the restart has options. Reads no English, so
it works on a Kannada block. `BENGK106` 48 → 45 items, the three removed being
exactly the instructions adjudication identified.

**v1 is frozen, not replaced.** Re-extraction adds a version beside it and
inherits no review — verified on a real document.

**Higher is not better, and both directions are reported:** v2 gains 2 false
positives on `BCHEM102` that are the two sub-parts v1 dropped entirely, and
produces fewer records on `BENGK106` because it stopped inventing three.

25 regression tests pinning each defect from both sides; 963 tests total;
browser QA with 0 axe violations. **v2 output has not been adjudicated** — the
M5A.6 metrics describe v1.

### M6 — Student academic core · ✅ **DELIVERED**
The eight-semester degree became the product. A student can enter four years of
history, mark where they are, keep this semester's subjects, track backlogs, and
see CGPA, percentage, subject trends and degree progress — **without touching
the question-paper pipeline at all**.

**All eight semesters, always.** `planned` / `in_progress` / `completed`, with a
student who starts in their third year treated as the normal case. No status is
derived from a date.

**Every number comes from `@gradtools/academic-rules`.** A new pure module
organises results across semesters and computes nothing; `SemesterResult` now
pins its `ruleSetId` so a later regulation cannot re-grade a semester already
sat.

**Deterministic analytics, no AI.** Subject trend only where a subject was
re-sat; strong/weak measured against the student's own average with the rule
printed on screen; "not enough history yet" below five graded subjects; credits
remaining reported as unknown rather than invented.

**No server, no auth, no new table.** Three local repositories behind the
existing bundle. The public repository holds zero real academic records.

1018 tests; browser QA at four viewports with 0 axe violations and 0 overflow
after fixing two real defects it found.

**The paper-intelligence pipeline is parked**, not removed — it remains the
future differentiator (M6 §27).

### M5b — Document pipeline · superseded
Folded into **M5 / M5A** above. Retained as a heading so earlier references
resolve.

### M7 — Announcements and notifications · ✅ **DELIVERED, with the source still closed**
*Was M6 before the student academic core took that number; see the reconciliation note above.*

Announcement model with provenance and a verification gate, deduplication, operator entry behind the loopback boundary, deterministic client-side relevance, a notification model that lives on the device, and deterministic priority. See `07` §7.14, `08` §8.14–8.15, `09` §9.16, `10` §10.14, `12` §12.12, `13` §13.15, `14` §14.15, `20` §20.12.

**What was NOT delivered, and is not a gap to quietly close:** the VTU announcements adapter. `OQ-026` / `OQ-006` remain open, so the source stays `enabled = false`, `terms_status = 'unknown'`, `access_method = 'none'` — enforced by the source gate and asserted by a test that fails if anyone enables it. **No real VTU announcement has ever been ingested.** Everything M7 was verified against is an operator entry or a labelled demo fixture.

Change detection, health monitoring and scheduling were built as the framework describes but have never run against a live source, and this repository claims nothing about how they behave against one.

**Exit, as met:** publishing requires verification (a database CHECK, not application code); a content change withdraws verification; no notification is derived from unvalidated data; the feed endpoint receives no student context at all; 0 axe violations and 0 console errors across 320/390/768/1280.

### M8 — Question-paper library · ✅ **DELIVERED, with the shelves nearly empty**
*New number. The work M5A–M5A.7 built had never been surfaced to a student.*

Browse, search and filter past papers by subject, code, scheme, branch, semester, year and format; open a hosted paper in the browser's own viewer; follow a link-only paper to its source. A view over `documents`, not a second document model. See `07` §7.15, `08` §8.16, `09` §9.17, `10` §10.15, `12` §12.13, `13` §13.16, `17` §17.20, `18` §18.10.

**The scope was read narrowly on purpose.** M8 is a finding tool. `OQ-031` blocks presenting extraction as reliable, so the library shows structural counts with the caveat attached and never a reviewed-versus-unreviewed claim about individual questions — the browsing surface exists, the corpus assertions do not.

**What is NOT delivered, and is not a gap to quietly close:** papers. `OQ-008` is open, so no third party's paper may be promoted to `host`, and the only documents that legitimately reach that state are the ten synthetic ones GradTools wrote itself. The library works; it is nearly empty of real material, and that is the rights model behaving correctly rather than failing.

**Exit, as met:** rights and presentation gates hold and are enforced by the database, not by the router; `private` and `blocked` are 404 rather than 403; the file route accepts an opaque id and nothing else; no URL is fetched or proxied; no structural count is presented without saying it was not checked by a person; 0 axe violations and 0 app console errors across 320/390/768/1280.

### M9 — Authentication and cloud · ✅ **DELIVERED, providers not yet configured**
*New number. Anticipated by the repository boundary since M3.*

Optional sign-in through Supabase Auth, `auth_user_id` as the only identity key, a student cloud in Supabase Postgres with row-level security on every table, an account-scoped local store, and a sync layer that detects conflicts instead of resolving them silently. See `07` §7.16–7.17, `08` §8.17, `09` §9.18, `10` §10.16, `11` §11.13, `12` §12.14, `13` §13.17, `22` §22.17.

**`DEC-022` reverses `11` §11.2.** Google and Apple were rejected there on privacy grounds; M9 adopts them anyway with the cost recorded rather than argued away (`11` §11.13).

**LOCAL-FIRST STILL WORKS COMPLETELY.** No account, no network, no degradation — verified in a browser with the network cut.

**What is NOT delivered, and is not a gap to quietly close:** a single real sign-in. Google and Apple provider configuration (dashboard, Apple Developer key, redirect allowlist) is outstanding, so **no Google, Apple or email sign-in has ever been performed** and no claim that they work appears anywhere in this repository. The screens render, and Supabase Auth's recovery endpoint answered a real request. Everything past that is NOT VERIFIED (`25` §25.15).

**Verified in M9.2.** One real provider — email — was configured and exercised end to end: a real sign-in in Chromium, a real ES256 token, real JWKS verification, real `/me`, real sync of 29 records including 10 result subjects, real cross-user denial, a real conflict, a real deletion that cascaded to zero, and a real export. Google and Apple remain **NOT CONFIGURED and NOT VERIFIED**, and no claim that they work appears anywhere. See `11` §11.14, `22` §22.19, `23` §23.16, `25` §25.16.

**Corrected in M9.1.** Three defects found in review and fixed: `result_subjects` was in the schema but not in the sync, so a result could reach the cloud without the subjects it is made of; a record created and deleted before its first sync was being created by that sync; and one rejected record aborted the transaction, silently discarding every other record in the same push. See `08` §8.18, `09` §9.19, `10` §10.17, `13` §13.18, `22` §22.18.

**Exit, as met:** authorization is enforced by the database, not the application — proven against the live Supabase project and by 22 tests against the same policies locally; there is no route that takes a student identifier; the API refuses to boot on a connection that can bypass RLS; a conflicted sync updates nothing; two accounts on one browser cannot see each other's records; signing out deletes nothing; account deletion cascades; export is RLS-scoped; 0 axe violations and 0 console errors across 320/390/768/1280; no secret in the browser bundle.

### M10 — Academic intelligence
Local embeddings, similarity ladder, clustering, topic matching, frequency analysis, evidence-first presentation.

**Exit:** the evaluation in `18` §8 is run and its results recorded; no output below 4 papers; no prediction language anywhere; every score carries its evidence.

**Depends on M8**, not merely on M5A: intelligence over a corpus students cannot see would have nowhere to surface.

### M11 — Admin and data quality
Source health dashboard, job monitor, review queue, corrections with audit, data-quality checks, the one-click fixture capture.

**Exit:** an operator can determine why any piece of data failed, from the admin UI alone.

### M12 — Hardening
Security review, accessibility manual pass, performance tuning, E2E completion, dependency audit, upload security verification, rate limits, error handling, backup/restore rehearsal, observability and alerting.

**Exit:** the Alpha readiness checklist (`30` §8) passes in full.

Together with M11 this is the "admin / hardening" pair: M11 makes failure diagnosable, M12 makes the product safe to hand to strangers.

### M13 — Pilot — experimental user test
10–30 students for 1–3 weeks. Observe, survey, fix critical problems, decide the feature freeze from evidence.

**Exit:** feature freeze agreed, based on data rather than preference.

### M14 — Alpha release
Deploy, release notes, known limitations, supported scope, bug-report route, final validation.

**Exit:** a shareable Alpha meeting `30` §11.

### M15 — College demonstration prep
Demo script, evidence pack, privacy explanation, data-source explanation, limitations, pilot proposal.

**Exit:** presentation-ready per `29` §4.

## 31.4 Risk register

| ID | Risk | L | I | Score | Mitigation | Owner |
|---|---|---|---|---|---|---|
| R-01 | A wrong academic calculation reaches a student | M | **Critical** | **High** | Clause-cited rules, property tests, real-grade-card validation, Sev-1 process | Dev |
| R-02 | Question-paper licensing prohibits redistribution | M | High | **High** | Resolve `OQ-008` before M5 completes; the data model supports link-only and analysis-only fallbacks | Human |
| R-03 | Papers are scanned images, making OCR the main path | M | Med | Med | Validate early (`OQ-019`); OCR is already designed in; extraction failure still leaves the library usable | Dev |
| R-14 | M4's academic validation stays open indefinitely because grade cards never arrive | M | **High** | **High** | Tracked as `OQ-024`. The calculators are already property-tested and clause-cited; what is missing is confirmation against VTU's actual practice, which only real grade cards give | Human |
| R-04 | Terms review blocks the announcements source | L | Med | Med | Framework built and testable regardless; manual entry is the fallback | Human |
| R-05 | Syllabus data entry is larger than estimated | **H** | Med | **High** | Confirmed real in M5a: the schema and API exist, but the *content* needs a verified source per subject. Seed deliberately left partial rather than invented | Dev + Human |
| R-06 | Students will not enter attendance manually | M | High | **High** | Test in M10; if it fails, reprioritise toward results and papers | Evidence |
| R-07 | The embedding model exceeds the container budget | M | Med | Med | Measure in M2 (`06` §6.8); fall back to a sidecar or hosted, reopening `DEC-006` | Dev |
| R-08 | Solo operator burnout / time | **H** | High | **High** | Milestones are independently valuable; M4 alone ships a useful product; no milestone requires a sprint | Human |
| R-09 | USN storage objected to at pilot | L | Med | Low | Downgrade to salted hash pre-designed (`12` §4); DOB already removed (`DEC-008`) | Human |
| R-10 | A source changes structure repeatedly | M | Low | Low | Fixtures, health monitoring, publish blocking | Dev |
| R-11 | The college declines a pilot | M | Med | Med | The product remains useful direct-to-student (`01` §1.6) | — |
| R-12 | A managed free tier proves unsuitable (DB autosuspend) | M | Low | Low | Validate in M2 (`OQ-020`); budget allows a paid tier | Dev |
| R-13 | Scope creep from Stage 2 feature requests | **H** | Med | Med | Freeze criteria in `30` §3; P2 promotion requires evidence | Human |

**The two highest-attention risks are R-01 and R-08.** R-01 because it is the only failure the product cannot recover from; R-08 because it is the most likely reason a solo project stops.

## 31.5 Human decisions by milestone

| Milestone | Decisions required |
|---|---|
| M2 | Approve architecture and Alpha scope; resolve every blocking item in `32`; confirm hosting; confirm the college and branch |
| M5b | `OQ-008` licensing; supply the paper corpus |
| M6 | `OQ-006` terms review; approve enabling the source |
| M9 | Approve the security review outcome |
| M10 | Approve the feature freeze |
| M11 | Approve the Alpha release |
| M12 | Approve the college approach and the demonstration content |

**No milestone proceeds past its gate without the human decisions listed.** This is the mechanism that keeps the human-in-the-loop rule operative rather than aspirational.

## 31.6 Definition of done

Per feature: the eleven criteria in `22` §13.

Per milestone: every feature done; tests green; documentation updated; the exit criterion demonstrably met; **the human has approved the gate where one exists.**

Per stage: the exit signal in `01` §1.6 observed in reality, not asserted.

## 31.7 Post-Alpha directions (not committed)

| Direction | Depends on |
|---|---|
| Additional schemes (2021, 2025) | Verified rule sets per scheme |
| Additional colleges | Demand, plus per-college verification |
| Autonomous colleges | Access to their regulations |
| Timetable and reminders | Stage 2 evidence |
| Richer marks analytics | Result data volume |
| Model papers | Corpus |
| Telegram delivery | Demand |
| Institutional dashboards | A pilot, plus a fresh privacy decision |
| VTU conversation | Stage 4 success and an introduction |

**None of these is promised.** They are recorded so that the architecture's extension points are deliberate, and so that a request for one can be answered with "here is what it would depend on" rather than a guess.

## 31.8 M9.3 — frontend redesign · ✅ **DELIVERED**

The interface was functionally complete and read like an internal admin tool:
46 uses of one container primitive, every region the same weight, subject codes
without names, and a resource list occupying a phone's entire first screen.

Rebuilt around information hierarchy rather than containers. See `05` §5.14–5.15
for the design rules and the permanent anti-template constraints, `07` §7.18 for
the navigation and dashboard model, `22` §22.20 for the QA, and `23` §23.17 for
what it cost (nothing: no dependency added, CSS slightly smaller, page heights
down by a third to a half).

**Fixed a latent defect while there:** six stylesheets referenced CSS custom
properties that were never declared. Custom properties fail silently, so those
rules had been falling back since M8 with nothing to show for it.

**Theme customisation remains DEFERRED.** No picker, no accent selector, no
per-user colours. The token architecture is centralised and ready for a future
milestone to override values rather than rewrite components.

**Semester 5 pilot (7 September 2026):** the dashboard leads with the current
semester and its status, which makes "Semester 5 · In progress" the natural
reading of the screen. **The date is not in the code**, and no business logic
derives a semester from the calendar (`ED-71`).

## 31.9 M9.4 — reference-driven visual redesign · ✅ **DELIVERED**

M9.3 made the product structurally right and left it looking anonymous. M9.4
gives it a visual identity, derived from five supplied reference images rather
than from a house style.

Delivered: a revalued token system (violet-black dark default, lavender light
theme, two-violet accent split, ambience and glow as separate tokens), a
tightened type scale with light display weights, pill actions, mobile modules,
a bottom bar with an active pill, a circular top-bar action, and a next-class
accent on the dashboard's Today list.

See `05` §5.16-5.17 for the visual language and the explicit list of what was
*not* taken from the references, `07` §7.19 for the two component changes,
`22` §22.21 for QA in both themes, and `23` §23.18 for the cost (no dependency;
+0.7 kB gzipped CSS).

**Fixed while there:** `.primaryLink` on the account screen was white on
`--accent` at 2.72:1 — a WCAG AA failure on the control that starts sign-in.

**Theme customisation remains DEFERRED** (M9.4 §25). No picker, no accent
selector, no per-user themes. The system now carries two complete themes driven
by `prefers-color-scheme`, which is the architecture a future picker overrides
rather than replaces.

**Semester 5 pilot (7 September 2026):** the dashboard leads with the semester
and its status, now marked with the product's one accent chip. **The date is
still not in the code** and no business logic derives a semester from the
calendar (`ED-71`).

## 31.10 M9.5 — reference-driven layout redesign · ✅ **DELIVERED**

M9.4 revalued the tokens and left the structure alone, which produced the old
application in a new palette. M9.5 changes the structure.

**The sidebar is gone.** Navigation is a two-tier horizontal bar: the three
areas on top, the destinations inside the open area beneath. Both tiers scroll
sideways on a phone; the bottom bar keeps its five chosen destinations and now
also selects the area.

**The dashboard is two columns** — the student's own semester in the main
column, what-changed and where-else in a sticky rail. `Module` returns as a
primitive for content that sits *beside* a page rather than in it, with a stated
test for when to use one. Section headings are readable again at 16px solid
rather than 13px uppercase muted.

See `05` §5.18 for the design language, `07` §7.20 for the two component
changes, `22` §22.22 for QA across nine widths in both themes, and `23` §23.19
for the cost.

**Three defects fixed**, one of them predating the milestone: an unnamed brand
link below 480px, a clipped area tab at 390px, and subject codes breaking one
character per line in the timetable week grid between 900 and 1080px.

**Theme customisation remains DEFERRED.** **VTU polling remains DISABLED.**

## 31.11 M9.5.1 — visual fidelity pass · ✅ **DELIVERED**

M9.5 fixed the architecture; the surfaces were still wrong. A third reading of
the references — for micro-detail rather than structure — found that neither
ever puts content directly on the page ground, and that their controls and
navigation are markedly more generous than what had been shipped.

`Panel` draws a surface again and the surface-less `Section` is deleted, so
there is one container primitive rather than two. The bar is 64px with tabs
8px apart; buttons gained side padding; the panel radius, the border value and
the metric column cap were all measured off the references and corrected.
Question papers, Results and Attendance moved to *one bordered surface with
dense rows inside* — the reference's answer to density, and neither fifty cards
nor fifty floating rows. `--settings-max` stops pages of prose and switches
from spreading across a 1920px window.

Both bundles got **smaller**. See `05` §5.19, `22` §22.23, `23` §23.20.

**Theme customisation remains DEFERRED. VTU polling remains DISABLED.**

## 31.12 M9.5.2 — iconography · ✅ **DELIVERED**

A purpose-built GradTools icon set: **32 shapes**, one `viewBox`, one stroke weight,
five tokenised sizes, accessibility enforced in the component rather than at the call
sites. `lucide-react` removed — its 2px stroke read heavier than the type beside it,
and stroke weight is not something a library exposes per icon.

Every destination has its own glyph; Account and Profile no longer share one. Contextual
marks were added only where they earn their place — empty states, retry, sign out, back,
the search field, external links, status pills — and deliberately not on metric labels.

See `05` §5.20 for the set's rules and the two decisions inside it (the `gpa` optical-size
fix; pruning what nothing renders), `22` §22.24 for QA and the environment it exposed,
`23` §23.21 for the cost.

**`tests/README.md` now documents the QA environment** — the harness's origin, the API,
its CORS requirement, and the two silent failure modes that make a green sweep
meaningless.

**Theme customisation remains DEFERRED. VTU polling remains DISABLED.**

## 31.13 M10A — deterministic academic intelligence · ✅ **DELIVERED**

Most of M10A already existed. M6 built the eight-semester model, cumulative
standing, subject performance, the own-mean strength classification, backlogs
and graduation progress — and built them to the same rules M10 specifies
(own baseline, ±1 grade point, minimum five graded subjects, no percentile, no
fallback for an unavailable rule set). The honest finding at the start of this
milestone was that **the domain layer was largely done and the gaps were
narrow.**

Delivered: `semesterHistory` (§6, §7) and `dataCompleteness` (§19), surfaced on
"My degree" as a Semester history panel and a one-line basis statement.

| Decision | Outcome |
|---|---|
| Where it lives | **Extended "My degree"**, no new route — a separate Insights page would have duplicated ~70% of it (`07` §7.21) |
| Trend form | **Inline bars + signed deltas**, no chart library. `OQ-040` stays closed as deferred |
| Mean SGPA | **Refused.** CGPA is the authoritative aggregate (`16` §16.12) |

**M10B (question-paper intelligence) and M10C (AI) are NOT started**, per §55 and
§65. M10C remains explicitly out of scope: no model, no embedding, no hosted
inference, and no academic record leaving the device.

**Theme customisation remains DEFERRED. VTU polling remains DISABLED.**

## 31.14 M10B — question-paper intelligence · ✅ **DELIVERED (scoped by evidence)**

M10B began by measuring the corpus, and the measurement changed the milestone.

**Shipped:** versioned question normalisation (`question-normalization-v1`),
tested lexical similarity, a measurement harness, cross-paper question search
(API + UI), and confidence/provenance-aware presentation.

**Deliberately not shipped as student features:** repetition and similarity.
The nine current papers are nine different subjects from one sitting, so no
question in the corpus can repeat. "Found in 0 papers" would state something
about VTU that is a fact about our corpus.

**AI decision gate (§62): D — AI not yet justified.** Not because models are
poor, but because the corpus cannot pose the question. See `18` §18.y.

**M10C is NOT started.** No model, no embedding, no hosted inference.
