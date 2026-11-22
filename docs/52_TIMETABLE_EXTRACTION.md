# Timetable extraction: measured baseline, fixes, and what is still open

Date: 2026-10-23. Documents and expected values are private (`.qa/`, git-ignored). This
file holds counts and public course codes only.

## Scope

GradTools' academic model is B.E./B.Tech, VTU 2022 scheme, eight semesters (OQ-055). The
in-scope timetable is a **VTU-affiliated college's class timetable**: a timed grid (a
clock-time header), a subject list below it, merged lab and project cells, and batch
rotations. Three real documents of that kind exist on this machine:

| id | what | kind |
|---|---|---|
| `sgbit-csbs-sem5-vb` | Sem 5 CSBS, V(B) division | native-text PDF |
| `sgbit-csbs-sem1-physics-r1` | Sem 1 CSBS, physics group, R1 | photograph (JPEG) |
| `sgbit-csbs-sem1-physics-r2` | the same timetable, revised (W.E.F. printed) | scan (PNG) |

**Undecided:** NIT-style SECTION × PERIOD grids (`parsePeriodGrid`). No product decision
puts non-VTU timetables in scope. The parser was written against a synthetic y-down
fixture, while both real extractors produce y-up coordinates, and on the real NIT-KKR PDFs
`SECTION 1…10` labels periods, not sections. It never fires on them, and nothing in the
review or storage reads its output. It has been left as it is: fixing it or removing it
waits on that scope decision.

## Expected values (ground truth)

`.qa/real/timetable-truth.json`. One entry per (day, start, subject or activity, batch).
**None is verified yet:**

- **Sem 5:** `candidate-index`, from a human-supplied index of the document, cross-checked
  cell by cell against the PDF's own text layer.
- **Sem 1 R1/R2:** `candidate-ai-read`, read from the source images by the AI assistant.
  They need a person to check them before they count as verified.
- **Code status:** each code is `stated` (printed against the cell's initials in the
  document's own subject list), `implied` (lab abbreviation, batch rotation, near-miss
  spelling) or `unresolved` (`TOC-T`: no source states its code; scored for presence
  only).

## How it is measured

`tests/timetable-truth-qa.mjs` runs each document through the shipped import page in
Chromium, chooses a lab batch where asked (`QA_BATCH=second` checks the other one),
confirms, and scores what was **stored** in IndexedDB.

## Results (stored entries, first batch; the second batch gives the same counts)

| document | before | after |
|---|---|---|
| Sem 5 PDF | 29/29 correct, 0 extra | 29/29, 0 extra |
| Sem 1 R1 photo | 0/25 correct, 2 noise entries stored | 15/25 correct; all 25 at the right day and time |
| Sem 1 R2 scan | 0/25 correct, 3 wrong entries stored | 25/25 correct, 0 extra |

The R1 numbers are scored against candidate AI-read expectations, so they are not an
accuracy figure. Three documents from one college support no general claim.

## Root causes found, and fixed

1. **The sparse OCR pass was gated on "empty", not "incomplete"** (`sparseIfGrid`,
   `lib/result-file.ts`). On both scans the default pass read one day of the grid and a
   couple of classes, enough to pass the gate. The sparse pass, which reads every day,
   was never tried. It now runs whenever the reading is not `looksComplete`.
2. **Text beside the grid became classes** (`timetable-import.ts`). `slotAt` clamps a
   position outside the grid to the nearest column, so the batch/roll-number table
   printed right of the grid filled the last hour of the day. Runs outside the grid's
   outer columns are no longer cells.
3. **A break label became a class and moved a lab.** With a break column's header
   unread, "LUNCH" joined the teaching cell beside it: it was read as the subject (with
   the real subject as its "room"), and as that cell's top line it pulled the next
   hour's lab into the wrong column. Break words are now kept out of cells unless a
   column holds nothing else.
4. **A merged cell centred across two hours started an hour late.** A cell now starts in
   the earlier column when its top line reaches at least a third of the way into it.

Each fix has a synthetic regression test that fails when the fix is reverted
(`timetable-ocr-retry.test.ts`, `timetable-ocr-layout.test.ts`).

## Still open

- **OCR misreads in the subject list are stored as identified codes.** R1 reads
  `BMATS101` as `BMATSI101`; five classes are stored with that code and are not flagged
  in review. The 2022 code grammar accepts both forms, and the catalogue is too
  incomplete to judge codes by near-match (valid codes sit one edit apart: BCS502,
  BCS503). The student must check them. A safe check needs an owner decision on
  validating timetable codes against the catalogue.
- On R1, the ETC row of the subject list and the IDT initials are unreadable: those
  classes are kept, unresolved, with a warning.
- No verified ground truth yet. The next step is a person checking the two
  `candidate-ai-read` files against the printed timetables.
- Android WebView and Safari were not tested. The 12 image-only public PDFs are non-VTU,
  and none were OCR-scored.
