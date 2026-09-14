# VTU 2025 coverage audit

Authority: measured at `1b31892` · raw 2022 evidence in
`.vtu-store/last-sync-documents.json` · companion to
[39_VTU_2022_COVERAGE.md](39_VTU_2022_COVERAGE.md)

## The headline

> **Superseded below.** Two official CSBS documents have since been supplied
> and have been through the whole pipeline. 2025 is now a **`CANDIDATE`** with
> 87 course identities and 9 syllabi; 2022 remains `PUBLISHED` and
> byte-unchanged. See [the update](#update--two-official-csbs-documents-supplied-and-what-they-proved).
> The sections between here and there record the position when the scheme PDFs
> were still absent, and are kept because the acquisition reasoning is what
> made the supplied route legitimate.

**The 2025 discovery graph is now real and complete. The scheme PDFs are still
not acquired, so there is no 2025 catalogue — not a published one, and not a
candidate one.**

The acquisition gate refuses vtu.ac.in, and refusing it is the correct
behaviour rather than a fault to be worked around. What this phase delivered is
everything downstream of acquisition: the catalogue model already carried
`scheme_year` as identity, the reader now recognises the code family the 2025
scheme actually prints, the validator no longer reports a scheme it has no data
for as passing, and the isolation between two scheme years is asserted rather
than assumed.

| | 2022 | 2025 (then) | 2025 (now) |
| --- | --- | --- | --- |
| Scheme documents acquired | 288 | **0** | **1** (supplied) |
| Course readings | 3603 | **0** | **109** |
| Stored catalogue rows | 187 | **0** | **87** |
| Publish state | `PUBLISHED` | **`NO SOURCE`** | **`CANDIDATE`** |

Seven real 2025-scheme documents DO exist on this machine. They are question
papers, and a question paper carries no credits, no L/T/P and no scheme
membership — so they establish the code grammar and cannot produce a single
catalogue row. See [What 2025 material is actually
here](#what-2025-material-is-actually-here).

The 2025 SCHEME documents are absent under any name: 288 cached extractions,
72 local PDFs and 11 archives were searched by CONTENT rather than by filename,
and none is a 2025 scheme. See [The local search](#the-local-search-by-content-rather-than-by-filename).

`NO SOURCE` is deliberately not `CANDIDATE`. A candidate is data that has been
through the pipeline and failed, or that awaits review. Nothing has been
through the pipeline, and calling an empty set a candidate would misrepresent
the position.

---

## Update — two official CSBS documents supplied, and what they proved

Two official 2025 documents were handed over by a person and entered through
Mode B. Nothing was fetched: the registry row is unchanged, and
`pnpm vtu:supply` contains no `fetch` (asserted by test).

| | file | sha-256 | bytes | pages |
| --- | --- | --- | --- | --- |
| Scheme, CSBS, sem III-VIII | `34csbssch.pdf` | `10943b44d287deb3...` | 483 778 | 30 |
| Syllabus, CS common | `34cscommsyll.pdf` | `86437482987bbf10...` | 1 522 031 | 59 |

Both were verified by CONTENT before being supplied, not by filename. The
scheme prints "B.E. in Computer Science and Business System - Scheme of
Teaching and Examinations - 2025 - (Effective from the academic year 2025-26)"
and heads six tables, III to VIII. The syllabus stamps every course "Scheme
2025 / Semester 3".

### The 2025 catalogue, as read

| | |
| --- | --- |
| Course readings | 109 |
| Stored course identities | **87** |
| Option groups / memberships | 10 / 47 |
| Syllabi / modules / topics | **9 / 25 / 47** |
| Conflicts | 0 |
| Publish state | **`CANDIDATE`** - see below |

Every printed semester total is reconciled by the deduplicated table rows:

| Semester | Printed | Table rows read |
| --- | --- | --- |
| III | 21 | 21 |
| IV | 21 | 21 |
| V | 22 | 22 |
| VI | 21 | 21 |
| VII | 20 | 20 |
| VIII | 15 | 15 |

The nine syllabus courses state credits of 4, 4, 4, 3, 3, 1, 1, 1, 1, which is
what the scheme's own third-semester table states for the same codes - two
documents agreeing without either being consulted for the other.

### Six defects the real documents exposed, all in shared code

None of these was a 2025-only patch; each was a reader that had been wrong for
both schemes and had nowhere to show it.

1. **A quarter of the scheme was invisible.** Semester headings were taken only
   from runs of 24 characters or fewer. The 2025 scheme heads its last two
   tables `VII SEMESTER (Swappable VII and VIII SEMESTER) (SCHEME-A)` - 57
   characters - so semesters VII and VIII produced no courses at all. The
   length limit now says what it meant: the heading may be followed by
   bracketed qualifiers and nothing else. **The same limit was dropping 19
   headings across the 2022 corpus**, including 2022's own swappable pages and
   the first-year stream tables.
2. **The eighth-semester table read as empty.** Its placeholder codes are typed
   in lower case - `1Bxx801x`, `1Bxx802x`, `1Bxx803x`, worth 3, 3 and 9 of that
   table's 15 credits - while the same document types them upper case
   elsewhere. Only the discipline segment is case-folded; the trailing letter
   is left exactly as printed, because `BXX515x` is a slot and `BXX515A` is one
   of its options.
3. **Titles carried the department column.** The cell is split at its colon
   into `"TD/PSB"` and `": CS Allied"`, so neither half matched a pattern that
   requires both, and every row on four pages read as "TD/PSB : CS Allied
   Machine Learning". The halves are rejoined by adjacency - they meet at
   exactly 0.0 - which is the rule already used for codes broken across runs.
4. **The syllabus produced nothing.** Its code grammar was a narrower copy of
   the scheme reader's and the two had drifted: `1BMATCS301` has a generation
   digit that pattern had no room for and six department letters where five
   were allowed. The document extracted cleanly and reported "syllabi 0", which
   is indistinguishable from a syllabus with no courses in it.
5. **Courses were titled from page furniture.** This template prints the name
   above the header table rather than labelling it, so the title came from the
   cell beside the semester - `1BMATCS301` was titled "Type of Course ASC", and
   marked `resolved`. Reading upward instead then found the running header
   (`IPCC (4 Credits) template30.03.2026`), so the search now starts at the
   course code and works back.
6. **Credits were read off that same running header.** "Credits" there is
   followed by `) template30`, and the first line carrying the label won - so
   seven of nine courses reported 30, 20 or 300 while `Credits 4` sat in the
   table below. A labelled number now prefers a reading inside its plausible
   range; an out-of-range one is still reported, still `ambiguous`, when it is
   the only one.

Measured over the 2022 corpus, these strictly recover more and lose nothing:
**193 -> 197** documents yielding syllabi, **2025 -> 2195** syllabi, **8042 ->
8759** modules, **9130 -> 10081** topics, **2010 -> 2167** credits resolved, and
zero new ambiguous readings.

### Mode B had no door for the pipeline either

`vtu:supply` could put an official document in the store, and nothing could use
one: the only route from the store to the database ran through `vtu:sync`,
whose gate stands in front of the downloader unconditionally. `--supplied-only`
is that door, and it works by **not calling the downloader at all** - so there
is no option it can pass wrongly and no socket it can open. The listing keeps
its own gate; a document that was never supplied is reported as such, never
fetched.

### The validator was mixing scheme years

`vtu:validate --scheme 2025` named the scheme and only two of its eight checks
listened. The first real 2025 run failed on a 2022 alias and two 2022
conflicts - rows no 2025 run can do anything about. Twenty-two queries are now
scoped, which is what makes the isolation claim checkable rather than asserted:
with 87 2025 courses stored, `--scheme 2022` reports **zero** courses and says
so, rather than borrowing any.

### Why 2025 is `CANDIDATE` and not published

`vtu:validate --scheme 2025` passes every course, syllabus, option, alias,
provenance and conflict check, and fails one: **semester totals, 2 of 2**.

Both are misreadings of the PRINTED figure, not of the catalogue:

- *sem 7, "printed 15"* - page 7's `Total` is a column header in the vertical
  header stack, not a totals row, and a stray `15` shares its baseline. The
  page's real total is 20, which is what the catalogue holds.
- *sem 8, "printed 20"* - read from page 11, the Scheme-B two-semester
  internship variant, which carries no heading of its own and so inherits
  semester 8. Scheme-A's VIII total is 15, which is what the catalogue holds.

The check was deliberately left alone. Loosening it to go green would remove
the only cross-check that compares the reader against the document's own
arithmetic, and the reader here is what is wrong. A one-number `Total` row
cannot simply be rejected either: **37 valid 2022 totals have exactly that
shape.**

### What is still missing, from the scheme's own contents

Determined by reading `34csbssch.pdf`, not guessed:

1. **The first-year (I & II semester) 2025 scheme.** The CSBS document opens at
   III SEMESTER, so semesters I and II are absent from the catalogue entirely.
   The listing offers three under "UG Engineering Scheme and Syllabus 2025 (1st
   & 2nd semesters)":
   `https://vtu.ac.in/pdf/UG2024/phycyc.pdf`,
   `https://vtu.ac.in/pdf/UG2024/chemcyc.pdf`,
   `https://vtu.ac.in/pdf/UG2024/4065.pdf`.
2. **Syllabi for CSBS semesters IV-VIII.** `34cscommsyll.pdf` is the only
   syllabus the CS family has in the 3-to-8 listing and it covers semester 3
   only - nine courses. No document in the discovery graph carries the rest.

Nothing else is required for the credits. `1BMATDIP310` and `1BMATDIP410`
(lateral-entry mathematics) and the NCMC activity rows are printed in the CSBS
scheme itself as non-credit (`PP`), and every elective option it offers carries
its credits from the slot row in that same document.

---

## Update - the three first-year documents supplied, and what they settle

All three documents named as missing above have since been supplied through
Mode B. Nothing was fetched; the registry row is unchanged. The store now holds
**five** supplied 2025 documents.

| file | sha-256 | bytes | pages | extraction | role |
| --- | --- | --- | --- | --- | --- |
| `34csbssch.pdf` | `10943b44d287deb3...` | 483 778 | 30 | text | CSBS scheme, III-VIII |
| `34cscommsyll.pdf` | `86437482987bbf10...` | 1 522 031 | 59 | text | CS shared syllabus, sem 3 |
| `phycyc.pdf` | `65f59c35d320bb91...` | 253 595 | 6 | text | first year, Physics group |
| `chemcyc.pdf` | `b14c96ee5d5e05f6...` | 333 316 | 6 | text | first year, Chemistry group |
| `4065.pdf` | `788fa3034caa67bf...` | 7 488 583 | 17 | **no_text_layer** | SEE/assessment circular |

### menu12 and menu13 are different sections and it matters

The listing carries three anchors, and conflating them would misattribute
documents:

| anchor | title | documents |
| --- | --- | --- |
| `menu11` | UG Engineering Scheme and Syllabus 2025 (1st & 2nd semesters) | 87 |
| `menu12` | UG 3rd to 8th semesters Scheme and Syllabus (2025)(Engg) | 93 |
| `menu13` | 3rd to 8th semester Common Courses 2025 scheme | 12 |

**`menu13` is CSBS-relevant and was nearly missed.** Its twelve documents are
shared course syllabi, and four of them are courses the CSBS scheme itself
prints: `1BMATDIP310` and `1BMATDIP410` (the lateral-entry bridge, NCMC/`PP` in
CSBS III and IV), and `1BPE309` / `1BYOG309` (two of the four NCMC activity
options in CSBS III). None carries credit, so none changes a semester total.

`menu13` also shows what CSBS does NOT take from it: its third-semester
mathematics documents are `1BMATCV301`, `1BMATME301`, `1BMATEC301` and
`1BMATEE301` - the CV, ME, EC and EE streams. There is no `1BMATCS301` there,
because the CS-stream mathematics syllabus is inside `34cscommsyll.pdf`. The
shared section is shared without being universal.

`1BPE409` and `1BYOG409` are in `menu13` too, but the CSBS fourth-semester rows
are coded `1BPEK409` and `1BYOK409`. A filename is not a course code and the
bytes are not held, so no equivalence is recorded.

### Syllabus coverage, CSBS III-VIII

| Semester | State | Evidence |
| --- | --- | --- |
| III | **Covered** | `34cscommsyll.pdf`, 9 syllabi / 25 modules / 47 topics |
| IV | **Genuinely unavailable** | no 2025 CS syllabus document exists in the listing |
| V | **Genuinely unavailable** | as above |
| VI | **Genuinely unavailable** | as above |
| VII | **Genuinely unavailable** | as above |
| VIII | **Genuinely unavailable** | as above |

`34cscommsyll.pdf` is filed under a "34" prefix that reads as "semesters 3 and
4". It is not: every one of its nine courses is stamped `Semester 3`. Content
decides, not the filename.

Of the 37 syllabus documents in `menu12`, exactly one belongs to the CS family -
`34cscommsyll.pdf`. There is no `34cbsyll`, no per-semester CS syllabus, and
nothing else in the 2025 graph carries CSBS IV-VIII. This is a **source
availability** state, not a reading failure: the scheme rows for IV-VIII are
read, validated and unaffected.

### First-year applicability is NOT resolved, and is not guessed

`phycyc.pdf` and `chemcyc.pdf` both head themselves "Common to all Engineering
Programmes", so both are recorded with `scope: common`. That is faithful to the
page, and it is not enough to place a CSBS student.

Each document prints a first-year CYCLE: a student takes Physics group in
semester I and Chemistry in II, or the reverse. The two documents therefore
describe alternatives, not a single first year. Within each, the core courses
are STREAM-DETERMINED rather than chosen - the scheme prints them as
placeholders (`1BMATx101`, `1BPHYx102`, `1BCEDx103`, `1Bxxx105x`,
`1BxxxL107x`) and resolves them in an options table where a CSBS student, being
CSE stream, must take `1BMATS101`, `1BPHYS102`, `1BCEDS103`.

Those placeholder forms carry a lowercase stream marker inside the discipline
segment, which the code grammar does not match, so **those rows are not read at
all**. The consequence is visible and is reported by the validator rather than
hidden:

| document | semester | printed | catalogue |
| --- | --- | --- | --- |
| `phycyc.pdf` | I | 20 | 4 |
| `phycyc.pdf` | II | 20 | 12 |
| `chemcyc.pdf` | I | 20 | 12 |
| `chemcyc.pdf` | II | 20 | 1 |

What IS stored from these documents is true: 25 rows that are genuinely common
or genuinely elective, including the `1BESC104A`-`E` engineering-science options
and the `1BPLC105B`/`105E` programming options, each carrying its credits from
the slot row that prints them.

**Nothing false is stored, and nothing is complete.** Reading the missing rows
would require resolving a stream marker to a stream, and presenting a
stream-determined course as a free elective would be exactly the guessed
applicability this phase forbids. First-year coverage is therefore an open
blocker, named, not worked around.

The first-year SYLLABUS dependencies are already stream-scoped in the graph and
simply not supplied: `UG2024/1BMATS101.pdf`, `UG2024/1BPHYS102.pdf`,
`UG2024/1BCHES102.pdf`, `UG2024/1BCEDS103.pdf`, `UG2024/1BESC104E.pdf`,
`UG2024/1BPLC105B.pdf` (plus their `bs`-prefixed variants).

### `4065.pdf` contributes provenance and no course data

It is a 17-page image-only circular - **zero** text-layer characters - whose
first page states that SEE details for 2025-scheme B.E./B.Tech programmes were
prepared and published. It is held, hashed and recorded with
`extraction: no_text_layer`, `lostAt: the PDF carries no text layer`,
`scope: unknown`, **0 courses, 0 syllabi**.

That is the whole of its contribution and it is the correct one. The catalogue
has no assessment/regulation entity for it to populate, and manufacturing
course or module rows from an unreadable scan would be invention. It stands as
evidence that the document exists and was obtained, nothing more.

### Sources deliberately rejected

No 2022 document was used as a 2025 substitute. Specifically refused:
`cb4sem`, `cb5sem`, `cb6sem`, `cb7sem`, `cb8sem` and every other 2022 CSBS
syllabus. A 2022 document is a different scheme: `scheme_year` is part of a
course identity, the 2025 codes carry a generation digit the 2022 codes do not,
and the credit figures are not transferable. Filename similarity between a 2022
and a 2025 document is not evidence of anything.

### State after this phase

| | |
| --- | --- |
| Supplied documents | **5** (store holds 295 total) |
| Course identities | **112** - 87 CSBS III-VIII, 25 first-year |
| Option groups / memberships | 15 / 66 |
| Syllabi / modules / topics | 9 / 25 / 47 |
| Conflicts | 0 |
| `vtu:validate --scheme 2025` | **FAILED** - 1 failure, the four first-year totals |
| Publish state | **`CANDIDATE`** - not published |

2022 is untouched: `d1081e8621852e4a92f3e4521383e16ac1ee8ab14f1a0604fed8aedff74e9065`,
187 courses, and `--scheme 2022` against a database holding 112 2025 rows still
reports zero 2022 courses, zero syllabi and zero option groups.

### Known limitation, unchanged

Option-list rows in two-column layouts still absorb the neighbouring column's
title - `1BIS505A` reads "Digital Image Processing Business Strategy". Codes,
credits, semesters and slot membership are unaffected, and the same limitation
is visible in the published 2022 catalogue (`BSFHK158`, "Scientific Foundations
of Health AnyDept"). Not introduced here and not fixed here.

### 2022, re-proved

The published artifact `packages/vtu-catalogue/data/vtu-2022.json` is
byte-unchanged:
`d1081e8621852e4a92f3e4521383e16ac1ee8ab14f1a0604fed8aedff74e9065`,
187 courses, 0 conflicts, 1 alias, 19 documents. It was **not** regenerated.

Rebuilding it from its own recorded provenance now reads MORE than it
publishes: `cvsch.pdf` goes 57 -> 121 courses, because the heading fix recovers
the Civil first-year tables it had been skipping. That is a decision to take
separately - whether to republish 2022 at 251 rows - and is not taken here. The
one row that appears to have been lost is not: `BSFHK158` is still read, with
the same credits, semester and basis, now from its real first-year table with a
clean title. It pairs with `BIDTK158` where the published row says `BITDK158`;
the document contains BOTH spellings, on different pages, so each reading is
faithful to the page it came from and neither is a parser fault.

## Why acquisition is blocked

The source registry row for `vtu-scheme-syllabus`, unchanged by this phase:

| Field | Value |
| --- | --- |
| `robots_status` | `allowed` |
| `terms_status` | `unknown` |
| `rights_status` | `unknown` |
| `enabled` | `false` |
| `access_method` | `none` |

Run today, the pipeline refuses before it reaches the network:

```
$ pnpm vtu:sync --scheme 2025
SourceNotAuthorized: Source "vtu-scheme-syllabus" has access method "none"
and is never fetched automatically. Only "http_fetch" sources are.
  refusal: 'not_permitted'
```

The refusal happens in `requireFetchPermission`, which runs *before* the
`fetch` call in `vtu-sync.ts`. `--scheme 2022` refuses identically; the 2022
documents in `.vtu-store` were supplied through the Mode B path, not crawled.

Unblocking this is a terms review (OQ-006), not a code change. Until it
happens, a 2025 catalogue can only be built from documents supplied through the
same Mode B path the 2022 corpus came through.

## Official 2025 sources, recorded and not fetched

These are the documents a supplied-material run would need. They are listed as
references, and none of them has been retrieved.

| Source | URL |
| --- | --- |
| UG scheme & syllabus listing | `https://vtu.ac.in/b-e-scheme-syllabus/` |
| 2025 scheme notification (July 2025) | `https://vtu.ac.in/2025/07/37313/` |
| First-year 2025 update circular (Sept 2025) | `https://vtu.ac.in/en/2025/09/37846/` |
| **CSBS 2025 scheme, semesters 3–8** | `https://vtu.ac.in/pdf/2025syll3to8/34csbssch.pdf` |
| Course/subject equivalences | `https://vtu.ac.in/course-subject-equivalences/` |
| Academic calendar | `https://vtu.ac.in/academic-calendar/` |
| Examination notices | `https://vtu.ac.in/category/examination/` |
| Administration notices | `https://vtu.ac.in/en/category/administration/` |
| Regulations | `https://vtu.ac.in/category/vtu-regulation/` |

No SHA-256, page count, retrieval timestamp or printed total is recorded for
any of them, because recording one would mean claiming a document was read.
§64's verification — actual SHA, page count, effective academic year,
programme, semester coverage, course count, printed totals — is **entirely
outstanding** and cannot begin without the bytes.

The September 2025 circular matters for a reason worth stating in advance: it
says first-year 2025 files were updated *by replacing* earlier ones. Two
binaries at one URL are two `source_document_versions` under the existing
content-addressed model (§17), and the older one is not overwritten. That
behaviour already exists and is tested; it simply has no 2025 rows to exercise.

## The discovery graph, from the supplied listing page

**SUPPLIED OFFICIAL DOCUMENT** — the listing page saved from
`https://vtu.ac.in/b-e-scheme-syllabus/`, sha256
`c99d2b62db0af9108a4cbae56d691488cb93a9af71f08559d8e38eb9162b40ac`. Nothing
fetched it.

`#menu11`, `#menu12` and `#menu13` are anchors into that one page, not three
sources. They are three logical SECTIONS of one HTML document, and the registry
holds one entry for it.

| Section | Heading as printed | Links | Scheme | Syllabus | Other |
| --- | --- | --- | --- | --- | --- |
| `#menu11` | UG Engineering Scheme and Syllabus 2025 (1st & 2nd semesters) | 87 | 4 | 71 | 12 |
| `#menu12` | UG 3rd to 8th semesters Scheme and Syllabus (2025)(Engg) | 93 | 55 | 37 | 1 |
| `#menu13` | 3rd to 8th semester Common Courses 2025 scheme | 12 | 0 | 12 | 0 |

**192 links, 192 distinct URLs, 0 duplicates, 0 unresolved scheme years.**
Scope, exactly as the page states it and not inferred: `#menu11` carries
**17 stream labels and no programme** — first year is stream-scoped; `#menu12`
carries **51 programme labels and no stream** — programme-scoped; `#menu13`
carries neither, being common courses.

Duplicate BINARIES cannot be reported: that needs the bytes, and none of these
192 documents has been retrieved.

### The CSBS 2025 documents, exactly as the page links them

| Document | URL |
| --- | --- |
| CSBS 2025 scheme, sem 3–8 | `https://vtu.ac.in/pdf/2025syll3to8/34csbssch.pdf` |
| CSBS 2025 syllabus, sem 3 | `https://vtu.ac.in/pdf/2025syll3to8/34cscommsyll.pdf` |

The scheme URL the brief named is confirmed by the page itself. The syllabus is
**shared**: the same `34cscommsyll.pdf` is linked from all eighteen programmes
of the Computer Science & Engineering Board of Studies, CSBS among them. It is
one binary with eighteen source references, which is the case §6 of the
ingestion model already handles.

### A defect this page exposed: 87 documents were invisible

The reader took the scheme year from a link's own text or its URL path. Run
over the real page, `#menu11` produced **86 of 87 links with `schemeYear:
null`** — because VTU files the 2025 first-year material under `/pdf/UG2024/`,
a path naming the year *before* the scheme, and the links themselves say only
"Syllabus".

So `vtu:sync --scheme 2025` selected **none** of those 87 documents, and said
nothing: a section whose documents all fail the year filter looks exactly like
a section with no documents.

The heading is the only thing on the page that states their year. The reader
now takes a section heading as a FALLBACK — never an override — and the whole
page measures:

| | Before | After |
| --- | --- | --- |
| Documents attributed to 2025 | 105 | **192** |
| Documents with no year at all | 355 | **28** |
| Years overridden | — | **0** |

Zero overridden is the property that matters: a document that states its own
year keeps it, so this can fill a null and can never contradict a source.

It is the HEADING and not the `#menuNN` wrapper, because one wrapper can hold
several: `#menu07` carries the 2022 first-year listing, the 2022 3-to-8 listing
and the 2022 common-course listing — three different semester scopes under one
anchor.

Two smaller findings from the same page: a heading naming several years
("2002 2006 2010 2014 2015 2017 and 2018 scheme…") establishes none, and the
semester-range reader could not read "3rd to 8**th** Semester" because it
required a word boundary immediately after the digit.

### A second gate hole: `--from` disabled the only check

`vtu:sync --from page.html` skips the acquisition gate, which is right for the
LISTING — nothing is fetched to read a file on disk. It was also the script's
only gate call, and the step after it downloads every PDF the listing names.

So `pnpm vtu:sync --scheme 2025 --from page.html` — the exact command this
phase calls for — would have fetched **179 documents** from vtu.ac.in with no
permission check, through the flag whose entire purpose is not fetching. The
download step is now gated independently. A dry run stays exempt because it
opens no socket, which is what makes building this graph offline possible.

```
$ pnpm vtu:sync --scheme 2025 --from <page.html>
  selected        59 scheme, 120 syllabus documents
SourceNotAuthorized: … access method "none" … refusal: 'not_permitted'

$ pnpm vtu:sync --scheme 2025 --from <page.html> --dry-run
  discovered      1142 PDF URLs on 1 page
  selected        59 scheme, 120 syllabus documents
  download          179 · "Would download."
```

### What is in the store now

The September 2025 circular is linked from `#menu11`, so its official URL is
established by the page rather than guessed, and it has been supplied:

| | |
| --- | --- |
| URL | `https://vtu.ac.in/wp-content/uploads/2025/09/2975.-2025-scheme-n-syllabus-updated-cir.pdf` |
| sha256 | `1494e1c17f84d8fe379d9f08e4d9b3f532ea6dfb8a9c48b58a49fcc878df838e` |
| bytes / pages | 253 036 / 1 |
| acquisition | `supplied` |

It is an image-only scan with no text layer, and it is a circular rather than a
scheme: it carries **no course rows**. What it establishes is supersession —
VTU's own words that the first-year 2025 files were "uploaded by replacing the
earlier files".

The store now holds **290 documents, 1 of them `supplied`**.

## What 2025 material is actually here

`scripts/source-inventory.ts`, run over the 2025-family documents held locally,
reads this off their pages. **SUPPLIED, not fetched** — these were already on
the machine, and nothing in this phase retrieved them.

| Code declared on the page | Model paper | Effect from | Semester | File |
| --- | --- | --- | --- | --- |
| `BEE105` | yes | — | first | `1BBEE105.pdf` ⚠ |
| `1BECHE105` | yes | — | first | `1BECHE105.pdf` |
| `1BESC104C` | yes | — | first | `1BESC104C.pdf` |
| `1BMATC101` | yes | 2025 | first | `1BMATC101.pdf` |
| `1BMATC201` | yes | 2025-26 | second | `1BMATC201.pdf` |
| `1BPHYS102` | yes | — | first | `1BPHYS102.pdf` |
| `1BPLC105E` | yes | — | first | `1BPLC205E.pdf` ⚠ |

⚠ The filename claims a code the page does not carry. The page is what is
trusted; a filename is not a document's statement about itself.

All seven have a text layer. Six declare a 2025-family code. Two carry an
explicit 2025 effect date, which is independent confirmation that the scheme is
real and in circulation.

**What they establish:** the course-code grammar, on real printed pages rather
than on codes quoted into a brief. The parser is tested against these codes
directly.

**What they cannot establish, at any quality:** credits, L/T/P, category,
option groups, semester membership, printed totals, applicability — anything
that makes a catalogue a catalogue. `source-scan.ts` states the limit
plainly: *"A question paper NEVER carries credits, L/T/P, scheme membership."*
They are also MODEL papers, which show an intended examination rather than a
sitting that happened.

They are therefore **not** supplied into the catalogue store. They are not
scheme or syllabus documents, their official URLs are not known here, and
`vtu:supply` requires a URL as a provenance claim rather than accepting a blank
one. Storing them would put rows in the catalogue's provenance chain that
cannot answer the questions the catalogue is asked.

## The local search, by content rather than by filename

Asked again whether the 2025 scheme bytes are anywhere on this machine, and
this time not trusting filenames:

| Where | Scanned | 2025-scheme documents |
| --- | --- | --- |
| `.vtu-store` cached extractions | 288 | **0** |
| Downloads, OneDrive, repository | 72 PDFs | **0** |
| Local archives (`.zip`) | 11 | **0** |

**The store.** Four of the 288 mention 2025 in a scheme context. All four are
2022-scheme documents whose "2025" is a `DDMMYYYY` revision stamp —
`05052025`, `26062025` — printed in a page footer. Each states *"Scheme of
Teaching and Examinations 2022"* in its own heading. None contains a `1B…`
code. A scan keyed on the digits alone would have called all four 2025 material.

**The filesystem.** Eight of the 72 PDFs carry a 2025 marker. Six are the
question papers listed above. Two are personal tax documents whose only match
is an assessment year; they were identified as unrelated private material and
not examined further.

**The archives.** `CSBS22 Docs.zip` holds the same eight 2022 documents as the
unpacked folder. No other archive contains VTU scheme material.

So the conclusion of the previous phase survives a much stricter test: the 2025
scheme documents are not here under any name.

## Mode B had no door for documents

The previous phase reported 2025 as blocked on bytes. Investigating how those
bytes would actually arrive turned up something worse: **there was no way to
hand one over.**

`acquire.ts` has described two acquisition modes since it was written and says
the difference is "ACQUISITION ONLY. What happens to the bytes afterwards —
hash, version, extract, normalize, validate, applicability — is identical."
That was true of the listing PAGE, which `vtu:sync --from` accepts. It was
false of the documents: `store.put` had exactly one caller in the repository,
inside the live downloader. So the only route to a document was the one the
registry refuses, and a person holding the official PDF was stuck.

`pnpm vtu:supply` is that door:

```bash
pnpm vtu:supply --file ./34csbssch.pdf                 --url https://vtu.ac.in/pdf/2025syll3to8/34csbssch.pdf
```

It never fetches, and contains no `fetch` — a test asserts that. The `--url` is
a provenance CLAIM about bytes somebody already holds, recorded so the document
can be cited and later compared against the official copy. It writes the same
content-addressed store and the same manifest the downloader writes, so
everything downstream cannot tell the difference except by reading the
provenance that says so.

Verified end to end against a real official VTU PDF (the 2022 CSBS scheme,
already held): 246 571 bytes, 14 pages, hash `60ed0ab331251d52…`, outcome
`already_present` — the content-addressed identity recognises bytes it already
has, and the run added no duplicate row. The manifest was restored afterwards,
so the store is byte-identical to before the check.

### A bug that run found

Supplying bytes the store ALREADY HOLDS went through a merge path that rebuilt
the entry from scratch: it stamped `acquisition: 'supplied'` and set `etag` and
`lastModified` to null.

Every one of the 289 documents in the store arrived by live fetch, so supplying
any of them — an ordinary thing to do with a copy you happen to hold — would
have relabelled a live acquisition as a supplied one, which is false about the
past, and destroyed the validators a conditional request depends on, so
`--changed-only` would re-download a document the server would have reported
unchanged.

The bytes were acquired however they were FIRST acquired, and handing over an
identical copy does not alter that. Supplying known bytes now adds a source
reference and advances `lastSeen`; it fills in a page count only where none was
recorded, and overwrites nothing. Covered by a regression test, checked by
mutation.

### The Mode B bargain, concretely

That verification run supplied the URL `…/pdf/2022syll/38csbssch.pdf`. The
manifest records the document's real URL as `…/pdf/2022_3to8/38csbssch.pdf` —
the one it was actually fetched from. Both were then attached to the same
document, because one binary legitimately has many source references (§6) and
nothing here can tell a correct URL from a plausible one.

That is the bargain working as designed rather than a defect: the human asserts
where the bytes came from, and the software never goes and gets them. It is
also a warning worth stating — **supply the URL you actually obtained the file
from, not the one that looks right.**

The manifest now records `acquisition: 'live' | 'supplied'`, `capturedAt`,
`sourceFilename` and `pageCount`. **Absent means not recorded.** The 289
documents already in the store predate the field, and stamping them `live` now
would invent a provenance claim about bytes nobody can re-examine.

## The acquisition gate had a hole

`vtu:discover`, `vtu:smoke` and `vtu:sync` each consult the source registry
before reaching vtu.ac.in. **`vtu:download` did not** — the one script whose
entire purpose is retrieving documents.

Its only check was `isFetchableUrl`, which verifies the protocol and that the
host **is** vtu.ac.in. That is the opposite of a permission check: it confirms
the target is the very source the registry has not authorised. So
`pnpm vtu:download --graph graph.json` would have fetched every PDF in the
graph with no permission check at all — not by subverting anything, by running
the documented command.

It now calls `requireFetchPermission` before it even reads the graph, `--dry-run`
included. And the audit that found this is now a test rather than a one-off
reading: every script containing `fetch(` or `downloadAll(` must also contain
`requireFetchPermission`. Removing the gate from `vtu:download` fails it —
checked by mutation, because the first version of that test could not fail at
all (a `` written as a literal backspace byte meant its pattern matched
nothing).

## What the discovery layer would do with 2025, unchanged

`vtu-scheme.ts` was already scheme-year-agnostic and needed no edit:

- `schemeYearOf` reads the year from the link text, then from the URL path
  (`/pdf/2025syll3to8/` yields `2025`), then from any bare year in the label.
- `kindOf`, `semestersOf` and the stream/programme classifiers never mention a
  year.
- `LABEL_IS_A_COURSE` has matched `^1?B[A-Z]{2,7}\d{3}[A-Za-z]?` since it was
  written, so a 2025 course row in the listing is already recognised as a
  course rather than invented as a programme.
- `vtu:sync --scheme 2025` and `vtu:validate --scheme 2025` are the same flags
  the 2022 path uses. No second crawler, no second pipeline.

## What changed in this phase

### 1. The reader recognises the 2025 course-code family

The scheme reader's code pattern was anchored at `B`, with a comment saying the
2025 family was excluded deliberately because "the leading digit is a different
scheme year, and reading it as this one would reattribute a course to the wrong
year."

The danger is real; refusing to read the row never addressed it. A discarded
row is not a row filed under the right year — it is a course missing from the
catalogue. A whole 2025 document parsed to **zero courses**, which is
indistinguishable from a document containing none.

What actually prevents reattribution is that `scheme_year` is part of a
course's identity and is read from the document's own heading. So the grammar
now carries an optional generation digit, expressed once and shared by the
compound, shared-tail and wrapped-code patterns built from it:

```ts
const GENERATION = String.raw`1?`;
const CODE_SHAPE = String.raw`${GENERATION}B[A-Z]{2,7}\d{3}[A-Za-z]?`;
```

The evidence is VTU's own printed codes from `34csbssch.pdf` — `1BCS301`,
`1BCS302`, `1BCS303`, `1BCSL306`, `1BCSL307A`, `1BCP308`, `1BNSS309`,
`1BMATDIP310` — which is one grammar with a generation marker, not two
grammars. Every one of them is now read; every one was previously rejected.

**This is a claim about code shape and nothing else.** No 2025 PDF has been
supplied, so nothing is claimed about 2025 column geometry, wrapped titles,
option groups, credit columns or printed totals. Those hazards remain
unmeasured.

The database needed no migration: `1BCSL307A` and `1BMATDIP310` already satisfy
the `code` CHECK constraint, which is asserted directly against Postgres.

### 2. 2022 is provably undisturbed

The grammar change was measured rather than argued. `parseScheme` was run over
all **288 cached 2022 extractions** before and after, digesting every course's
document, semester, code, credits, slot, alternative and title:

| | Before | After |
| --- | --- | --- |
| Documents | 288 | 288 |
| Courses read | 3923 | 3923 |
| Rows rejected | 3391 | 3391 |
| SHA-256 of all readings | `efa716b4919d001f…` | `efa716b4919d001f…` |

Identical. The published artifact `packages/vtu-catalogue/data/vtu-2022.json`
is byte-unchanged (`d1081e8621852e4a…`, 114 335 bytes, 187 courses,
0 conflicts, 1 alias, 19 documents).

### 3. An empty scheme no longer validates as clean

`vtu:validate --scheme 2025` against a catalogue with no 2025 rows reported
**VALIDATION PASSED**. Every scheme-scoped rule is written to stay quiet when
it has nothing to look at — right for an optional part of a catalogue, wrong
for the whole of one — and the verdict is `failures === 0`.

§48 and §74 gate publication on that verdict, so "never ingested" and
"validated clean" were indistinguishable at exactly the moment the distinction
matters. Asked for a scheme it holds no courses for, the validator now fails:

```
✗ no courses are stored for the 2025 scheme, so there is nothing to validate
  — an empty result is not a passing one
```

The guard is about the *requested* scheme, not about 2025: the same run against
an empty 2022 catalogue fails the same way, and a populated 2022 catalogue
passes exactly as before.

### 4. Scheme isolation is asserted, not assumed

No real cross-scheme code collision exists, because there is no second scheme.
§33 asks for exactly that case — prove the identity key includes the year
anyway. Added:

| Property | Where |
| --- | --- |
| `courseKey` separates the same code in two schemes | `packages/vtu-catalogue/test/catalogue.test.ts` |
| A scheme query never falls back to another scheme's rows | same |
| Every shipped catalogue is internally single-year | same |
| The 2022 artifact holds its published row counts | same |
| Two scheme years keep separate namespaces for one code | `services/api/test/vtu-catalogue-store.test.ts` |
| The real 2025 codes satisfy the `code` constraint | same |
| Adding a later scheme leaves the earlier one bit-identical | same |
| A scheme-scoped query returns only that scheme | same |
| A second run of a new scheme inserts nothing | same |
| Three concurrent writers on one identity insert once | same |

The "leaves the earlier scheme untouched" test photographs the 2022 rows
including `updated_at`, writes a whole 2025 scheme beside them, and asserts the
2022 rows are unchanged. That is §5's invariant as something the database can
be asked.

## Coverage matrix (§98)

Published catalogue, `vtu-2022.json`:

| Scheme | Programme / stream | Semesters | Scheme doc | Syllabus | Courses | Valid |
| --- | --- | --- | --- | --- | --- | --- |
| 2022 | Computer Science & Business System | 3–8 | yes | yes | 90 | published |
| 2022 | CSE Stream (CSE/ISC/BT) | 1–2 | yes | yes | 66 | published |
| 2022 | Civil Stream (CV/EV/TR/CC) | 1 | yes | — | 31 | published |
| **2025** | **Computer Science & Business System** | **—** | **not acquired** | **not acquired** | **0** | **no source** |
| **2025** | **first-year streams** | **—** | **not acquired** | **not acquired** | **0** | **no source** |

Credit basis across the 187 published rows: 63 `table`, 108 `slot`,
16 `alternative`.

## Difference matrix (§99)

| Metric | 2022 (published) | 2022 (full candidate) | 2025 |
| --- | --- | --- | --- |
| Documents selected | — | 292 | 0 |
| Documents downloaded / already present | — | 288 | 0 |
| Download failures | — | 4 | 0 |
| No text layer | — | 8 | 0 |
| Extracted | — | 280 | 0 |
| Course readings | — | 3603 | 0 |
| Distinct published rows | 187 | — | 0 |
| Distinct course codes | — | 2085 *(per [39](39_VTU_2022_COVERAGE.md), not re-measured here)* | 0 |
| Syllabi / modules / topics | — | 2014 / 8002 / 9065 | 0 / 0 / 0 |
| Option groups / memberships | — | 493 / 1919 | 0 / 0 |
| Aliases | 1 | 1 | 0 |
| Conflicts | 0 | 12 open *(per the sync ledger)* | 0 |
| Semester coverage | 1–8 across three scopes | — | none |

Four numbers that are not the same number, kept apart deliberately: documents,
course *readings*, distinct course *identities*, and distinct course *codes*.

## Student scheme resolution

The data model already supports two schemes end to end:

- `StudentProfile.schemeId` exists and is stored per student.
- `coursesForScheme(schemeId)` filters by year and **does not fall back**, so a
  scheme with no data returns nothing rather than the nearest scheme that has
  some. This is what makes §55 structural rather than a matter of care.
- `catalogue_courses` is keyed by `(scheme_year, programme, stream, semester,
  code)`.

**Integration gap, reported and not silently filled (§31, §56):** the profile
screen's scheme control offers one option, `vtu-2022`, hard-coded. A student
cannot select 2025, and there is no 2025 rule set for them to select. Adding an
option that resolves against an empty catalogue would present a broken state as
a working one, so no frontend change was made. When a 2025 catalogue exists,
this control and a 2025 rule set are the integration work.

Existing 2022 students are unaffected: nothing infers a scheme, and nothing
defaults to 2025.

## What is not established

- Any 2025 course code, title, credit, category, semester or option, beyond the
  eight codes VTU prints in the CSBS scheme and which are used here only as
  evidence of code *shape*.
- Any 2025 document's SHA-256, page count, printed totals or effective academic
  year.
- 2025 layout behaviour of any kind.
- Any 2022 ↔ 2025 equivalence. None is recorded, and `catalogue_aliases` is not
  used as a similarity mechanism.
- Applicability of any 2025 first-year document to any stream or programme.

## Publish decision

**2022 remains `PUBLISHED`. 2025 is `NO SOURCE` and must not be published.**

### The exact bytes still required

The door now exists, so each of these is one `vtu:supply` away. None of them is
present on this machine, and none may be fetched.

The listing page is supplied, so every URL below is now the page's own, not an
inferred one. **179 documents are selected for 2025** (59 scheme, 120
syllabus); the minimum CSBS target is the first two rows.

| Document | Official URL | Needed for |
| --- | --- | --- |
| **CSBS 2025 scheme, sem 3–8** | `https://vtu.ac.in/pdf/2025syll3to8/34csbssch.pdf` | every CSBS 2025 course, credit and option group |
| **CSBS 2025 syllabus, sem 3** | `https://vtu.ac.in/pdf/2025syll3to8/34cscommsyll.pdf` | modules and topics (shared across the CSE board) |
| 2025 first-year, `#menu11` | 87 documents under `/pdf/UG2024/` | semesters 1–2, stream-scoped |
| 2025 common courses, `#menu13` | 12 documents under `/pdf/2025commsyll3to8/` | courses shared across programmes |
| The listing page | `https://vtu.ac.in/b-e-scheme-syllabus/` | **supplied** ✓ |

The complete graph — every URL with its section, kind, year, programme and
stream — is written to `apps/web/.qa/vtu/graph-2025.json` by the dry run.

For each, supply the file and its official URL:

```bash
pnpm vtu:supply --file <the document> --url <the official VTU URL>
```

Then the rest of the pipeline runs unchanged — extract, normalize,
applicability, validate — because the only thing Mode B changes is how the
bytes arrived.

### Then, and only then

1. Verify `34csbssch.pdf` against its own pages: SHA, page count, programme,
   effective academic year, semester coverage, printed totals. Not the
   filename.
2. **Measure the 2025 layout before trusting a single extracted row.** This is
   the one thing that cannot be prepared in advance. The 2022 corpus taught
   that visually plausible PDFs carry hostile structure — codes split across
   text runs, credits displaced a full line, compound codes broken mid-code —
   and each cost real courses. Nothing here has seen a 2025 scheme table.
3. Establish first-year 2025 applicability from the documents' own headers,
   never from the fact that CSBS is an engineering programme.
4. Compare each printed semester total against deduplicated course identities.
5. Re-run `vtu:validate --scheme 2025`, which fails honestly until there is
   something to validate.

## Reproducing this

```bash
# Supply the official documents somebody already holds (nothing is fetched)
pnpm vtu:supply --file ./34csbssch.pdf \
                --url https://vtu.ac.in/pdf/2025syll3to8/34csbssch.pdf
pnpm vtu:supply --file ./34cscommsyll.pdf \
                --url https://vtu.ac.in/pdf/2025syll3to8/34cscommsyll.pdf

# Run the pipeline over held bytes only - the downloader is never called
pnpm vtu:sync --scheme 2025 --from ./listing.html --supplied-only

pnpm vtu:validate --scheme 2025      # fails only on the printed semester totals
pnpm vtu:validate --scheme 2022      # reports zero 2022 rows; never borrows 2025's
pnpm vtu:sync     --scheme 2025      # without --supplied-only: refuses at the gate
pnpm test                            # includes every isolation assertion above
```
