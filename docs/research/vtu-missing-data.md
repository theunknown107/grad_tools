# GradTools missing-data registry

**Updated:** 2026-09-20 (session 2) · Companions: `vtu-gap-analysis.md`, `vtu-conflicts.md`,
`vtu-web-discovery.json`, `vtu-resource-inventory.json`

Status vocabulary: **VERIFIED** (Tier 1 evidence) · **CORROBORATED** (≥2 independent
non-official) · **UNVERIFIED** · **CONFLICTING** · **NOT FOUND** · **INACCESSIBLE**.

---

## 1 · Missing schemes — **VERIFIED MISSING**

GradTools supports `vtu-2022` only (`packages/academic-rules/src/rulesets/`, one file).

| Scheme | Evidence | Status |
|---|---|---|
| **2025** | Official PDF `vtu.ac.in/pdf/UG2024/phycyc.pdf` — *"Scheme of Teaching and Examinations (2025) … Effective from the academic year 2025-26"* | **VERIFIED EXISTS, MISSING** |
| 2021 | Draft regulation PDF on vtu.ac.in; aggregator calculators | UNVERIFIED (see C5) |
| 2018 / 2017 / 2015 | vtu.ac.in CGPA formula page names them explicitly | **VERIFIED EXIST, MISSING** |

**Why it matters:** a 2025-intake student is entirely unmodelled today. Historical schemes
matter for interpreting older grade cards a student may import.
**Action:** 2025 first — it is current and the official PDF is already downloaded.

## 2-4 · Missing branches / programmes / semesters — **VERIFIED MISSING**

Reference DB seeds **one** branch. `services/api/src/db/seed.ts:119` states it: *"Only CSE is
seeded: csesch.pdf is the only branch scheme retrieved and verified. Other branches exist but
their documents have not been read."*

Missing programmes (all VERIFIED to exist via vturesource): **M.Tech, MBA, MCA, B.Arch,
B.Plan, PhD**. GradTools models UG B.E. only. *These are arguably out of product scope — a
decision, not a defect.*

Semester spread today is front-loaded (1:64, 2:33, then 13-21 per semester) because only
first-year documents were read in depth.

## 5 · Missing subjects — **259 codes, UNVERIFIED**

Full list in `vtu-resource-inventory.json → subjectCodeGap.missingFromGradTools2022`.
Codes came from URL slugs. **No credit, title or semester may be taken from a slug** (C7).
**Action:** ingest from `vtu.ac.in/b-e-scheme-syllabus/` through the importer that already
exists (`packages/vtu-catalogue/src/scheme-import.ts`).

## 6 · Missing subject metadata — **VERIFIED MISSING**

GradTools course fields are: `code, title, credits, semester, programme, creditBasis,
relatedCode, provenance`. Absent: **L, T, P, S**, exam duration, CIE/SEE per course, category,
elective classification, module count and titles, prerequisites.

The official 2025 PDF proves all of these are published in the scheme tables — columns
observed: *Course and Course Code · Course Title · TD/PSB · Teaching Hours/Week (L T P S) ·
Examination Duration · CIE Marks · SEE Marks · Total Marks · Credits*.

## 7-8 · Missing credits / L:T:P:S — **RULE NOW VERIFIED, DATA STILL MISSING**

**NEW THIS SESSION — 22OB Table 1 "Credit Values", quoted from the regulation:**

| L | T | P | Credits (L:T:P) | Total |
|---|---|---|---|---|
| 4 | 0 | 0 | 4:0:0 | 4 |
| 3 | 0 | 2 | 3:0:1 | 4 |
| 2 | 2 | 2 | 2:1:1 | 4 |
| 3 | 0 | 0 | 3:0:0 | 3 |
| 2 | 2 | 0 | 2:1:0 | 3 |
| 2 | 0 | 2 | 2:0:1 | 3 |
| 0 | 0 | 6 | 0:0:3 | 3 |
| 2 | 0 | 0 | 2:0:0 | 2 |
| 1 | 0 | 0 | 1:0:0 | 1 |
| 0 | 0 | 2 | 0:0:1 | 1 |

Reading: **2 practical hours = 1 credit; 2 tutorial hours = 1 credit; 1 lecture hour = 1
credit.** **Status: VERIFIED (Tier 1).** GradTools models none of it — it stores a credit
integer with no structure behind it.

**Also VERIFIED — course-type credit ranges (22OB 3.2.2):** SD 1-3 · AE 1-2 · NM (pass only,
no credit) · **Project Work 10 · Mini Project 3 · Internship 6**. Categories: HS, BS, ES, SD,
AE, NM, PW, MP, IS.

## 9 · Missing marks structures — **VERIFIED, GradTools already correct**

22OB 6.3: CIE max **50**, min **40%** to sit the SEE (and 40% in lab CIE separately where a
lab is attached); SEE max weightage **50**, min **35%** to pass; overall pass **40%** of
course maximum; minimum passing grade **P**. CIE and SEE carry **50% weightage each, total
100, irrespective of credits**. GradTools matches. See C8 for the `seeMax` note.

## 10 · Missing grade rules — **VERIFIED, GradTools already correct**

Bands verified verbatim: O/A+/A/B+/B/C/P/F = 10/9/8/7/6/5/4/0 at
90-100/80-89/70-79/60-69/55-59/50-54/40-49/0-39. Extra grades DX, AU, AB, PP, NP, IC, W all
present in GradTools. *"Passing Standards: passing a course only when GP is greater than or
equal to 04."*

**Newly verified detail GradTools may not model:** `IC` is *"a place holder; gets converted to
an appropriate grade after clearing SEE examination else converted to F"*, and `W` is *"not a
grade but only a place holder"*. Both are transitional states, not terminal ones.

## 11-13 · Missing SGPA / CGPA / percentage rules — **VERIFIED, GradTools already correct**

`SGPA = ∑(Ci×Gi)/∑Ci` · `CGPA = ∑(Ci×Si)/∑Ci` · *"rounded off to 2 decimal points"* ·
`M = CGPA × 10` (22OB 6.7) · class equivalence FCD ≥70, FC 60-70, SC 50-60, Pass 40-50.

**Only real gap:** the 2021 formula (C5) and the pre-2021 `−0.75` variant (C4), both needed
only if those schemes are supported.

## 14 · Missing attendance knowledge — **VERIFIED, and it settles Worktree 1**

85% required · up to 10% condonable by the Vice Chancellor on documented grounds (medical,
NSS/NCC, national sport/cultural, etc.) · DX below 75% · DX bars the SEE for that course and
the course must be repeated · attendance reckoned per the academic calendar · the Principal
must notify shortage monthly · **audit courses require 75%** (22OB 3.2.4) · **non-credit
mandatory courses require 75% + 40% CIE**.

**NOT FOUND anywhere:** treatment of cancelled or substituted classes. GradTools' ledger
handles cancellation by construction (non-`scheduled` contributes 0/0); **no VTU rule was
found that contradicts or constrains that**, which is the honest finding.

## 15 · Missing exam regulations — PARTIAL
CIE/SEE structure verified above. Question-paper patterns live in Annexure VI, **not
extracted** this pass.

## 16 · Missing revaluation / supplementary / improvement — **NOT FOUND (C10)**
Absent from the entire 65-page regulation. Governed by separate examination circulars.
**Do not model from aggregator guides.**

## 17-19 · Academic calendars / exam timetables / announcements — PARTIAL
GradTools already imports calendars and exam timetables from documents and has an
announcements subsystem. The aggregators proved a weak source (2 timetable URLs, 2
announcement URLs in 1,508). **`vtu.ac.in` circulars are the right source.**

## 20 · Missing result-format knowledge — **UNVERIFIED**
22OB 6.9 specifies the grade card contents (course code, title, credits, letter grade). Real
grade-card layouts, and the `NE`/`X`/`M` statuses (C9), remain unverified. GradTools' parser
was built from real cards, so this is a corroboration gap, not a known defect.

## 21-24 · Question papers / notes / labs / projects — **MISSING, out of scope as content**
701 notes · 85 lab · 13 question-paper URLs catalogued. **No source carries a reusable
licence.** vtuadda publishes a takedown form. **DO NOT INGEST as content; LINK-ONLY at most.**

## 25-26 · Missing calculators / utilities — **POTENTIAL FEATURES, not data gaps**
Absent from GradTools: backlog calculator, target-CGPA, required-SGPA, marks-to-grade,
percentage→SGPA reverse, placement eligibility. Note `packages/academic-rules/src/targets.ts`
already exists, so some may be partly built.

## 27 · Missing document-parsing patterns — UNVERIFIED
Older-scheme grade cards (2015/2018, codes like `15CS73`) use a different code shape than
`BCS301`. If GradTools should read historical cards, the parser needs that pattern.
**Status: gap identified, not yet tested against a real old card.**

## 28 · Outdated GradTools data — **NONE FOUND**
No current GradTools value was contradicted by Tier 1. Everything checked either matched or
was confirmed correct against an aggregator that was wrong. **GradTools is incomplete, not
wrong.**

## 29 · Conflicting GradTools data — **NONE**
All four conflicts carried into this session closed **in GradTools' favour** (C1-C4). Open
items (C5-C10) are gaps in *external* evidence, not defects in GradTools.

## 30 · Unverified GradTools assumptions — **ONE, now resolved**
The `vtu-2022.ts` comment asserting that `(CGPA − 0.75) × 10` *"does not appear in this
regulation"* was an assumption. It is now **VERIFIED**: the regulation states `M = CGPA × 10`,
and VTU's own page scopes the 0.75 form to 2015/2017/2018.

---

# Ingestion priority

| # | Action | Evidence | Risk |
|---|---|---|---|
| 1 | Ingest remaining branch scheme PDFs from `vtu.ac.in/b-e-scheme-syllabus/` via the existing importer | Tier 1 | None — same path as existing data |
| 2 | Ingest the 2025 first-year scheme (PDF already downloaded) | Tier 1 | None |
| 3 | Model L:T:P:S + Table 1 credit mapping | Tier 1 VERIFIED | Low — additive |
| 4 | Model course categories and PW/MP/IS credit rules | Tier 1 VERIFIED | Low |
| 5 | Resolve the 2021 formula from the released B.E. 2021 regulation | **blocked** — draft only so far | Do not guess |
| 6 | Verify `NE`/`X`/`M` against a real grade card or circular | **blocked** | Do not guess |
| 7 | Resource-link catalogue | Tier 4-5, rights unclear | LINK-ONLY, needs a new model |

**Never:** ingest a credit from a URL slug; bulk-copy notes/papers; replace a
sha256+page-provenanced catalogue row with aggregator data.


---

# Session 3 — measured against official documents

The earlier figure of "259 missing codes" came from **URL slugs**. It has now been replaced
by a figure measured against **official VTU scheme PDFs**.

| Measure | Value |
|---|---|
| Official PDFs harvested | **29** (398 pages, 818,173 chars) |
| Extraction failures | **0** |
| Duplicate documents by sha256 | **0** |
| Course rows parsed | 569 → **556 unique** (544 OK, 12 SUSPECT) |
| Official 2022 courses parsed cleanly | **533** |
| …already in GradTools (corroborated) | **218** |
| …**MISSING from GradTools** | **315** |
| Official 2025 courses parsed cleanly | **11** (of 23 rows; the rest need a 2025-shape parser) |
| Credit conflicts | **5**, all on placeholder codes (C11) |

### Missing by programme — every one of these is a branch GradTools cannot serve today

Electronics & Communication 43 · Electrical & Electronics 34 · Mechanical 34 · Civil 33 ·
AI & ML 20 · Computer & Communication 20 · Data Science 20 · Computer Engineering 17 ·
Computer Science 16 · CS & Design 16 · CSE 15 · ISE 15 · AI & DS 15 · Mechanical Streams 9 ·
Electrical Streams 8.

### Fields now available that GradTools does not model

Every parsed row carries **L, T, P, (S), exam duration, CIE marks, SEE marks, total marks,
credits, category** and full provenance (`sourceUrl` + `documentSha256` + `sourcePage` +
`retrievedAt`). GradTools stores only code/title/credits/semester/programme.

`BCS301` is the worked example: `L3 T2 P0, duration 3h, CIE 50, SEE 50, total 100,
credits 4` — from `38csesch.pdf` page 1.

### Still missing after this pass

- **Elective classification, module titles, objectives, outcomes, prerequisites** — these are
  in the per-semester *syllabus* PDFs, not the *scheme* tables. Not extracted.
- **~370 of ~400 official PDFs** not harvested. This pass took the major branches.
- **Semester 5-8 attribution** (C12).
- **2021 scheme** — still unverified (C5).


---

# Course accounting — reconciled and exhaustive

Every extracted course falls in exactly **one** bucket. The buckets are disjoint and sum to
the total; verified by assertion, not by hand.

```
556 unique extracted courses
 = 218  corroborated present in GradTools (2022, parse OK)
 + 315  MISSING from GradTools            (2022, parse OK)
 +  11  2025 scheme                        (no GradTools counterpart to compare against)
 +  12  SUSPECT                            (excluded from comparison by design)
```

**`creditConflicts` is not a bucket.** The 5 conflict *rows* span **2 distinct codes** across
**4 course rows**, and every one is a **subset of the 218 present** — a conflict requires the
course to exist on both sides. The row count exceeds the code count because the GradTools
catalogue holds the same code under more than one stream document.

**Correcting the earlier arithmetic.** `315 + 218 + 5 = 538` treated conflicts as a separate
bucket *and* omitted the 2025 and SUSPECT records. The true remainder is **23 (11 + 12)**,
not 18.

**Correcting a second earlier statement.** All **12 SUSPECT rows are 2025**; the 2022
extraction produced **zero**. Earlier reporting implied the suspect rows were a general
parser artefact across both schemes.

## SUSPECT rows — diagnosed, not labelled

Every suspect row carries a machine-readable `suspect` object (`rule`, `observed`,
`diagnosis`, `explanation`, `fieldsUntrustworthy`, `fieldsTrustworthy`, `rootCause`,
`remedy`, `ingestion`).

| Diagnosis | Rows | What happened |
|---|---|---|
| `COLUMN_SHIFT_BY_ONE` | **10** | The 4-value (L T P S) matcher consumed the **exam-duration** column as `S`. Every later field holds its left neighbour's value, and `credits` holds the **next row's serial number**. Root cause: these 2025 rows have **no S column**. Code, title, L, T, P remain trustworthy. |
| `AMBIGUOUS_NUMERIC_RUN` | **2** | The captured title still contains digits, so the matcher latched onto a numeric run *inside the title*. **No field position can be trusted** beyond code/scheme/programme. |

**Remedy for both: re-parse.** No value is hand-corrected, and none is ingested.

## Invariants asserted (all pass)

every extracted course carries url + sha256 + page + retrievedAt · every source is
`vtu.ac.in` (no aggregator) · every missing-course claim cites source url + page · every
conflict carries both values and both sources · no stream-placeholder code sits in the
ingestion-candidate list · no course has a null credit (nothing slug-filled) · no SUSPECT row
appears in the missing list · the GradTools catalogue is untouched at 187 rows / 160 codes ·
every extracted document has sha256 + pageCount.
