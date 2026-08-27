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

Stage 2  OCR — asynchronous, see §17.15 for the implemented pipeline
           ├─ success → ocr_extracted; needs_review when the format is UNKNOWN
           └─ failure → retried, then ocr_needs_review; the document is never
                        discarded and stays available
```

> **Superseded, M5A.3.** This block previously read
> "OCR (Tesseract, eng, 300 DPI render)" and implied OCR ran inline. All three
> details were wrong once measured:
>
> | Was | Is | Why |
> |---|---|---|
> | `eng` only | `eng` or `eng+kan` per document | `eng` alone recovers **zero** Kannada (§17.11d) |
> | 300 DPI | **150 DPI** | 2.8× faster at comparable quality; these scans are low-resolution, so upsampling adds noise |
> | inline | **background job** | measured at ~1.07 s/page — see §17.15 |
> | one PSM | format-dependent | PSM 3 descriptive, PSM 6 MCQ |
>
> `extraction_confidence` as a number is **not implemented and will not be**: a
> numeric accuracy score would be invented rather than measured (§17.11d).
> Qualitative states carry the meaning instead.

`-layout` is used rather than plain extraction because question papers are strongly column- and table-structured, and preserving layout is what makes question-number and marks detection tractable. This was verified during Phase 1: the VTU regulation PDF was unreadable to a generic extractor and extracted cleanly with `pdftotext -layout`.

**A document that cannot be analysed is still useful.** It remains downloadable — students want the PDF far more than they want our analysis of it. Extraction failure degrades the intelligence features, never the library.

**Answered in M5A** (`32/OQ-019`, PARTIALLY VERIFIED): in the supplied 65-document corpus, **56 of 65 produced no meaningful text**. OCR is the main path for that sample, not an edge case. That figure describes one local corpus and does not generalise to VTU as a whole.

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

## 17.11b OCR feasibility benchmark (M5A.1) · **HISTORICAL**

> Kept as the record of how the engine was chosen. Two of its conclusions were
> superseded by M5A.2 and must not be read as current guidance:
> **`--psm 6` globally** (it is format-dependent) and **"Kannada: zero
> recovery"** (an artefact of having only `eng` installed — see §17.11d).
> Its engine choice and privacy reasoning stand.

Evidence gathering, not implementation. **No OCR is implemented, and nothing in
GradTools calls an OCR engine.**

### Method

10 scan-like documents from the supplied corpus, chosen for variation: 2–6
pages, 145–542 KB/page, six subject families, both question-paper formats, and a
Kannada-script paper. 33 pages, 11.4 MB total.

Two engines, **both fully local — nothing left the machine, no hosted API was
contacted, and no document was uploaded anywhere**:

| Engine | Version | Install | Runs on |
|---|---|---|---|
| Tesseract | 5.5.3 | `winget`, ~100 MB with `eng` | Windows, Linux, macOS |
| Windows.Media.Ocr | ships with Windows 11 | none — already present | **Windows only** |

Rasterization by `pdftoppm` (poppler 25.07.0) at 300 DPI, then 150 DPI for the
tuning comparison.

### A rubric correction, made mid-benchmark

The first rubric graded every paper against `Module-1..5`, `Q.n`, and the
marks/Bloom's/CO columns — and scored 4 of 10 documents POOR. Inspecting the
output showed the fault was the rubric's: **VTU 2022 uses at least two
question-paper formats**, and four of the sample were the second kind.

| Format | Marks | Structure |
|---|---|---|
| Descriptive | 100 | `Module-1..5`, `Q.1..Q.10`, marks / Bloom's level / CO columns |
| MCQ | 50 | 50 one-mark items, "Question Paper Version", "darken the circles", **no modules, no Bloom's column** |

Re-graded against the format each document actually uses:

| Engine | GOOD | PARTIAL | POOR | FAILED |
|---|---|---|---|---|
| Tesseract | 6 | 4 | 0 | 0 |
| Windows OCR | 7 | 3 | 0 | 0 |

The lesson generalises beyond OCR: a paper that does not match the expected
template is not a broken paper, and any future question-intelligence work has to
detect the format before assuming a structure.

### The finding that decides it

Raw character accuracy favours Windows OCR. **Structural fidelity favours
Tesseract, decisively.**

On a two-column descriptive paper, Windows OCR reads the left-hand label column
top to bottom and emits it detached from the question text:

```
Q.4
a.
b.
c.
b.
c.
Module-I
With usual notations, prove that tan (t) = r-
```

Tesseract with `--psm 6` keeps the row together, marks column included:

```
Show that the curves = a(1 +sin@) and r= b(1 - Sin®) intersect each other | 7 | L2 | CO1
```

For GradTools the second is usable and the first is not. The entire point of
reading a paper is knowing which question carries which marks and belongs to
which module; an engine that separates the labels from the text destroys exactly
that, however well it reads individual words.

Windows OCR does read some anchors better — it recovered the subject code
`BCS403` where Tesseract produced `, GBCSGHENE`, and found `USN` on 10/10
documents against Tesseract's 1/10.

### What is lost even when OCR succeeds

- **Kannada script: nothing at all.** Both engines recovered **0** Kannada
  codepoints from the Kannada paper and emitted Latin gibberish instead.
  Tesseract has no `kan` language pack installed and Windows has only en-GB and
  en-US. `BKBKK107` and `BKSKK107` are mandatory courses, so this is a real gap
  with a known fix (install the language data) that has **not** been done or
  measured.
- **Mathematical notation.** `tan⁡(∅)` became `tan = e $ v4 ayy`. Formulas do not
  survive, matching the finding for text-layer maths papers in §17.11a.
- **Table columns** survive partially under `--psm 6` and not at all otherwise.

### Cost, measured

| | Tesseract | Windows OCR |
|---|---|---|
| OCR only | 1 111 ms/page | 588 ms/page |
| Rasterization (300 DPI) | 1 901 ms/page | (shared) |
| **End to end** | **~3.0 s/page** | ~2.5 s/page |
| A 4-page paper | ~12 s | ~10 s |
| Peak memory | 126 MB | 197 MB |

**Rasterization, not OCR, is the bottleneck.** And 300 DPI is the wrong setting
for this corpus: at 150 DPI, across four documents, rasterization is ~3× faster,
OCR ~1.5× faster, and quality is comparable or better — the source scans are
low-resolution, so upsampling adds interpolation noise rather than information.
150 DPI recovered the subject code on 2 of 4 documents where 300 DPI recovered
it on none.

Even tuned, ~1.5–2 s/page cannot go in the synchronous request path that M5A
measured at 12–202 ms per document. **OCR is the trigger for background
processing that `ED-41` anticipated.**

### Recommendation

**(A) Local OCR with Tesseract, when OCR is implemented** — not now.

- **Accuracy:** adequate and, crucially, structurally usable. 6 GOOD / 4 PARTIAL.
- **Privacy:** decisive. The corpus is third-party academic material of
  unresolved rights (`OQ-008`) and student uploads are private by construction.
  Sending either to a hosted API would contradict the guarantee the Documents
  screen makes. A local engine keeps that guarantee true.
- **Cost:** zero marginal, versus roughly $1–1.50 per 1 000 pages for hosted OCR
  — before the privacy question, which is the one that actually decides it.
- **Operational complexity:** one binary plus language data; runs on Linux, so
  it deploys where the API deploys.
- **Windows OCR is not a candidate for production** despite being faster and
  free: it is Windows-only, and the server is not.

**Before any OCR ships, three things must be measured that this benchmark did
not:** Kannada accuracy with `kan` traineddata, the 150-DPI setting across a
larger sample, and whether OCR output is accurate enough for question
segmentation — which is a different and higher bar than "readable".


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

## 17.11c Two different quality questions, two different rubrics (M5A.2)

These are repeatedly confused, so they are separated here permanently.

| | **Native text extraction** (§17.11a) | **OCR** (§17.11b, §17.11d) |
|---|---|---|
| Applies to | PDFs that already carry a text layer | scans, which have none |
| Tool | `pdftotext` | Tesseract over a rasterized page |
| Cost | 12–202 ms per document | ~1.1 s per **page** |
| Failure mode | text is present but mangled (maths fonts) | text is invented from pixels |
| "GOOD" means | the characters are what the PDF actually stores | the characters plausibly match the printed page |
| Measured by | replacement-glyph ratio, structural anchors | structural anchors only |

**A native-text score and an OCR score are not comparable and must never be
averaged.** The same document cannot receive both: `pdftotext` yields either a
usable text layer or nothing, and only in the second case does OCR apply.

## 17.11d OCR qualification (M5A.2)

Still evidence only. **No OCR is implemented.**

### Sample

20 scan-like documents, 65 pages, from the supplied local corpus — chosen for
engineering diversity (2–6 pages, six subject families, both formats, both
scripts, best and worst scans). **Not statistically representative of VTU.**

### Configuration, corrected

M5A.1 preferred `--psm 6` at 150 DPI. The subset comparison shows **the right
mode depends on the format**:

| | PSM 3 (auto) | PSM 6 (uniform block) | PSM 11 (sparse) |
|---|---|---|---|
| Descriptive: complete marks rows | **13** | 5 | 14 |
| MCQ: numbered items (paper has 50) | 34 | **59** | 76 |

`--psm 3` for descriptive, `--psm 6` for MCQ. 150 DPI confirmed: **~1.07 s/page
end to end** (444 ms rasterize + 630 ms OCR), against ~3.0 s/page at 300 DPI in
M5A.1.

### Results — 12 GOOD, 8 PARTIAL, 0 POOR, 0 FAILED

Format detection: **20/20 correct**, after three iterations. The iterations are
the finding, not an embarrassment — each failure was a real property of the
corpus:

1. **Marks totals do not identify a format.** `BCY358A` is a *descriptive* paper
   worth 50 marks ("Answer any FIVE full questions, choosing ONE full question
   from each module"). A "Marks: 50 ⇒ MCQ" rule misclassifies it.
2. **The detector must tolerate OCR noise in the words it keys on.** On the
   Kannada paper "fifty questions" came back as "fifty ಕೈತ", so requiring a
   readable noun after "fifty" failed on a document read correctly in every
   other respect.
3. **Detection must be language-aware.** A Kannada-medium paper carries its
   instructions in Kannada, so an English-only detector returns UNKNOWN for a
   perfectly good document.

The resulting design — several independent cues per format, in both languages,
strongest side wins — is what §17.12 records.

### Kannada — resolved, with `kan.traineddata`

M5A.1 reported zero Kannada recovery. That was true for `-l eng` and remains
true; adding the language data changes it completely.

| Config | Kannada codepoints | English header | Max Marks | Verdict |
|---|---|---|---|---|
| `-l eng` | **0** | ✅ | ✅ | Kannada lost entirely |
| `-l kan` | 4 039 | ❌ | ❌ | Latin text destroyed |
| **`-l eng+kan`** | **3 922** | ✅ | ✅ | **both scripts survive** |

`eng+kan` is the answer for these papers, which are genuinely bilingual — an
English header over Kannada body text.

Recovered Kannada is real, not glyph soup: `ಸಾಂಸ್ಕತಿಕ ಕನ್ನಡ` (the subject),
`ಸೂಚನೆಗಳು` ("Instructions"), and
`ಎಲ್ಲ ೫೦ ಪ್ರಶ್ನೆಗಳಿಗೂ ಉತ್ಪರಿಸಿರಿ. ಪ್ರತಿ ಪ್ರಶ್ನೆಗೆ ಒಂದು ಅಂಕ.` — "Answer all 50
questions, one mark each." Question text is coherent:
`ಕಬ್ಬಿಗರ ಕಾವ್ಯ ಇದರ ಕರ್ತೃ ಯಾರು?` — "Who is the author of Kabbigara Kavya?".
Token statistics support this: 652 Kannada tokens, mean length 6.7 characters,
only 4% single-glyph — word-shaped, not noise.

**Verdict: GOOD for structure and discovery, PARTIAL for authoritative
transcription.** Per-glyph errors are visible even in the phrases above
(`ಉತ್ಪರಿಸಿರಿ` for `ಉತ್ತರಿಸಿರಿ`). **Caveat stated plainly: this was judged by
recognising known words and phrases, not by a fluent reader reviewing the whole
output. A Kannada speaker should confirm before anything depends on it.**

### Mathematics — unchanged, and decisive

Across three maths and physics papers: **0 Greek letters, 0 mathematical
operators, 0 superscripts, 0 subscripts.**

Question *stems* survive well — "Find the radius of curvature at the point…",
"Find the Maclaurin's expansion of log(1 + eˣ) upto the term containing…".
Mathematical *content* does not: `x²p² + xyp − 6y²` became `x’p? + xyp-6y7 4S`.

> **Text may be suitable for discovery but not for authoritative mathematical
> question reconstruction.**

No equation-correction layer is proposed. It would be a research project, and
the honest alternative is to treat maths papers as searchable but not
reconstructable.

## 17.12 Format detection must precede parsing (M5A.2)

VTU 2022 uses at least two question-paper formats, and the difference is
structural rather than cosmetic:

```
PDF -> text (native or OCR)
        |
   PaperFormatDetector          several cues per format, both languages
        |
   +----+--------+-----------+
   |             |           |
DESCRIPTIVE     MCQ      UNKNOWN
100 or 50 mk    50 mk     -> do not guess; hold for review
Module-1..5     50 items
Q.1..Q.10       4 options
marks/L/CO      no modules
```

**`UNKNOWN` must be a real outcome, not a fallback to the commoner format.** A
paper that does not match a known template is not a broken paper — the first
rubric in M5A.1 scored four correctly-read papers POOR for exactly that mistake.

**Not implemented.** This records the shape the parser must take when it is
built.

## 17.15 The OCR pipeline as built (M5A.3)

OCR is implemented, local, and **asynchronous**.

```
text_available ──► done. The PDF had its own text layer; nothing else runs.

ocr_required ──► POST /documents/:id/ocr ──► ocr_queued
                                                │
                                    worker claims (SKIP LOCKED)
                                                ▼
                                          ocr_processing
                                                │
                    rasterize 150 DPI ─► probe page 1 ─► detect format
                                                │
                                    tesseract, format-appropriate PSM
                                                ▼
                              ┌──── ocr_extracted        text looks dependable
                              └──── ocr_needs_review     unknown format, or maths
```

### Two lifecycles, deliberately separate

| Column | Question it answers |
|---|---|
| `documents.state` | is this file safe, and have we processed it |
| `documents.extraction_status` | how we got the text, and how far we trust it |

Collapsing them would make `extracted` mean both "we ran extraction" and "we
have usable text" — and a scan reaches `extracted` with no text at all.

### Configuration, all of it measured

| Setting | Value | Why |
|---|---|---|
| DPI | **150**, never silently raised | 2.8× faster than 300 DPI at comparable quality; the scans are low-resolution, so upsampling adds noise (docs/23 §23.3.4) |
| PSM | **3** descriptive, **6** MCQ | 13 complete marks rows vs 5; 59 numbered items vs 34 (§17.11d) |
| Language | `eng`, or `eng+kan` where Kannada is seen | `eng` alone recovers zero Kannada; `kan` alone destroys the Latin header; `eng+kan` everywhere would cost ~1.8× on every English paper |
| Unknown format | PSM 3 **and flagged for review** | A paper matching no template is not a broken paper, and must not be presented as cleanly read |

### Language detection is triggered by failure to classify, not by empty output

A Kannada page read with `eng` does **not** come back empty — it comes back as
confident Latin gibberish. An emptiness check accepts that happily and the
`eng+kan` retry never fires; this was observed on a real paper, which was
processed as `unknown`/`eng` until the trigger was changed to *"the detector
could not classify it"*. The retry then costs one extra page only for documents
that could not otherwise be identified.

### Maths is flagged even when OCR succeeds

A paper detected as mathematical is stored with `needs_review` and a plain-words
reason, because OCR recovers **zero** Greek letters, operators, superscripts or
subscripts (§17.11d). The text is real and useful for search; it is not the
original, and the UI says so.

Detection keys on the **subject and question stems**, not on symbols — the
symbols are exactly what does not survive, so looking for them would find
nothing on precisely the papers that need flagging.

### Verified end to end on real scans

| Document | Result | Format | Lang | PSM | Sections |
|---|---|---|---|---|---|
| `BCS403` (DBMS, poor scan) | `ocr_extracted` | descriptive | eng | 3 | 110 |
| `BKSKK107` (Kannada MCQ) | `ocr_extracted` | **mcq** | **eng+kan** | 6 | 56 |
| `BMATS101` (maths) | `ocr_needs_review` | descriptive | eng | 3 | 8 |

Three documents, 13 pages, drained in 18.6 s including database writes.

### The worker runtime

```
pnpm --filter @gradtools/api worker
```

A separate long-running process. It serves no HTTP, listens on no port, and is
reachable from nothing.

| Behaviour | Value | Why |
|---|---|---|
| Idle sleep | 3 s, **interruptible** | Not a busy loop. A plain `setTimeout` would make Ctrl-C wait out the full interval |
| Backlog | no sleep between jobs | Sleeping between items would only make a backlog longer |
| Stalled recovery | every 5 min, **and once at startup** | Well inside the 30-minute stall window. Running it first means a worker starting after a crash picks up what the dead one dropped, rather than waiting |
| Startup check | refuses to start without `tesseract` and `pdftoppm` | A worker that starts and fails every job is worse than one that does not start: it burns each job's retry budget and marks good documents unreadable for a reason unrelated to them |
| Worker id | `ocr-<8 random chars>` | Enough to tell two workers apart in a log. Never the hostname or username |
| Shutdown | first signal drains, second exits | Aborting does not cancel the in-flight job: a half-processed document would leave its row `processing` with sections partly written |
| Loop errors | logged, loop continues | A worker that exits on a database blip needs a supervisor to notice; better that it retries |

### Deliberately not built

No question segmentation, no module mapping, no embeddings, no prediction.
Sub-question identity is recovered only 3–4 times in 15–20 rows (§17.11d), so
anything keyed on "question 3(b)" would be built on the least reliable field
available.

## 17.16 Positional extraction (M5A.4)

Feasibility, answered with a working prototype. **No AI, no embeddings, no
semantic classification** — geometry and regular expressions only, because the
question was how much structure is recoverable *deterministically*.

### TSV, not hOCR — and the reason is the native path

| | Tesseract TSV | Tesseract hOCR |
|---|---|---|
| One page | 759 ms | 779 ms |
| Size | 20 733 bytes | 43 370 bytes |
| Parsing | split on tabs | XML |

Same information, same speed, half the size. But the decisive fact is that
**poppler's `pdftotext -tsv` emits the same column schema**, so a native PDF and
a scan can feed one representation. hOCR has no native counterpart.

### One representation, two sources

```
native PDF   pdftotext -tsv  ─┐
                              ├─► PositionedToken ─► line grouping ─► parser
scanned PDF  tesseract tsv   ─┘
```

They are not byte-compatible, and the three differences are the whole reason
`geometry.ts` exists:

1. **Column order differs.** Poppler emits `par_num, block_num`; Tesseract emits
   `block_num, par_num`. Parsing by index would silently swap two grouping keys.
   Both are parsed by **header name**.
2. **Units differ.** Poppler reports PDF points; Tesseract reports pixels at the
   rasterization DPI. Everything is converted to points so one set of geometric
   thresholds serves both.
3. **Poppler emits marker rows** (`###PAGE###`, `###FLOW###`) that are layout,
   not words.

**Line grouping is by vertical overlap, not by the tools' line numbers.** On a
two-column paper the question text and its marks column are different *blocks*,
and block line numbers restart — which is exactly why flattening loses the
association.

### Results on real papers

| Document | Source | Format | Q | sub-Q | marks | L | CO | MCQ |
|---|---|---|---|---|---|---|---|---|
| `1BESC104C` (2 model papers in one file) | native | descriptive | **20** | **47** | 67 | 67 | 67 | — |
| `1BMATC101` (maths) | native | descriptive | 12 | 33 | 42 | 42 | 0 | — |
| `BCHEM102` | OCR | descriptive | **10** | 11 | 19 | 19 | 19 | — |
| `BMATS101` (maths) | OCR | descriptive | 8 | 14 | 21 | 20 | 14 | — |
| `BCS403` (poor scan) | OCR | descriptive | 6 | 13 | 17 | 16 | 13 | — |
| `BENGK106` | OCR | mcq | — | — | — | — | — | 44 |
| `BKSKK107` (Kannada) | OCR | mcq | — | — | — | — | — | 27 |
| `BCY358A` (worst scan) | OCR | descriptive | **0** | 0 | 0 | 0 | 0 | — |

`1BESC104C` returns exactly 20 questions because the file genuinely contains
**two** model papers of Q1–Q10 each — verified by inspection, not assumed.
`BCHEM102` returns exactly 10.

### The sub-question answer — OQ-019a

| Approach | Sub-question labels |
|---|---|
| Flattened OCR text (M5A.2) | **3–4 of 15–20 rows** |
| Positional, native PDF | **47 across 20 questions** — essentially complete a/b/c |
| Positional, OCR scan | 11–14 per paper — **partial but far better** |

Position is what makes the difference: `a.` occupies its own narrow cell at a
predictable x, and flattening merges it into the question text. The parser looks
for a lone letter token near the left of a row *before* trying any inline
pattern.

The right-hand `marks | L | CO` columns are recovered the same way — by where
they are, not by a regex over a line that may have collapsed. A bare `6` in
prose and a `6` in the marks cell are indistinguishable in flat text.

### Two defects found by running the prototype

**Numbered instructions look exactly like questions.** "1. Answer any FIVE full
questions…" matched a bare question number and produced three false questions.
The discriminator is positional and needs no reading: an instruction has nothing
in the right-hand table. A first attempt also required "before the first Module
heading" and failed on the two-paper file, where the second paper's instructions
arrive with a module already set.

*The trade-off, stated:* a genuine question whose entire marks column was lost is
now skipped rather than kept. Across this corpus that removed 6 false questions
and cost none — but it is why `BCY358A`, the worst scan, returns **0** rather
than a handful of unreliable rows. That case is reported separately, never
averaged in.

**`L2` was being read as marks 2.** Stripping non-digits turned the Bloom's token
into a number. Caught by a synthetic fixture; it would have quietly corrupted
marks on every row where the marks cell itself was lost.

### Mathematics — structure survives, content does not

`BMATS101` yields 8 questions, 14 sub-questions, 21 marks and 20 Bloom's levels
while its formulas remain unreadable. The distinction is now demonstrated rather
than asserted:

> **text = partially usable · structure = usable · maths = unreliable**

### Kannada

`eng+kan` gives 27 MCQ items and readable Kannada question text. **Item numbering
is unreliable** — observed `8, 8, 8, 0, 20` where consecutive numbers belong —
because the leading digit of a Kannada-script line is frequently misread. The
text is usable for discovery; the numbering is not authoritative.

### MCQ is helped much less than descriptive

An MCQ paper is a single-column flow, so geometry adds little over flat text: 44
items of 50 for English, 27 of 50 for Kannada, with numbered instruction lines
still appearing as items and options grouped unreliably. **Positional extraction
is a descriptive-paper technique.**

### Confidence states — structural, never an accuracy score

| State | Rule |
|---|---|
| `high` | question number + text body + marks found **in the right-hand column** |
| `medium` | number and text found; marks missing or outside the marks column |
| `low` | inferred from a single weak cue — a sub-label with no owning question |
| `review_required` | cues contradict: two question numbers on one row, or marks outside 1–20 |

No numeric percentage, for the reason `ED-46` gives: there is no ground truth, so
a number would be invented. These states describe how much the *geometry* agreed,
which is answerable.

### Performance

| Stage | Cost |
|---|---|
| `pdftotext -tsv` (4-page native) | 32 ms |
| `tesseract tsv` (one page) | 759 ms |
| TSV parse (1 042 tokens) | 2.4 ms |
| Line grouping (130 lines) | 2.1 ms |
| Format detection | 0.6 ms |
| Structural parser | 1.9 ms |

**The whole positional layer costs ~7 ms.** A native 4-page paper is fully
structured in **39 ms**; a scan is dominated entirely by OCR. Nothing here needs
optimising.

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

## 17.17 Persisted question structure (M5A.5)

M5A.4 answered *can we?*. This answers *and then what?* — the parser's output
becomes durable, provenanced and reviewable.

```
PDF ─► native text | OCR ─► TSV ─► PositionedToken ─► lines ─► format
                                                              ─► parser
                                                              ─► ExtractedPaper
                                                              ─► database
                                                              ─► human review
```

### ONE RECOGNITION PASS, TWO OUTPUTS

Tesseract accepts several output configs in one invocation, so `txt tsv`
recognises once and writes both. The text is byte-identical to the old `stdout`
path (verified against a real scan; only the file writer's CRLF differs, and
that is normalised).

This matters because it is the difference between paying for OCR once and twice.
Asking for geometry separately would repeat a ~759 ms/page workload to recompute
information the engine had already produced and was about to discard.

| Path | Geometry from | Cost | Where structure is built |
|---|---|---|---|
| Native text | `pdftotext -tsv` | 32 ms / 4-page paper | Inline, in the process request |
| Scan | `tesseract ... txt tsv` | free — same pass as the text | In the OCR job |

### `pdftotext` is an ambiguous name

Xpdf ships one and poppler ships another, and **only poppler's supports
`-tsv`**. A machine with both on PATH silently gets whichever comes first, and
positional extraction then fails on every native document while text extraction
keeps working — observed on the development machine during this milestone's
real-document validation, where it produced 0 questions from two papers that had
yielded 20 and 12 in M5A.4. Both stages now honour `PDFTOTEXT_BIN`.

### Real-document validation

Seven papers, all local, none committed. `pnpm verify` green; every row below is
a measured run, not an estimate.

| Document | Source | Format | Q | sub-Q | MCQ | high | med | low | Persisted |
|---|---|---|---|---|---|---|---|---|---|
| `1BESC104C` (2 model papers) | native | descriptive | **20** | **47** | — | 20 | 0 | 0 | ✅ v1 |
| `1BMATC101` (maths) | native | descriptive | 12 | 33 | — | 5 | 0 | 7 | ✅ v1 |
| `BCHEM102` | ocr | descriptive | 10 | 11 | — | 9 | 1 | 0 | ✅ v1 |
| `BMATS101` (maths) | ocr | descriptive | 8 | 14 | — | 8 | 0 | 0 | ✅ v1 |
| `BENGK106` | ocr | mcq | — | — | 48 | 48 | 0 | 0 | ✅ v1 |
| `BKSKK107` (Kannada) | ocr | **unknown** | 0 | 0 | 0 | — | — | — | ✅ v1 |
| `BCY358A` (worst scan) | ocr | descriptive | **0** | 0 | — | — | — | — | ✅ v1 |

The native figures reproduce M5A.4 exactly (20/47 and 12/33), and a second run
of each returned `unchanged` — idempotency demonstrated on real documents, not
only on fixtures.

**`BCY358A` persists a paper with zero questions on purpose.** "We ran the
parser and it found nothing" is a result worth keeping; an absent row could not
be told apart from a document nobody has tried.

### Kannada: NOT VERIFIED in this run, and why

`BKSKK107` classified as `unknown` and yielded nothing. The cause is the
machine, not the pipeline: `kan.traineddata` is **not installed** here —
`tesseract --list-langs` reports `eng` and `osd` only.

What made this worth fixing rather than noting: `-l eng+kan` did **not fail**.
It returned English-only output byte-for-byte identical to an `eng` run, with
zero Kannada codepoints and no error, and 3 855 characters of confident Latin
text. A bilingual paper would have been reported as successfully read.

The engine's languages are now asked for before the request, once:

- Kannada present → `eng+kan`, unchanged from M5A.3.
- Kannada absent → `eng`, `needsReview = true`, and a reason that says the pack
  is missing and the text is not dependable.
- The worker warns at startup rather than letting each document discover it.

Kannada extraction itself remains as qualified in M5A.2. **Re-validating it here
requires installing the language pack, and has not been done.**

### Mathematics

Unchanged and now demonstrated on stored data: `BMATS101` yields 8 questions, 14
sub-questions and 8 high-confidence rows while its formulas remain unreadable.
Notation is stored EXACTLY as read — no repair, no normalisation, and nothing
sent to a model.

> **structure = usable · text = partially usable · maths = unreliable**
