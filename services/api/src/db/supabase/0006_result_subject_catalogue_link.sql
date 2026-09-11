-- ===========================================================================
-- Supabase 0006 — what a student has declared their row to be
-- ===========================================================================
--
-- Authority: docs/08 §8.19 · Phase 7B.1-final §5–§10
--
-- Forward-only. 0001–0005 are released and are not edited. The column is
-- nullable with no default, so every existing row reads as what it is: nobody
-- has declared it to be anything.
--
-- ---------------------------------------------------------------------------
-- A LINK IS NOT A PROMOTION
-- ---------------------------------------------------------------------------
--
-- `provenance` already said `catalogue` or `manual`, and the editor wrote the
-- link into it — so the moment a student identified a row they had typed, the
-- row stopped saying they had typed it. One enum cannot hold two facts, and
-- both matter:
--
--   provenance      how the row came to be. Set once, never rewritten.
--   catalogue_code  what the student has since said it corresponds to.
--
-- A row can carry both, and the pair is the point: "entered manually, linked
-- to BCS502" is a true sentence and the product could not say it.
--
-- ---------------------------------------------------------------------------
-- WHY A CODE AND NOT A FOREIGN KEY
-- ---------------------------------------------------------------------------
--
-- The catalogue is reference data keyed by course code and versioned
-- independently of any student: rows are replaced wholesale when a scheme is
-- re-read. A foreign key to one reading of a course would break on the next
-- import, or worse, quietly follow it. A code survives, because the link the
-- student made is to the COURSE.
--
-- It is deliberately NOT constrained to the catalogue's contents. A student
-- may hold a scheme this deployment has not ingested, and refusing their link
-- because our reference data is incomplete would make our gap their problem.
-- What the UI will not do is offer a code the catalogue does not have, which
-- is where the "exact evidence only" rule belongs.
-- ===========================================================================

ALTER TABLE result_subjects
  ADD COLUMN IF NOT EXISTS catalogue_code text
    CHECK (catalogue_code IS NULL OR length(catalogue_code) BETWEEN 1 AND 24);

COMMENT ON COLUMN result_subjects.catalogue_code IS
  'The catalogue course the student has declared this row to be, or NULL. '
  'Never inferred from a title, and never a substitute for provenance.';
