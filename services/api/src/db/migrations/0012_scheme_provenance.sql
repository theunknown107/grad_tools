-- ===========================================================================
-- 0012 — a reference fact carries the page it came from
-- ===========================================================================
--
-- Authority: docs/09 §9.22 · docs/32 M10A.4 · M10A.4 §11, §15, §18
--
-- Forward-only. 0001 and 0011 are released and are not edited.
--
-- ---------------------------------------------------------------------------
-- WHY A URL WAS NOT ENOUGH
-- ---------------------------------------------------------------------------
--
-- `subjects` already carried `source_url`, `source_clause`, `verification` and
-- `verified_by`, which is enough to say WHO published a fact and roughly where
-- it came from. It is not enough to check one.
--
-- A scheme document is revised. The same URL served a different table last
-- year and will serve another next year, so "vtu.ac.in/pdf/2022syll/csesch.pdf
-- says 4 credits" is a claim that cannot be falsified without knowing WHICH
-- csesch.pdf was read. That is what the hash is for: it identifies the bytes,
-- so a later reader can tell whether they are looking at the same document or
-- a revision of it (M10A.4 §18).
--
-- The page number is the other half. A twelve-page scheme has four different
-- semester tables and two elective expansions in it, and "it is in the scheme"
-- sends the next reader through all of them.
--
-- ---------------------------------------------------------------------------
-- WHY THE WORKLOAD COLUMNS SAY `scheme_`
-- ---------------------------------------------------------------------------
--
-- A real college timetable prints hours TWICE: as taught, and as per the VTU
-- scheme — and they differ. One course is delivered 3+0+2 against a scheme of
-- 2+0+2. They are two facts about two different things, and a column called
-- `lecture_hours` would invite whichever arrived second to overwrite the first.
--
-- These columns hold the SCHEME's hours, because that is what this document
-- states. A college's delivered hours, if they are ever recorded, need their
-- own columns and their own source — they are not a better version of these.

ALTER TABLE subjects
  -- The bytes the fact was read from. Not the URL: the URL is a location, and
  -- locations are re-used across revisions.
  ADD COLUMN source_document_sha256 char(64)
    CHECK (source_document_sha256 IS NULL OR source_document_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN source_page smallint
    CHECK (source_page IS NULL OR source_page > 0),

  -- Scheme workload. NULL where the source does not state it, which is the
  -- ordinary case for anything outside a scheme of teaching document.
  ADD COLUMN scheme_lecture_hours   smallint
    CHECK (scheme_lecture_hours   IS NULL OR scheme_lecture_hours   BETWEEN 0 AND 40),
  ADD COLUMN scheme_tutorial_hours  smallint
    CHECK (scheme_tutorial_hours  IS NULL OR scheme_tutorial_hours  BETWEEN 0 AND 40),
  ADD COLUMN scheme_practical_hours smallint
    CHECK (scheme_practical_hours IS NULL OR scheme_practical_hours BETWEEN 0 AND 40);

COMMENT ON COLUMN subjects.source_document_sha256 IS
  'SHA-256 of the exact document this row was read from. Identifies the bytes, so a revision at the same URL is detectable (M10A.4 §18).';

COMMENT ON COLUMN subjects.source_page IS
  'The page of that document carrying the fact, so a reviewer can check it without reading the whole scheme.';

COMMENT ON COLUMN subjects.scheme_lecture_hours IS
  'Lecture hours per week AS THE SCHEME STATES THEM. A college may teach different hours; those are a separate fact and do not belong in this column (M10A.4 §15).';
