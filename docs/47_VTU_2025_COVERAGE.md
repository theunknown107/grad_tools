# VTU 2025 coverage audit

Authority: this phase · measured at `7a63350` · raw 2022 evidence in
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
| Source documents acquired | 288 | **0** |
| Course readings | 3603 | **0** |
| Published catalogue rows | 187 | **0** |
| Publish state | `PUBLISHED` | **`NO SOURCE`** |

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
| Distinct course codes | — | 2085 | 0 |
| Syllabi / modules / topics | — | 2014 / 8002 / 9065 | 0 / 0 / 0 |
| Option groups / memberships | — | 493 / 1919 | 0 / 0 |
| Aliases | 1 | 1 | 0 |
| Conflicts | 0 | 12 open | 0 |
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

Blocking items, in the order they must be cleared:

1. Terms review (OQ-006), or supply the 2025 documents through the Mode B path.
2. Verify `34csbssch.pdf` per §64 — SHA, pages, programme, semesters, totals.
3. Measure 2025 layout against the known PDF hazards before trusting any
   extracted row.
4. Establish first-year 2025 applicability from the documents' own headers.
5. Re-run `vtu:validate --scheme 2025`; it will now fail honestly until there
   is something to validate.

## Reproducing this

```bash
pnpm vtu:validate --scheme 2022      # the published catalogue
pnpm vtu:validate --scheme 2025      # fails: no courses stored
pnpm vtu:sync     --scheme 2025      # refuses at the acquisition gate
pnpm test                            # includes every isolation assertion above
```
