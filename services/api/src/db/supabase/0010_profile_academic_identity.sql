-- ===========================================================================
-- Supabase 0010 — the student's academic identity, as they stated it
-- ===========================================================================
--
-- Authority: UF-01 · DEC-001 · DEC-002 · DEC-008 · OQ-055
--
-- Forward-only. 0001–0009 are released and are not edited.
--
-- Every column is nullable with no default: the honest value for an existing
-- row is that nobody has said. Nothing is inferred from anything else — the
-- entry route implies no semester count and no lateral entry (OQ-055), and the
-- passout year is what the student asserted, not admission + N.
--
-- The year window is a plausibility bound only. No constraint is derived from
-- a USN; there is no evidence for one. packages/shared-types profileInputSchema
-- carries the same window.
--
-- NO DATE OF BIRTH, and none may be added (DEC-008).
-- ===========================================================================

ALTER TABLE student_profiles
  ADD COLUMN IF NOT EXISTS admission_year integer
    CHECK (admission_year IS NULL OR admission_year BETWEEN 2000 AND 2100),
  ADD COLUMN IF NOT EXISTS expected_passout_year integer
    CHECK (expected_passout_year IS NULL OR expected_passout_year BETWEEN 2000 AND 2100),
  ADD COLUMN IF NOT EXISTS entry_route text
    CHECK (entry_route IS NULL OR entry_route IN ('puc', 'diploma')),
  ADD COLUMN IF NOT EXISTS identity_confirmed_at timestamptz;

ALTER TABLE student_profiles
  DROP CONSTRAINT IF EXISTS student_profiles_passout_after_admission;
ALTER TABLE student_profiles
  ADD CONSTRAINT student_profiles_passout_after_admission
    CHECK (
      admission_year IS NULL
      OR expected_passout_year IS NULL
      OR expected_passout_year >= admission_year
    );

COMMENT ON COLUMN student_profiles.entry_route IS
  'PUC or Diploma, as the student stated it. A plain fact: no semester count or '
  'lateral-entry meaning is inferred from it (OQ-055).';
COMMENT ON COLUMN student_profiles.expected_passout_year IS
  'The passout year the student asserted. Never computed from the admission year.';
COMMENT ON COLUMN student_profiles.identity_confirmed_at IS
  'When the student explicitly confirmed how their name is shown. Null if skipped.';
