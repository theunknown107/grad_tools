# CSBS 2022 — Candidate Table Reconciliation

Authority: Phase 7C.2 §2–§11, §59 · Reconciled at `b603029`

## What this is

A candidate CSBS 2022 course table was supplied as a QA checklist. It is **not**
authoritative. This document reconciles all 47 candidate rows against the
official VTU documents, and records the evidence for every correction.

Nothing here was decided by inspection or similarity. Every "official" value in
the tables below was produced by `parseScheme` reading the official PDF, and can
be reproduced by re-running the parser against the same file.

## Sources

| Key | Document | URL | Retrieved |
| --- | --- | --- | --- |
| `SCH38` | CSBS 2022 Scheme of Teaching and Examinations, semesters 3–8 | `https://vtu.ac.in/pdf/2022_3to8/38csbssch.pdf` | 2026-09-07 |
| `SYL34` | CSBS 2022 syllabus, semesters 3–4 | `https://vtu.ac.in/pdf/2022_3to8/2csbssyll.pdf` | 2026-09-07 |
| `CSESCH` | CSE-stream first-year scheme (2022) | `https://vtu.ac.in/pdf/2022syll/csesch.pdf` | 2026-09-08 |
| `STREAM` | Stream-wise list of UG programmes | `https://vtu.ac.in/pdf/UG2024/stream.pdf` | 2026-09-08 |

Discovery root: `https://vtu.ac.in/b-e-scheme-syllabus/`.

### Which first-year document applies to CSBS

`STREAM` lists **"Computer Science & Business System"**, programme code **CB**, as
item 7 under the **Computer Science & Engineering Stream**. That is why `CSESCH`
is the first-year authority for CSBS. It was read off the official list, not
assumed from the programme's name.

The `phycyc.pdf` and `chemcyc.pdf` documents linked from the same page are the
**2025** scheme ("Scheme of Teaching and Examinations (2025)", effective 2025-26)
and must not be used for a 2022-scheme student.

## Status counts

| Status | Count |
| --- | ---: |
| MATCH | 30 |
| CORRECTED | 16 |
| AMBIGUOUS | 1 |
| WRONG | 0 |
| OUTDATED | 0 |
| UNRESOLVED | 0 |
| **Total candidate rows** | **47** |

Per semester: first year 11 MATCH · Sem 3 6 M / 2 C · Sem 4 5 M / 3 C ·
Sem 5 3 M / 3 C / 1 A · Sem 6 2 M / 4 C · Sem 7 2 M / 3 C · Sem 8 1 M / 1 C.

Separately, **1 ALIAS** was established (`BCSL358D` → `BCS358D`). It is not one
of the 47 candidate rows — the candidate table does not mention either code —
so it is counted apart rather than folded into the total.

**11 official courses the candidate table omits entirely**: `BPEK359`,
`BPEK459`, `BPEK559`, `BPEK658` (Physical Education, 0 credits, one per
semester 3–6), `BCB586` Mini Project, `BXX657x`, `BIKS609`, `BCS703`,
`BCB802x`, plus `BCBL504` as distinct from the mini project. These are not
candidate-row statuses; they are gaps in the candidate table.

`CORRECTED` means the candidate row named a real course but stated a value the
official document contradicts. `AMBIGUOUS` means the candidate row merges two
official courses, or names a code the official document does not carry, and the
correct reading needs a source this reconciliation did not have.

## Semester credit totals

Computed by summing the official table rows, cross-checked against the total the
document prints in its own footer where it prints one.

| Semester | Official rows | Computed | Printed footer | Agree |
| --- | ---: | ---: | ---: | --- |
| 1 | 13 | — (student takes 8) | not printed | — |
| 2 | 13 | — (student takes 8) | not printed | — |
| 3 | 9 | 21 | not printed | single-sourced |
| 4 | 9 | 19 | **19** | ✅ |
| 5 | 9 | 22 | **22** | ✅ |
| 6 | 9 | 18 | **18** | ✅ |
| 7 | 6 | 24 | not printed | single-sourced |
| 8 | 3 | 16 | not printed | single-sourced |

Semesters 4, 5 and 6 are confirmed twice: the parser's arithmetic and the PDF's
own printed total. Semesters 3, 7 and 8 are the parser's sum only — those pages
do not print a footer this reader could locate, so treat them as single-sourced.

First-year semesters list more courses than any one student takes, because the
table offers alternatives (see "OR groups" below); a total across all rows would
not describe anybody's semester.

---

## Semester 5 — the audit targets

Every value the prompt gave as "official" is confirmed by `SCH38`.

| Candidate | Candidate credits | Official code | Official title | Official credits | Status |
| --- | ---: | --- | --- | ---: | --- |
| BCB501 | 3 | BCB501 | Fundamentals of Management | 3 | MATCH |
| BCS502 / BCB502 | 4 | BCS502 | Computer Networks | 4 | MATCH (code `BCS502`) |
| BCS503 / BCB503 | **3** | BCS503 | **Theory of Computation** | **4** | **CORRECTED** |
| BCS515x / BCB515x | 3 | BXX515x | Professional Elective Course | 3 | **CORRECTED** (code) |
| BRMK557 | 3 | BRMK557 | Research Methodology and IPR | 3 | MATCH |
| **BESK508** | **1** | BCS508 | Environmental Studies and E-waste Management | **2** | **CORRECTED** |
| BCSL504 / BCBL504 "Mini Project / Practical Core Lab" | 2 | *two courses* | see below | — | **AMBIGUOUS** |

**The candidate row merges two distinct official courses.** `SCH38` carries both:

- `BCBL504` — Computational Statistics Lab — **1 credit**
- `BCB586` — Mini Project — **2 credits**

They are separate rows in the official table and must not be collapsed. The
candidate's "BCSL504 / Mini Project = 2" conflates the lab's code with the mini
project's credits.

Official Sem 5 also carries `BPEK559` (Physical Education, 0 credits), which the
candidate table omits. Total 22 ✅.

## Semester 6 — the code question

The prompt asked whether the official document uses `BXX…` or `BCB…`. **It uses
`BXX` and `BCSL`.** Credits and the 18 total match the candidate table; four
codes do not.

| Candidate | Official code | Title | Credits | Status |
| --- | --- | --- | ---: | --- |
| BCB601 "Cloud Computing / AI for Business" | BCB601 | **Artificial Intelligence for Business** | 4 | **CORRECTED** (title) |
| BCS602 / BCB602 | BCS602 | Machine Learning | 4 | MATCH |
| BCS613x / **BCB613x** | **BXX613x** | Professional Elective Course | 3 | **CORRECTED** |
| BCS654x / **BCB654x** | **BXX654x** | Open Elective Course | 3 | **CORRECTED** |
| **BCBL606** | **BCSL606** | Machine Learning lab | 1 | **CORRECTED** |
| BCB685 "Major Project Phase-I" | BCB685 | **Project Phase I** | 2 | MATCH (title differs) |
| *(absent)* | **BXX657x** | Ability Enhancement / Skill Development Course V | 1 | **candidate omits** |
| *(absent)* | **BIKS609** | Indian Knowledge System | 0 | **candidate omits** |
| *(absent)* | BPEK658 | Physical Education | 0 | **candidate omits** |

Total 18 ✅ (printed footer confirms).

## Semester 7

| Candidate | Candidate credits | Official code | Official credits | Status |
| --- | ---: | --- | ---: | --- |
| BCB701 | 4 | BCB701 | 4 | MATCH |
| BCS702 / BCB702 "Enterprise Systems / Core Elective" | **3** | BCS702 **Parallel Computing** | **4** | **CORRECTED** |
| *(absent)* | — | **BCS703 Cryptography & Network Security** | **4** | **candidate omits** |
| BCS713x / BCB713x | 3 | **BCB714x** Professional Elective Course | 3 | **CORRECTED** (code) |
| BCS755x / BCB755x | 3 | BCB755x Open Elective Course | 3 | MATCH |
| BCB786 | **10** | BCB786 Major Project Phase-II | **6** | **CORRECTED** |

Total 24 ✅.

**Where the candidate's "10" probably came from:** `BCB803`, the semester 8
internship, genuinely is 10 credits. The figure appears to have been transposed
onto `BCB786`.

## Semester 8

| Candidate | Official code | Title | Credits | Status |
| --- | --- | --- | ---: | --- |
| BCS801x / BCB801x | BCB801x | Professional Elective (Online Courses), NPTEL only | 3 | MATCH |
| *(absent)* | BCB802x | Open Elective (Online Courses), NPTEL only | 3 | **candidate omits** |
| **BCB802** "Internship & Seminar, 6–10" | **BCB803** | Internship (Industry/Research), 14–20 weeks | **10** | **CORRECTED** |

Total 16 ✅. The candidate's `BCB802` is the *open elective* code in the official
document; the internship is `BCB803`.

## Semester 3

| Candidate | Candidate credits | Official code | Official credits | Status |
| --- | ---: | --- | ---: | --- |
| BCS301 / BCB301 "Mathematics for CS / Statistics" | **3** | BCS301 Mathematics for Computer Science | **4** | **CORRECTED** |
| BCS302 / BCB302 | 4 | BCS302 Digital Design & Computer Organization | 4 | MATCH |
| BCS303 / BCB303 | 4 | BCS303 Operating Systems | 4 | MATCH |
| BCS304 / BCB304 | 3 | BCS304 Data Structures and Applications | 3 | MATCH |
| BCSL305 / BCBL305 | 1 | BCSL305 Data Structures Lab | 1 | MATCH |
| BCS306x | 3 | BCS306x ESC/ETC/PLC | 3 | MATCH |
| BSCK307 | 1 | BSCK307 Social Connect and Responsibility | 1 | MATCH |
| BCS358x / BCB358x | 1 | **BXX358x** Ability/Skill Enhancement Course III | 1 | **CORRECTED** (code) |
| *(absent)* | BPEK359 | Physical Education | 0 | **candidate omits** |

Total 21.

## Semester 4

| Candidate | Candidate credits | Official code | Official credits | Status |
| --- | ---: | --- | ---: | --- |
| BCS401 | 3 | BCS401 Analysis & Design of Algorithms | 3 | MATCH |
| BCB402 | 4 | BCB402 Financial Management | 4 | MATCH |
| BCS403 | 4 | BCS403 Database Management Systems | 4 | MATCH |
| BCSL404 | 1 | BCSL404 Analysis & Design of Algorithms Lab | 1 | MATCH |
| BCS405x | 3 | **BCB405x** ESC/ETC/PLC | 3 | **CORRECTED** (code) |
| BCS456x / BCB456x | 1 | **BXX456x** Skill Enhancement Course IV | 1 | **CORRECTED** (code) |
| BBOC407 | **3** | BBOC407 Biology For Computer Engineers | **2** | **CORRECTED** |
| BUHK408 | 1 | BUHK408 Universal human values course | 1 | MATCH |
| *(absent)* | BPEK459 | Physical Education | 0 | **candidate omits** |

Total 19 ✅ (printed footer confirms).

## First year

Source `CSESCH`. The candidate table's first-year rows are **all MATCH on
credits**; the corrections are structural rather than numeric.

| Candidate | Official | Credits | Status |
| --- | --- | ---: | --- |
| BMATS101 / 201 | BMATS101, BMATS201 | 4 | MATCH |
| BPHYS102 / BCHES102 | BPHYS102, BCHES102, BPHYS202, BCHES202 | 4 | MATCH |
| BPOPS103 / 203 | BPOPS103, BPOPS203 | 3 | MATCH |
| BESCK104x / 204x | BESCK104x, BESCK204x | 3 | MATCH (slot) |
| BETCK105x / BPLCK105x | BETCK105x, BPLCK105x (an OR pair) | 3 | MATCH (slot) |
| BENGK106 | BENGK106, paired with BPWSK106 | 1 | MATCH (OR group) |
| BICOK107 / 207 | BICOK107, paired with BKBKK107 | 1 | MATCH (OR group) |
| BKSKK107 / BKBKK107 | BKBKK107 | 1 | MATCH |
| BIDTK158 / 258 | BIDTK158, paired with BSFHK158 | 1 | MATCH (OR group) |
| BSFHK158 / 258 | BSFHK158, BSFHK258 | 1 | MATCH |
| BPWSK206 | BPWSK206, paired with BENGK206 | 1 | MATCH (OR group) |

### The physics/chemistry cycle

`CSESCH` contains **four** tables, not two: semester 1 and 2 for the *physics
group*, and semester 1 and 2 for the *chemistry group*. A student does one cycle
first and the other second, so the same course carries a `1xx` code in one
ordering and a `2xx` code in the other. This reconciliation's validation student
is physics-group (their semester 1 carries `BPHYS102`).

### OR groups

Several first-year slots are a choice between two named courses, printed with
one shared set of columns on the row carrying the word "OR". Represented as
`viaAlternativeTo`, both options carrying the shared row's credits:

| Option A | Option B | Shared credits |
| --- | --- | ---: |
| BENGK106 Communicative English | BPWSK106 Professional Writing Skills | 1 |
| BICOK107 Indian Constitution | BKBKK107 Samskrutika/Balake Kannada | 1 |
| BIDTK158 Innovation and Design Thinking | BSFHK158 Scientific Foundations of Health | 1 |
| BETCK105x Emerging Technology | BPLCK105x Programming Languages | 3 |

…and the same four pairs again in the semester-2 ordering (`…206`, `…207`,
`…258`, `…205x`).

## Alias

| Source code | Canonical code | Title | Evidence | Status |
| --- | --- | --- | --- | --- |
| BCSL358D (in `SCH38` option list) | **BCS358D** | Data Visualization with Python | `SYL34` gives this course the code **BCS358D**, Semester III, **Credits 01**, and does not contain `BCSL358D` anywhere. The result card VTU issued says `BCS358D`. | **ALIAS** |

Precedence applied: the course's own syllabus page outranks a secondary mention
in a scheme's option list. Recorded as data in
`apps/web/src/domain/course-aliases.ts` with the citation attached. No edit
distance, no title similarity — `BCS358C`, one letter away, resolves to nothing.

## Open questions

These are not candidate-row statuses — every candidate row resolved to MATCH,
CORRECTED or AMBIGUOUS. These are things this reconciliation could not settle
and that remain open.

| Item | Why |
| --- | --- |
| `BCB301` / `BCB302` / `BCB303` / `BCB304` alternatives | The candidate table offers `BCS…`/`BCB…` pairs for semester 3. `SCH38` carries only the `BCS…` forms. Whether the `BCB…` codes exist for another programme was not established. |
| `BCS515x` vs `BXX515x` | Candidate says `BCS515x`/`BCB515x`; `SCH38` prints `BXX515x`. Recorded as CORRECTED, but whether `BCS515x` is a valid parallel code in another CSE-family programme was not checked. |
| Semester 3 / 7 / 8 printed totals | Those pages do not print a footer this parser could locate, so their totals are single-sourced. |
| Course **category** for every row | `SCH38`'s category column (PCC / IPCC / PCCL / PEC / OEC / AEC / MC / UHV) is read as part of the row but is not yet stored on the course record. §7 of the phase brief asks for category to be preserved distinctly from course kind; that field does not exist in the catalogue yet. |

## Validation against a real student record

The student's actual semesters 1–4, imported through the product's own UI:

| Semester | Courses | Credits | SGPA | Official semester total |
| --- | ---: | ---: | ---: | ---: |
| 1 | 8 | 20 | 6.65 | — (alternatives) |
| 2 | 8 | 20 | 7.30 | — (alternatives) |
| 3 | 9 | **21** | 7.05 | **21** ✅ |
| 4 | 9 | **19** | 7.47 | **19** ✅ |

**Semesters 3 and 4 reproduce the official printed semester totals exactly** from
the student's own course selections — an independent check that the catalogue and
the enrichment agree with the source document.

CGPA = Σ(Ci × Si) / ΣCi = (20×6.65 + 20×7.30 + 21×7.05 + 19×7.47) / 80
= 568.98 / 80 = **7.11** across **80 credits**.

The unweighted mean of the four SGPAs is 7.12, which is *not* what the product
displays — confirming the figure is credit-weighted as 22OB 6.6(2b) requires.

34 courses, 34 passed, 0 backlogs, 34 of 34 credits resolved, 0 needing review.
