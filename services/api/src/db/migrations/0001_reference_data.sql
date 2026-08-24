-- ===========================================================================
-- 0001 — Reference data foundation
--
-- Authority: docs/08_DATA_MODEL.md §8.3, docs/09_DATABASE_SCHEMA.md §9.4
--
-- SCOPE: public academic reference data ONLY.
--
-- There are deliberately NO student tables in this migration. Stage 1 keeps
-- every student record in the browser (docs/33 §33.3), and creating empty
-- student tables "ready for later" would undercut the privacy claim that the
-- server holds no student data. They arrive with the milestone that needs them.
--
-- Forward-only. A mistake is corrected by a new migration, never by editing
-- this file (docs/09 §9.10).
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Shared enums
-- ---------------------------------------------------------------------------

-- Verification is a three-state lifecycle, not a boolean, because "we have not
-- looked at this yet" and "we looked and could not confirm it" are different
-- facts with different remedies (docs/14 §14.7.1 uses the same distinction for
-- sources).
CREATE TYPE verification_state AS ENUM ('draft', 'unverified', 'verified');

CREATE TYPE publication_state AS ENUM ('unpublished', 'published');

CREATE TYPE subject_category AS ENUM (
  'core', 'elective', 'lab', 'mandatory', 'non_credit', 'project', 'internship'
);

-- ---------------------------------------------------------------------------
-- universities
-- ---------------------------------------------------------------------------

CREATE TABLE universities (
  id          text PRIMARY KEY,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  short_name  text NOT NULL CHECK (length(short_name) BETWEEN 1 AND 32),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- colleges
-- ---------------------------------------------------------------------------

CREATE TABLE colleges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  university_id text NOT NULL REFERENCES universities (id) ON DELETE RESTRICT,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  code          text,
  -- Present from day one even though only non-autonomous colleges are
  -- supported. An autonomous college sets its own internal rules, and this
  -- flag is what lets the rules engine refuse to apply VTU defaults to one
  -- (docs/08 §College).
  is_autonomous boolean NOT NULL DEFAULT false,
  city          text,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (university_id, name)
);

-- ---------------------------------------------------------------------------
-- schemes
-- ---------------------------------------------------------------------------

CREATE TABLE schemes (
  id                 text PRIMARY KEY,
  university_id      text NOT NULL REFERENCES universities (id) ON DELETE RESTRICT,
  code               text NOT NULL,
  regulation_code    text NOT NULL,
  name               text NOT NULL,
  effective_from     date NOT NULL,
  effective_to       date,

  -- Provenance. Mandatory for anything externally derived (docs/14 §14.10).
  source_url         text NOT NULL CHECK (source_url ~ '^https?://'),
  source_clause      text,
  verification       verification_state NOT NULL DEFAULT 'draft',
  verified_at        timestamptz,
  verified_by        text,
  publication        publication_state NOT NULL DEFAULT 'unpublished',

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (university_id, code),
  CONSTRAINT schemes_effective_range CHECK (effective_to IS NULL OR effective_to > effective_from),

  -- THE central integrity rule of this milestone, repeated on every reference
  -- table below: a record cannot be published unless it is verified AND
  -- carries the timestamp proving when. Unpublishable-unless-verified is a
  -- database invariant, not a code convention, so no route handler, seed
  -- script or future contributor can bypass it.
  CONSTRAINT schemes_publish_requires_verification CHECK (
    publication = 'unpublished'
    OR (verification = 'verified' AND verified_at IS NOT NULL)
  )
);

-- ---------------------------------------------------------------------------
-- branches
-- ---------------------------------------------------------------------------

CREATE TABLE branches (
  id            text PRIMARY KEY,
  university_id text NOT NULL REFERENCES universities (id) ON DELETE RESTRICT,
  code          text NOT NULL,
  name          text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (university_id, code)
);

-- ---------------------------------------------------------------------------
-- rule_sets
--
-- Stores the rule DATA. It does NOT implement the rules: every calculation
-- lives in @gradtools/academic-rules and the client calls that package
-- (M5a §9, docs/16). The API exposes this row as metadata so a caller can see
-- which formula identifiers and thresholds apply, and can cite the clause.
-- ---------------------------------------------------------------------------

CREATE TABLE rule_sets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id      text NOT NULL REFERENCES schemes (id) ON DELETE RESTRICT,
  college_id     uuid REFERENCES colleges (id) ON DELETE RESTRICT,
  version        integer NOT NULL CHECK (version >= 1),
  effective_from date NOT NULL,
  effective_to   date,
  active         boolean NOT NULL DEFAULT false,

  -- Formula IDENTIFIERS, never expressions. The rules engine resolves them
  -- against its own registry, so a scheme with a different conversion is a
  -- new row rather than a branch in a calculator (docs/16 §16.8).
  sgpa_formula_id       text NOT NULL,
  cgpa_formula_id       text NOT NULL,
  percentage_formula_id text NOT NULL,

  cie_max                   numeric(5, 2) NOT NULL CHECK (cie_max > 0),
  cie_min_pct               numeric(5, 2) NOT NULL CHECK (cie_min_pct BETWEEN 0 AND 100),
  see_max                   numeric(5, 2) NOT NULL CHECK (see_max > 0),
  see_min_pct               numeric(5, 2) NOT NULL CHECK (see_min_pct BETWEEN 0 AND 100),
  course_max                numeric(5, 2) NOT NULL CHECK (course_max > 0),
  overall_min_pct           numeric(5, 2) NOT NULL CHECK (overall_min_pct BETWEEN 0 AND 100),
  attendance_required_pct   numeric(5, 2) NOT NULL CHECK (attendance_required_pct BETWEEN 0 AND 100),
  attendance_condonable_pct numeric(5, 2) NOT NULL CHECK (attendance_condonable_pct BETWEEN 0 AND 100),
  attendance_dx_floor_pct   numeric(5, 2) NOT NULL CHECK (attendance_dx_floor_pct BETWEEN 0 AND 100),

  source_url    text NOT NULL CHECK (source_url ~ '^https?://'),
  source_clause text NOT NULL,
  verification  verification_state NOT NULL DEFAULT 'draft',
  verified_at   timestamptz,
  verified_by   text,
  publication   publication_state NOT NULL DEFAULT 'unpublished',

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- NOTE: there is deliberately NO `UNIQUE (scheme_id, college_id, version)`
  -- here. PostgreSQL treats NULLs as distinct, so such a constraint silently
  -- fails to deduplicate the scheme-wide rows (`college_id IS NULL`) that are
  -- the common case. The COALESCE unique index below is created instead.

  CONSTRAINT rule_sets_dx_floor_below_required CHECK (
    attendance_dx_floor_pct <= attendance_required_pct
  ),
  CONSTRAINT rule_sets_course_max_exceeds_cie CHECK (course_max > cie_max),

  -- An unverified rule set can never compute a student-facing number
  -- (docs/09 §9.4, docs/16 §16.13).
  CONSTRAINT rule_sets_active_requires_verification CHECK (
    active = false OR (verification = 'verified' AND verified_at IS NOT NULL)
  ),
  CONSTRAINT rule_sets_publish_requires_verification CHECK (
    publication = 'unpublished'
    OR (verification = 'verified' AND verified_at IS NOT NULL)
  )
);

-- One row per (scheme, college, version). COALESCE gives a NULL college_id a
-- stable key so scheme-wide rows deduplicate correctly; a plain UNIQUE would
-- let unlimited duplicates through (NULL <> NULL).
CREATE UNIQUE INDEX rule_sets_scheme_college_version
  ON rule_sets (
    scheme_id,
    COALESCE(college_id, '00000000-0000-0000-0000-000000000000'::uuid),
    version
  );

-- At most one ACTIVE rule set per (scheme, college), for the same reason
-- (docs/09 §9.4).
CREATE UNIQUE INDEX one_active_rule_set
  ON rule_sets (scheme_id, COALESCE(college_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE active;

-- ---------------------------------------------------------------------------
-- subjects
-- ---------------------------------------------------------------------------

CREATE TABLE subjects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id    text NOT NULL REFERENCES schemes (id) ON DELETE RESTRICT,
  branch_id    text NOT NULL REFERENCES branches (id) ON DELETE RESTRICT,
  semester     smallint NOT NULL CHECK (semester BETWEEN 1 AND 8),
  code         text NOT NULL CHECK (length(code) BETWEEN 1 AND 24),
  title        text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  credits      numeric(3, 1) NOT NULL CHECK (credits >= 0),
  category     subject_category NOT NULL,

  -- Per-subject because the regulation permits courses with no SEE, where CIE
  -- alone determines the grade (22OB 6.1(3)). A model assuming 50/50
  -- universally computes labs and mandatory courses wrongly (docs/08 §Subject).
  cie_max      numeric(5, 2) NOT NULL DEFAULT 50 CHECK (cie_max > 0),
  see_max      numeric(5, 2) NOT NULL DEFAULT 100 CHECK (see_max > 0),
  has_see      boolean NOT NULL DEFAULT true,
  module_count smallint NOT NULL DEFAULT 5 CHECK (module_count BETWEEN 1 AND 10),

  source_url   text NOT NULL CHECK (source_url ~ '^https?://'),
  source_clause text,
  verification verification_state NOT NULL DEFAULT 'draft',
  verified_at  timestamptz,
  verified_by  text,
  publication  publication_state NOT NULL DEFAULT 'unpublished',

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  UNIQUE (scheme_id, branch_id, code),
  CONSTRAINT subjects_publish_requires_verification CHECK (
    publication = 'unpublished'
    OR (verification = 'verified' AND verified_at IS NOT NULL)
  )
);

CREATE INDEX subjects_lookup ON subjects (scheme_id, branch_id, semester);
CREATE INDEX subjects_published ON subjects (publication) WHERE publication = 'published';

-- ---------------------------------------------------------------------------
-- syllabus_modules
-- ---------------------------------------------------------------------------

CREATE TABLE syllabus_modules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id    uuid NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
  module_number smallint NOT NULL CHECK (module_number BETWEEN 1 AND 10),
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  topics        text[] NOT NULL DEFAULT '{}',
  hours         smallint CHECK (hours IS NULL OR hours > 0),

  source_url    text NOT NULL CHECK (source_url ~ '^https?://'),
  source_clause text,
  verification  verification_state NOT NULL DEFAULT 'draft',
  verified_at   timestamptz,
  verified_by   text,
  publication   publication_state NOT NULL DEFAULT 'unpublished',

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (subject_id, module_number),
  CONSTRAINT syllabus_modules_publish_requires_verification CHECK (
    publication = 'unpublished'
    OR (verification = 'verified' AND verified_at IS NOT NULL)
  )
);

CREATE INDEX syllabus_modules_subject ON syllabus_modules (subject_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER universities_updated_at BEFORE UPDATE ON universities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER colleges_updated_at BEFORE UPDATE ON colleges
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER schemes_updated_at BEFORE UPDATE ON schemes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER branches_updated_at BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER rule_sets_updated_at BEFORE UPDATE ON rule_sets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER subjects_updated_at BEFORE UPDATE ON subjects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER syllabus_modules_updated_at BEFORE UPDATE ON syllabus_modules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
