-- ===========================================================================
-- 0015 — what is actually IN a course: syllabus, module, topic
-- ===========================================================================
--
-- Authority: docs/38_VTU_INGESTION.md · Phase 7D.2 §3–§10
--
-- Forward-only. Earlier migrations are released and are not edited.
--
-- ---------------------------------------------------------------------------
-- WHY NOT A TEXT COLUMN ON `catalogue_courses`
-- ---------------------------------------------------------------------------
--
-- 0014 records that a course exists, who it is for and what it is worth. It
-- says nothing about its content, and the obvious cheap answer — a `syllabus`
-- text column holding the extracted page — can be displayed and nothing else.
--
-- The questions this table exists to answer are structural. Which module does
-- this examination question belong to. Which modules has the student not
-- covered. What does this course share with that one. None of them can be
-- asked of a blob, and adding the column would mean re-extracting every
-- document later to get the structure back (§3).
--
-- ---------------------------------------------------------------------------
-- A SYLLABUS IS NOT A CHILD OF A COURSE ROW
-- ---------------------------------------------------------------------------
--
-- It carries the same identity as a course — (scheme year, programme, stream,
-- semester, code) — but it is NOT a foreign key to `catalogue_courses`,
-- because the two come from different documents and the documents disagree.
--
-- A scheme lists courses a syllabus never describes; a syllabus describes
-- courses their scheme prints under another code. `BCS358D` is the standing
-- example: the scheme's option list writes `BCSL358D` and the syllabus writes
-- `BCS358D`. A foreign key would force a decision at write time, discarding
-- one document's reading to satisfy the other's — and §22 is explicit that
-- disagreements are RECORDED, not resolved. Joining on the shared identity
-- keeps both readings and lets the mismatch be reported as what it is.
--
-- ---------------------------------------------------------------------------
-- NULL IS NOT "NO DATA" (§5)
-- ---------------------------------------------------------------------------
--
-- A column here is NULL when the document did not state the value, or stated
-- something that cannot be true. Those are different, and `unresolved` says
-- which: it holds an entry per field that did not resolve, with the state and,
-- for an ambiguous reading, what was actually printed.
--
-- The alternative — storing the printed figure in the column — makes an
-- impossible reading indistinguishable from an established one. A real VTU
-- laboratory syllabus prints "Credits 01 Exam Hours 100"; that cell has
-- collected a marks figure from the column beside it, and no examination lasts
-- a hundred hours.

CREATE TYPE catalogue_field_state AS ENUM (
  -- The document states it, and it can be what it says.
  'resolved',
  -- The document does not state it.
  'unavailable',
  -- The document states something that cannot be the value. Kept, not used.
  'ambiguous'
);

-- ---------------------------------------------------------------------------
-- The syllabus
-- ---------------------------------------------------------------------------

CREATE TABLE catalogue_syllabi (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- IDENTITY, the same shape as a course's (0014 §9). The title is NOT part of
  -- it: VTU corrects wording between revisions, and a title in the key turns
  -- every correction into a second syllabus.
  scheme_year       text NOT NULL CHECK (scheme_year ~ '^20\d{2}$'),
  programme_name    text,
  stream_id         text REFERENCES academic_streams (id) ON DELETE SET NULL,
  -- Nullable, unlike a course's. Five of the first-year science syllabi print
  -- no semester anywhere; their code carries it and their header does not.
  semester          smallint CHECK (semester IS NULL OR semester BETWEEN 1 AND 8),
  code              text NOT NULL CHECK (code ~ '^[A-Z0-9]{4,11}[A-Za-z0-9]?$'),

  -- What the header states. NULL means it did not resolve; `unresolved` says
  -- whether that was silence or an impossible reading.
  title             text CHECK (title IS NULL OR length(title) BETWEEN 1 AND 300),
  credits           numeric(4, 1) CHECK (credits IS NULL OR (credits >= 0 AND credits <= 30)),
  cie_marks         smallint CHECK (cie_marks IS NULL OR cie_marks BETWEEN 0 AND 200),
  see_marks         smallint CHECK (see_marks IS NULL OR see_marks BETWEEN 0 AND 200),
  total_marks       smallint CHECK (total_marks IS NULL OR total_marks BETWEEN 0 AND 200),
  exam_hours        smallint CHECK (exam_hours IS NULL OR exam_hours BETWEEN 1 AND 6),
  -- "2:2:2:0" as printed — L:T:P:S. Not split into four columns, because the
  -- document states one value and splitting it would be our arithmetic.
  teaching_hours    text CHECK (teaching_hours IS NULL OR teaching_hours ~ '^\d(:\d){2,3}$'),

  -- Every field that did not resolve, keyed by name:
  --   {"examHours": {"state": "ambiguous", "printed": 100}}
  unresolved        jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- The course's stated aims and outcomes, in the order printed. Arrays rather
  -- than tables: nothing joins to an individual objective, and a table per
  -- bullet point is the over-normalization §8 warns against.
  objectives        text[] NOT NULL DEFAULT '{}',
  outcomes          text[] NOT NULL DEFAULT '{}',

  -- PROVENANCE (§9). Mandatory, on every extracted row in this migration.
  version_id        uuid NOT NULL REFERENCES source_document_versions (id) ON DELETE RESTRICT,
  source_page       smallint NOT NULL CHECK (source_page > 0),
  parser_version    text NOT NULL,
  extraction_method text NOT NULL,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Over COALESCE, not a plain UNIQUE: `programme_name`, `stream_id` and
-- `semester` are nullable, and NULL never equals NULL in a unique constraint.
-- A plain UNIQUE let every re-run insert the same syllabus again (§35 asks for
-- a deterministically reproducible catalogue, and that starts with a second
-- run changing nothing).
CREATE UNIQUE INDEX catalogue_syllabi_identity_idx
  ON catalogue_syllabi (
    scheme_year,
    COALESCE(programme_name, ''),
    COALESCE(stream_id, ''),
    COALESCE(semester, 0),
    code
  );

CREATE INDEX catalogue_syllabi_code_idx ON catalogue_syllabi (code);
CREATE INDEX catalogue_syllabi_version_idx ON catalogue_syllabi (version_id);

-- ---------------------------------------------------------------------------
-- Modules
-- ---------------------------------------------------------------------------

CREATE TABLE catalogue_modules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  syllabus_id       uuid NOT NULL REFERENCES catalogue_syllabi (id) ON DELETE CASCADE,

  -- What the heading says — "Module-3" is 3. Explicit, never array position:
  -- a document that prints Module-1, Module-3, Module-4 has a gap, and
  -- renumbering it to 1, 2, 3 would erase that (§6).
  number            smallint NOT NULL CHECK (number BETWEEN 1 AND 20),

  -- Both nullable, and often null. "Module-1 8Hours" names no title;
  -- "Module-1: Probability Distributions" states no hours. Neither is filled
  -- in from the other shape (§10).
  title             text CHECK (title IS NULL OR length(title) BETWEEN 1 AND 300),
  hours             smallint CHECK (hours IS NULL OR hours BETWEEN 1 AND 60),

  -- The module's text as printed, kept WHOLE alongside its topics. The
  -- structure is what makes the syllabus queryable; the prose is what makes it
  -- readable, and a topic list is a poor substitute for a student reading it.
  content           text NOT NULL,

  version_id        uuid NOT NULL REFERENCES source_document_versions (id) ON DELETE RESTRICT,
  source_page       smallint NOT NULL CHECK (source_page > 0),
  parser_version    text NOT NULL,
  extraction_method text NOT NULL,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (syllabus_id, number)
);

-- ---------------------------------------------------------------------------
-- Topics
-- ---------------------------------------------------------------------------

CREATE TABLE catalogue_topics (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id         uuid NOT NULL REFERENCES catalogue_modules (id) ON DELETE CASCADE,

  -- Where in the module it is printed. The document numbers its modules and
  -- does not number its topics, so this is position — recorded explicitly
  -- rather than left to row order (§7).
  position          smallint NOT NULL CHECK (position > 0),

  -- ONLY what the document sets out as a topic (§8). VTU heads the parts of a
  -- module with a phrase and a colon; those headings are these rows. A module
  -- written as continuous prose has NO topics, and that is stored as none —
  -- splitting its sentences would present our guesses here as the university's
  -- own structure, which is what everything downstream would read them as.
  title             text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),

  version_id        uuid NOT NULL REFERENCES source_document_versions (id) ON DELETE RESTRICT,
  source_page       smallint NOT NULL CHECK (source_page > 0),
  parser_version    text NOT NULL,
  extraction_method text NOT NULL,

  created_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (module_id, position)
);

CREATE INDEX catalogue_modules_syllabus_idx ON catalogue_modules (syllabus_id);
CREATE INDEX catalogue_topics_module_idx ON catalogue_topics (module_id);
