-- ===========================================================================
-- 0014 — the ingested academic catalogue, and the documents behind it
-- ===========================================================================
--
-- Authority: docs/38_VTU_INGESTION.md · Phase 7D.1 §2–§13
--
-- Forward-only. Earlier migrations are released and are not edited.
--
-- ---------------------------------------------------------------------------
-- WHY NOT `documents`
-- ---------------------------------------------------------------------------
--
-- `documents` (0004) holds what a PERSON uploaded: it quarantines by default,
-- carries a rights determination and a presentation mode, and exists to stop a
-- student's file being served to anybody else. Every one of those columns is
-- about a document whose provenance is a human.
--
-- These are the opposite: public documents the software retrieved from a
-- university's own website, whose whole point is that they are citable. Giving
-- them a `state` of `quarantined` and a `rights_status` of `unknown` would be
-- describing something that is not true of them, and sharing the table would
-- mean every query about one had to remember which kind it was looking at.
--
-- ---------------------------------------------------------------------------
-- A DOCUMENT IS ITS BYTES; A URL IS ONLY WHERE THEY WERE FOUND
-- ---------------------------------------------------------------------------
--
-- `source_document_versions` is keyed by SHA-256, so the same PDF linked from
-- six programme rows is one row here and six in `source_document_references`
-- (§6). When a URL later serves different bytes, that is a NEW version — the
-- old one is not touched, and the reference table records that this URL has
-- pointed at both (§7).
--
-- ---------------------------------------------------------------------------
-- `programme = NULL` WAS NOT AN APPLICABILITY MODEL (§5, §6)
-- ---------------------------------------------------------------------------
--
-- A first-year scheme genuinely serves every programme in its stream. The
-- pipeline recorded that as `programme = null`, which cannot be told apart
-- from "nobody worked out which programme this is" — and it silently put the
-- Civil stream's first year and the CSE stream's into one namespace.
--
-- `document_applicability` says it properly: a document applies to a
-- PROGRAMME, or to a STREAM, and `common`/`unknown`/`ambiguous` are three
-- different answers rather than one absent value.

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------

CREATE TYPE ingest_extraction_status AS ENUM (
  'pending',
  -- The PDF had a text layer and it was read.
  'text',
  -- Pages but no text runs. NOT sent to OCR by default: a document that would
  -- need it should be visible rather than quietly approximated.
  'no_text_layer',
  'failed'
);

CREATE TYPE ingest_validation_status AS ENUM ('pending', 'valid', 'invalid', 'conflicted');

CREATE TABLE source_document_versions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Content address. This IS the identity: same bytes, same row (§6).
  sha256            char(64) NOT NULL UNIQUE CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size         bigint NOT NULL CHECK (byte_size > 0 AND byte_size <= 41943040),
  mime_type         text NOT NULL,
  page_count        integer CHECK (page_count IS NULL OR page_count > 0),

  -- When these bytes were first and most recently seen. A document that stops
  -- appearing in discovery keeps its row and stops advancing `last_seen`,
  -- which is what makes staleness visible (§32).
  first_seen        timestamptz NOT NULL DEFAULT now(),
  last_seen         timestamptz NOT NULL DEFAULT now(),
  retrieved_at      timestamptz NOT NULL,

  -- How it was read, and by what. Together these make re-extraction possible
  -- without re-downloading: bump the parser, and the rows it produced are
  -- identifiable and replaceable (§18, §35 of 7D).
  extraction_method text,
  extraction_status ingest_extraction_status NOT NULL DEFAULT 'pending',
  parser_version    text,
  normalization_version text,
  validation_status ingest_validation_status NOT NULL DEFAULT 'pending',

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Every URL that has served these bytes. Many URLs to one version (§6), and a
-- URL that changes what it serves appears against both versions (§7).
CREATE TABLE source_document_references (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id   uuid NOT NULL REFERENCES source_document_versions (id) ON DELETE CASCADE,
  source_id    text REFERENCES sources (id) ON DELETE SET NULL,
  url          text NOT NULL CHECK (url ~ '^https?://'),
  -- What the listing said about it, kept because it is evidence about the
  -- document and the listing may change.
  link_text    text,
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (version_id, url)
);

CREATE INDEX source_document_references_url_idx ON source_document_references (url);

-- ---------------------------------------------------------------------------
-- Applicability
-- ---------------------------------------------------------------------------

CREATE TYPE document_scope AS ENUM (
  -- The document names one programme.
  'programme',
  -- It serves a whole stream, and the stream's programmes inherit it.
  'stream',
  -- It serves everyone, without naming a stream.
  'common',
  -- Discovery could not establish who it is for. NOT the same as `common`.
  'unknown',
  -- The source says something that could be read more than one way.
  'ambiguous'
);

CREATE TABLE academic_streams (
  id          text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{2,40}$'),
  name        text NOT NULL,
  -- The document that establishes which programmes are in this stream.
  source_url  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Which programmes a stream contains, per the university's own list.
CREATE TABLE academic_stream_programmes (
  stream_id      text NOT NULL REFERENCES academic_streams (id) ON DELETE CASCADE,
  -- VTU's own two-letter programme code: "CB" for Computer Science & Business
  -- System. Free text rather than a foreign key because discovery finds
  -- programmes the reference tables may not carry yet.
  programme_code text NOT NULL,
  programme_name text NOT NULL,
  source_url     text,
  PRIMARY KEY (stream_id, programme_code)
);

CREATE TABLE document_applicability (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id     uuid NOT NULL REFERENCES source_document_versions (id) ON DELETE CASCADE,
  scope          document_scope NOT NULL,
  -- Exactly one of these is set for a `programme` or `stream` scope; both are
  -- null for `common`, `unknown` and `ambiguous`.
  programme_name text,
  stream_id      text REFERENCES academic_streams (id) ON DELETE SET NULL,
  scheme_year    text CHECK (scheme_year IS NULL OR scheme_year ~ '^20\d{2}$'),
  semester_from  smallint CHECK (semester_from IS NULL OR semester_from BETWEEN 1 AND 8),
  semester_to    smallint CHECK (semester_to IS NULL OR semester_to BETWEEN 1 AND 8),

  CONSTRAINT document_applicability_scope_target CHECK (
    (scope = 'programme' AND programme_name IS NOT NULL AND stream_id IS NULL)
    OR (scope = 'stream' AND stream_id IS NOT NULL AND programme_name IS NULL)
    OR (scope IN ('common', 'unknown', 'ambiguous')
        AND programme_name IS NULL AND stream_id IS NULL)
  )
);

-- The identity, over COALESCE rather than a plain UNIQUE, because
-- `programme_name` and `stream_id` are nullable and NULL never equals NULL in
-- a unique constraint. A plain UNIQUE let `ON CONFLICT DO NOTHING` miss every
-- time, so a second sync inserted the same applicability row again -- and the
-- requirement is zero duplicate applicability relationships.
CREATE UNIQUE INDEX document_applicability_identity_idx
  ON document_applicability (
    version_id, scope, COALESCE(programme_name, ''), COALESCE(stream_id, '')
  );

-- ---------------------------------------------------------------------------
-- The catalogue
-- ---------------------------------------------------------------------------

CREATE TYPE credit_basis AS ENUM (
  -- The course's own table row states the credits.
  'table',
  -- It is an option for an elective slot and takes the slot's credits.
  'slot',
  -- It shares one "A OR B" row with another course.
  'alternative'
);

CREATE TABLE catalogue_courses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- IDENTITY (§9). A course code is not globally unique: BCS503 is Theory of
  -- Computation in CSBS 2022 and nothing promises it means that elsewhere. The
  -- title is deliberately NOT part of this — a corrected title must update a
  -- course, not create a second one.
  scheme_year    text NOT NULL CHECK (scheme_year ~ '^20\d{2}$'),
  -- Null for a course from a stream-wide or common document; the applicability
  -- of its source document is what says who it is for.
  programme_name text,
  stream_id      text REFERENCES academic_streams (id) ON DELETE SET NULL,
  semester       smallint NOT NULL CHECK (semester BETWEEN 1 AND 8),
  -- A trailing lowercase letter is VTU's own convention for an elective
  -- PLACEHOLDER — `BESCK104x`, `BXX515x` — the row that carries a slot's
  -- credits. Requiring all-uppercase rejected every elective slot in the
  -- scheme, which is most of what makes a semester add up.
  code           text NOT NULL CHECK (code ~ '^[A-Z0-9]{4,11}[A-Za-z0-9]?$'),

  title          text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  credits        numeric(4, 1) NOT NULL CHECK (credits >= 0 AND credits <= 30),
  credit_basis   credit_basis NOT NULL DEFAULT 'table',
  -- The slot or alternative partner a borrowed figure came from.
  related_code   text,
  category       text,

  -- PROVENANCE (§10). A value with no trace to a source is indistinguishable
  -- from one somebody typed, so these are NOT NULL.
  version_id     uuid NOT NULL REFERENCES source_document_versions (id) ON DELETE RESTRICT,
  source_page    smallint CHECK (source_page IS NULL OR source_page > 0),

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT catalogue_courses_borrowed_names_its_source CHECK (
    credit_basis = 'table' OR related_code IS NOT NULL
  )
);

-- The identity. Expressed over COALESCE because both `programme_name` and
-- `stream_id` are nullable and NULLs do not compare equal in a plain UNIQUE
-- constraint.
--
-- THE STREAM IS PART OF IT, and leaving it out was a measured defect: the
-- Civil-stream and CSE-stream first-year schemes both describe "semester 1"
-- with `programme_name` null, so their courses shared an identity and
-- overwrote each other. Of 57 courses read from the Civil scheme, 4 survived.
-- A stream-wide document is not a programme-less document; it belongs to its
-- stream, and that is what distinguishes it (§5, §7).
CREATE UNIQUE INDEX catalogue_courses_identity_idx
  ON catalogue_courses (
    scheme_year, COALESCE(programme_name, ''), COALESCE(stream_id, ''), semester, code
  );

CREATE INDEX catalogue_courses_code_idx ON catalogue_courses (code);

-- Elective slots and the courses that may fill them (§13). A slot is itself a
-- catalogue course — it carries the credits — and this says which concrete
-- courses are its options, so nothing has to flatten them into one.
CREATE TABLE catalogue_course_options (
  slot_course_id   uuid NOT NULL REFERENCES catalogue_courses (id) ON DELETE CASCADE,
  option_course_id uuid NOT NULL REFERENCES catalogue_courses (id) ON DELETE CASCADE,
  PRIMARY KEY (slot_course_id, option_course_id),
  CONSTRAINT catalogue_course_options_distinct CHECK (slot_course_id <> option_course_id)
);

-- ---------------------------------------------------------------------------
-- Disagreements and aliases
-- ---------------------------------------------------------------------------

CREATE TYPE conflict_status AS ENUM ('open', 'resolved', 'accepted');

-- Two official documents that disagree (§11). BOTH readings are kept. A
-- resolution is recorded only when a documented precedence rule settles it —
-- never invented, and never by silently overwriting one with the other.
CREATE TABLE catalogue_conflicts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_year   text NOT NULL,
  programme_name text,
  semester      smallint,
  code          text NOT NULL,
  field         text NOT NULL,
  status        conflict_status NOT NULL DEFAULT 'open',
  resolution    text,
  resolved_by   text,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT catalogue_conflicts_resolution_is_explained CHECK (
    status = 'open' OR resolution IS NOT NULL
  )
);

CREATE TABLE catalogue_conflict_readings (
  conflict_id uuid NOT NULL REFERENCES catalogue_conflicts (id) ON DELETE CASCADE,
  version_id  uuid NOT NULL REFERENCES source_document_versions (id) ON DELETE CASCADE,
  value       text NOT NULL,
  source_page smallint,
  PRIMARY KEY (conflict_id, version_id, value)
);

-- A code the university itself writes two ways (§12). Every row cites the
-- document that establishes it — an equivalence nobody can check is a guess
-- with a table around it. Never populated by similarity.
CREATE TABLE catalogue_aliases (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_year    text NOT NULL,
  variant_code   text NOT NULL,
  canonical_code text NOT NULL,
  title          text NOT NULL,
  reason         text NOT NULL CHECK (length(reason) >= 20),
  version_id     uuid REFERENCES source_document_versions (id) ON DELETE SET NULL,
  source_page    smallint,
  created_at     timestamptz NOT NULL DEFAULT now(),

  UNIQUE (scheme_year, variant_code, canonical_code),
  CONSTRAINT catalogue_aliases_distinct CHECK (variant_code <> canonical_code)
);
