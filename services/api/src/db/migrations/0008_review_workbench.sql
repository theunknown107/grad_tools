-- 0008_review_workbench.sql
--
-- Authority: docs/17 §17.18 · docs/21 §21.15 · M5A.6 §4, §5, §16, §17
--
-- Forward-only. 0001–0007 are not edited.
--
-- 0007 gave every record a review state and a place to put corrections. Working
-- through the review surface found three fields a reviewer needs and cannot
-- reach, all of them cases where the MACHINE column exists but the matching
-- REVIEWED column does not:
--
--   extracted_sub_questions.bloom_level     parsed, not correctable
--   extracted_sub_questions.course_outcome  parsed, not correctable
--   extracted_mcq_items.options             parsed, not correctable
--
-- A field the parser can get wrong and a person cannot fix is worse than a
-- field we never extracted: it looks reviewed once the row is accepted, while
-- the wrong value sits underneath it.
--
-- The rule from 0007 is unchanged and is why these are new columns rather than
-- edits: THE MACHINE WRITES ONCE AND A HUMAN WRITES BESIDE IT. Nothing here
-- makes a machine column writable.

-- ---------------------------------------------------------------------------
-- 1. Sub-questions gain the two correctable fields their parents already had
-- ---------------------------------------------------------------------------
--
-- A sub-question carries its own Bloom's level and CO on a VTU paper — the
-- right-hand table has a row per sub-part, not per question. The parser already
-- reads them positionally; only the correction path was missing.

ALTER TABLE extracted_sub_questions
  ADD COLUMN reviewed_bloom_level    text,
  ADD COLUMN reviewed_course_outcome text;

-- The three CHECKs from 0007 listed the correctable columns explicitly, so they
-- have to learn about the new ones or a correction to Bloom's alone would be
-- accepted on an unreviewed row and rejected as "corrected with no correction".
ALTER TABLE extracted_sub_questions
  DROP CONSTRAINT sub_question_corrected_has_correction,
  DROP CONSTRAINT sub_question_corrections_need_review;

ALTER TABLE extracted_sub_questions
  ADD CONSTRAINT sub_question_corrected_has_correction CHECK (
    review_state <> 'corrected'
    OR COALESCE(
         reviewed_label, reviewed_sub_text, reviewed_marks::text,
         reviewed_bloom_level, reviewed_course_outcome
       ) IS NOT NULL
  ),
  ADD CONSTRAINT sub_question_corrections_need_review CHECK (
    review_state <> 'unreviewed'
    OR COALESCE(
         reviewed_label, reviewed_sub_text, reviewed_marks::text,
         reviewed_bloom_level, reviewed_course_outcome
       ) IS NULL
  );

-- ---------------------------------------------------------------------------
-- 2. MCQ options become correctable
-- ---------------------------------------------------------------------------
--
-- Options are the substance of an MCQ item: an item whose stem is right and
-- whose options are scrambled is not a usable record. 0007 stored them and gave
-- no way to fix them.
--
-- jsonb for the same reason the machine column is jsonb: options are always
-- read with their item, never queried alone, and never joined to anything.
-- NULL means "not corrected", which is distinct from `[]` meaning "a person
-- says this item has no options".

ALTER TABLE extracted_mcq_items
  ADD COLUMN reviewed_options jsonb
    CHECK (reviewed_options IS NULL OR jsonb_typeof(reviewed_options) = 'array');

ALTER TABLE extracted_mcq_items
  DROP CONSTRAINT mcq_corrected_has_correction,
  DROP CONSTRAINT mcq_corrections_need_review;

ALTER TABLE extracted_mcq_items
  ADD CONSTRAINT mcq_corrected_has_correction CHECK (
    review_state <> 'corrected'
    OR COALESCE(reviewed_item_number::text, reviewed_item_text, reviewed_options::text)
       IS NOT NULL
  ),
  ADD CONSTRAINT mcq_corrections_need_review CHECK (
    review_state <> 'unreviewed'
    OR COALESCE(reviewed_item_number::text, reviewed_item_text, reviewed_options::text)
       IS NULL
  );

-- ---------------------------------------------------------------------------
-- 3. The review queue
-- ---------------------------------------------------------------------------
--
-- ORDER: review_required -> low -> medium -> unreviewed high (M5A.6 §7).
--
-- Deliberately NOT a score. A number would have to be invented, would imply a
-- precision nothing here has, and would let two incomparable things — how much
-- the geometry agreed, and how much work a record needs — be averaged into one
-- misleading figure (docs/32 ED-46). An ordering is what a queue actually
-- needs.
--
-- Stored as a function rather than repeated in every query, so the order is
-- defined once and a change moves the whole product at once.

CREATE FUNCTION review_priority(confidence structural_confidence) RETURNS smallint
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT CASE confidence
             WHEN 'review_required' THEN 0
             WHEN 'low'             THEN 1
             WHEN 'medium'          THEN 2
             ELSE 3
           END::smallint
  $$;

COMMENT ON FUNCTION review_priority IS
  'Queue ordering, not a score: review_required, low, medium, then high. See migration 0008.';

-- Partial indexes: the queue only ever asks for rows nobody has looked at, and
-- those are a shrinking minority of a growing table.
CREATE INDEX extracted_questions_queue
    ON extracted_questions (review_priority(confidence), paper_id, ordinal)
 WHERE review_state = 'unreviewed';

CREATE INDEX extracted_sub_questions_queue
    ON extracted_sub_questions (review_priority(confidence), question_id, ordinal)
 WHERE review_state = 'unreviewed';

CREATE INDEX extracted_mcq_items_queue
    ON extracted_mcq_items (review_priority(confidence), paper_id, ordinal)
 WHERE review_state = 'unreviewed';
