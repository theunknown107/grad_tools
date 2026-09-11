-- ===========================================================================
-- Supabase 0005 — a result row the student can name but not code
-- ===========================================================================
--
-- Authority: docs/08 §8.19 · Phase 7B.1 §6, §21, §47
--
-- Forward-only. 0001–0004 are released and are not edited. Nothing is dropped
-- and nothing is rewritten: every existing row carries a code, keeps it, and
-- satisfies the new constraint unchanged.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS WRONG
-- ---------------------------------------------------------------------------
--
-- `subject_code` was NOT NULL, so a student recording something of their own
-- had to supply a VTU code for it. Two kinds of row have none:
--
--   * an activity that simply is not a coded course — "Placement & Training"
--   * a course whose code the student does not have to hand
--
-- A code invented to get the row saved then reads on screen exactly like a
-- code the university issued, and is indexed as a subject beside real ones.
-- That is worse than the row being unstorable, which is why the same
-- reasoning already made `timetable_slots.subject_code` nullable in 0004.
--
-- ---------------------------------------------------------------------------
-- THE CODE IS NOT THE IDENTITY
-- ---------------------------------------------------------------------------
--
-- `id` is. What a row must be able to do is be RECOGNISED, and a title does
-- that as well as a code does — so the constraint asks for one or the other
-- rather than for a code specifically. `subject_title` is already NOT NULL,
-- so the check below is about substance, not presence: a title of spaces
-- names nothing.
--
-- This does NOT make the row official. `provenance` still says whether the
-- subject was matched to the catalogue, and a row with no code cannot have
-- been.
-- ===========================================================================

ALTER TABLE result_subjects
  ALTER COLUMN subject_code DROP NOT NULL;

ALTER TABLE result_subjects
  ADD CONSTRAINT result_subjects_can_be_recognised
    CHECK (
      coalesce(btrim(subject_code), '') <> ''
      OR coalesce(btrim(subject_title), '') <> ''
    );

COMMENT ON COLUMN result_subjects.subject_code IS
  'The course code, or NULL where the student is recording something that has '
  'none. Never the row identity — id is — and never invented to fill the '
  'column.';
