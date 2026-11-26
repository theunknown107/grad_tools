# Printable statement, grade-card CGPA, and re-exam attempts

Authority: 22OB (VTU 2022 regulation) · the VTUSync competitive audit
(`D:\GradTools-artifacts\research-2026-10-23-vtusync\REPORT.md`) · this task.

Four student-facing additions, each built on the figures GradTools already
computes. None adds a calculation engine, a dependency, or a network call, and
none synces new data to the cloud.

## 1. Results portal: Summer / Make-up 2026

`packages/vtu-catalogue/data/vtu-result-sessions.json` gains one session,
`SME26cbcs` (`https://results.vtu.ac.in/SME26cbcs/index.php`).

**Verification.** `results.vtu.ac.in/` (its main page, HTTP 200, "Results
updated on : October 17, 2026") links this path from a panel labelled *"Summer
/ Makeup - 2026 Examination [B.E 2022 Scheme 1st & 2nd Semester]"* (a separate
panel serves the 2025 scheme). The page title is *"VTU PROVISIONAL RESULT
SUMMER / MAKEUP - 2026 EXAMINATION RESULTS"*. It is CBCS and in the product's
2022-scheme scope. No USN was entered; no form was submitted. The entry's note
records that this was verified on VTU's own page, not on the third-party page
the rest of the file was transcribed from. Test: `result-sessions.test.ts`.

## 2. Printable academic statement

`/results/statement` (reachable from Results → "Print summary" and a semester's
"Print"). `domain/statement.ts` assembles it; `features/results/StatementPage.tsx`
renders it; print styles live in `styles/index.css` under `@media print`.

- **It reads, it does not compute.** SGPA, CGPA, percentage, credits come from
  `academicStatistics`; grades and pass/fail from `evaluateResultSubject`;
  credits from `creditsOf`. There is no second calculation path.
- **Missing is not zero (OQ-049).** A field the record does not hold is left
  out, and a figure that could not be worked out carries its reason.
- **It is not a marks card.** Every statement, on screen and on paper, is
  labelled *"GradTools-generated academic summary — not an official VTU marks
  card or transcript."* It does not imitate VTU branding.
- **The class** is shown only for a completed degree with nothing failed (22OB
  6.8 awards a class on completion); otherwise it says why not.
- **Print** is the browser's own dialog → Save as PDF. Nothing is uploaded. The
  toolbar is screen-only; the document is A4, black on white in any theme, with
  table headers repeated per page and rows kept whole.
- **Not browser-print-verified** in this task: the print view's pagination was
  not inspected in a real browser. The on-screen view is tested.

Tests: `result-statement.test.tsx`.

## 3. CGPA reconstructed from grade-card SGPAs

Academics → Calculators → CGPA. `domain/grade-card-cgpa.ts`; the student enters
each semester's SGPA and its credits registered and earned, as the grade card
prints them. Stored under `gradeCards` (device-local, in the backup, not
synced, labelled as the student's own).

**The denominator is the open question (OQ-069).** 22OB 6.6(2)(b) gives
`CGPA = Σ(Ci × Si) / Σ Ci` with Ci "the total number of credits in that
semester". The regulation's own worked example (Annexure-I (a)) instead divides
by the credits *earned* — excluding courses under F: for its student
`279 / 39 = 7.15`, where the clause as written gives `279 / 46 = 6.07`. The two
agree exactly when every counted semester has earned = registered (no F, no
absent), and disagree otherwise.

So GradTools reconstructs the CGPA **only when no entered semester has credits
not earned**, through the engine's `calculateCGPA`. Where any semester shows an
F, it shows nothing and says the regulation is not consistent about how to
count it. It never picks the easier formula. Grade cards print SGPAs to two
decimals, so the result is labelled a reconstruction (it can differ in the
second decimal) and is kept apart from the CGPA computed from saved course
results, which it never overwrites.

Lateral (diploma) entry starts in semester 3 (22OB 2.2, 3.3(2)); a CGPA runs
from the second semester onward (22OB 2.16).

Tests: `grade-card-cgpa.test.tsx`, including the Annexure example as the case
that must be refused.

## 4. Re-exam (backlog / make-up) attempts

`domain/course-attempts.ts`; recorded from the backlog panel (Semesters →
Backlogs → the re-exam button on a row). Stored under `courseAttempts`
(device-local, in the backup, not synced).

- **Every appearance is kept** (22OB 6.3(9)). A recorded sitting never edits the
  original result row or an earlier attempt. Re-entering the same session
  corrects that row rather than adding a second (deduped by semester + code +
  session).
- **The kind is the student's statement:** a regular SEE, a make-up /
  supplementary exam (22OB 4.4; make-up and supplementary are the same thing per
  notification 2209, scope revised by 2625 of 21-08-2026), or a summer-semester
  SEE. GradTools does not infer it.
- **The outcome is read, not re-graded.** A sitting that printed P cleared the
  course; one that printed F is another attempt; anything else is unknown and
  never becomes a pass.
- **It does not recompute SGPA or CGPA.** The same OQ-069 conflict applies, and
  22OB 6.9(4) (a cleared course "shown in the respective semester") and the
  Annexure (the re-pass booked into the semester it was sat in) point different
  ways. A recorded pass marks the backlog cleared; it does not touch a saved
  figure. The panel says so.

Tests: `course-attempts.test.ts`, `semesters.test.ts`.

## Persistence

`gradeCards` and `courseAttempts` are new device-local collections. They are in
the local backup (format **version 2**; a version-1 file still restores and
simply carries neither — `backup.ts`, `backup-records.ts`, docs/51). They are
**not** in `SYNC_COLLECTIONS`, so nothing about them reaches the cloud — the
same local-only status the attendance ledger and timetable overrides have. No
database migration and no API change were made.

## Open regulatory question

**OQ-069 — the CGPA denominator and where a re-pass is booked.** The clause and
the regulation's own worked example disagree for any student with an F. Until an
authoritative clarification resolves it, GradTools reconstructs a CGPA only
where the two agree (no unearned credits) and never auto-recalculates a saved
figure after a re-pass. See docs/32.
