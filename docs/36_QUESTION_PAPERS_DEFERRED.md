# 36. Question papers — removed on purpose, deferred to a greenfield Phase 8

**Status:** deferred · **Recorded at:** Phase 7B.1 closeout
**Supersedes:** the implementation described in `docs/17` and `docs/18`, which
describes code that no longer exists.

This note exists because the removal of the question-paper system is the kind of
decision that gets quietly undone. Four milestones spent effort deleting it, a
later brief asked for it back, and the only thing standing between those two
facts was a paragraph inside an architecture audit. This is that paragraph,
promoted to a document of its own.

---

## 36.1 What was removed, and when

The question-paper / PYQ system was dismantled deliberately, on instruction,
across four milestones:

| Milestone | What went |
|---|---|
| M10A.9 | Declared question papers scrapped — "no tokens, storage, dependencies, QA, UI or implementation time" |
| M10A.10 | The product surface: pages, routes, hooks, the search entry |
| M10A.11 | The query surface: the router, the intelligence modules |
| M10A.13 | The ingestion pipeline, and six tables |

The six tables dropped in `0013_drop_question_paper_extraction.sql`, children
first and without `CASCADE`:

`extracted_papers` · `extracted_questions` · `extracted_sub_questions` ·
`extracted_mcq_items` · `document_sections` · the OCR `jobs` queue

**Approximately 8,400 lines.** Every one of those milestones repeated the
instruction not to spend anything further on question papers.

---

## 36.2 It must not be restored

**Do not revert those commits, and do not treat the deleted code as a starting
point.** The migrations are forward-only, so a restoration would in any case be
new tables and new code rather than a revert — but the deeper reason is that the
old architecture is not the foundation the feature should be built on:

- It grew alongside the result-import pipeline and shared assumptions with it
  that no longer hold — in particular about OCR being a queued server-side job,
  which the local-first model this product settled on does not do.
- Its extraction model treated a paper as a flat list of questions, with
  sub-questions and MCQ items bolted on as separate tables. Module mapping and
  repeated-question detection both want a different shape.
- It predates the subject-identity work in M10A.1, so it matched subjects by
  means that decision now forbids.

Reading it for ideas is fine. Building on it is not.

---

## 36.3 The feature is still wanted

Deferred is not cancelled. Question papers remain in scope for GradTools, as a
**greenfield** implementation in a future Phase 8, after the core academic data
model is stable. The planned scope:

- paper metadata
- document ingestion
- question extraction
- normalisation
- syllabus / module mapping
- duplicate detection
- repeated-question detection
- frequency analysis
- historical priority
- model-paper support
- a later prediction / recommendation layer

---

## 36.4 What has to be true first

Phase 8 depends on things that are only now settling, which is most of why it
waits:

- **Subject identity.** Every one of the items above is keyed by subject, and
  `subjectKey` plus the reference catalogue is the only thing that makes a
  paper and a result talk about the same course.
- **Syllabus modules.** Module mapping needs `syllabus_modules` to be populated
  and trustworthy, not merely to exist as a table.
- **The source registry's legal gates.** A question paper is somebody's
  copyright. `robots_status`, `terms_status` and `rights_status` already exist
  and default to refusing; a paper pipeline is the first feature that would
  actually be blocked by them, and that is the point.

---

## 36.5 Housekeeping

`docs/17` and `docs/18` still specify the removed system in the present tense
and now describe code that does not exist. They should be marked historical
rather than deleted — they are the record of what was built and why it was
shaped that way, which is useful input to a greenfield design even though it is
not its foundation.

**No question-paper implementation code was written in Phase 7B or 7B.1, and
none should be until Phase 8 is explicitly opened.**
