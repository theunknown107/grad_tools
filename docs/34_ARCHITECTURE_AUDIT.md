# 34. Architecture audit — what Phase 7 asks for, and what already exists

**Baseline:** `1151bb0` · **Method:** repository inspection, not recollection.

Phase 7 asks for a domain model, a calculation layer, a provider abstraction, an
ingestion pipeline, validation, caching, security, privacy and a test strategy.

**Most of it is already built.** This document says which parts, with the
evidence, so the phase spends its effort on the gaps rather than on rewriting
work that already passes its tests. Where something is genuinely missing it says
so plainly, and where the phase's own instructions contradict a standing
decision it says that too rather than picking one silently.

---

## 34.1 The Phase 7W checklist, against the code

| Required | State | Evidence |
|---|---|---|
| Student model | **exists** | `student_profiles` (cloud) + `StudentProfile` (`domain/types.ts`), RLS-scoped |
| College / branch / scheme | **exists** | `colleges`, `branches`, `schemes`, `rule_sets` in the reference database |
| Semester model | **exists** | `semester_records`, `SemesterView` (`domain/academics.ts`) |
| Subject model | **exists** | `subjects` (reference) + `semester_subjects` (student) |
| Syllabus model | **exists** | `syllabus_modules`, served by the reference router |
| Result model | **exists** | `semester_results` + `result_subjects` |
| Marks / grade model | **exists** | `result_subjects` carries internal/external/total/status; `grades.ts`, `marks.ts` in the rules package |
| Backlog model | **exists** | `backlog_records` |
| Attendance model | **exists** | `attendance_records` + local `classMarks` |
| Timetable model | **exists** | `timetable_slots` + `timetableImports` provenance |
| Notification model | **exists** | `announcements` + local notification state |
| **Question-paper model** | **REMOVED** | deleted in M10A.13 — see §34.5 |
| Deterministic calculation layer | **exists** | `packages/academic-rules`, zero dependencies |
| Provider abstraction | **partial** | `SourceAdapter` exists; one implementation |
| Ingestion pipeline | **partial** | full for announcements; document pipeline removed |
| Validation layer | **exists** | zod contracts, CHECK constraints, source gates |
| Caching boundaries | **undocumented** | see §34.4 |
| Security boundaries | **exists** | docs/13, RLS, `authorization.test.ts` |
| Privacy model | **exists** | docs/12, local-first by default |
| Test strategy | **exists** | 1154 web + 341 API, all executing |
| Unresolved decisions | **exists** | 48 open questions, 13 cited in code |

---

## 34.2 The calculation engine is already extracted

Phase 7D asks that calculations not live in React components. They do not.

`packages/academic-rules` is a pure, zero-dependency package exporting
`calculateSGPA`, `calculateCGPA`, `calculatePercentage`, `calculateClass`,
`evaluateCourseResult`, `validateCourseMarks`, `resolveGrade`, `gradeFromMarks`,
`calculateAttendance`, `calculateClassesCanMiss` and `calculateClassesMustAttend`.

Two properties matter more than the list:

**Every result carries its own explanation.** `RuleResult<T>` is a success with a
`buildExplanation` trail or a typed failure with a reason — which is why the UI
can show the clause a figure came from instead of asserting it.

**The rules are data, not code.** A `RuleSet` carries the grade bands, the credit
weighting, the attendance threshold and the percentage formula, so a second
regulation is a row rather than a branch. `rule_sets` is a real table.

Nothing here needs building. `targets.ts` already adds `calculateRequiredMarks`
and `calculateRequiredSGPA` to the list above, tested — what is missing is a
caller, not a calculation (§34.4.4).

---

## 34.3 The provider abstraction exists and has one implementation

Phase 7E's boundary is already drawn, in `services/api/src/sources/adapter.ts`:

```
RawItem  →  NormalizedItem  →  ValidationVerdict
                                    ↓
                          hashItem / detectChanges
```

`SourceAdapter` is the interface; `vtu-announcements.ts` is the only adapter.
Nothing above the adapter knows about HTML, selectors or VTU URLs — the
frontend consumes `/api/v1/announcements`, which returns normalised records.

**The `sources` registry Phase 7T asks for already exists, and is stricter than
the phase describes.** Beyond kind, publisher, URL and access method it carries
three independent legal gates:

- `robots_status` — and `unknown` is explicitly *not* permission
- `terms_status` — reviewed by a human, with a date
- `rights_status` — rights to the material, separate from both gates

`access_method` defaults to `none`: a source in the registry is **recorded, not
reached**. That default is the safety property, and it should stay.

**Gap:** the abstraction is proven by exactly one adapter. An abstraction with
one implementation has not yet been shown to abstract anything. The honest test
is a second adapter of a genuinely different shape.

---

## 34.4 Genuine gaps

1. **Caching is undocumented.** There is HTTP caching and a client-side
   repository layer, but no written TTL, invalidation, staleness or fallback
   policy. Phase 7M is a documentation gap, not a code gap.
2. **No admin / data-health surface** (Phase 7V). `sources`, `source_changes`
   and the validation verdicts hold the data such a surface would read; nothing
   presents it.
3. **Second provider.** See §34.3.
4. **The target calculators are built, tested, and reach nobody.**
   `calculateRequiredMarks` and `calculateRequiredSGPA` exist in
   `packages/academic-rules/src/targets.ts` and have their own
   `targets.test.ts` — and `grep` finds no caller anywhere in `apps/web` or
   `services/api`. This is the opposite of the usual gap: the engine can already
   answer "what do I need in the exam to pass" and "what SGPA do I need next
   semester", and no screen asks it. Surfacing them is UI wiring against the
   frozen contract, not new domain work.

   *(This entry was wrong in the first draft of this document, which claimed the
   functions did not exist. They do. The claim was written from memory and
   corrected by running `grep` — which is the whole method this audit is
   supposed to follow.)*

5. **Exam / ExamSession entities do not exist in the active product.** The only
   `exam_session` in the tree is a column added by
   `0010_question_paper_library.sql` to the `documents` table — part of the
   removed system, and dropped with it. Nothing models a scheduled examination
   today; the calendar import produces dated events, which is not the same
   thing.

---

## 34.5 The question-paper contradiction — unresolved, deliberately

Phase 7I asks to build "paper ingestion, paper metadata, PDF storage, question
extraction, normalization, subject mapping, module mapping, duplicate detection
and frequency analysis", and Phase 7J asks for question and module frequency
analytics on top.

**That system existed and was deliberately destroyed, on instruction, three
milestones ago.**

- M10A.9 declared question papers scrapped: "no tokens, storage, dependencies,
  QA, UI or implementation time."
- M10A.10 removed the product surface — pages, routes, hooks, search entry.
- M10A.11 removed the query surface — the router, the intelligence modules.
- M10A.13 removed the ingestion pipeline and dropped six tables:
  `extracted_papers`, `extracted_questions`, `extracted_sub_questions`,
  `extracted_mcq_items`, `document_sections` and the OCR `jobs` queue. **8,400
  lines.**

Every one of those milestones repeated the instruction not to spend anything on
question papers. Phase 7I reverses it.

**No question-paper work has been started, and none should be until this is
settled.** Rebuilding is possible — the migrations are forward-only, so the work
would be new tables and new code, not a revert — but it is days of work to
restore something removed at explicit request, and doing it on the strength of
one line in a long brief would be the wrong reading of a genuine conflict.

`docs/17` and `docs/18` still specify these systems and now describe code that
does not exist. They should be marked historical if the removal stands.

---

## 34.6 What Phase 7 should actually do

Given the above, the useful order is:

1. **Settle §34.5.** Everything in 7I and 7J depends on it.
2. **Document the cache boundary** (7M) — a gap with no code behind it.
3. **A second source adapter** (7E) — the only way to know the abstraction works.
4. **Exam/ExamSession**, if the product needs scheduled examinations.
5. **Surface the target calculators** that already exist and answer real
   student questions (§34.4.4) — UI wiring, no new domain work.
6. **Admin/data-health surface** (7V), reading what the registry already stores.

What Phase 7 should **not** do is rebuild the domain model, the calculation
engine, the persistence layer, the validation layer or the test strategy. Those
exist, they are tested, and the frozen UI at `1151bb0` already consumes them.

---

## 34.7 The VTU 2022 rule set, checked against the supplied regulations

Phase 7B §9 and §10 say to confirm the rules against the source rather than
against any summary. Checked field by field against the regulations pack:

| Rule | Regulations | Shipped | |
|---|---|---|---|
| Grade bands | O 90–100/10 · A+ 80–89/9 · A 70–79/8 · B+ 60–69/7 · B 55–59/6 · C 50–54/5 · P 40–49/4 · F 0–39/0 | identical | ✅ |
| Special grades | DX, AU, AB, PP, NP, IC, W | all seven present | ✅ |
| Max CIE | 50 | `cieMax: 50` | ✅ |
| Min CIE for SEE | 40% of CIE max | `cieMinPct: 40` | ✅ |
| Min SEE | 35% of SEE max | `seeMinPct: 35` | ✅ |
| Overall pass | 40% of CIE+SEE | `overallMinPct: 40` | ✅ |
| Min passing grade | P / 4 | P = 4, lowest non-F band | ✅ |
| SGPA / CGPA | Σ(C·G)/ΣC, Σ(C·S)/ΣC | `credit_weighted_gp`, `credit_weighted_sgpa` | ✅ |

**`seeMax: 100` is not a discrepancy.** The handoff note gives SEE weightage as
50; the rule set stores the scale the paper is *written* on (100) and derives
the weightage as `courseMax - cieMax` = 50. `course-result.ts` computes the
threshold from the derived weight, so the SEE minimum lands at 17.5 — 17 fails,
18 passes, which is the behaviour DEC-037 recorded. Keeping the two scales apart
is what lets `targets.ts` convert between a mark on the paper and a mark in the
total; collapsing them to one number would lose that.

**The three unverified special grades stay unverified.** `AB`, `IC` and `W`
carry `points: null` rather than a guess, and `resolveGrade` returns a typed
failure for them instead of a number. That is the "surface it, never fabricate
certainty" rule (§15) already implemented, and it should not be tidied away by
assigning them zero.

**Not yet modelled:** SEE participation per course. The regulations state a
course without an SEE takes its letter grade from CIE alone, so `hasSee` is
reference data per DEC-037 and is never inferred from `external = 0`. The
Exam/ExamSession entity that would carry this properly is still the gap
identified in §34.4.5.
