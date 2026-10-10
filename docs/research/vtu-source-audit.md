# VTU ecosystem source audit

**Performed:** 2026-09-20 · **Method:** `robots.txt` → sitemap enumeration → targeted page
fetches. **Machine-readable companion:** `vtu-resource-inventory.json` (1,508 URLs with
per-URL host, resource type, scheme hint, extracted subject codes and `lastmod`).

## What this pass did and did not do

**Did:** fetched and read `robots.txt` for all seven sources; enumerated every sitemap and
child sitemap; consolidated 1,508 unique URLs; classified each by resource type; extracted
357 distinct subject codes from URL slugs; fetched and read six content pages covering the
percentage formula, the grading table, and the attendance model.

**Did not:** fetch the body of all 1,508 pages. Per-page facts (credits, L:T:P:S, CIE/SEE
splits, module titles, file sizes, licence statements) are therefore **NOT FOUND** in this
pass rather than absent from the sources. No PDF was downloaded. No `/api/` endpoint was
probed on `vtuadda.com` or `vtuwise.in` — both `Disallow` it, and the brief forbids evading
robots restrictions.

**Rate limiting:** one request per second, single-threaded, custom UA
(`GradToolsResearch/1.0`). `vtulife.in` declares `Crawl-delay: 1`, which was honoured.

---

## 1. www.vtulife.in — ENUMERATED

`robots.txt` allows all, declares `Crawl-delay: 1`, one sitemap. **10 URLs — the entire
site.** A small tool site, not a resource library.

| Path | Type |
|---|---|
| `/vtu-results` | results |
| `/vtu-sgpa-cgpa-calculator`, `/sgpa-calculator` | calculator |
| `/attendance-calculator` | calculator |
| `/placement-salary-calculator` | calculator — **no GradTools equivalent** |
| `/about` `/contact` `/privacy` `/disclaimer` | site meta |

**Attendance page, read in full.** States *"Most colleges and universities require a minimum
attendance of **75%** to be eligible to sit for examinations."* It does **NOT** distinguish
VTU regulation from college policy — asked directly, the distinction is NOT FOUND. Formula:
`Attendance % = (Attended ÷ Total) × 100`. Recovery formula
`x = ⌈(R×T − 100×A) ÷ (100 − R)⌉`. Can-miss formula NOT FOUND (output described, formula not
shown). Condonation NOT FOUND; cancelled-class handling NOT FOUND; "detention" mentioned as
a consequence only.

## 2. vtucircle.com — ENUMERATED

WordPress. `robots.txt` disallows `/wp-admin/`, `/search/`, `/tag/`, `/archive/`, `/feed/`,
`/*?s=` — all respected, none crawled. Two child sitemaps: 162 posts + 119 pages = **280
URLs**. Classification: 215 `other`, 23 lab, 22 scheme, 7 site meta, 2 calculator.
The heavy `other` count reflects post slugs that carry no type keyword; per-page fetching
would be needed to classify them, which this pass did not do.

## 3. vtuadda.com — ENUMERATED (with two broken sitemaps)

`robots.txt` allows all except `/admin/` and **`/api/`**. The sitemap index declares four
children; **`sitemap-branches.xml` and `sitemap-subjects.xml` both return HTTP 404** while
being advertised — recorded as a source defect, not as absence of data. Working children
yield **19 URLs**.

Notable sections: `/pyq`, `/labs`, `/textbooks`, `/model-papers`, `/upload` (user
contribution), `/copyright` + `/report-copyright` (an explicit takedown process — evidence
the operator treats the corpus as rights-encumbered), and three long-form guides:
`/resources/vtu-revaluation-guide`, `/resources/how-to-calculate-sgpa-cgpa`,
`/resources/vtu-internships-guide`.

**`/api/` is `Disallow`ed and was not probed.** Whatever structured data backs the branch and
subject browsing is therefore UNVERIFIED.

## 4. vtusync.in — ENUMERATED (largest corpus)

WordPress. Eight child sitemaps → **810 URLs**, the largest of the seven. Composition:
**416 notes**, 55 lab, 42 textbook, 23 scheme, 10 question paper, 250 other.
Two `attachment-sitemap` files indicate uploaded media (likely PDFs) are indexed; their file
metadata was not fetched.

## 5. vtuwise.in — ENUMERATED (most structurally useful)

`robots.txt` allows all except **`/api/`** (not probed). A single 68 KB sitemap → **344
URLs**, and the **cleanest URL taxonomy of any source**:

```
/firstyear/{25-scheme|22-scheme}/{p-cycle|c-cycle}/{subject-slug}-{CODE}-vtu-notes
```

This is the source that revealed the **2025 scheme**. Codes appear as `1BMATS101`,
`1BCHES102`, `1BESC104A`… — the 2022 code with a leading `1`. Physics/Chemistry cycle
(P/C cycle) organisation of the first year is explicit here and has **no representation in
GradTools' model**.

## 6. www.vturesource.com — NAVIGATION-ONLY

`robots.txt` allows all but **declares no sitemap**, so no enumeration was possible. Structure
was sampled from the homepage instead; URL counts are therefore absent, not zero.

Structurally the **broadest** source and the one that most exceeds GradTools' scope:

- **Programmes beyond UG BE:** M.Tech, MBA, MCA, B.Arch, B.Plan, PhD.
- **Schemes beyond 2022:** 2015, 2018 visible in URLs (`15CS73`, `15EC835`, `16MBA15`).
- **Sections:** Question Papers, Syllabus, Time Table, Results, **MCQ**, **Subject Codes**, Notes.
- **URL pattern:** `/vtu-question-papers/{BRANCH}/{YEAR}/{CODE}/{Subject-Name}`.
- Explicitly **not** an official VTU property; an independent aggregator.

## 7. vtusgpacalculator.com — ENUMERATED

One sitemap → **45 URLs**, every one a calculator or calculator-adjacent page. Per-scheme
calculators for **2018, 2021, 2022 and 2025**; per-branch pages for CSE/ECE/EEE/ISE/Civil/
Mechanical; and several utilities with **no GradTools equivalent**: `/backlog-calculator/`,
`/required-sgpa-calculator/`, `/target-cgpa-calculator/`, `/placement-eligibility/`,
`/marks-to-grade/`, `/percentage-to-sgpa-calculator-vtu/`.

Two pages were read in full; findings are in `vtu-gap-analysis.md` §13 and the conflict
register.

---

## Rights and provenance posture

No source carries a visible reusable licence. `vtuadda.com` publishes a copyright policy and
a takedown form, which is the clearest signal that notes/papers/textbooks across this
ecosystem are **third-party copyrighted material**. Accordingly, every notes / question-paper
/ textbook / lab-manual finding in the gap analysis is classified **LINK-ONLY** or **REQUIRES
RIGHTS REVIEW** — never "safe to ingest". Only factual academic structure (codes, credits,
formulas, grade bands) is a normalisation candidate, and only after verification against
`vtu.ac.in`.


---

# Session 2 — sources beyond the original seven

Full register with per-source status: `vtu-web-discovery.json` (16 sources, 7 Tier 1).

## Tier 1 — official VTU (the authority)

| Source | Status | What it settled |
|---|---|---|
| `Regulations-Clr-BE-BTECH-2022-611-02052023.pdf` (65 pp) | **FETCHED & EXTRACTED** | Attendance, SGPA/CGPA, percentage, grade bands, pass marks, credit table, course types — see `vtu-conflicts.md` C1-C4 |
| `vtu.ac.in/en/cgpa-standard-formula/` | **FETCHED** | `(CGPA − 0.75) × 10` scoped to **2015/2017/2018 only** |
| `vtu.ac.in/pdf/UG2024/phycyc.pdf` | **FETCHED & EXTRACTED** | 2025 scheme, 61 codes, effective 2025-26 |
| `vtu.ac.in/b-e-scheme-syllabus/` | DISCOVERED | The canonical index — the ingestion path for the 259 missing codes |
| `vtu.ac.in/en/2025/09/37846/` | DISCOVERED | 2025 first-year syllabus circular |
| `BE-BTech-Regulation-2021-draft.pdf` | DISCOVERED (**DRAFT**) | Needed to settle C5 |
| `VTU_M.Plan_Regulations.pdf` | SNIPPET ONLY | PG programme — must **not** be generalised to B.E. |

**Extraction method.** WebFetch could not read the regulation PDF (returned "heavily
compressed/corrupted"). The PDF was fetched with `curl` and extracted using **the
repository's own `pdfjs-dist`** — the same library `apps/web/src/lib/pdf-text.ts` uses in
production. 65 pages, 136,883 characters of clean text. Reproducible.

## Tier 4-6 — newly discovered, none authoritative

`vturesource.com/VTU-Subject-Codes/` (broadest programme coverage: M.Tech, MBA, MCA, B.Arch,
B.Plan, PhD; schemes 2015/2018) · `vtu-easy.com` (**conflicting** code convention, see C6) ·
`vtustudent.com` · `vtuverse.com` · `toolisky.com` · `embibe.com` · `macmyths.com`.

## GitHub / open data — NEGATIVE RESULT

Searched `github.com/topics/vtu` and `/vtulab`. **No structured VTU subject/credit JSON or
CSV dataset found** — the repositories are lab-program solutions with unclear licensing.

Worth stating plainly: **GradTools' own catalogue — 187 courses carrying sha256 + source page
+ retrieval timestamp — appears to be the best-provenanced structured VTU 2022 dataset
located anywhere in this research.** That asymmetry is the reason nothing scraped should
overwrite it.
