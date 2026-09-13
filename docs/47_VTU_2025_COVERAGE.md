# VTU 2025 coverage audit

Authority: measured at `1b31892` · raw 2022 evidence in
`.vtu-store/last-sync-documents.json` · companion to
[39_VTU_2022_COVERAGE.md](39_VTU_2022_COVERAGE.md)

## The headline

**No 2025 document has been acquired, so there is no 2025 catalogue — not a
published one, and not a candidate one.**

The acquisition gate refuses vtu.ac.in, and refusing it is the correct
behaviour rather than a fault to be worked around. What this phase delivered is
everything downstream of acquisition: the catalogue model already carried
`scheme_year` as identity, the reader now recognises the code family the 2025
scheme actually prints, the validator no longer reports a scheme it has no data
for as passing, and the isolation between two scheme years is asserted rather
than assumed.

| | 2022 | 2025 |
| --- | --- | --- |
| Scheme documents acquired | 288 | **0** |
| Course readings | 3603 | **0** |
| Published catalogue rows | 187 | **0** |
| Publish state | `PUBLISHED` | **`NO SOURCE`** |

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

| Document | Official URL | Needed for |
| --- | --- | --- |
| CSBS 2025 scheme, sem 3–8 | `https://vtu.ac.in/pdf/2025syll3to8/34csbssch.pdf` | every CSBS 2025 course, credit and option group |
| 2025 first-year scheme(s) | from `https://vtu.ac.in/b-e-scheme-syllabus/` (1st & 2nd sem 2025) | semesters 1–2, and the stream scope CSBS inherits |
| 2025 3–8 common courses | same listing | courses shared across programmes |
| CSBS 2025 syllabi | same listing | modules and topics |
| The listing page itself | `https://vtu.ac.in/b-e-scheme-syllabus/` | the discovery graph (`vtu:sync --from`) |

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
pnpm vtu:validate --scheme 2022      # the published catalogue
pnpm vtu:validate --scheme 2025      # fails: no courses stored
pnpm vtu:sync     --scheme 2025      # refuses at the acquisition gate
pnpm test                            # includes every isolation assertion above
```
