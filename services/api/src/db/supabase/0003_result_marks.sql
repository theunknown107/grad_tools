-- ===========================================================================
-- Supabase 0003 — a result row can hold what a result card prints
-- ===========================================================================
--
-- Authority: docs/08 §8.19 · docs/09 §9.20 · docs/32 OQ-049, DEC-037
--
-- Forward-only. 0001 and 0002 are released and are not edited.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS WRONG
-- ---------------------------------------------------------------------------
--
-- `result_subjects` REQUIRED `credits` and `grade_letter` and could store none
-- of internal, external, total, status or the announcement date.
--
-- A VTU provisional result is the exact inverse. It prints subject code,
-- subject name, internal marks, external marks, total, a one-letter result and
-- an "Announced / Updated on" date — and prints no grade, no grade point, no
-- credits and no SGPA at all. So a student copying their own card had to invent
-- a grade and a credit value before the row would save, which is the
-- manufacturing of missing values docs/37 forbids, forced by the schema.
--
-- ---------------------------------------------------------------------------
-- WHY NULL IS THE POINT, NOT A CONCESSION
-- ---------------------------------------------------------------------------
--
-- Every column added here is nullable, and `credits` and `grade_letter` become
-- nullable. NULL means "the source did not say", and it has to be storable and
-- distinguishable from zero: a credit of 0 says the course carries no weight,
-- and a grade of 'F' says the student failed. Neither is what a silent card
-- means.
--
-- ---------------------------------------------------------------------------
-- WHAT THE DATABASE DOES AND DOES NOT ENFORCE
-- ---------------------------------------------------------------------------
--
-- It enforces the cross-column invariant — a row whose columns do not add up is
-- a transcription error and every figure derived from it would be wrong. It
-- does NOT enforce the regulation's maxima: which maximum applies depends on
-- whether the course has a semester-end examination, and the ruling numbers
-- live in @gradtools/academic-rules where a scheme change can move them. The
-- bounds below are sanity limits against a mistyped or hostile payload, not a
-- statement of the 2022 regulation.

ALTER TABLE result_subjects
  -- CIE. Up to the whole course maximum, because a course with no SEE is
  -- assessed on CIE alone over the full 100 (22OB 6.1(3)).
  ADD COLUMN internal      numeric(5, 1)
                             CHECK (internal IS NULL OR (internal >= 0 AND internal <= 200)),
  -- The SEE's PRINTED contribution, on the card's own scale. Not a raw script.
  ADD COLUMN external      numeric(5, 1)
                             CHECK (external IS NULL OR (external >= 0 AND external <= 200)),
  -- As PRINTED. Never repaired to match the other two columns.
  ADD COLUMN total         numeric(5, 1)
                             CHECK (total IS NULL OR (total >= 0 AND total <= 200)),
  -- The status letter, VERBATIM. The card legends P, F, A, W, X and NE; those
  -- are observed values, not a closed universe, and a status GradTools has
  -- never seen is a fact about the card rather than a data error. So this is a
  -- bounded text column and NOT an enum: an enum would reject a real result.
  ADD COLUMN result_status text
                             CHECK (result_status IS NULL OR length(result_status) BETWEEN 1 AND 8),
  ADD COLUMN announced_on  date,
  ADD COLUMN grade_point   numeric(4, 2)
                             CHECK (grade_point IS NULL OR (grade_point >= 0 AND grade_point <= 10)),
  -- Whether the course has a semester-end examination. NULL IS LOAD-BEARING:
  -- an external of 0 is equally consistent with "no SEE" and with "sat the SEE
  -- and scored nothing", the two have opposite outcomes, and no arithmetic on
  -- the marks separates them (DEC-037). Unknown must therefore be storable, and
  -- must not default to true.
  ADD COLUMN has_see       boolean,
  -- Where the subject definition came from. Display information, never a trust
  -- level: a manually named subject is as real as a catalogued one, it simply
  -- carries no reference credits or SEE flag.
  ADD COLUMN provenance    text NOT NULL DEFAULT 'manual'
                             CHECK (provenance IN ('catalogue', 'manual'));

-- The two columns a provisional card does not print.
ALTER TABLE result_subjects
  ALTER COLUMN credits      DROP NOT NULL,
  ALTER COLUMN grade_letter DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- The cross-column invariant
-- ---------------------------------------------------------------------------
--
-- Only when all three are present. With one side missing there is nothing to
-- disagree with, and requiring the other side would require a number the card
-- may not have printed.

ALTER TABLE result_subjects
  ADD CONSTRAINT result_subjects_total_adds_up
    CHECK (
      internal IS NULL OR external IS NULL OR total IS NULL
      OR total = internal + external
    );

COMMENT ON CONSTRAINT result_subjects_total_adds_up ON result_subjects IS
  'A printed total must equal internal + external where all three are known. Refused, never repaired (OQ-049 §8).';

COMMENT ON COLUMN result_subjects.has_see IS
  'NULL means unknown, and unknown propagates to a backlog state of "not known". An external of 0 does not imply the course has no SEE (DEC-037).';

COMMENT ON COLUMN result_subjects.credits IS
  'From the subject catalogue, or NULL. Never inferred from marks, grade or subject name (OQ-049 §15).';
