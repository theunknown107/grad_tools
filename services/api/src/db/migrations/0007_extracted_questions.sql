-- 0007_extracted_questions.sql
--
-- Authority: docs/08 §8.9 · docs/09 §9.8 · docs/17 §17.17 · M5A.5 §3–§6, §15
--
-- Forward-only. 0001–0006 are not edited.
--
-- M5A.4 proved that positional extraction recovers question structure
-- deterministically (docs/17 §17.16). This makes that output DURABLE and
-- REVIEWABLE, which is the difference between a prototype and academic data
-- anything may be built on.
--
-- THE THREE CONFIDENCES ARE THREE DIFFERENT THINGS (M5A.5 §7)
--
--   documents.ocr_char_count etc.   how well the ENGINE read characters
--   *.confidence                    how much the GEOMETRY agreed
--   review_state                    what a HUMAN concluded
--
-- Every one of them can be high while the next is low: a crisp scan (engine)
-- of a table the parser misread (geometry), or a perfectly parsed row whose
-- mathematics is nonsense (human). Collapsing any two would let one stand in
-- for another, and "OCR was confident" would start to read as "this is
-- correct". They are three columns in three different places for that reason.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Where the geometry came from. Both feed one parser (docs/17 §17.16), but the
-- distinction is real provenance: a native token stream is the publisher's own
-- typesetting, an OCR one is our best reading of an image.
CREATE TYPE extraction_source AS ENUM ('native', 'ocr');

-- STRUCTURAL confidence, never an accuracy score. There is no ground truth for
-- character accuracy, so no number is invented (docs/32 ED-46); these states
-- describe how much of the structure agreed, which is answerable.
CREATE TYPE structural_confidence AS ENUM ('high', 'medium', 'low', 'review_required');

-- What a PERSON concluded. Deliberately not the same field as the machine's
-- `needs_review` flag: one is a parser observation, the other is a human act.
--
--   unreviewed  nobody has looked
--   accepted    a person read it and the machine value stands
--   corrected   a person changed something; see the reviewed_* columns
--   rejected    a person judged the record spurious. NOT deleted (M5A.5 §6)
CREATE TYPE question_review_state AS ENUM ('unreviewed', 'accepted', 'corrected', 'rejected');

-- ---------------------------------------------------------------------------
-- extracted_papers
-- ---------------------------------------------------------------------------
--
-- One row per (document, parser version). A paper is the RESULT OF ONE
-- EXTRACTION RUN, not a description of the document — which is why the
-- document's own metadata (title, hash, rights, presentation) is not copied
-- here. It is one join away and duplicating it would create two answers to the
-- same question (M5A.5 §3).

CREATE TABLE extracted_papers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,

  -- `unknown` is a real outcome and is stored as one. Forcing it into
  -- 'descriptive' is exactly the error that scored four correctly-read papers
  -- as failures during qualification (docs/17 §17.11d, M5A.5 §10).
  paper_format  paper_format NOT NULL,
  extraction_source extraction_source NOT NULL,

  /*
   * PROVENANCE, sufficient to audit or reproduce (M5A.5 §4).
   *
   * `parser_version` identifies the geometry + structural parser that produced
   * these rows. `extraction_version` orders the runs for one document, so an
   * upgraded parser adds a version rather than overwriting what a human may
   * already have reviewed.
   */
  parser_version     text NOT NULL CHECK (length(parser_version) BETWEEN 1 AND 64),
  extraction_version integer NOT NULL CHECK (extraction_version > 0),

  -- True for the run a reader should be shown. Older runs stay queryable.
  is_current    boolean NOT NULL DEFAULT true,

  page_count       integer NOT NULL CHECK (page_count >= 0),
  question_count   integer NOT NULL CHECK (question_count >= 0),
  mcq_item_count   integer NOT NULL CHECK (mcq_item_count >= 0),

  -- The MACHINE's flag. Distinct from every row's review_state below.
  needs_review  boolean NOT NULL DEFAULT false,
  review_reason text,

  created_at    timestamptz NOT NULL DEFAULT now(),

  /*
   * IDENTITY AND IDEMPOTENCE (M5A.5 §15, §16).
   *
   * Running the same parser over the same document twice is a no-op, enforced
   * here rather than trusted to the caller. A different parser version is a
   * different run and gets its own version — which is what makes reprocessing
   * safe: the old rows, and any human review recorded against them, are still
   * there afterwards.
   */
  UNIQUE (document_id, parser_version),
  UNIQUE (document_id, extraction_version),

  /*
   * The composite key the child tables point at.
   *
   * Redundant as a key on its own; it exists so `extracted_questions` and
   * `extracted_mcq_items` can carry the format and have the DATABASE refuse a
   * descriptive question on an MCQ paper. See the child tables (M5A.5 §14).
   */
  UNIQUE (id, paper_format),

  CONSTRAINT paper_review_has_reason CHECK (needs_review = false OR review_reason IS NOT NULL)
);

COMMENT ON TABLE extracted_papers IS
  'One deterministic extraction run over one document. A new parser_version creates a new extraction_version rather than overwriting the previous run or its human review.';

-- At most one current run per document, enforced rather than maintained.
CREATE UNIQUE INDEX extracted_papers_one_current
    ON extracted_papers (document_id) WHERE is_current;

CREATE INDEX extracted_papers_document ON extracted_papers (document_id, extraction_version DESC);

-- ---------------------------------------------------------------------------
-- extracted_questions — descriptive papers only
-- ---------------------------------------------------------------------------

CREATE TABLE extracted_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id      uuid NOT NULL,

  /*
   * Carried so the composite foreign key can constrain it. The CHECK pins it to
   * 'descriptive' and the FK ties it to the paper's own format, so an MCQ or
   * unknown paper CANNOT have descriptive questions attached — a rule that
   * would otherwise live in application code and hold only until someone wrote
   * different application code (docs/14 §14.3).
   */
  paper_format  paper_format NOT NULL CHECK (paper_format = 'descriptive'),

  ordinal       integer NOT NULL CHECK (ordinal >= 0),

  /* ---- machine values. Written once by the parser, never updated. -------- */
  question_number text,
  module          text,
  question_text   text NOT NULL,
  marks           smallint CHECK (marks IS NULL OR marks BETWEEN 1 AND 100),
  bloom_level     text,
  course_outcome  text,

  /* ---- provenance (M5A.5 §4) -------------------------------------------- */
  page_number   integer NOT NULL CHECK (page_number > 0),
  bbox_x        integer NOT NULL,
  bbox_y        integer NOT NULL,
  bbox_width    integer NOT NULL CHECK (bbox_width >= 0),
  bbox_height   integer NOT NULL CHECK (bbox_height >= 0),

  confidence    structural_confidence NOT NULL,
  needs_review  boolean NOT NULL DEFAULT false,

  /* ---- human review ------------------------------------------------------ */
  --
  -- The machine columns above are NEVER overwritten (M5A.5 §9). A correction is
  -- written beside the original, so the effective value is
  -- COALESCE(reviewed_x, x) and the two are always both visible. An audit that
  -- cannot see what the machine said is not an audit.
  review_state    question_review_state NOT NULL DEFAULT 'unreviewed',
  reviewed_question_number text,
  reviewed_module          text,
  reviewed_question_text   text,
  reviewed_marks           smallint CHECK (reviewed_marks IS NULL OR reviewed_marks BETWEEN 1 AND 100),
  reviewed_bloom_level     text,
  reviewed_course_outcome  text,
  review_note   text,
  reviewed_at   timestamptz,
  reviewed_by   text,

  created_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (paper_id, ordinal),
  FOREIGN KEY (paper_id, paper_format)
    REFERENCES extracted_papers (id, paper_format) ON DELETE CASCADE,

  -- A human act must say who and when, or it is not attributable.
  CONSTRAINT question_review_is_attributed CHECK (
    review_state = 'unreviewed'
    OR (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  ),

  -- 'corrected' means something actually changed. Otherwise it is 'accepted'.
  CONSTRAINT question_corrected_has_correction CHECK (
    review_state <> 'corrected'
    OR COALESCE(
         reviewed_question_number, reviewed_module, reviewed_question_text,
         reviewed_marks::text, reviewed_bloom_level, reviewed_course_outcome
       ) IS NOT NULL
  ),

  -- Corrections belong to a review. They cannot appear on an unreviewed row.
  CONSTRAINT question_corrections_need_review CHECK (
    review_state <> 'unreviewed'
    OR COALESCE(
         reviewed_question_number, reviewed_module, reviewed_question_text,
         reviewed_marks::text, reviewed_bloom_level, reviewed_course_outcome
       ) IS NULL
  )
);

COMMENT ON TABLE extracted_questions IS
  'Machine-extracted questions. Machine columns are immutable; human corrections live in the reviewed_* columns beside them, so the effective value is COALESCE(reviewed_x, x) and the original is never lost.';

CREATE INDEX extracted_questions_paper ON extracted_questions (paper_id, ordinal);
-- Serves the review queue: the rows a person still has to look at.
CREATE INDEX extracted_questions_review_queue
    ON extracted_questions (paper_id) WHERE review_state = 'unreviewed' AND needs_review;

-- ---------------------------------------------------------------------------
-- extracted_sub_questions
-- ---------------------------------------------------------------------------
--
-- The a/b/c parts. A separate table because a sub-question is a distinct record
-- with its own marks, page, box and review state — and because sub-question
-- identity is the thing OQ-019a was about, so it deserves to be addressable
-- rather than a column on its parent.

CREATE TABLE extracted_sub_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id   uuid NOT NULL REFERENCES extracted_questions (id) ON DELETE CASCADE,
  ordinal       integer NOT NULL CHECK (ordinal >= 0),

  label         text,
  sub_text      text NOT NULL,
  marks         smallint CHECK (marks IS NULL OR marks BETWEEN 1 AND 100),
  bloom_level   text,
  course_outcome text,

  page_number   integer NOT NULL CHECK (page_number > 0),
  bbox_x        integer NOT NULL,
  bbox_y        integer NOT NULL,
  bbox_width    integer NOT NULL CHECK (bbox_width >= 0),
  bbox_height   integer NOT NULL CHECK (bbox_height >= 0),

  confidence    structural_confidence NOT NULL,
  needs_review  boolean NOT NULL DEFAULT false,

  review_state  question_review_state NOT NULL DEFAULT 'unreviewed',
  reviewed_label    text,
  reviewed_sub_text text,
  reviewed_marks    smallint CHECK (reviewed_marks IS NULL OR reviewed_marks BETWEEN 1 AND 100),
  review_note   text,
  reviewed_at   timestamptz,
  reviewed_by   text,

  created_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (question_id, ordinal),

  CONSTRAINT sub_question_review_is_attributed CHECK (
    review_state = 'unreviewed'
    OR (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  ),
  CONSTRAINT sub_question_corrected_has_correction CHECK (
    review_state <> 'corrected'
    OR COALESCE(reviewed_label, reviewed_sub_text, reviewed_marks::text) IS NOT NULL
  ),
  CONSTRAINT sub_question_corrections_need_review CHECK (
    review_state <> 'unreviewed'
    OR COALESCE(reviewed_label, reviewed_sub_text, reviewed_marks::text) IS NULL
  )
);

CREATE INDEX extracted_sub_questions_question ON extracted_sub_questions (question_id, ordinal);

-- ---------------------------------------------------------------------------
-- extracted_mcq_items — MCQ papers only
-- ---------------------------------------------------------------------------
--
-- A SEPARATE TABLE, not descriptive questions with the columns left empty
-- (M5A.5 §13, §14). An MCQ paper has no modules, no Bloom's level, no CO and no
-- per-question marks — the format never contained them. Giving it those columns
-- would invite something downstream to read NULL as "missing" when the truthful
-- answer is "not applicable to this format".
--
-- Options are jsonb rather than a fourth table: they are always read with their
-- item, never queried independently, and never joined to anything.

CREATE TABLE extracted_mcq_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id      uuid NOT NULL,
  paper_format  paper_format NOT NULL CHECK (paper_format = 'mcq'),

  ordinal       integer NOT NULL CHECK (ordinal >= 0),
  item_number   integer CHECK (item_number IS NULL OR item_number >= 0),
  item_text     text NOT NULL,
  options       jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options) = 'array'),

  page_number   integer NOT NULL CHECK (page_number > 0),
  bbox_x        integer NOT NULL,
  bbox_y        integer NOT NULL,
  bbox_width    integer NOT NULL CHECK (bbox_width >= 0),
  bbox_height   integer NOT NULL CHECK (bbox_height >= 0),

  confidence    structural_confidence NOT NULL,
  needs_review  boolean NOT NULL DEFAULT false,

  review_state  question_review_state NOT NULL DEFAULT 'unreviewed',
  reviewed_item_number integer CHECK (reviewed_item_number IS NULL OR reviewed_item_number >= 0),
  reviewed_item_text   text,
  review_note   text,
  reviewed_at   timestamptz,
  reviewed_by   text,

  created_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (paper_id, ordinal),
  FOREIGN KEY (paper_id, paper_format)
    REFERENCES extracted_papers (id, paper_format) ON DELETE CASCADE,

  CONSTRAINT mcq_review_is_attributed CHECK (
    review_state = 'unreviewed'
    OR (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  ),
  CONSTRAINT mcq_corrected_has_correction CHECK (
    review_state <> 'corrected'
    OR COALESCE(reviewed_item_number::text, reviewed_item_text) IS NOT NULL
  ),
  CONSTRAINT mcq_corrections_need_review CHECK (
    review_state <> 'unreviewed'
    OR COALESCE(reviewed_item_number::text, reviewed_item_text) IS NULL
  )
);

CREATE INDEX extracted_mcq_items_paper ON extracted_mcq_items (paper_id, ordinal);
