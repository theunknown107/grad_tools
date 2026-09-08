# VTU document ingestion

Authority: Phase 7D · Implemented across `06a0757…HEAD`

## What this replaces

Credits used to reach the product two ways: a cloud reference API that returns
nothing on a device that has never been online, and a scheme PDF the student had
to find on VTU's website and import by hand. The first failed silently; the
second is the manual catalogue maintenance this pipeline exists to abolish.

Now the catalogue is generated from VTU's own documents and shipped with the
build. A student imports a result card and their credits resolve — no scheme
PDF, no network.

## The pipeline

```
https://vtu.ac.in/b-e-scheme-syllabus/
        │
        ▼  pnpm vtu:discover        — one page, classified into a graph
   document graph (JSON)
        │
        ▼  pnpm vtu:download        — polite, resumable, deduplicating
   .vtu-store/documents/ab/abc….bin — content-addressed, gitignored
   .vtu-store/manifest.json         — hashes, URLs, validators, history
        │
        ▼  pnpm vtu:normalize       — extract (cached) → parse → normalize
   packages/vtu-catalogue/data/vtu-2022.json
        │
        ▼  bundled into the app
   result import → credits → grade → SGPA → CGPA
```

Each stage is a separate command so a failure in one does not force the others
to be repeated, and so a parser change can re-read documents already held.

## Discovery

`services/api/src/sources/vtu-scheme.ts`, an implementation of the existing
`SourceAdapter` contract — pure `parse`, `normalize`, `validate`, and a
`parserVersion`.

**A document graph, not a site crawl.** The listing page enumerates every UG
programme's scheme and syllabus; nothing needs following out into the rest of
the site. One page is read and classified.

**The programme is the table ROW, not the link.** A link reads only "3-8 Sem
Scheme". Reading anchors alone produced 244 "programmes" that were mostly
fragments of link text and found nothing at all for CSBS.

Against the live listing: 1134 unique PDFs, 339 in the 2022 scheme, 275
programme labels, 263 schemes, 678 syllabi, 192 unclassified, 14 common. An
unclassifiable document is still discovered and still reported.

## Download

`services/api/src/sources/vtu-download.ts`.

Every URL ends in exactly one state, and none is dropped:

| State | Meaning |
| --- | --- |
| `downloaded` | New bytes, now stored |
| `already_present` | This URL previously gave these bytes |
| `duplicate` | **Another** URL already gave these bytes |
| `changed` | This URL's bytes differ from last time — a new version |
| `failed` | Network or HTTP error, after retries |
| `blocked` | Not a VTU document, or not http(s) — never fetched |
| `invalid_document` | Retrieved, but the bytes are not a PDF |

**Politeness (§10).** One request at a time, 750 ms between, 60 s timeout, three
attempts with exponential backoff, 40 MB ceiling. Conditional requests using
ETag and Last-Modified where the server offers them, so `--changed-only` costs a
304 rather than a download.

**One failure never ends a run.** A broken link among a thousand documents is
normal.

### Flags

```
pnpm vtu:download --graph graph.json                 # everything in it
                  --dry-run                          # plan, fetch nothing
                  --changed-only                     # conditional requests
                  --limit 20                         # bounded first run
                  --programme CSBS                   # plus common documents
                  --kind scheme
```

## The document store

`services/api/src/sources/document-store.ts`. A document is stored under its own
SHA-256 and nothing else, in a two-character prefix directory.

That one decision gives three properties:

- **Deduplication** — the same PDF linked from six rows is one file (§6).
- **Versioning** — changed bytes hash differently, so the old version survives
  rather than being overwritten (§7).
- **Safety** — nothing derived from a URL or a header reaches the filesystem, so
  a filename cannot traverse out of the store (§37). `pathFor` throws on
  anything that is not 64 hex characters.

`DocumentStore` is an interface; the local directory is one implementation. The
store and manifest are gitignored: the repository keeps normalized records and
provenance, never a binary dump of VTU.

## Extraction and normalization

`services/api/scripts/vtu-normalize.ts`.

**Cached by (document hash, extractor version).** A new parser re-reads a
document without downloading it again (§35); bumping the version invalidates
exactly the extractions it affects.

**Native text only.** §13's ladder is native text → layout-aware → rendering →
OCR. VTU publishes text-layer PDFs, so the first rung carries them. A document
with no text layer is recorded as `no_text_layer` and left visible rather than
quietly approximated — OCR is not run by default.

Parsing is `@gradtools/vtu-catalogue`'s `parseScheme`, the same reader the web
app uses. That is the point of the package: one implementation of what a VTU
scheme says, shared by the crawler that writes the catalogue and the app that
reads it.

## The catalogue

`packages/vtu-catalogue/data/vtu-2022.json`, generated, committed as normalized
data with provenance on every row.

**Identity is not the course code alone (§18).** A course is
`(scheme year, programme, semester, code)`. `BCS503` is Theory of Computation in
CSBS 2022; nothing guarantees it means that elsewhere, and a 2025 record sits
beside a 2022 one without either overwriting the other.

Every course records **how its credits were established**:

| `creditBasis` | Meaning |
| --- | --- |
| `table` | The course's own row states them |
| `slot` | It is an option for an elective slot and takes the slot's |
| `alternative` | It shares one "A OR B" row with another course |

`relatedCode` names the slot or partner a borrowed figure came from.

**Conflicts are recorded, not resolved (§22).** Two documents that disagree both
stay in the record with their sources.

## Source precedence

Established by evidence, not by preference:

1. **The course's own syllabus page** — the definition of that course.
2. **The programme's scheme table** — authoritative for credits and structure.
3. **A scheme's elective option list** — a secondary mention.

That order settled `BCS358D`: the scheme's option list writes `BCSL358D`, the
syllabus page writes `BCS358D` with 1 credit and does not contain `BCSL358D` at
all, and the result card VTU issued says `BCS358D`. Recorded in
`apps/web/src/domain/course-aliases.ts` as data with the citation, never by
similarity — `BCS358C`, one letter away, resolves to nothing.

## OR rows

A first-year table offers some slots as a choice between two named courses and
prints **one** set of columns for the pair, on the row carrying the word "OR":

```
BENGK106   Communicative English
     OR                            1 0 0 0  01  50 50 100  01
BPWSK106   Professional Writing Skills
```

The marker is the word; its options are the codes immediately above and below;
the shared columns are the ones on the marker's **own** baseline. A pair whose
baseline carries no columns stays unresolved — it never reaches for the nearest
number, because that number belongs to another course.

## Commands

| Command | Does |
| --- | --- |
| `pnpm vtu:discover` | Reads the listing into a document graph |
| `pnpm vtu:download` | Retrieves, hashes, deduplicates, versions |
| `pnpm vtu:normalize` | Extracts and normalizes into the catalogue |
| `pnpm vtu:smoke` | Live check that the real source still works |

`vtu:smoke` is deliberately **not** part of the test suite: §39 forbids making
ordinary tests depend on the internet, and a test that fails on a train is
measuring the network rather than the code.

## What is not built yet

- `vtu:validate` and `vtu:sync` as commands — validation currently happens
  inside normalize (dedup, conflict detection) and the reconciliation document.
- Persisting the catalogue into the API's Postgres schema. The catalogue is a
  build artifact the app reads directly; the `documents`/`sources` tables exist
  but the crawler does not write to them.
- Syllabus extraction (§16). Syllabus documents are discovered and downloaded;
  only scheme documents are normalized.
- Programme namespacing across **streams**. Stream-wide documents all carry
  `programme: null`, so a Civil-stream and a CSE-stream first-year course share
  a namespace. No conflict has arisen because their codes differ, but the model
  does not yet distinguish them.
