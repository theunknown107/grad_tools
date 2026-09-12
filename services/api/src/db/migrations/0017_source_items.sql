-- ===========================================================================
-- 0017 — what the monitored VTU sources have said, and what we made of it
-- ===========================================================================
--
-- Authority: Phase 7B.3 §9, §12–§18, §49–§57, §60 · docs/41
--
-- Forward-only. 0001–0016 are released and are not edited.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS NOT `announcements`
-- ---------------------------------------------------------------------------
--
-- 0009's `announcements` is a PUBLICATION surface: an operator decides a notice
-- is fit to show, and the publication gate is the point of the table. These
-- rows are the opposite — everything the monitored sources said, published or
-- not, classified or not, including the items nobody could classify and the
-- items that have since been taken down.
--
-- Collapsing the two would mean either publishing things nobody reviewed, or
-- discarding the unreviewed ones. §16 forbids the second and §92 forbids the
-- first. A monitoring ledger and a publication queue are different tables.
--
-- Nothing here is student data. It is what a public source published, and it
-- is identical for everybody — which is why it belongs in this database and
-- the fact that a particular student was told about it does not (docs/33
-- §33.3, Supabase 0007).
--
-- ---------------------------------------------------------------------------
-- THE VERSION IS PART OF THE IDENTITY
-- ---------------------------------------------------------------------------
--
-- `(source_id, external_id, content_hash)` is unique, so a source item that is
-- re-read unchanged collides with itself and a revised one does not. That is
-- what makes a second run over the same snapshot produce nothing new, by
-- constraint rather than by the worker being careful (§53).
--
-- `supersedes` is a text id and NOT a foreign key, deliberately: VTU can
-- publish a correction naming a circular this deployment has never seen, and
-- refusing to record the correction because our copy is incomplete would make
-- our gap the student's problem. It is also never INFERRED — only stored when
-- the document itself says what it replaces (§12, §88).
-- ===========================================================================

CREATE TYPE source_item_change AS ENUM ('new', 'unchanged', 'updated', 'revised', 'removed');

CREATE TABLE source_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The registry row this came from. The same `sources` table the gates use;
  -- there is no second source model (M7 §4).
  source_id      text NOT NULL REFERENCES sources (id),
  family         text NOT NULL CHECK (length(family) BETWEEN 1 AND 40),

  external_id    text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 200),
  content_hash   text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),

  url            text NOT NULL CHECK (url ~ '^https?://'),
  title          text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  body           text NOT NULL,

  -- What the SOURCE printed. Never the time we read it; that is `first_seen_at`
  -- and the two are different facts (§55).
  published_at   date,
  source_updated_at date,

  supersedes     text CHECK (supersedes IS NULL OR length(supersedes) BETWEEN 1 AND 200),

  -- The classification, and the phrases that produced it. Storing the signals
  -- is what makes a wrong answer reviewable instead of mysterious (§54).
  category       text NOT NULL CHECK (length(category) BETWEEN 1 AND 40),
  signals        text[] NOT NULL DEFAULT '{}',
  importance     text NOT NULL CHECK (importance IN ('high', 'medium', 'low')),

  /*
   * THE AUDIENCE, AS THE SOURCE STATED IT. Null on an axis means the source did
   * not restrict it — never "we could not tell". That second case is
   * `unresolved_scope`, and keeping them in separate columns is the whole
   * reason an unreadable scope does not become a university-wide broadcast
   * (§35).
   */
  aud_scheme     text,
  aud_programme  text,
  aud_branch     text,
  aud_department text,
  aud_stream     text,
  aud_college    text,
  aud_semester   smallint CHECK (aud_semester IS NULL OR aud_semester BETWEEN 1 AND 10),
  aud_courses    text[] NOT NULL DEFAULT '{}',
  aud_exam_cycle text,
  unresolved_scope boolean NOT NULL DEFAULT false,

  change         source_item_change NOT NULL,
  -- Set when the source stopped serving it. The row stays: a source that drops
  -- a notice has not made it untrue (§15, §77).
  removed_at     timestamptz,

  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  first_run_id   text NOT NULL CHECK (length(first_run_id) BETWEEN 1 AND 64),
  last_run_id    text NOT NULL CHECK (length(last_run_id) BETWEEN 1 AND 64)
);

CREATE UNIQUE INDEX source_items_one_per_version
  ON source_items (source_id, external_id, content_hash);

CREATE INDEX source_items_by_family ON source_items (family, published_at DESC);
CREATE INDEX source_items_live ON source_items (family) WHERE removed_at IS NULL;

COMMENT ON TABLE source_items IS
  'Everything the monitored VTU sources published, at every version we read. '
  'Not a publication queue: unclassified and withdrawn items are kept.';

-- ---------------------------------------------------------------------------
-- monitor_runs — what happened, every time the worker ran
-- ---------------------------------------------------------------------------
--
-- §60: a run that reports nothing is indistinguishable from a run that did
-- nothing, and the catalogue crawl taught this project what that costs. Every
-- run writes a row whether or not it found anything, including the ones that
-- were refused before they started.

CREATE TABLE monitor_runs (
  run_id         text PRIMARY KEY CHECK (length(run_id) BETWEEN 1 AND 64),
  family         text NOT NULL CHECK (length(family) BETWEEN 1 AND 40),
  -- How the bytes were obtained. `live` is unreachable while terms are
  -- unknown, and recording the mode is what makes that auditable (docs/41).
  mode           text NOT NULL CHECK (mode IN ('live', 'fixture', 'supplied')),
  dry_run        boolean NOT NULL DEFAULT false,

  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,

  -- Null while the run is in flight; set to 'ok' or a failure the run names.
  outcome        text CHECK (outcome IS NULL OR length(outcome) BETWEEN 1 AND 40),
  detail         text,

  discovered     integer NOT NULL DEFAULT 0,
  items_new      integer NOT NULL DEFAULT 0,
  items_unchanged integer NOT NULL DEFAULT 0,
  items_updated  integer NOT NULL DEFAULT 0,
  items_revised  integer NOT NULL DEFAULT 0,
  items_removed  integer NOT NULL DEFAULT 0,
  skipped        integer NOT NULL DEFAULT 0
);

CREATE INDEX monitor_runs_recent ON monitor_runs (family, started_at DESC);

COMMENT ON TABLE monitor_runs IS
  'One row per worker run, including refused and empty ones. A quiet source '
  'and a broken worker must not look the same (Phase 7B.3 §60, §133).';
