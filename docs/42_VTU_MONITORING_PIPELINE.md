# The VTU monitoring pipeline

Authority: Phase 7B.3 §5–§76, §98, §106–§148 · measured at `2fbe67d` + this change

## What was built

```
SOURCE → DISCOVERY → ACQUISITION → IDENTITY → HASH/VERSION → EXTRACTION
       → NORMALIZATION → CLASSIFICATION → VALIDATION → APPLICABILITY
       → IMPORTANCE → NOTIFICATION
```

Every stage below acquisition exists and is exercised end to end. Acquisition
has two implementations and only the fixture one is reachable, because the
registry refuses the other — see **Still refused** below.

| Module | Does |
| --- | --- |
| `src/monitor/acquire.ts` | the boundary: fixture, or ask the registry and be refused |
| `src/monitor/run.ts` | identity, versioning, change detection, classification, ranking, ledger |
| `src/monitor/classify.ts` | what an item is, and how much it matters |
| `src/monitor/applicability.ts` | whether it is this student's business, and why |
| `src/monitor/store.ts` | `source_items`, `monitor_runs` — the reference side |
| `src/monitor/notify.ts` | `source_notifications` — the student side |
| `scripts/vtu-monitor.ts` | `pnpm vtu:monitor --fixture --dry-run --family --verbose` |

## Still refused, and this is the system working

```
$ pnpm vtu:monitor --family examination
examination  (vtu-examination)
  UNAUTHORIZED: Source "vtu-examination" has access method "none" and is
  never fetched automatically. Only "http_fetch" sources are.
```

All six families carry `terms_status = 'unknown'`, `rights_status = 'unknown'`,
`enabled = false`, `access_method = 'none'`, and none of those values changed in
this phase. **No code here fetches vtu.ac.in.** The one test that would catch a
regression asserts the refusal for all six, including with no registry at all
(§113).

Nothing about the architecture changes when permission is eventually obtained.
`acquireLive` is the only place a fetch would go, and everything below it is
already running against fixtures every time the suite does.

## Measured, not asserted

Three runs over the committed fixtures, against a real database:

| Run | discovered | new | unchanged | updated | revised | removed |
| --- | --- | --- | --- | --- | --- | --- |
| v1 (first sight) | 11 | 11 | 0 | 0 | 0 | 0 |
| v1 again | 11 | 0 | 11 | 0 | 0 | 0 |
| v2 | 12 | 1 | 9 | 1 | 1 | 1 |

The second row is §139: **the same worker over the same snapshot produces zero
new anything.** Not because the worker is careful — because
`(source_id, external_id, content_hash)` is unique and
`(auth_user_id, external_id, content_hash)` is unique, so a duplicate is a
constraint violation rather than a bug somebody has to notice.

After the three runs: 14 `source_items` rows, 1 of them marked removed, 18
`monitor_runs` rows. The withdrawn draft is still there. A source that takes a
document down has not made it untrue (§15, §77).

### What the v2 snapshot proves, family by family

| Family | Change | Why it is that change and not another |
| --- | --- | --- |
| `administration` | NEW | a post that was not there before |
| `examination` | REVISED | the notice *says* it supersedes `exam-2026-0301` |
| `academic_calendar` | UPDATED | same id, different bytes, no supersession statement |
| `ug_scheme_syllabus` | REMOVED | the draft is no longer served |
| `pg_scheme_syllabus` | UNCHANGED | identical snapshot |
| `regulations` | UNCHANGED | including the item nobody can classify |

**Revised is not updated**, and the two fixtures exist to keep them apart. A
publisher fixing a typo and a publisher changing the exam date produce different
bytes in both cases; only the document can say which happened, so supersession
is read and never inferred from recency (§12, §88).

## The applicability engine

One engine, `applicabilityOf(source, student)`, returning
`applicable | not_applicable | unresolved` plus the dimensions that matched and a
reason in words.

- **Seven axes are a conjunction.** Every constraint the source states must
  match. A notice for one branch's semester 5 reaches a semester-5 student of
  another branch not at all.
- **Courses are a disjunction**, deliberately unlike the rest: a notice naming
  five codes is for anyone sitting any of them, and a backlog paper counts.
- **`null` on an axis means "not targeted"**, never "unknown". The publisher
  chose not to restrict it.
- **A scope nobody could read is `unresolved`**, which is a different column in
  the schema and a different answer in the engine. "For the candidates
  concerned" is not university-wide; it is a sentence nobody can act on.
- **`unresolved` notifies nobody** (§35). A broadcast cannot be un-sent.

It does **not** duplicate the browser's `relevanceOf`. That answers "should this
appear in this student's list" and answers it leniently on purpose; this answers
"should we interrupt this student" and is strict. Same matching rules, two
policies, differing only in what they do with `unknown` — which is written into
the top of `applicability.ts` so the next person does not merge them.

## Where the fanout runs, and why it is not in the worker

The obvious shape is a worker looping over every student. **This codebase cannot
do that, and that is a feature.** Student data is reachable only through
`withUser`, as `authenticated`, with `auth.uid()` from a verified token; there is
no service-role client and no unscoped query helper (M9 §44). A worker-side
fanout would need a connection that bypasses RLS, turning every policy in the
student schema into decoration for the sake of a loop.

So:

- **the worker** reads and classifies each source item **once**, for everybody,
  into the reference database. No student data is touched (§64, §65).
- **the session** projects those shared rows against the caller's own profile
  and inserts the caller's own notifications — rows RLS permits precisely
  because they are theirs.

Still one engine and one projection (§49, §146). What moves is where the loop
runs. It is **not** per-user crawling: no student's request fetches anything
(§144).

## Two findings that came from running it, not from reading it

1. **"Scheme and Syllabus" was classifying as `syllabus`.** VTU publishes one
   document under that name and it is a scheme document containing a syllabus.
   The rule order was wrong; `scheme` now precedes `syllabus`, and a test pins
   it.

2. **Every programme-scoped notice reached zero students.** VTU states the
   programme on nearly everything it publishes ("Time Table for B.E. V Semester
   Examination"), the student record had no programme column, so the engine
   read that axis as "the student has not said" → `unresolved` → nobody. The
   engine was right; the record was incomplete. Supabase `0008` adds
   `student_profiles.programme`, nullable, never inferred from the scheme or the
   branch.

   **The frozen frontend does not yet collect it.** The column and the API
   accept it; nothing asks the student. Until something does, every
   programme-scoped notice resolves to `unresolved` for existing profiles —
   which is the correct behaviour, and is a gap, and is recorded here rather
   than hidden behind a default.

## Tests

71 new, all green; 1930 in the suite, up from 1859.

`test/monitor-engines.test.ts` (50) — no database. The §115 dimension matrix
asserted **twice per axis**, matched and missed, because an engine that only
ever returns `applicable` passes every one-sided test. Plus classification
determinism, the `unresolved` refusal, importance, content identity under URL
aliasing, and all five change types.

`test/monitor-pipeline.test.ts` (21) — both databases. Fixture acquisition for
all six families; the mandatory unauthorized-source refusal (§113) including
with no registry; missing vs malformed distinguished; the ledger; idempotence;
revision; update; removal; delivery with a reason; dedupe; muting; irrelevant →
nothing; ambiguous → nothing; **RLS isolation between two students**; a student
cannot reassign their own notification; a non-http source link is refused by the
schema.

The values in the engine tests are deliberately **not** CSBS / 2022 / semester 5
(§32). A suite written around this developer's own record would let a hardcoded
shortcut pass.

## What this phase did NOT build

Named so nobody has to discover it.

- **No scheduler.** `vtu:monitor` is a command. There is no daemon, no cron, no
  persistent process, and nothing here may be described as "always on" (§48).
  The worker is written so a scheduler calls it; none is wired.
- **No HTTP surface for notifications.** `source_notifications` is written and
  read by `notify.ts`; no route exposes it and the frozen frontend does not
  render it. The projection is proven by tests, not by a screen.
- **No parser for five of six families.** The fixtures model what a family's
  items *look like* once parsed. Only UG scheme/syllabus (the catalogue
  pipeline) and exam time tables (user-supplied, docs/40) can actually turn a
  VTU document into items. Administration, examination, academic calendar, PG
  and regulations have no extractor — so the pipeline below extraction is
  complete and proven, and the extraction step for those five is a fixture.
  **This is the honest coverage figure §98 asks for: 1 of 6 families has a real
  document parser.**
- **No exam-timetable projection into the notification stream.** docs/40's
  reader is local-first and unconnected to this.
- **No admin diagnostics UI.** `monitor_runs` and `source_items` answer §132–§136
  by query; nothing renders them.
- **`department` and `stream` have no student column**, so notices scoped to
  either resolve to `unresolved` for everyone. Same shape as the programme
  finding, not yet fixed.

## Carried-over, unchanged by this phase

- `/profile` overflows below 430px. Present at `2ae84a6` and at `2fbe67d`, with
  and without the management panel. Not caused by this work.
- `tests/real-academic-chain-qa.mjs` reports 11 problems of 16 checks. **Verified
  at clean `2fbe67d` before this change: identical, 11 of 16.** Pre-existing.
- Exam timetable data is local-first with no cloud sync.
- Manual exam-event mapping is not implemented.
- `pnpm format:check` is red across 76 files, most of them untouched here. The
  files this phase adds or edits are formatted.
