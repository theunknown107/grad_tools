-- ===========================================================================
-- Supabase 0004 — a timetable schedules more than courses
-- ===========================================================================
--
-- Authority: docs/08 §8.19 · Phase 7E Workstream B §21–§28
--
-- Forward-only. 0001–0003 are released and are not edited. Nothing is dropped
-- and nothing is rewritten: every existing row is a course, keeps its
-- `subject_code`, and gets `activity = NULL` by default.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS WRONG
-- ---------------------------------------------------------------------------
--
-- `subject_code` was NOT NULL, so a slot had to name a course. A real college
-- timetable does not agree: the Semester 5 V(B) document schedules "Value
-- added Course", "Placement & Training" and "ESEVM" in the same grid as
-- Computer Networks, and its own subject table defines none of them.
--
-- Those hours were read correctly, shown on the review screen, and then
-- dropped at save — because the only way to store one was to invent a code.
-- An invented code is worse than the lost row: it would be indexed as a
-- subject, offered for attendance, and printed beside real VTU codes with
-- nothing to say it was ours rather than the university's.
--
-- ---------------------------------------------------------------------------
-- TWO COLUMNS, ONE OF THEM ALWAYS SET
-- ---------------------------------------------------------------------------
--
--   a COURSE    subject_code = 'BCS502',  activity = NULL
--   an ACTIVITY subject_code = NULL,      activity = 'Placement & Training'
--
-- The CHECK is what makes this a model rather than two loose nullable columns:
-- a row with neither is unnameable and a row with both is two claims about one
-- hour. Neither can be written.
--
-- A BREAK is not here at all. Short break and lunch are properties of the
-- imported document's time columns, not hours in a student's week, and they
-- never became rows in this table.
-- ===========================================================================

ALTER TABLE timetable_slots
  ALTER COLUMN subject_code DROP NOT NULL;

ALTER TABLE timetable_slots
  ADD COLUMN IF NOT EXISTS activity text
    CHECK (activity IS NULL OR length(activity) BETWEEN 1 AND 80);

-- Exactly one of the two, on every row, old and new.
ALTER TABLE timetable_slots
  ADD CONSTRAINT timetable_slot_names_a_course_or_an_activity
    CHECK (num_nonnulls(subject_code, activity) = 1);

COMMENT ON COLUMN timetable_slots.subject_code IS
  'The course this hour teaches. NULL where the hour is a scheduled activity '
  'the timetable names but no subject table defines.';

COMMENT ON COLUMN timetable_slots.activity IS
  'What the timetable called this hour, verbatim, where it names no course. '
  'Never a code we made up for one.';
