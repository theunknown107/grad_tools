# VTU data conflict register

**Updated:** 2026-09-20 (session 2) · Companion to `vtu-gap-analysis.md`, `vtu-web-discovery.json`

Every unresolved factual conflict, and every conflict this session **closed with Tier 1
evidence**. Nothing here is silently reconciled: where a conflict is closed, the official
clause that closed it is quoted.

Tier 1 = official VTU document. Tier 4-5 = VTU resource sites / aggregators. Tier 6 = blogs.

---

## CLOSED — resolved by the official 2022 regulation

Source for all four: `Regulations-Clr-BE-BTECH-2022-611-02052023.pdf` (65 pp), extracted
locally with the repository's own pdfjs extractor.

### C1 · Failed course in the SGPA denominator — **CLOSED, GradTools was correct**

| | |
|---|---|
| GradTools | Included at 0 grade points; only `countsTowardGpa === false` is excluded (`domain/results.ts` `sgpaInputs`) |
| Tier 5 claim | vtusgpacalculator.com: *"An F grade carries 0 grade points and does not count toward your SGPA calculation"* |
| **Tier 1** | 22OB 6.6: *"SGPA is the ratio of sum of the product of the number of credits with the grade points secured by a student in **all the courses taken by him** and the sum of the number of credits of **all the courses undergone** by a student, i.e., SGPA = ∑ (Ci x Gi) / ∑ Ci"* |
| **Verdict** | The denominator is **all courses undergone**. An F scores Gi = 0 and is **included**. **GradTools is correct; the aggregator is wrong.** No change. |

### C2 · Minimum attendance — **CLOSED, GradTools was correct**

| | |
|---|---|
| GradTools | 85% required / 10% condonable / 75% DX floor |
| Tier 5 claim | vtulife.in: *"Most colleges and universities require a minimum attendance of 75%"* — no VTU attribution, regulation vs college policy NOT distinguished |
| **Tier 1** | 22OB 3.7(1): *"a student shall obtain a **minimum attendance of 85%** in each of the courses registered. However, if the attendance is below 85%, the shortage **upto a maximum of 10%** may be condoned by the Vice Chancellor…"* · §2.22: *"**DX: Attendance below 75%**"* |
| **Verdict** | All three GradTools values **VERIFIED**. 75% is the *detention floor after condonation*, not the requirement. The ecosystem conflates them. **Confirms the Worktree 1 design**: a college minimum must be separately sourced and must never override the regulation DX floor. |

### C3 · CGPA → percentage for the 2022 scheme — **CLOSED, GradTools was correct**

| | |
|---|---|
| GradTools | `M = CGPA × 10`, clause 22OB 6.7; explicitly rejects `(CGPA − 0.75) × 10` |
| **Tier 1** | 22OB 6.7: *"Percentage of marks secured, M = CGPA Earned x 10. E.g.: Illustration for a CGPA of 8.20; M = 8.20 × 10 = 82.0 %"* |
| **Verdict** | **VERIFIED.** The code comment that rejected the 0.75 variant was right. |

### C4 · Scope of the 0.75 subtraction — **CLOSED**

| | |
|---|---|
| **Tier 1** | vtu.ac.in/en/cgpa-standard-formula/: *"Standard formula to calculate percentage from CGPA for **2015, 2017 and 2018 scheme only**"* → `Percentage = (CGPA – 0.75) * 10` |
| **Verdict** | The 0.75 variant is **scoped to 2015/2017/2018**. Required only if GradTools ever supports those schemes. Not applicable to 2022. |

---

## OPEN — unresolved, requires official verification

### C5 · CGPA → percentage for the **2021** scheme — **UNVERIFIED, genuine conflict**

| Source | Tier | Claim |
|---|---|---|
| vtusgpacalculator.com | 5 | 2021 uses `CGPA × 10` (grouped with 2022/2025) |
| vtu.ac.in CGPA standard formula page | **1** | covers **2015/2017/2018 only** — says nothing about 2021 |
| 22OB regulation | **1** | covers **2022 only** — says nothing about 2021 |
| VTU **M.Plan** 2021 regulations | 1 | shows `[CGPA − 0.75] × 10` — **but M.Plan is a different, postgraduate programme** |

**STATUS: CONFLICT / UNVERIFIED.** Neither official source I obtained covers B.E. 2021.
The M.Plan illustration must **not** be generalised across programmes.

**ACTION:** fetch `vtu.ac.in/wp-content/uploads/2021/12/BE-BTech-Regulation-2021-draft.pdf`
(note: marked **DRAFT**) and locate the released 2021 B.E. regulation.
**DO NOT** implement a 2021 percentage rule on aggregator evidence.

### C6 · 2022 subject-code convention — **CONFLICT, low confidence source**

| Source | Tier | Claim |
|---|---|---|
| Official VTU scheme PDFs (already in GradTools) | **1** | `BCS301`, `BCS401`, `BMATS101` |
| vtu-easy.com | 5 | 2022 CSE codes are *"22CS31–22CS8X"* |

**STATUS: CONFLICT.** Either a different local convention or an error. GradTools' codes carry
sha256 + page provenance from official PDFs. **Tier 1 stands. DO NOT INGEST vtu-easy codes.**

### C7 · Credits for the 259 externally-seen codes — **UNVERIFIED**

Codes were extracted from **URL slugs only**. A slug proves a page exists; it proves nothing
about credits, title or semester. **No credit value may be ingested from a slug.**
**ACTION:** resolve from the official per-branch scheme PDFs at `vtu.ac.in/b-e-scheme-syllabus/`.

### C8 · `seeMax` representation — **AMBIGUITY, not yet a defect**

GradTools sets `seeMax: 100` ("the SEE is written for 100 marks") while 22OB 6.3(2) says
*"The maximum weightage of SEE marks shall be 50"*. GradTools computes the displayed SEE
maximum as `courseMax − cieMax` = 50, which agrees with the regulation, and `seeMinPct: 35`
is a percentage so it is scale-invariant. **No arithmetic defect identified.** Recorded so a
future reader does not mistake the 100 for a contradiction.

### C9 · Result statuses `NE`, `X`, `M` — **NOT FOUND in the 2022 regulation**

The regulation defines only: `O A+ A B+ B C P F` plus `DX AU AB PP NP IC W`. `NE`, `X` and `M`
appear in no clause of 22OB. **STATUS: NOT FOUND — unverified.** They may be
result-portal/grade-card artefacts rather than regulation grades.
**ACTION:** verify against a real grade card or a VTU examination circular before modelling.

### C10 · Revaluation / challenge valuation / photocopy / improvement / withheld — **NOT FOUND**

None of these terms appears anywhere in the 65-page 2022 regulation. They are governed by
separate VTU examination circulars.
**STATUS: NOT FOUND in the regulation — not evidence of absence from VTU policy.**
**ACTION:** search VTU examination circulars specifically. Do **not** model these from
aggregator guides (vtuadda has a revaluation guide; Tier 5, unverified).


---

# Session 3 — conflicts from the official extraction

29 official VTU scheme PDFs were harvested and parsed (398 pages, 0 failures, 0 duplicate
hashes). Full data: `vtu-official-gap.json`, `vtu-official-courses.json`,
`vtu-official-documents.json`.

## C11 · Credits on stream-placeholder codes — **5 conflicts, DO NOT RESOLVE**

| Code | GradTools | Official row | Source |
|---|---|---|---|
| `BPLCK105x` | 3 | 1 | 2022 scheme tables (×4 occurrences) |
| `BETCK205x` | 3 | 1 | 2022 scheme tables |

**Why this is not a GradTools defect.** These are **placeholder codes** — the PDF prints
`x` where the stream letter goes (`BPLCK105A/B/C/D`). A placeholder row is a table header
for a family of courses, not a course a student enrols in. The GradTools value of 3 credits
is for the *concrete* courses; the official row the parser matched is the placeholder line.

**STATUS: CONFLICT ON A NON-CANONICAL KEY.** Neither value is wrong for its own subject.
**ACTION:** resolve placeholder codes to their concrete variants before any comparison is
treated as meaningful. **Do not change GradTools on this evidence.**

## C12 · Semester attribution for semesters 5-8 — **PARSER LIMITATION, NOT A DATA CONFLICT**

The parse assigned **0 rows to semester 7 and 105 to semester 8**. That is implausible for
documents covering semesters 5-8 and indicates the semester heading is not being picked up
correctly in those tables.

**STATUS: EXTRACTION DEFECT, recorded not hidden.** Semester is **unreliable for the 5-8
range** and must be re-derived before ingestion. Semesters 3 (29) and 4 (46) look sound.

## C13 · 12 rows with CIE + SEE ≠ Total — **EXCLUDED, not repaired**

Where the 4-value (L T P S) matcher hit a 3-value row it shifted every column, producing
e.g. `CIE 50, SEE 100, Total 3`. These rows are marked `parseConfidence: "SUSPECT"` and are
**excluded from the comparison**. No attempt was made to guess which column slipped.
