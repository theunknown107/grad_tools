# 17 — PYQ and Document Processing

**Status:** Phase 1 draft
**Human decision `DEC-007`:** collect any papers obtainable; the human will supply an initial set; students may also upload, **with verification before storage** and explicit protection against decompression bombs and other destructive payloads.

---

## 17.1 Pipeline

```
INTAKE                VALIDATE              EXTRACT              STRUCTURE
┌──────────┐   ┌───────────────────┐   ┌──────────────┐   ┌────────────────┐
│ operator │   │ magic bytes       │   │ pdftotext    │   │ segmentation   │
│ import   │──►│ size / page caps  │──►│  -layout     │──►│ question split │
│          │   │ bomb guard        │   │      │       │   │ marks parse    │
│ student  │   │ active-content    │   │  no text?    │   │ module map     │
│ upload   │   │ rejection         │   │      ▼       │   │ dedup          │
└──────────┘   │ sha256 dedup      │   │  OCR         │   └───────┬────────┘
               └───────────────────┘   └──────────────┘           │
                        │ fail                                    ▼
                        ▼                                 ┌───────────────┐
                   REJECTED                               │ confidence ≥ τ │
                   (quarantine, reason logged)            └───┬───────┬───┘
                                                    published │       │ review queue
```

Nothing reaches the public library without passing validation, and nothing below the confidence threshold reaches it without a human decision.

## 17.2 Sources of documents

| Origin | Volume | Trust | Handling |
|---|---|---|---|
| Operator import (human-supplied set) | Initial corpus | High — the operator chose them | Bulk import with metadata from filenames, still fully validated |
| Public collection by the operator | Ongoing | Medium | Per-document source URL recorded |
| Student upload | Unbounded | **Untrusted** | Full hostile-input treatment plus review queue |

**All three paths run through identical validation.** Trusting the operator's files would mean maintaining two code paths, and the operator's files are the ones least likely to be tested against.

## 17.3 Validation — hostile input handling

This is the highest-risk input surface in GradTools (`13` §T-03). Every check, in order:

| # | Check | Limit | Failure |
|---|---|---|---|
| 1 | Proxy body limit | 20 MB | 413 |
| 2 | **Magic bytes** — file must start `%PDF-` | — | 415. The declared MIME type and the filename extension are **ignored entirely** |
| 3 | SHA-256 | — | Duplicate → link to the existing document, no reprocessing |
| 4 | Page count | ≤ 500 | Reject |
| 5 | **Decompression ratio** — total uncompressed stream size ÷ file size | ≤ 100:1 | Reject. This is the zip/PDF-bomb guard the human asked for |
| 6 | Absolute uncompressed cap | ≤ 500 MB | Reject |
| 7 | Object count | ≤ 100,000 | Reject — guards against object-graph explosion |
| 8 | **Active content** — `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, `/RichMedia`, `/OpenAction` with an action | present → reject | These have no legitimate place in a question paper |
| 9 | External references — remote URLs in `/URI`, `/GoToR` | present → strip and flag | Not fatal, but recorded |
| 10 | Encryption | encrypted → reject | Cannot be validated or extracted |
| 11 | Structural parse | must open cleanly | Malformed → reject |

### As built in M5

Checks 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 and 11 are implemented in
`services/api/src/documents/validate.ts`, at the byte level — the module opens
no PDF with a real parser. Every rejection path has a fixture and a test.

Two implementation notes worth recording:

- **The decompression check reads declared `/Length` values rather than
  decompressing.** Computing the true expanded size is precisely what a bomb
  wants; the declaration is enough to catch it without performing the attack.
- **Bytes are read as `latin1`, never `utf8`.** latin1 maps every byte to one
  code unit, so offsets survive and no sequence is silently replaced — utf8
  decoding of binary mangles exactly the regions a hostile file cares about.

A page-count bug was found here and fixed: `/Type /Pages`, the page-tree node,
contains `/Type /Page` as a substring, so a plain substring count reported one
page too many on every document.

**Then, and only then**, extraction runs — in a **child process**, never in the API process:

```
Child process limits:
  CPU        30 s
  Memory     512 MB (hard, enforced by the OS)
  Wall clock 60 s (parent kills on expiry)
  Network    none
  Filesystem read-only except one scratch directory
  Privileges non-root

Crash, OOM or timeout → document rejected, parent unaffected
```

This is what makes a poppler zero-day a rejected document rather than a compromised server.

**Serving:** validated documents are served from a **separate origin** with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`, so a PDF that survives everything above still cannot script the application origin.

### Extraction as built in M5

`pdftotext -layout -enc UTF-8` via `execFile` (no shell), with a 60 s wall-clock
kill, an 8 MB output cap and `SIGKILL` on timeout. Three reported outcomes:

| Status | Meaning |
|---|---|
| `text_available` | A usable text layer was read |
| `ocr_required` | Fewer than 24 meaningful characters per page — a scan |
| `extraction_failed` | The document could not be parsed |

**OCR is not performed.** `ocr_required` is a report, not a trigger (M5 §15).
The few stray glyphs a scan yields are discarded rather than stored, because a
handful of noise characters look like content and are worse than nothing.

Sectioning stops at pages and blank-line-separated blocks. Question segmentation
and module mapping are deferred to the intelligence milestone; a test asserts
sections carry no `questionNumber` or `marks`, so the absence is deliberate and
stays that way.

## 17.4 Text extraction

```
Stage 1  pdftotext -layout
           ├─ ≥ 200 characters extracted → text-layer PDF, extraction_confidence 0.9
           └─ < 200 characters           → likely scanned → Stage 2

Stage 2  OCR (Tesseract, eng, 300 DPI render)
           ├─ success → extraction_confidence 0.5–0.7, flagged for review
           └─ failure → document held as 'validated' but unextracted;
                        still downloadable, simply not analysed
```

`-layout` is used rather than plain extraction because question papers are strongly column- and table-structured, and preserving layout is what makes question-number and marks detection tractable. This was verified during Phase 1: the VTU regulation PDF was unreadable to a generic extractor and extracted cleanly with `pdftotext -layout`.

**A document that cannot be analysed is still useful.** It remains downloadable — students want the PDF far more than they want our analysis of it. Extraction failure degrades the intelligence features, never the library.

**Unknown until the corpus arrives:** whether real VTU papers carry a text layer or are scans. This determines whether OCR is an edge case or the main path, and it materially affects Milestone 5's effort. Recorded as `32/OQ-019` and as a validation task in `06` §6.8.

## 17.5 Question segmentation

VTU SEE papers have a **structural regularity** verified from the regulation (22OB 4.x):

> *"The question paper will have ten questions. Each question is set for 20 marks."*
> *"There will be 2 questions from each module."*
> *"The students have to answer 5 full questions, selecting one full question from each module."*

This yields a reliable structural mapping:

| Questions | Module |
|---|---|
| 1, 2 | Module 1 |
| 3, 4 | Module 2 |
| 5, 6 | Module 3 |
| 7, 8 | Module 4 |
| 9, 10 | Module 5 |

**This is the single most valuable fact in the entire PYQ pipeline.** Module mapping — the hard problem that would otherwise need semantic AI — is *given by the paper's structure* for standard SEE papers. Semantic methods become a fallback for non-standard papers, not the primary mechanism.

### Segmentation algorithm

```
1  Detect the header block → subject code, subject title, year, session, duration, max marks
2  Detect question boundaries by number pattern:  ^\s*(\d{1,2})\s*[.)]  and sub-parts a/b/c
3  Detect marks:  trailing (NN Marks) / [NN M] / (NN)
4  Detect module markers where present ("Module-1", "MODULE 1")
5  Assign module:
      explicit marker present        → module_mapping_method = 'structural', confidence 1.0
      else 10-question pattern holds → 'structural', confidence 0.9
      else                           → 'embedding' or 'keyword' fallback, confidence < 0.7
6  Validate the whole paper:
      question count in 8..12          (10 expected)
      marks total plausible (~100)
      every question has non-empty text
      failures → needs_review = true
```

Step 6's paper-level validation matters more than per-question confidence: a paper that extracted 3 questions instead of 10 has clearly failed, regardless of how confident each of those 3 looks.

## 17.6 Normalization

Applied before any comparison or clustering:

| Step | Purpose |
|---|---|
| Whitespace collapse, dehyphenation across line breaks | OCR and layout artefacts |
| Unicode NFKC, smart-quote and dash folding | Consistent comparison |
| Remove question numbers, marks annotations and "OR" separators from the text body | These are metadata, not content |
| Preserve mathematical notation and code blocks verbatim | Destroying them makes many questions meaningless |
| Lowercase **only** for the comparison key, never for storage | Display keeps the original |

The original extracted text is always retained alongside the normalized form. Normalisation is lossy and a reviewer must be able to see what the document actually said.

## 17.7 Duplicate and repeat detection

Two distinct problems, deliberately separated:

**Exact duplicates** (the same paper uploaded twice): SHA-256 on the file. Free, certain, no AI.

**Repeated questions** (the same question appearing across years — the actually interesting signal): a three-tier ladder, cheapest first.

| Tier | Method | Threshold | Cost |
|---|---|---|---|
| 1 | Normalized-text exact match | identical | Free |
| 2 | Trigram similarity (`pg_trgm`) | ≥ 0.85 | Cheap, in-database |
| 3 | Embedding cosine similarity (MiniLM, local) | ≥ 0.88 | Model inference |

Tiers 1 and 2 catch most real repeats, because VTU questions are frequently reused near-verbatim. Tier 3 runs only on pairs that tier 2 scored between 0.5 and 0.85 — the genuinely ambiguous band. This keeps embedding inference off the majority of comparisons and is what makes the local-model decision (`DEC-006`) computationally viable.

Comparisons are scoped to **one subject at a time** (hundreds of questions), which is why in-Node cosine over a `real[]` column is adequate and `pgvector` is deferred (`06` §6.3).

**Clusters are derived data.** They can be recomputed from questions at any time, and a change to the method version triggers recomputation rather than a migration.

## 17.8 Confidence and review

| Signal | Weight |
|---|---|
| Extraction method (text layer vs OCR) | High |
| Paper-level structural validation passed | High |
| Question count in the expected range | High |
| Marks total plausible | Medium |
| Module mapping method (structural vs semantic) | Medium |
| Subject code recognised in reference data | Medium |

```
confidence ≥ 0.85              → auto-publish
0.60 ≤ confidence < 0.85       → publish the DOCUMENT, hold the EXTRACTED QUESTIONS for review
confidence < 0.60              → full review queue
student upload, any confidence → operator review before publication
```

The middle band matters: a paper that extracted poorly is still worth reading, so the PDF is published while the derived analysis waits for a human. Students get the paper immediately; the intelligence features wait for accuracy.

## 17.9 Review queue

The operator sees, per item: the rendered PDF page beside the extracted text, the parsed questions with their confidence, the proposed module mapping and its method, and the specific validation warnings.

Actions: approve, edit-and-approve, reject with reason, or reprocess with a different method.

Every decision is audited (`09` §audit_records). Approved corrections become fixtures: a manually corrected extraction is added to the regression corpus so the same failure mode is measurable next time.

## 17.10 Storage and reprocessing

| Artefact | Where | Mutable? |
|---|---|---|
| Original PDF | Object store, keyed by SHA-256 | **Never** |
| Extracted raw text | Database | Replaced on reprocessing |
| Questions | Database, stamped with `method_version` | Replaced on reprocessing |
| Manual corrections | Database, flagged `mapping_method='manual'` | **Preserved across reprocessing** |
| Clusters | Database, derived | Recomputed freely |

**Reprocessing rule:** when a parser improves, documents are reprocessed — but human corrections are never overwritten by machine output. A `manual` mapping wins over any recomputed value. Losing an operator's corrections to an automated rerun would make the review queue pointless work.

## 17.11 Licensing and redistribution — two corpora, one pipeline

**Unresolved and genuinely important.** Whether VTU question papers may be redistributed by a third party is **NOT VERIFIED** (`32/OQ-008`).

**This does not block GradTools.** It blocks exactly one thing: *public redistribution of third-party documents.* Resolved (`DEC-010`) by separating two concepts that share the entire processing pipeline but differ in one field:

| | **Experimental / private corpus** | **Public paper library** |
|---|---|---|
| Purpose | Development, pipeline validation, test fixtures, the operator's own use | Student-facing downloadable library |
| Contents | Operator-supplied documents, synthetic fixtures, a student's own uploads visible only to them | Documents with verified rights |
| Redistribution | **None** — never served to another user | Served to all users |
| Rights required | None beyond the operator's own possession | **Verified provenance and permission** |
| Status | **Available now** — M5 proceeds | **Disabled until `OQ-008` is resolved** |
| Gate | — | `documents.publication_tier = 'public'` requires a recorded rights determination |

**Schema expression** (`09` §9.6): `documents` carries a `publication_tier` of `private` (default) or `public`. Analysis derived from private documents — question extraction, clustering, frequency — is computed and stored normally, because computing statistics over a document you lawfully possess is not redistribution. What is gated is *serving the file, and serving question text extracted from it, to another user.*

**Consequences that make this workable:**
- The document pipeline (`17` §§1–10) is built and validated in M5 regardless of the licensing answer.
- A student's own upload is always visible to that student; publishing it to others requires the public tier.
- If `OQ-008` resolves negatively, GradTools ships with a private corpus and **link-only** public entries — metadata, provenance and a link to the original location — plus analysis where permissible.
- If it resolves positively, flipping documents to the public tier is a data operation, not a rewrite.

**Nothing is served publicly by default.** The tier defaults to `private`, so an omission fails closed.

### 17.11.1 As built in M5

Expressed as constraints in migration `0004`, not as application logic:

```sql
CONSTRAINT document_host_requires_rights CHECK (
  presentation <> 'host'
  OR (rights_status = 'permitted' AND rights_determined_at IS NOT NULL))

CONSTRAINT document_user_private_stays_private CHECK (
  rights_status <> 'user_private' OR presentation = 'private')

CONSTRAINT document_link_requires_url CHECK (
  presentation <> 'link' OR source_url IS NOT NULL)

CONSTRAINT document_stored_only_when_held CHECK (
  presentation IN ('host','private') OR storage_key IS NULL)
```

Four presentation modes replace the two-tier flag, because "we have it and may
share it" and "we know where it is" are different states and the second is the
useful one while `OQ-008` is open:

| Mode | Meaning | File held? |
|---|---|---|
| `host` | Permission recorded; we serve it | yes |
| `link` | Metadata plus the original URL | **no** — refused by constraint |
| `private` | The uploader's own copy | yes |
| `blocked` | Cannot be used safely | no |

`private` is the default, so an omission fails closed. **While `OQ-008` is
unresolved, no document can legitimately reach `host` at all**, and a
`user_private` document cannot be made public by any combination of fields — a
test asserts that even an `UPDATE` flipping an existing private document is
refused.

`link` deliberately refuses a stored file. Holding the bytes of a document we
have no permission to redistribute is the redistribution risk, not the metadata.

**No route serves a document file.** A test walks `/file`, `/download`,
`/content` and `/raw` on a real document id and asserts 404 on each.

Interim handling, designed so the answer can be applied later without rework:
- Every document stores `source_url` and `license_note` recording what is known about its origin.
- Student uploads require an affirmation that the uploader may share the document.
- A takedown path exists: any document can be unpublished immediately, with the action audited.
- **Before the paper library is publicly accessible in Alpha**, this question must be answered, because a public library of possibly-restricted material is exactly the risk that ends a college conversation.

Options if redistribution proves impermissible: link-only (metadata and analysis, with the student fetching the document from its original location); analysis-only (frequency data derived from papers without hosting them); or seek permission. The data model supports all three, because `Document` and `QuestionPaper` are separate entities (`08` §8.5) — the analysis survives without the file.

## 17.11a As built in M5A — the private path, measured on real documents

The pipeline is implemented for the **private** path only, and was exercised
against a supplied corpus of **65 real academic PDFs** (gitignored, never
committed, never redistributed).

### The order, which is the security property

```
import -> hash -> validate -> (reject)  | (QUARANTINE -> store -> validated)
                                                       -> extract -> sections
```

Nothing is stored before it is validated. A rejected file leaves a database row
saying what was refused and why, and **no bytes on disk** — rejection is
auditable without retaining the thing that was rejected. `quarantined` is the
state a document is created in and extraction refuses to run on it, so a storage
failure leaves a document that cannot be processed rather than one that looks
validated with nothing behind it.

### What the real corpus showed

| Outcome | Count |
|---|---|
| `text_available` | 9 |
| `ocr_required` | 54 |
| Rejected — not a PDF at all | 2 |

**56 of 65 produced no meaningful text.** Precisely that, and no wider claim:
one local sample (`32/OQ-019`, PARTIALLY VERIFIED).

The two rejections are worth noting: both were **HTML pages carrying `<script>`,
saved with a `.pdf` name**. The magic-byte check caught them, which is exactly
the case §17.3 check 2 exists for — and it turned up naturally in a real corpus
rather than in a contrived fixture.

### Two validator defects found by real documents

Both were **false positives that rejected genuine question papers**, and both
were only discoverable by running real files:

| Defect | Effect | Fix |
|---|---|---|
| `/JS` matched as a plain substring | 3 papers rejected. `/JS` is two characters and appears by chance in compressed image streams; every observed hit was followed by binary noise, not a delimiter | Match complete **PDF name tokens** — the marker must be followed by a PDF delimiter or whitespace |
| Any `/OpenAction` rejected | 4 papers rejected. `/OpenAction [3 0 R /FitH null]` is a benign "open at this view" destination produced by ordinary authoring tools | §17.3 check 8 always said "`/OpenAction` **with an action**". Only a dictionary carrying an `/S` action subtype — or an unresolvable indirect reference — is refused |

Acceptance went from 56/65 to **63/65** with no loss of protection: the hostile
fixtures (embedded JavaScript, decompression bomb, encrypted, truncated,
non-PDF) are all still rejected. A validator that refuses 12% of legitimate
input is not a strict validator, it is one people learn to work around.

### Extraction quality, sampled and graded

Ten documents were inspected rather than merely counted. Non-zero text is not
the same as good extraction.

| Document | Pages | Status | Quality |
|---|---|---|---|
| Biology for Engineers | 2 | `text_available` | **GOOD** |
| Engineering science (`1BESC104C`) | 4 | `text_available` | **GOOD** |
| Physics (`1BPHYS102`) | 2 | `text_available` | **GOOD** |
| DBMS solutions | 36 | `text_available` | **PARTIAL** — clean text, but no module labels to anchor structure |
| Maths (`1BMATC101`) | 2 | `text_available` | **POOR** |
| 4 scanned papers | 2–6 | `ocr_required` | n/a — correctly identified, not reported as failures |
| `Jan-2024.pdf` | — | rejected | n/a — HTML, not a PDF |

**What survives:** page separation (form feeds match the page count exactly),
module headings (`Module-1`…`Module-5`), question numbering (`Q 1.`, `a`, `b`,
`c`), the `USN` header, and the marks/L/CO column headers.

**What does not:** mathematical notation. The two maths papers lose **15–17% of
their characters to U+FFFD replacement glyphs** — the maths font has no usable
encoding, so formulas are destroyed while surrounding prose extracts cleanly.
Every other sampled document had **zero** replacement characters. This is a
per-document-type problem, not a general one, and it means a maths paper's text
is not trustworthy input for anything downstream.

**Table structure is mangled.** `-layout` preserves horizontal position, but the
marks/level/outcome columns break across lines and interleave with question
text. Recovering them needs positional extraction, not more parsing of this
output.

### What is deliberately absent

No OCR. `ocr_required` is a **reported outcome**, not a trigger: 54 documents in
this corpus carry no text, and OCR-ing them silently would make "text we read"
and "text we guessed" indistinguishable at exactly the moment that distinction
starts to matter. **Future OCR required** (`32/OQ-019a`).

No question segmentation. Sectionizing stops at pages and blank-line-separated
blocks. Given that a maths paper loses a sixth of its characters, inferring
question boundaries from this text would be building on sand.

## 17.12 Testing

| Test | Method |
|---|---|
| Validation rejects a decompression bomb | Synthetic bomb PDF in fixtures; must reject without exhausting memory |
| Validation rejects non-PDF with a `.pdf` name | Fixture |
| Validation rejects embedded JavaScript | Fixture |
| Extraction sandbox survives a malformed PDF | Fixture; the parent process must remain healthy |
| Segmentation on a standard 10-question paper | Golden fixture → 10 questions, correct module mapping |
| Segmentation on a malformed paper | Must flag `needs_review`, never emit confident wrong output |
| OCR path | Scanned fixture → text with reduced confidence |
| Duplicate detection | Identical file twice → one document |
| Repeat detection | Same question across two years → one cluster |
| Normalization | Unicode, hyphenation and whitespace variants → identical comparison key |
| Manual-correction preservation | Reprocess after a correction; the correction must survive |

**Synthetic fixtures are used for the security tests** (bombs, malformed structures) because they must be deterministic and safe to commit. Real papers are used for accuracy tests once available, subject to §17.11.

---

## 17.13 Quarantine holds for publication (M5.1)

§17.1's lifecycle is quarantine-first, but M5 enforced only the rights half of
publication. A document could be marked `host` or `link` while still
`quarantined`, i.e. before its bytes had been checked.

Two independent preconditions, both required:

| | Question | Enforced by |
|---|---|---|
| `presentation` | May we show it at all? | `document_host_requires_rights`, `document_user_private_stays_private` |
| `state` | Is it safe to show? | `document_public_requires_validation` |

Having permission to show a document says nothing about whether it is safe to
show, and the reverse is equally true. Only `validated` and `extracted`
documents can be public; `quarantined`, `rejected`, `private` and `blocked` are
not.
