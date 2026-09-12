# Reaching a student who is not here

Authority: Phase 7B.3.1 §1–§142 · measured at `2dccfc6` + this change

## The one thing B.3 could not do

B.3 projected notifications inside the student's own session. Correct,
RLS-safe, and unable to do the job the product exists for: a student asleep when
VTU postpones their examination cannot run a projection.

This phase moves the fanout server-side without giving a background process the
run of the student schema.

## How, exactly

**Not `service_role`.** That would hand one background process every student's
grades, attendance, timetable and USN in order to send them a link to a public
PDF, and would turn every policy in the schema into decoration (§46).

**Not a `SECURITY DEFINER` function either.** The matching rules live in
`applicability.ts` and §139 forbids a second copy, so the decision cannot move
into SQL. A function returning "the profiles matching this notice" would have to
either reimplement the engine — two engines, drifting — or accept a filter and
hand back rows, which is a generic privileged query mechanism wearing a narrow
name (§45).

**A role with three grants, and a view that cannot grow columns.**

| The worker may | Through |
| --- | --- |
| read six columns of matching context | `monitor_applicability_context` |
| read course codes a student holds | `monitor_course_context` |
| create a notification | `INSERT` on `source_notifications` |

That is the complete list. A view has a fixed column list and no parameters, so
it cannot be talked into returning a column it does not have.

### Proven, not asserted

As `gradtools_monitor`, every one of these is refused:

```
student_profiles       permission denied for table student_profiles
semester_results       permission denied for table semester_results
result_subjects        permission denied for table result_subjects
attendance_records     permission denied for table attendance_records
timetable_slots        permission denied for table timetable_slots
source_notifications   permission denied for table source_notifications
```

The last line is the interesting one: **the worker cannot read a notification
back, not even one it just wrote.** It also cannot `UPDATE` (so it cannot mark
anything read on a student's behalf) or `DELETE` (so it cannot unsend). And
because the login role is `NOINHERIT`, a connection that forgets to `SET ROLE`
holds nothing at all — also asserted.

### Dedupe without read access

`INSERT ... ON CONFLICT DO NOTHING` needs no `SELECT` privilege. That is what
makes insert-only fanout possible rather than merely desirable: the worker
cannot enumerate what a student has already been told, and does not need to.

**With one wrinkle that cost a debugging session.** Naming the arbiter columns —
`ON CONFLICT (auth_user_id, external_id, content_hash)` — makes PostgreSQL
require `SELECT` on them, and the statement then fails with `permission denied`
under exactly the grants that make the design safe. The bare form is the one
that works. *The privilege model chose the SQL, rather than the other way
round.*

## What the profile gained, and what it did not

| Dimension | Verdict | Why |
| --- | --- | --- |
| `programme` | **added** (Supabase 0008, UI this phase) | VTU names it on nearly every notice |
| `department` | **not added** | `null` in all 22 fixture items |
| `stream` | **not added** | `null` in all 22 fixture items |

§7 and §8 say not to add unused fields to satisfy a checklist, so the corpus was
counted rather than guessed at. Notices scoped to department or stream resolve
to `unresolved` for everybody — the correct answer to a question nobody
recorded — and `recipientBatch` says so in a comment rather than deriving one
from the branch name.

The Profile form gains one `SelectField`, in the existing grid, with the
existing components. A select rather than a text box because matching is exact
(§76, §77) and free text invites `be`, `BE.` and `Bachelor of Engineering` —
three spellings that would each silently fail to match. **"Not set" is offered
and never preselected away**; a legacy profile with `programme = null` keeps
working and is simply not interrupted about programme-scoped notices (§12).

There is no "not applicable" option because there is no such student: everyone
VTU examines is on some programme. A student who does not want to say has "Not
set", which resolves to `unresolved`.

## What runs it

**Nothing.** GradTools has no deployment — no Dockerfile, no Procfile, no
platform configuration, and the only GitHub Actions workflow runs the test
suite. `pnpm --filter @gradtools/api worker` is a loop in a terminal that stops
when the terminal does.

So, per §127 and §128: **production-ready scheduled worker; deployment not yet
active.** GradTools is not monitoring VTU, and could not be even if it were
deployed, because the source gate still refuses live acquisition.

What exists is the execution path a scheduler calls (§38): `runCycle` takes its
connections as arguments and knows nothing about what invoked it, so a managed
cron, a queue consumer or a container loop all drive it unchanged. Cadence is
`MONITOR_INTERVAL_MINUTES`, default 60, **minimum 5 enforced rather than
documented** — a configuration that would hammer a source fails to start.

While fixing it: `services/api/package.json` carried `"worker": "tsx
src/jobs/main.ts"`, and `src/jobs/` does not exist. It now points at the worker.

## Measured

Three runs over the committed fixtures, one student with a complete profile:

| Run | created | already held | not applicable | unresolved |
| --- | --- | --- | --- | --- |
| first | 4 | 0 | 4 | 6 |
| again, unchanged | **0** | 4 | 4 | 6 |
| after the v2 revision | 2 | 4 | 8 | 7 |

The middle row is §21: the same worker over the same snapshot creates nothing,
by constraint. The third is §59: a revision the source itself declares is news,
and exactly one notification per student follows it.

The dry-run report §43 asks for:

```
  exam-2026-0301  exam_timetable/high
    99999999…  created         scheme+programme+semester  Applies to your scheme · programme · semester.
    aaaaaaaa…  not_applicable  —                          This notice is for a different scheme.
    aaaaaaaa…  unresolved      —                          This notice is for a particular programme and
                                                          semester, and your profile does not say which is yours.
```

## The importance floor

§54's "do not turn six source families into a firehose", made concrete: only
`high` and `medium` are materialized. The fixtures contain a housekeeping tender
— `administration/low`, university-wide — which is exactly the shape that would
otherwise reach every student in the database. It is stored, versioned and
reviewable, and interrupts nobody. `--floor high` narrows it further.

## Tests

64 new, all green; **1994 in the suite, up from 1930.**

- `monitor-fanout.test.ts` (44) — worker privilege (eight refusals asserted
  individually), the **mandatory offline test** (§109: no session exists while
  the notification is created; one is opened afterwards), two-user fanout,
  multi-dimension → one row, idempotence, two workers racing, **partial fanout
  over ten students recovered without duplicates** (§116), revision, withdrawal,
  the importance floor, profile completeness, no-guessing, RLS isolation, IDOR,
  forging, health, keyset paging, dry run.
- `monitor-inbox.test.ts` (11) — the HTTP surface: ordering by importance,
  source link, reason, **no plumbing in the response** (`run_id`,
  `content_hash`, `auth_user_id` asserted absent), per-student isolation, IDOR
  returning the same 404 as a nonexistent id, mark-read, mark-all-read.
- `source-notifications.test.tsx` (9) — the browser half, including that a
  signed-out student causes **no request at all**.

**From genuinely empty databases with the monitor roles dropped, all 1994
pass** — §102 and §103: the schema is built by migrations found in a directory,
and `gradtools_monitor` is created by one of them.

## Profile QA

`node tests/profile-programme-qa.mjs` — nine widths × two appearances, 100
checks. 98 pass.

The two failures are `color-contrast`, 18 nodes, dark mode. Every node is
app-shell chrome — the brand mark, the sidebar group labels, the nav links, the
footer — and none is the programme field. **Verified at clean `2dccfc6`:
identical, 18 nodes.** Pre-existing, not caused by this phase.

## Unresolved limitations

- **No deployed scheduler.** Stated above and in `schedule.ts`; nothing may be
  described as always-on.
- **Live VTU acquisition is still refused**, unchanged, by design. `terms_status`
  and `rights_status` remain `unknown` on all six families.
- **`department` and `stream` have no representation.** Deliberate, per the
  corpus count, and it means a notice scoped to either reaches nobody.
- **The VTU panel is unreachable without an account.** Correct — these rows are
  per-account — but it does mean the notification materialization is invisible
  to anonymous local-first use, which is how most of this product is used today.
- **Five of six families still have no document parser** (docs/42 §98). The
  fixtures model parsed output; only UG scheme/syllabus and exam time tables can
  read a real VTU document.
- `tests/real-academic-chain-qa.mjs` reports 11 problems of 16, and
  `tests/subject-identity-qa.mjs` times out. **Both verified identical at clean
  `2dccfc6`** before this change. Pre-existing.
- `pnpm format:check` remains red across files this phase does not touch.
