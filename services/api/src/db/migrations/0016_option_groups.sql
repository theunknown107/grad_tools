-- ===========================================================================
-- 0016 — a choice the curriculum offers, as a group rather than a pair
-- ===========================================================================
--
-- Authority: docs/38_VTU_INGESTION.md · Phase 7D.2 §5–§10
--
-- Forward-only. Earlier migrations are released and are not edited.
--
-- ---------------------------------------------------------------------------
-- WHY `catalogue_course_options` IS REPLACED RATHER THAN FILLED IN
-- ---------------------------------------------------------------------------
--
-- 0014 modelled a choice as `(slot_course_id, option_course_id)` — a pair table
-- between two rows of `catalogue_courses`. It was never written to, and it
-- cannot express what a scheme actually prints.
--
-- A pair has no identity of its own, so there is nowhere to record what the
-- choice IS: whether it is an elective slot the student picks one of, or two
-- courses the first-year table joins with the word OR; what the shared credit
-- figure is and which document page states it; how many options the group has.
-- "Three rows pointing at the same slot" is an accident of arithmetic, not a
-- statement that a group of three exists.
--
-- It also required the slot to exist as a course. An OR pair has no slot row at
-- all — the scheme prints two named courses and one set of columns between
-- them — so half the choices in the first year had nothing to point at.
--
-- Dropped rather than left in place: an empty table that looks like it models
-- this is worse than no table, because the next reader has to work out which
-- of the two is real.
--
-- ---------------------------------------------------------------------------
-- A GROUP IS SCOPED, NOT GLOBAL (§6)
-- ---------------------------------------------------------------------------
--
-- `BCS515A` is an option in the CSBS fifth semester of the 2022 scheme. It is
-- not a member of one universal group named BCS515A: another programme, or
-- another scheme year, may offer a different set under the same slot, and a
-- global group would silently merge them.
--
-- So the identity is the same shape as a course's — (scheme year, programme,
-- stream, semester, slot) — and the stream is in it for the reason it is in a
-- course's key: two stream-wide first-year schemes both describe "semester 1"
-- with no programme, and without the stream they collide.
--
-- ---------------------------------------------------------------------------
-- MEMBERSHIP IS NOT ENROLMENT (§7)
-- ---------------------------------------------------------------------------
--
-- These rows say the curriculum OFFERS a choice. They say nothing about what
-- any student took — that is in the result card, which names the one course
-- actually sat. Nothing here may be read as "the student is enrolled in all
-- three", and nothing here is written from a student's records.

CREATE TYPE catalogue_option_kind AS ENUM (
  -- A slot with its own code, printed once with its credits, and a list of
  -- courses that may fill it: `BCS515x` filled by BCS515A/B/C/D.
  'elective_slot',
  -- Two named courses the table joins with the word OR, sharing one set of
  -- columns printed on the OR row itself. There is no slot code.
  'alternative'
);

DROP TABLE catalogue_course_options;

CREATE TABLE catalogue_option_groups (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  scheme_year    text NOT NULL CHECK (scheme_year ~ '^20\d{2}$'),
  programme_name text,
  stream_id      text REFERENCES academic_streams (id) ON DELETE SET NULL,
  semester       smallint NOT NULL CHECK (semester BETWEEN 1 AND 8),

  -- What names the group. For an elective slot it is the slot's own code, as
  -- the scheme prints it — `BCS515x`. An OR pair has no such code, so the
  -- LOWEST of the two option codes stands for the group: it is derived from
  -- the members alone, so the same pair read again in either order produces
  -- the same group rather than a second one.
  slot_code      text NOT NULL CHECK (slot_code ~ '^[A-Z0-9]{4,11}[A-Za-z0-9]?$'),
  kind           catalogue_option_kind NOT NULL,

  -- The credits the group carries, where the document states one figure for
  -- the whole choice. NULL when it does not; the members' own figures are then
  -- the only ones, and §9 forbids inventing a shared figure they do not have.
  credits        numeric(4, 1) CHECK (credits IS NULL OR (credits >= 0 AND credits <= 30)),

  -- PROVENANCE. The page that PRINTS the choice, so a shared credit figure can
  -- always be checked against the row it was read from.
  version_id     uuid NOT NULL REFERENCES source_document_versions (id) ON DELETE RESTRICT,
  source_page    smallint CHECK (source_page IS NULL OR source_page > 0),

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Over COALESCE: `programme_name` and `stream_id` are nullable, and NULL never
-- equals NULL in a unique constraint — a plain UNIQUE would let every run
-- insert the same group again.
CREATE UNIQUE INDEX catalogue_option_groups_identity_idx
  ON catalogue_option_groups (
    scheme_year,
    COALESCE(programme_name, ''),
    COALESCE(stream_id, ''),
    semester,
    slot_code
  );

CREATE TABLE catalogue_option_members (
  group_id    uuid NOT NULL REFERENCES catalogue_option_groups (id) ON DELETE CASCADE,

  -- The option's code as the document prints it. Deliberately a CODE and not a
  -- foreign key to `catalogue_courses`: a scheme's option list and a course's
  -- own syllabus do not always spell the code the same way — the CSBS list
  -- writes `BCSL358D` where the syllabus writes `BCS358D` — and a foreign key
  -- would force that reconciliation at write time, discarding one document's
  -- reading. `catalogue_aliases` connects the two afterwards.
  code        text NOT NULL CHECK (code ~ '^[A-Z0-9]{4,11}[A-Za-z0-9]?$'),
  title       text CHECK (title IS NULL OR length(title) BETWEEN 1 AND 300),

  -- The option's OWN credit figure where its row states one. Usually equal to
  -- the group's, and kept separately because "the same as the slot" and "this
  -- row says 3" are different facts and only one of them is checkable.
  credits     numeric(4, 1) CHECK (credits IS NULL OR (credits >= 0 AND credits <= 30)),

  version_id  uuid NOT NULL REFERENCES source_document_versions (id) ON DELETE RESTRICT,
  source_page smallint CHECK (source_page IS NULL OR source_page > 0),

  PRIMARY KEY (group_id, code)
);

CREATE INDEX catalogue_option_members_code_idx ON catalogue_option_members (code);

-- ---------------------------------------------------------------------------
-- Conflicts: an entity kind, and an identity that survives a second run
-- ---------------------------------------------------------------------------
--
-- 0014 gave `catalogue_conflicts` no unique key, so a sync that detected the
-- same disagreement twice inserted it twice — and a durable record of "the
-- documents disagree about BCHEC102" is only useful if it is ONE record that
-- accumulates readings, not a row per run.
--
-- `entity_type` because the disagreements are no longer all about courses: a
-- syllabus header states a code its own document is filed under differently,
-- and that is a conflict about a syllabus.

ALTER TABLE catalogue_conflicts
  ADD COLUMN entity_type text NOT NULL DEFAULT 'course'
    CHECK (entity_type IN ('course', 'syllabus', 'option_group', 'alias'));

CREATE UNIQUE INDEX catalogue_conflicts_identity_idx
  ON catalogue_conflicts (
    entity_type,
    scheme_year,
    COALESCE(programme_name, ''),
    COALESCE(semester, 0),
    code,
    field
  );
