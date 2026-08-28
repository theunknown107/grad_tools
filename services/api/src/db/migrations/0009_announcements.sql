-- 0009_announcements.sql
--
-- Authority: docs/08 §8.14 · docs/09 §9.16 · docs/14 §14.11 · M7 §7–§11
--
-- Forward-only. 0001–0008 are not edited.
--
-- Announcements are the first CONTENT GradTools shows a student that it did not
-- calculate itself. Everything here exists to keep two things true:
--
--   1. Nothing unvalidated reaches a student.
--   2. Where a notice came from is never in doubt.
--
-- NO SECOND SOURCE MODEL (M7 §4). `source_id` points at the same `sources`
-- registry that documents and change detection already use, with the same
-- gates. This table adds no way to reach the network and no way around them.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE announcement_category AS ENUM (
  'results',
  'exam_timetable',
  'exam_registration',
  'backlog',
  'summer_semester',
  'revaluation',
  'fees',
  'holiday',
  'academic_calendar',
  'college_notice',
  'department_notice',
  'general'
);

/*
 * HOW THE RECORD GOT HERE. Not the same question as who published it.
 *
 *   external_source  fetched from an enabled, gated source
 *   operator_entry   typed in by an operator on this machine
 *   demo_fixture     synthetic. MUST be labelled as such wherever it is shown
 *
 * `demo_fixture` exists as its own value rather than as a flag so that
 * "is this real?" is answerable by a query, and so a synthetic notice can never
 * be mistaken for an official one by a UI that forgot to check (M7 §36).
 */
CREATE TYPE announcement_origin AS ENUM ('external_source', 'operator_entry', 'demo_fixture');

-- ---------------------------------------------------------------------------
-- announcements
-- ---------------------------------------------------------------------------

CREATE TABLE announcements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  /*
   * PROVENANCE.
   *
   * `source_id` is the registry row this came from, and is NULL for anything a
   * person typed in — an operator entry has provenance (a publisher, a URL, a
   * date) but no automated source behind it.
   *
   * `publisher` is who ISSUED the notice and is always required. For a fetched
   * announcement it usually repeats the source's publisher; for an operator
   * entry it is the college or department that actually put the notice out,
   * which no single source row could carry.
   */
  source_id     text REFERENCES sources (id) ON DELETE RESTRICT,
  origin        announcement_origin NOT NULL,
  publisher     text NOT NULL CHECK (length(publisher) BETWEEN 1 AND 200),

  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  -- Plain text. NEVER markup: see the note on rendering below.
  body          text,
  category      announcement_category NOT NULL DEFAULT 'general',

  /*
   * The link to the original. Constrained to http(s) IN THE DATABASE, so a
   * `javascript:` or `data:` URL cannot be stored even by a mistake in a route
   * handler or a future admin tool (docs/13, M7 §31).
   */
  canonical_url text CHECK (canonical_url IS NULL OR canonical_url ~ '^https?://'),

  /*
   * FOUR DIFFERENT DATES, KEPT APART (M7 §7).
   *
   * A publication date is not an exam date, and neither is a deadline. Folding
   * them into one field would make "when was this posted" and "when must I act"
   * indistinguishable, and the second is the one a student plans around.
   *
   * All optional. An announcement with no deadline has none, and the product
   * must not invent one from wording like "apply soon" (M7 §18).
   */
  published_at   timestamptz,
  event_start_at timestamptz,
  deadline_at    timestamptz,

  /* ---- audience (M7 §14) ---------------------------------------------- */
  --
  -- NULL on an axis means NOT TARGETED on that axis, never "unknown". Every
  -- non-null constraint must match for a student to see it; a targeted notice
  -- is never silently broadened.
  --
  -- Names are stored beside the identifiers because the student's profile holds
  -- a branch NAME and a college NAME, and relevance is computed in the browser
  -- from what the profile actually has (M7 §13). The identifiers keep the
  -- referential integrity; the names make client-side matching possible without
  -- sending the student's profile anywhere.
  scheme_id     text REFERENCES schemes (id) ON DELETE RESTRICT,
  branch_id     text REFERENCES branches (id) ON DELETE RESTRICT,
  branch_name   text,
  college_id    uuid REFERENCES colleges (id) ON DELETE RESTRICT,
  college_name  text,
  semester      smallint CHECK (semester IS NULL OR semester BETWEEN 1 AND 8),

  /* ---- identity and change detection (M7 §10, §22) -------------------- */
  --
  -- The source's own identifier for the item, so the same notice is recognised
  -- across polls rather than accumulating duplicates.
  external_id   text,
  -- Hash of the normalised content. What "changed" is decided against.
  content_hash  char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  parser_version text,

  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),

  /* ---- the publication gate (M7 §11) ---------------------------------- */
  verification  verification_state NOT NULL DEFAULT 'draft',
  verified_at   timestamptz,
  verified_by   text,
  publication   publication_state NOT NULL DEFAULT 'unpublished',

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  /*
   * THE GATE, AS A CONSTRAINT (docs/14 §14.3).
   *
   * Unvalidated content cannot become student-visible. The same rule every
   * reference table carries, for the same reason: a policy in a route handler
   * is enforced only until someone writes a different route handler.
   */
  CONSTRAINT announcement_publish_requires_verification CHECK (
    publication = 'unpublished'
    OR (verification = 'verified' AND verified_at IS NOT NULL)
  ),

  -- A fetched announcement must say which source it was fetched from.
  CONSTRAINT announcement_external_needs_source CHECK (
    origin <> 'external_source' OR source_id IS NOT NULL
  ),

  -- A dated event cannot precede the notice announcing it by the clock alone,
  -- but a deadline before the publication date is a data-entry error worth
  -- refusing rather than displaying as "0 days left".
  CONSTRAINT announcement_deadline_after_publication CHECK (
    deadline_at IS NULL OR published_at IS NULL OR deadline_at >= published_at
  ),

  -- Names accompany their identifiers, so client-side matching cannot silently
  -- see a targeted announcement as untargeted.
  CONSTRAINT announcement_branch_name_with_id CHECK (branch_id IS NULL OR branch_name IS NOT NULL),
  CONSTRAINT announcement_college_name_with_id CHECK (college_id IS NULL OR college_name IS NOT NULL)
);

COMMENT ON TABLE announcements IS
  'Academic notices. Only publication = published AND verification = verified is served to students; see announcement_publish_requires_verification.';

COMMENT ON COLUMN announcements.body IS
  'PLAIN TEXT ONLY. Rendered as text by the client and never as markup: an announcement body is untrusted external content (docs/13 §T-21).';

/*
 * DEDUPLICATION (M7 §10, §22).
 *
 * One logical announcement per (source, external id). Polling the same source
 * twice updates the row rather than adding a second copy, and a source with no
 * stable identifier falls back to the content hash below.
 */
CREATE UNIQUE INDEX announcements_source_identity
    ON announcements (source_id, external_id)
 WHERE source_id IS NOT NULL AND external_id IS NOT NULL;

-- The fallback identity: the same content from the same source is the same
-- notice even when the source names nothing.
CREATE UNIQUE INDEX announcements_content_identity
    ON announcements (source_id, content_hash)
 WHERE source_id IS NOT NULL AND external_id IS NULL;

-- Serves the student listing: published, newest first.
CREATE INDEX announcements_published_feed
    ON announcements (published_at DESC NULLS LAST, created_at DESC)
 WHERE publication = 'published';

CREATE INDEX announcements_category ON announcements (category)
 WHERE publication = 'published';

-- Deadlines that have not passed, for the "what is due" view.
CREATE INDEX announcements_deadlines ON announcements (deadline_at)
 WHERE publication = 'published' AND deadline_at IS NOT NULL;
