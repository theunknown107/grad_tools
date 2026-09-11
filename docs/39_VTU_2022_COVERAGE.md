# VTU 2022 coverage audit

Authority: Phase 7E Workstream A · measured at `51a9aa3` against the live
listing on 2026-09-11 · raw evidence in `.vtu-store/last-sync-documents.json`

## Status at `c3547b9`

`pnpm vtu:validate --scheme 2022` is down to **one failing rule** from five.
The catalogue is still **not published**.

| | First audit | Now |
| --- | --- | --- |
| Failing validation rules | 5 | **1** |
| Semester totals disagreeing | 37 of 149 | **15 of 149** |
| Option groups offering no choice | 1 (`BAE755x`) | **0** |
| Courses offered by two slots | 4 (`BEC654A–D`) | **0** |
| Documents with unknown applicability | 60 | 57 |
| Course rows with neither programme nor stream | 588 | 46 |
| Course rows (candidate) | 3221 | 3567 |
| Distinct course codes | 2007 | 2056 |

### Units, kept apart

| Unit | Full 2022 universe | CSBS production |
| --- | --- | --- |
| Documents selected | 291 | 19 |
| Unique binaries retrieved | 287 | 19 |
| Normalized course rows | 3567 | 187 |
| Distinct course codes | 2056 | 187 |
| Rows scoped to CSBS by name | 90 | 90 |
| Rows scoped to a stream | 97 | 97 |
| Rows with neither | 46 | 0 |
| Option groups / memberships | 482 / 1873 | — |
| Aliases | 1 | 1 |
| Open conflicts | 11 | 0 |

The production catalogue's 187 rows are 90 CSBS + 66 CSE-stream + 31
Civil-stream. **The full universe is not the CSBS catalogue** and must not be
poured into it: 3380 of the candidate's rows belong to programmes GradTools
does not serve.

### The three structural defects fixed this round

1. **A code cell naming more than one code.** `BCH358x/BCHL358x`,
   `BTX/ST306x`, and `BBOC407 BBOK407` set side by side. The first two went
   unread — taking their credits with them — and the third was read as two
   rows, each charged the row's credits. 33 totals → 15.
2. **A group counting a row already in the sum.** A compound cell prints one
   row under its first code; charging the alternative group as well turned a
   document five credits short into one five over.
3. **One choice named twice.** `BCH358x` and `BCHL358x` are the theory and
   laboratory names of one Ability Enhancement slot, and the document prints a
   single list of four options under them.

### Root causes, stated

- **`BAE755x`** — its options are printed as slashed compound codes the reader
  could not see, so the slot stood empty. Category: *choices were not parsed*.
  Fixed in the parser; no rule was changed.
- **`BEC654A–D`** — legitimate. VTU names the sixth-semester Open Elective
  `BXX654x`, `BEC654x` and `BTE654x` in three of its own documents, and the
  course is rightly an option in each. The rule compared across a programme's
  documents where its own comment said "no scheme prints" — one scheme, one
  document. Scoped to the document; within one, the invariant holds and is
  still asserted.

### What still fails, and why

**15 semester totals, across 9 documents, every one an under-read** — the
parser did not read a row the document counts. Classification:
`PARSER_MISSING_ROW` × 15. Five of the fifteen are one document,
`00.-SchemeA-B-2022-3-8-sem-V6-Final11.03.2026.pdf`, which also has
unresolved applicability. Two more are a code the PDF broke across separate
text runs (`B` `BM` `456x`). The rest are individually distinct.

These are parser defects, not source conditions, so the rule is **not**
relaxed for them and validation stays red. A green validator bought by
loosening this rule would assert a faithfulness the catalogue does not have.

---

## Status at `074a50f`

Three of the five blockers this document first reported are fixed, and the
catalogue is still **not published**. What changed:

| | Before | After |
| --- | --- | --- |
| Documents with unknown applicability | 60 | 57 |
| Course rows with neither programme nor stream | 588 | 46 |
| Programme names that are really a row number | 2 (`21a`, `29a`) | 0 |
| CSE's own scheme | no programme at all | Computer Science & Engineering |
| Course rows | 3221 | 3490 |
| Semester totals disagreeing | 37 of 149 | 33 of 149 |
| `vtu:validate --scheme 2022` | FAILS, 5 rules | FAILS, 3 rules |

The remaining 33 disagreements are classified from the readings themselves:

| Count | Classification |
| --- | --- |
| 22 | a row the parser did not read |
| 11 | one row read under two codes whose printed titles are identical |

In ten of the eleven the delta equals the twin's credits exactly. **No alias
was created from a repeated title**: an identical title may be the alias it
looks like, or a title-extraction defect, and §16 wants evidence rather than a
resemblance.

Credit provenance is now reported on every run — 1723 `table`, 1739 `slot`, 28
`alternative` — and two new rules check the borrowing: no borrowed credit may
name a slot the catalogue does not hold, and none may contradict the slot it
came from. **Both pass: there are no unresolved credit conflicts.**

A candidate artifact was generated for comparison only, never published. Against
the 187-course production catalogue: **3303 added, 0 removed, 0 changed, 187
unchanged**, alias intact. The trusted CSBS data is untouched by any of this.

### What is not established

The `38csesch.pdf` document was expected to be first-year CSE *stream*
material. The source says otherwise: it sits in the 3-8 semester programme
table, its link reads "3- 8 Sem Scheme", and it spans semesters 3 to 8. The
first-year CSE stream document is `csesch.pdf`, which already carries
`CSE Stream Scheme (CSE/ISC/BT)`. So `38csesch.pdf` is recorded as the
Computer Science & Engineering programme's scheme, on the listing's own words.

---

## The headline

**The broadened catalogue is not publishable.** `pnpm vtu:validate --scheme
2022` fails on five checks, 37 of 149 printed semester totals disagree with what
was extracted, and the Computer Science & Engineering scheme — 91 courses — is
stored with no programme at all. The crawl is a good source of evidence and a
bad source of truth, and §19 exists for exactly this outcome: the production
artifact `packages/vtu-catalogue/data/vtu-2022.json` was **not** regenerated.

## Counts are not comparable until you say what they count

An earlier note put "291" beside "187 courses" as though one were the shortfall
of the other. They measure different things and their ratio means nothing:

| Number | What it counts |
| --- | --- |
| 1140 | PDF URLs on the listing page, **all scheme years** |
| 291 | 2022 scheme/syllabus **documents** selected |
| 3684 | **course readings** the parsers produced |
| 3221 | **course rows**, one per (year, programme, stream, semester, code) |
| 2007 | distinct **course codes** |
| 187 | course rows in the **published** artifact, from 19 documents |

A PDF is not a course; a reading is not an identity; an identity is not a code.
`BCS501` is one code, twelve rows and one course.

## The pipeline, stage by stage

```
listing page                     1140 PDF URLs (all years)
        |
        v  filter to 2022 scheme + syllabus
selected                          291   = 78 schemes + 213 syllabi
        |
        v  download (polite, cached, content-addressed)
retrieved                         287   4 failed
        |
        v  hash
unique binaries                   287   0 URLs shared a binary
        |
        v  extract (native text layer only)
readable                          280   7 carry no text layer
        |
        v  parse
produced something                260   20 read cleanly and yielded nothing
        |
        v  normalize + dedupe by identity
course rows                      3221   from 3684 readings
syllabi / modules / topics       1829 / 7270 / 8097
        |
        v  validate
                                 FAILS
        |
        v  publish
                                 NOT DONE
```

Stage yields, kept separate as §42 requires — one number would be a lie:

| Stage | Ratio | |
| --- | --- | --- |
| selected / listing | 291 / 1140 | the rest are other scheme years |
| downloaded / selected | 287 / 291 | 98.6% |
| extracted / downloaded | 280 / 287 | 97.6% |
| yielded / extracted | 260 / 280 | 92.9% |
| validated / normalized | 0 / 3221 | **the gate fails** |
| published / validated | 0 | |

## Every source that produced nothing

31 of 291. No source is unaccounted for; the ledger holds one row per document
whatever became of it.

| Count | Stage of loss | Classification |
| --- | --- | --- |
| 2 | over the 40 MB download ceiling (71.9 MB, 43.8 MB) | download gap |
| 2 | HTTP 404 — the listing links a document VTU does not serve | URL/access gap |
| 7 | no text layer (scanned) | extraction gap |
| 6 | scheme read cleanly, zero courses parsed | normalization gap |
| 14 | syllabus read cleanly, zero syllabi parsed | normalization gap |

The two oversize documents are the cheapest win available: `3eisyll.pdf` and
`2enccsyll.pdf` are refused by a constant, not by anything about them.

## Applicability — the defect that blocks publication

| Scope | Documents |
| --- | --- |
| programme | 213 |
| unknown | 60 |
| stream | 14 |

`unknown` means the row's programme could not be read, and a course from such a
document is stored with `programme_name = NULL` **and** `stream_id = NULL` —
which is the shape reserved for a document common to everybody. 588 course rows
are in that state. Among the 60 are:

- `38csesch.pdf` — Computer Science & Engineering, 91 courses
- `civsch.pdf`, `58civsch.pdf` — Civil Engineering, 34 courses each

So VTU's largest programme is recorded as though its fifth-semester courses
applied to every student at the university. The credits happen to agree with the
other programmes' readings of the same codes today, so nothing is currently
mis-computed — but the identity is wrong, and §8's rule that a null programme
must not be a catch-all is exactly what this violates.

Two further classification defects, from the same stage:

- `21a` and `29a` are stored as programme names. They are fragments of a table
  row, not programmes, and `21a` carries a duplicate of the whole CSE scheme.
- 310 syllabi describe a course that no scheme in the catalogue lists.

## Semester totals

The scheme tables print their own per-semester credit total. 37 of the 149
totals we can check disagree with what was extracted, in both directions:

```
silksch.pdf   sem 3: printed 20, catalogue 16      under-read
38aidssch.pdf sem 4: printed 19, catalogue 28      over-read
00.-SchemeA-B-2022-3-8-sem-V6-Final11.03.2026.pdf
              sem 8: printed 16, catalogue 0       read nothing
```

The document's own arithmetic is the check, and a quarter of it fails. Until
that is understood, no figure from these documents should reach a student's
SGPA.

## Courses, by semester

| Semester | Rows | Distinct codes |
| --- | --- | --- |
| 1 | 126 | 41 |
| 2 | 33 | 33 |
| 3 | 604 | 348 |
| 4 | 637 | 347 |
| 5 | 431 | 251 |
| 6 | 699 | 430 |
| 7 | 358 | 255 |
| 8 | 333 | 302 |

Semester 2's 33 rows against semester 1's 126 is not a real asymmetry in VTU's
degree; it is a reading gap in the first-year documents.

## How credits were established

| `creditBasis` | Rows |
| --- | --- |
| `slot` — borrowed from the elective slot | 1642 |
| `table` — the course's own row states them | 1551 |
| `alternative` — shared with an "A OR B" partner | 28 |

**Half the catalogue's credits are borrowed.** That is recorded rather than
hidden — `relatedCode` names where each came from — but a figure inherited from
a slot is weaker evidence than one a course's own row prints, and a 51% share is
a quality fact about this crawl, not a footnote.

## Conflicts, aliases, options

- **12 open conflicts**, none resolved: 1 on course credits (`BBOK407`, 3 vs 2)
  and 11 on a syllabus code. 26 readings recorded behind them. Nothing was
  settled by whichever document was read last.
- **1 alias**, `BCSL358D` to `BCS358D`, with its evidence document cited. No
  alias was inferred; there is no similarity function anywhere in this pipeline.
- **418 option groups** (403 elective slots, 15 alternatives) with 1629
  memberships. The existing `catalogue_option_groups` model carries them; no
  parallel structure was added.
- **185 syllabus readings were overwritten** by a later reading of the same
  identity (2014 normalized, 1829 stored). Some surfaced as the 11 code
  conflicts; the rest did not, and that is a gap — §14 says a replaced reading
  must be recorded, not dropped.

## Programme coverage

37 distinct programme labels carry course rows. The largest and smallest:

| Programme | Rows | Semesters covered |
| --- | --- | --- |
| (no programme — includes CSE and Civil, wrongly) | 588 | 8 |
| Marine Engineering | 105 | 6 |
| CSE (Artificial Intelligence & Machine Learning) | 94 | 6 |
| Computer Science & Business System | 90 | 6 |
| `21a` (a fragment, not a programme) | 90 | 6 |
| Electrical & Electronics Engineering | 34 | 2 |
| Aerospace Engineering | 26 | 2 |

A programme showing 2 or 3 semesters is not a shorter degree; it is a document
that did not read.

## What to fix, in order

1. **Applicability for the 60 unknown documents.** Nothing else matters while
   CSE has no programme. Read the listing row, not the link.
2. **`21a` / `29a`.** The same stage, the same fix.
3. **The 37 disagreeing semester totals.** The documents check our arithmetic
   for us; use it.
4. **Syllabus identity collisions.** 185 readings replaced in silence.
5. **The 40 MB ceiling**, for two documents.
6. **OCR**, for the 7 scanned documents — §13's ladder, next rung.

Only after 1-3 is any of this catalogue safe to publish.

## Reproducing this

```bash
createdb -p 55432 -U gradtools gradtools_vtu_audit
DATABASE_URL=postgres://gradtools@127.0.0.1:55432/gradtools_vtu_audit \
  pnpm --filter @gradtools/api migrate
DATABASE_URL=... pnpm vtu:sync --scheme 2022        # cached: no re-download
DATABASE_URL=... pnpm vtu:validate --scheme 2022
```

Use a database of its own. The audit was first run against `gradtools_test`,
which the test suite drops and which had fixture rows in it — one of them a
document version with a SHA of sixty-four `a`s that the validator duly reported.
