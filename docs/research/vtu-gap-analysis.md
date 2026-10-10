# GradTools ↔ VTU ecosystem gap analysis

> **SESSION 2 UPDATE (2026-09-20).** The seven-site crawl below was structural discovery.
> A second pass went to **Tier 1 — the official VTU regulation itself** — and closed four of
> the open questions. Read `vtu-conflicts.md` and `vtu-missing-data.md` first; they supersede
> several statements in this file.
>
> | Was | Now |
> |---|---|
> | C1 F-in-SGPA — "CONFLICT, verify against 22OB 6.6" | **CLOSED. GradTools correct.** 22OB 6.6 defines SGPA over *"all the courses undergone"*; an F scores 0 and is included |
> | Attendance 85 / 10 / 75 — GradTools values unverified | **VERIFIED verbatim** at 22OB 3.7 and §2.22 (`DX: Attendance below 75%`) |
> | Percentage `CGPA × 10` — corroborated only | **VERIFIED** at 22OB 6.7 with the regulation's own 8.20 → 82.0 example |
> | `(CGPA − 0.75) × 10` scope | **VERIFIED** by vtu.ac.in as *"2015, 2017 and 2018 scheme only"* |
> | 2025 scheme — "discovered via aggregator slugs" | **Official PDF obtained** (`vtu.ac.in/pdf/UG2024/phycyc.pdf`), 61 codes, L:T:P:S and CIE/SEE columns |
> | L:T:P:S — "MISSING, sources unverified" | **RULE VERIFIED** — 22OB Table 1 credit-value mapping extracted |
>
> Newly open: the **2021** percentage formula is covered by *neither* official source obtained
> (C5), and `NE`/`X`/`M` statuses appear **nowhere** in the 65-page regulation (C9).


**Date:** 2026-09-20 · **Companions:** `vtu-source-audit.md` (per-source), `vtu-resource-inventory.json` (1,508 URLs, machine-readable)

> **Nothing in this document is authoritative academic data.** Every external value is a
> third-party claim recorded with its source. Conflicts are preserved, never resolved.
> Ingestion requires verification against `vtu.ac.in`.

## GradTools baseline, measured not assumed

| Fact | Value | Where |
|---|---|---|
| Catalogue courses | 187 rows / **160 distinct codes** | `packages/vtu-catalogue/data/vtu-2022.json` |
| Schemes | **`vtu-2022` only** | same + `packages/academic-rules/src/rulesets/` |
| Rule sets | **`vtu-2022-v1` only** | `rulesets/registry.ts` |
| Source documents | 19 (3 scheme PDFs + 16 syllabus PDFs) | catalogue `documents[]` |
| Provenance | `vtu.ac.in` PDFs with **sha256 + page number + retrievedAt** | catalogue `provenance` |
| Seeded branches | **CSE only** | `services/api/src/db/seed.ts:119-120` — *"Only CSE is seeded… Other branches exist but their documents have not been read."* |
| Programme scope | UG B.E. only | no PG / B.Arch / B.Plan anywhere |
| Semester spread | 1:64 2:33 3:15 4:17 5:13 6:21 7:13 8:11 | catalogue |

GradTools' provenance discipline is **stronger than every source audited** — none of the
seven records a document hash or a page number. That is precisely why external data must not
overwrite it.

## Headline numbers

| Measure | Count |
|---|---|
| URLs enumerated | **1,508** |
| Distinct subject codes discovered | **357** (324 × 2022-style, 33 × 2025-style) |
| Codes corroborated with GradTools | **65** |
| 2022-scheme codes **missing** from GradTools | **259** |
| 2025-scheme codes (GradTools has no 2025 scheme) | **33** |
| Notes pages | 701 · Lab 85 · Scheme 66 · Calculator 57 · Textbook 44 |
| Freshness | 605 URLs modified in 2026, 855 in 2025 — actively maintained |

---

# Findings by category

### 1 · Missing academic data — MISSING

`L:T:P:S`, teaching hours, per-course CIE/SEE split, exam duration, module counts and module
titles are absent from GradTools' catalogue, whose course fields are only: code, title,
credits, semester, programme, creditBasis, relatedCode, provenance. Whether the external
sources carry these is **UNVERIFIED** — per-page bodies were not fetched in this pass.

### 2 · Missing schemes — MISSING

GradTools supports **2022 only**. Discovered: **2025** (vtuwise `25-scheme`,
vtusgpacalculator `/2025-scheme/`), **2021**, **2018**, **2015** (vturesource `15CS73`,
`16MBA15`). The 2025 scheme is live and being published for — a student starting now falls
outside GradTools' model entirely. *Importance: HIGH.*

### 3 · Missing branches — PARTIAL

The reference DB seeds **one** branch (CSE). The catalogue covers three stream documents
(Civil stream CV/EV/TR/CC, CSE stream CSE/ISC/BT, CSBS) plus first-year maths/physics/
chemistry for the EEE and Mechanical streams. Discovered externally: ECE, EEE, ISE,
Mechanical, Civil, AI/ML, AI&DS, CSBS. Missing code prefixes observed: `BAD*` (AI&DS),
`BAI*` (AI/ML), `BCO*`, and `BCS*` for semesters 3-8.

### 4 · Missing subjects — MISSING, 259 codes

Full list: `vtu-resource-inventory.json → subjectCodeGap.missingFromGradTools2022`.
Concentrated in semesters 3-8 of branches whose scheme PDF has never been read — exactly
what `seed.ts:119` predicts.

**Codes only.** A code in a URL slug proves a page exists; it proves nothing about credits,
title or semester. *Ingestion: REQUIRES VERIFICATION.*

### 5 · Missing credits/rules — PARTIAL

Grade bands fully corroborated (§13). Percentage formula corroborated for 2022. Genuinely
missing: the `(CGPA − 0.75) × 10` variant that would be needed if 2015/2017/2018 support is
ever added.

### 6 · Missing syllabus — PARTIAL

GradTools holds 16 syllabus PDFs, **all first-year**. Semesters 3-8 syllabus is absent.
Sources carry scheme/syllabus pages (66 URLs classified `scheme`). *LINK-ONLY until rights
are reviewed — and the underlying `vtu.ac.in` PDFs, not the aggregators, are the correct
ingestion path.*

### 7 · Missing question papers — MISSING (out of current scope)

GradTools has **no question-paper concept at all**. vturesource is built around it
(`/vtu-question-papers/{BRANCH}/{YEAR}/{CODE}/{Name}`); vtuadda has `/pyq` and
`/model-papers`. *RESOURCE CONTENT → REQUIRES RIGHTS REVIEW. Plausibly LINK-ONLY as a
catalogue; not ingestable as content.*

### 8 · Missing notes — MISSING (out of current scope)

**701 notes pages** — the single largest category in the ecosystem. GradTools has no notes
model. *DO NOT INGEST. Third-party copyright, no visible licence anywhere.*

### 9 · Missing lab resources — MISSING

85 lab/manual URLs (vtusync 55, vtucircle 23, vtuwise 6). GradTools models a lab only as a
timetable slot kind and a course row; no manual, experiment list or viva material. *LINK-ONLY.*

### 10 · Missing project/report resources — MISSING

11 URLs (project and internship guides). GradTools has no project model.
*OPTIONAL FEATURE IDEA.*

### 11 · Missing VTU announcements — PARTIAL

GradTools already **has** an announcements/notifications subsystem with an applicability
engine. What it lacks is a discovered feed of circulars. These sources classify only 2 URLs
as announcements, so the aggregators are a weak source here — **`vtu.ac.in` itself is the
right source.**

### 12 · Missing timetables/calendars — PARTIAL

GradTools imports exam timetables and academic calendars from documents. vturesource has a
`/vtu-time-table/` index; only 2 URLs across the enumerated corpus classify as timetable.
Low marginal value from these sources.

### 13 · Missing calculators/formulas — PARTIAL; mostly corroboration

**Corroborated — no change needed:**

| Item | GradTools | External | Status |
|---|---|---|---|
| Grade bands O/A+/A/B+/B/C/P/F | 10/9/8/7/6/5/4/0 at 90/80/70/60/55/50/40/0 | vtusgpacalculator — **identical** | CORROBORATED |
| Percentage (2022) | `CGPA × 10`, clause 22OB 6.7 | vtusgpacalculator: `CGPA × 10` for 2021/2022/2025 | CORROBORATED |
| `(CGPA − 0.75) × 10` | explicitly rejected in `vtu-2022.ts` as absent from this regulation | attributed to **2015/2017/2018 only** | GradTools was right |
| Must-attend formula | `ceil((R × conducted − 100 × attended) / (100 − R))` | vtulife: `⌈(R×T − 100×A) ÷ (100−R)⌉` — **identical** | CORROBORATED |

**Missing utilities** (present externally, absent here): backlog calculator, required-SGPA
calculator, target-CGPA calculator, placement-eligibility checker, marks-to-grade converter,
percentage→SGPA reverse converter, placement-salary calculator. *POTENTIAL PRODUCT FEATURE —
note `packages/academic-rules/src/targets.ts` already exists, so required-SGPA and
target-CGPA may be partly built already.*

### 14 · Missing attendance knowledge — THE MOST IMPORTANT FINDING

The ecosystem **conflates three things GradTools keeps apart**:

| Category | Value | Source |
|---|---|---|
| VTU regulation requirement | **85%** (clause 22OB 3.7) | GradTools `vtu-2022.ts:134` |
| VTU DX floor (detained, cannot sit the exam) | **75%** | GradTools `attendanceDxFloorPct` |
| VTU condonable | **10%** | GradTools `attendanceCondonablePct` |
| "Minimum attendance" as published | **75%**, *"most colleges and universities require"* | vtulife.in/attendance-calculator |

vtulife presents 75% as *the requirement* and, asked directly, **does not distinguish VTU
regulation from college policy** — that distinction is NOT FOUND on the page. In VTU terms
75% is the *detention floor*, not the requirement.

**This independently validates the Worktree 1 design**: a student-supplied college minimum
must be a separate, clearly-sourced value, and the regulation DX floor must never be
overridden by it. Condonation, medical leave and cancelled-class handling are **NOT FOUND**
on any source read.

### 15 · Missing student utilities — see §13.

### 16 · Missing resource links — MISSING

GradTools stores no external resource links at all. 1,508 catalogued URLs exist here.
*LINK-ONLY candidate; requires a resource-link model that does not exist.*

### 17 · Existing GradTools data that appears outdated — NONE FOUND

No evidence that any current GradTools value is stale. The 2022 scheme remains live (sources
publish it alongside 2025). GradTools is **incomplete, not wrong.**

### 18 · Conflicting information requiring verification

```
CONFLICT 1
FIELD      Treatment of a failed (F) course in SGPA
GRADTOOLS  Included at 0 grade points; only countsTowardGpa === false is excluded
           (domain/results.ts sgpaInputs)
SOURCE A   vtusgpacalculator.com/vtu-grading-system/ — "An F grade carries 0 grade
           points and does not count toward your SGPA calculation"
AMBIGUITY  "does not count" may mean zero-weighted or wholly excluded. The two
           produce different SGPAs for the same student.
STATUS     CONFLICT — requires verification against 22OB 6.6
ACTION     DO NOT CHANGE GradTools. Verify against the regulation text.

CONFLICT 2
FIELD      Minimum attendance
GRADTOOLS  85% required / 75% DX floor / 10% condonable, clause 22OB 3.7
SOURCE A   vtulife.in — 75%, "most colleges and universities", no VTU attribution
STATUS     NOT A CONFLICT — the source conflates three distinct categories.
ACTION     Record as evidence for the Worktree 1 provenance split. No change.

CONFLICT 3
FIELD      Subject credits for the 259 missing codes
STATUS     UNVERIFIED — codes came from URL slugs; no credit value was fetched.
ACTION     REQUIRES VERIFICATION. Never ingest a credit from a slug.
```

---

# Ingestion classification

| Finding | Class | Ingestion |
|---|---|---|
| 2025 scheme existence | DOMAIN DATA | **REQUIRES VERIFICATION** — from `vtu.ac.in`, not aggregators |
| 259 missing 2022 codes | DOMAIN DATA | **REQUIRES VERIFICATION** — codes only, no credits |
| Remaining branch scheme PDFs | DOMAIN DATA | **SAFE TO NORMALIZE** via the existing `vtu.ac.in` importer |
| Grade bands, percentage formula | RULE / FORMULA | **NO ACTION** — already correct and corroborated |
| `(CGPA−0.75)×10` for ≤2018 | RULE / FORMULA | REQUIRES VERIFICATION (only if pre-2021 support is added) |
| F-in-SGPA treatment | RULE / FORMULA | **REQUIRES VERIFICATION** — conflict open |
| Notes, question papers, textbooks, lab manuals | RESOURCE CONTENT | **DO NOT INGEST** — third-party copyright, no licence |
| 1,508 resource URLs | EXTERNAL LINK | **LINK-ONLY** — needs a model that does not exist |
| Backlog / target-CGPA / marks-to-grade | OPTIONAL FEATURE IDEA | Not data. A product decision |
| PG, B.Arch, B.Plan, MCQ, placement salary | OUT OF CURRENT SCOPE | — |

# Recommended phases

1. **Close the branch gap at source.** Read the remaining `vtu.ac.in` scheme PDFs through the
   importer that already exists. Highest value, zero rights risk, strongest provenance, and
   it is what `seed.ts:119` already flags as pending. Resolves most of the 259.
2. **Resolve CONFLICT 1** against 22OB 6.6. A wrong answer changes every SGPA in the product.
3. **Decide the 2025 scheme.** A new-intake student is currently unmodelled.
4. **Only then** consider a link-only resource catalogue. It needs a new model, carries the
   rights questions, and delivers less than steps 1-3.

**Do not** bulk-import any external subject list. **Do not** replace catalogue rows carrying
sha256 + page provenance with slug-derived data.
