-- ===========================================================================
-- 0010 — The question-paper library
-- ===========================================================================
--
-- Authority: docs/08 §8.16 · docs/09 §9.17 · docs/17 §17.13 · M8 §7, §37
--
-- NO SECOND DOCUMENT MODEL (M8 §4).
--
-- A question paper IS a document. Everything the library needs about the file
-- itself — its rights, its presentation mode, its validation state, its page
-- count, its extraction — already lives on `documents` and `extracted_papers`,
-- and duplicating any of it would create two answers to the same question.
--
-- What was genuinely missing is TAXONOMY: which subject a paper belongs to,
-- and which sitting of the examination it is from. Nothing in the existing
-- schema records either, so a student could not have found a paper by subject
-- and year however the interface was written. That gap is what this migration
-- closes, and it closes nothing else.

-- ---------------------------------------------------------------------------
-- What kind of document this is
-- ---------------------------------------------------------------------------
--
-- `documents` was always generic — the source registry knows about question
-- papers, syllabus documents and results alike. The library must not list a
-- syllabus PDF as a question paper, so the distinction has to be recorded
-- rather than guessed at from a filename (M8 §7).
--
-- DEFAULT 'unknown', NOT 'question_paper'. Every document that exists today is
-- in fact a question paper, and defaulting to that would still be a guess
-- written into data — the exact move this project refuses everywhere else. An
-- unknown kind is invisible to the library, which is the safe direction: a
-- paper missing from a list is a smaller error than a syllabus presented as an
-- examination paper.

CREATE TYPE document_kind AS ENUM ('question_paper', 'syllabus', 'other', 'unknown');

ALTER TABLE documents
  ADD COLUMN document_kind document_kind NOT NULL DEFAULT 'unknown';

-- ---------------------------------------------------------------------------
-- Taxonomy
-- ---------------------------------------------------------------------------
--
-- TWO WAYS TO SAY WHICH SUBJECT, AND THEY ARE MUTUALLY EXCLUSIVE.
--
--   subject_id      the subject exists in the catalogue; scheme, branch,
--                   semester, code and title all come from that row
--   the loose columns  the subject is NOT in the catalogue, so what is known
--                      about the paper is recorded directly
--
-- The catalogue is deliberately incomplete — syllabus content is entered only
-- where a verified source exists (docs/32 OQ-016) — so a real paper for a
-- subject nobody has transcribed yet must still be findable. Without the loose
-- columns such a paper would have to either invent a subject row or carry no
-- taxonomy at all.
--
-- A CHECK keeps them exclusive. If both could be set they could disagree, and
-- then "which semester is this paper for" would have two answers with nothing
-- to decide between them.

ALTER TABLE documents
  ADD COLUMN subject_id uuid REFERENCES subjects (id) ON DELETE RESTRICT,

  -- Used only when `subject_id` is null. The code as printed on the paper.
  ADD COLUMN subject_code text CHECK (subject_code IS NULL OR length(subject_code) BETWEEN 1 AND 24),
  ADD COLUMN scheme_id    text REFERENCES schemes (id) ON DELETE RESTRICT,
  ADD COLUMN branch_id    text REFERENCES branches (id) ON DELETE RESTRICT,
  ADD COLUMN semester     smallint CHECK (semester IS NULL OR semester BETWEEN 1 AND 8),

  /*
   * The sitting.
   *
   * `exam_year` is the calendar year printed on the paper. NOTHING DERIVES IT
   * FROM A FILENAME (M8 §7) — "BCS403-2024.pdf" is a claim by whoever named the
   * file, and the year stays null until a human or a source states it.
   *
   * The lower bound is 2015 rather than something permissive: VTU's schemes do
   * not run back further in any form this product models, and a 1970 in this
   * column would be a data-entry slip rather than a genuinely old paper.
   */
  ADD COLUMN exam_year smallint CHECK (exam_year IS NULL OR exam_year BETWEEN 2015 AND 2100),

  /*
   * Free text, not an enum. VTU labels sittings inconsistently ("June/July
   * 2024", "Model Question Paper", "Supplementary"), and an enum would force
   * every unanticipated label into a wrong bucket — the same mistake that
   * scored four correctly-read papers as failures in M5A (docs/17 §17.11d).
   */
  ADD COLUMN exam_session text CHECK (exam_session IS NULL OR length(exam_session) BETWEEN 1 AND 60),

  ADD CONSTRAINT document_subject_is_stated_once CHECK (
    subject_id IS NULL
    OR (subject_code IS NULL AND scheme_id IS NULL AND branch_id IS NULL AND semester IS NULL)
  );

COMMENT ON COLUMN documents.subject_id IS
  'The catalogue subject. When set, scheme/branch/semester/code come from it and the loose columns must be null.';
COMMENT ON COLUMN documents.exam_year IS
  'The year printed on the paper. Never inferred from a filename.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
--
-- ONE index, covering the library's only listing query: publicly visible
-- question papers, newest sitting first. Every filter the interface offers
-- narrows that same result set.
--
-- Deliberately NOT added (M8 §37): a per-column index for each filter, and a
-- trigram index for search. At the sizes measured in docs/23 §23.14 the planner
-- has no use for them, and an index nobody's query reaches is write cost with
-- no read benefit. They go in when a measurement asks for them.

CREATE INDEX documents_library ON documents (exam_year DESC NULLS LAST, created_at DESC)
 WHERE document_kind = 'question_paper'
   AND presentation IN ('host', 'link')
   AND state IN ('validated', 'extracted');

CREATE INDEX documents_subject_lookup ON documents (subject_id)
 WHERE subject_id IS NOT NULL;
