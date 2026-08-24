-- 0004_sources_and_documents.sql
--
-- Authority: docs/14 §14.3, §14.7 · docs/17 §17.3, §17.11 · M5 §3–§5, §11, §17
--
-- Forward-only. 0001–0003 are not edited.
--
-- ONE source model for both M5 tracks. The document pipeline and the
-- external-source pipeline share this table rather than each inventing its own
-- idea of where material came from and whether it may be shown (M5 §3).
--
-- The safety gates in this file are CHECK constraints, not application logic,
-- for the reason docs/14 §14.3 gives: a policy that lives in code is enforced
-- only until someone writes different code. A constraint is enforced against a
-- migration, a fix-up script, a future admin tool and a mistake.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE source_kind      AS ENUM ('announcements','question_papers','syllabus','results','other');
CREATE TYPE source_authority AS ENUM ('official','third_party','user');
CREATE TYPE access_method    AS ENUM ('none','http_fetch','manual_upload','manual_entry');

-- The two gates are separate types because they are separate questions.
-- robots.txt is a machine-readable access policy; terms of use are a human
-- judgement about reuse. A site can allow one and forbid the other.
CREATE TYPE robots_status AS ENUM ('unknown','allowed','disallowed');
CREATE TYPE terms_status  AS ENUM ('unknown','permitted','restricted','prohibited');

-- Rights are about the MATERIAL, not the source. Distinct from provenance
-- entirely: knowing exactly where a document came from tells you nothing about
-- whether you may redistribute it (M5 §4).
CREATE TYPE rights_status     AS ENUM ('unknown','permitted','restricted','prohibited','user_private');
CREATE TYPE presentation_mode AS ENUM ('host','link','private','blocked');

CREATE TYPE source_health      AS ENUM ('unknown','healthy','degraded','failing');
CREATE TYPE document_state     AS ENUM ('quarantined','validated','rejected','extracted');
CREATE TYPE extraction_status  AS ENUM ('pending','text_available','ocr_required','extraction_failed');
CREATE TYPE change_type        AS ENUM ('new','modified','removed');

-- ---------------------------------------------------------------------------
-- sources — the shared registry
-- ---------------------------------------------------------------------------

CREATE TABLE sources (
  id              text PRIMARY KEY,
  kind            source_kind NOT NULL,
  publisher       text NOT NULL CHECK (length(publisher) BETWEEN 1 AND 200),
  canonical_url   text NOT NULL CHECK (canonical_url ~ '^https?://'),
  authority       source_authority NOT NULL,

  -- Defaults to 'none': a source in the registry is RECORDED, not reached.
  access_method   access_method NOT NULL DEFAULT 'none',

  -- Gate 1: robots.txt. 'unknown' is not permission.
  robots_status     robots_status NOT NULL DEFAULT 'unknown',
  robots_checked_at timestamptz,
  robots_note       text,

  -- Gate 2: terms of use, reviewed by a human.
  terms_status      terms_status NOT NULL DEFAULT 'unknown',
  terms_reviewed_at timestamptz,
  terms_note        text,

  -- Rights to the material this source publishes. Separate from both gates.
  rights_status   rights_status NOT NULL DEFAULT 'unknown',

  verification    verification_state NOT NULL DEFAULT 'draft',
  verified_at     timestamptz,
  verified_by     text,

  enabled         boolean NOT NULL DEFAULT false,

  health               source_health NOT NULL DEFAULT 'unknown',
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_checked_at      timestamptz,
  parser_version       text,
  -- Conservative floor. docs/14 §14.4 sets the default at 4 requests/hour.
  poll_interval_seconds integer CHECK (poll_interval_seconds IS NULL OR poll_interval_seconds >= 900),
  notes           text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  /*
   * THE GATE (docs/14 §14.3, M5 §10).
   *
   * A source cannot be enabled unless EVERY condition holds: robots.txt allows
   * it and was actually checked, a human reviewed the terms and recorded a
   * permissive conclusion, and the record itself is verified.
   *
   * Both gates are required because they answer different questions. VTU's own
   * two hosts demonstrate why: as checked on 2026-08-24, results.vtu.ac.in
   * returns `Disallow: /` while vtu.ac.in disallows only /wp-admin/. Robots
   * permits reading vtu.ac.in announcements — and that source is still disabled
   * here, because its terms have never been reviewed (OQ-006).
   *
   * No code path, admin mistake or future contributor can enable a source past
   * this. That is the entire point of expressing it here rather than in code.
   */
  CONSTRAINT source_enable_requires_all_gates CHECK (
    enabled = false
    OR (
      robots_status = 'allowed' AND robots_checked_at IS NOT NULL
      AND terms_status = 'permitted' AND terms_reviewed_at IS NOT NULL
      AND verification = 'verified' AND verified_at IS NOT NULL
      AND access_method <> 'none'
    )
  ),

  -- A recorded status must carry the timestamp that justifies it, so a status
  -- can never be asserted without evidence of when it was established.
  CONSTRAINT source_robots_status_needs_check CHECK (
    robots_status = 'unknown' OR robots_checked_at IS NOT NULL
  ),
  CONSTRAINT source_terms_status_needs_review CHECK (
    terms_status = 'unknown' OR terms_reviewed_at IS NOT NULL
  ),
  CONSTRAINT source_verified_needs_timestamp CHECK (
    verification <> 'verified' OR verified_at IS NOT NULL
  )
);

COMMENT ON TABLE sources IS
  'Shared source registry for both M5 tracks. `enabled` is gated by robots AND terms AND verification; see constraint source_enable_requires_all_gates.';

CREATE INDEX sources_enabled_lookup ON sources (kind) WHERE enabled;

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------

CREATE TABLE documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL for a document the user supplied themselves: it has provenance (the
  -- uploader) but no external source row.
  source_id     text REFERENCES sources (id) ON DELETE RESTRICT,

  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),

  -- Content address. Duplicate detection and the storage key both derive from
  -- it, so the same bytes are stored once no matter how often they arrive.
  sha256        char(64) NOT NULL UNIQUE CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size     bigint NOT NULL CHECK (byte_size > 0 AND byte_size <= 20971520),
  mime_type     text NOT NULL,
  page_count    integer CHECK (page_count IS NULL OR (page_count > 0 AND page_count <= 500)),

  -- Opaque storage key, never a client-supplied filename. Nothing derived from
  -- user input reaches the filesystem (docs/13 §T-03).
  storage_key   text,
  -- Kept only to show the user what they uploaded. Never used as a path.
  original_filename text,

  state              document_state NOT NULL DEFAULT 'quarantined',
  extraction_status  extraction_status NOT NULL DEFAULT 'pending',

  rights_status       rights_status NOT NULL DEFAULT 'unknown',
  rights_determined_at timestamptz,
  rights_note         text,
  presentation        presentation_mode NOT NULL DEFAULT 'private',

  source_url    text CHECK (source_url IS NULL OR source_url ~ '^https?://'),
  license_note  text,
  rejection_reason text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  /*
   * RIGHTS GATE (M5 §17, docs/17 §17.11).
   *
   * Hosting a file requires an affirmative, dated rights determination. Since
   * OQ-008 is unresolved, no document can legitimately reach 'host' today —
   * and the default of 'private' means an omission fails closed rather than
   * open.
   */
  CONSTRAINT document_host_requires_rights CHECK (
    presentation <> 'host'
    OR (rights_status = 'permitted' AND rights_determined_at IS NOT NULL)
  ),

  /*
   * A student's own document is theirs. `user_private` can only ever be
   * presented privately — no combination of other fields can make it public,
   * which is M5 §8's requirement expressed where it cannot be bypassed.
   */
  CONSTRAINT document_user_private_stays_private CHECK (
    rights_status <> 'user_private' OR presentation = 'private'
  ),

  -- 'link' means "we do not have the file, here is where it lives". Without a
  -- URL it means nothing at all.
  CONSTRAINT document_link_requires_url CHECK (
    presentation <> 'link' OR source_url IS NOT NULL
  ),

  -- We only hold bytes for what we host or hold privately. A link-only or
  -- blocked document must not have a stored file (M5 §9).
  CONSTRAINT document_stored_only_when_held CHECK (
    (presentation IN ('host','private')) OR storage_key IS NULL
  ),

  -- Nothing leaves quarantine without passing validation.
  CONSTRAINT document_extracted_requires_validation CHECK (
    state <> 'extracted' OR extraction_status <> 'pending'
  ),

  CONSTRAINT document_rejected_has_reason CHECK (
    state <> 'rejected' OR rejection_reason IS NOT NULL
  )
);

COMMENT ON TABLE documents IS
  'Document metadata. Hosting requires a dated rights determination; user_private can never be public. Files live in object storage, never in this table.';

CREATE INDEX documents_source_lookup ON documents (source_id);
CREATE INDEX documents_public_lookup ON documents (state) WHERE presentation IN ('host','link');

-- ---------------------------------------------------------------------------
-- document_sections — the extraction foundation
-- ---------------------------------------------------------------------------
--
-- Deliberately stops at "sections of text with positions". Question
-- segmentation and module mapping are the later intelligence milestone (M5
-- §16); building them here would mean guessing structure before the extraction
-- itself is proven.

CREATE TABLE document_sections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  page_number   integer NOT NULL CHECK (page_number > 0),
  ordinal       integer NOT NULL CHECK (ordinal >= 0),
  content       text NOT NULL,
  -- Which extractor produced this, so output can be regenerated or compared
  -- when the extractor changes.
  extractor_version text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, page_number, ordinal)
);

-- ---------------------------------------------------------------------------
-- source_changes — detection, not delivery
-- ---------------------------------------------------------------------------
--
-- A change is RECORDED here. Nothing is sent (M5 §14). Notification delivery is
-- a later milestone, and separating detection from delivery means the detection
-- history exists before anyone can be woken by it.

CREATE TABLE source_changes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id     text NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  -- The source's own identifier for the item, so the same item is recognised
  -- across polls.
  external_id   text NOT NULL,
  change_type   change_type NOT NULL,
  title         text,
  item_url      text CHECK (item_url IS NULL OR item_url ~ '^https?://'),
  -- Hash of the normalised item, which is what "modified" is decided against.
  payload_hash  char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  parser_version text NOT NULL,
  detected_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX source_changes_lookup ON source_changes (source_id, detected_at DESC);

-- The same item at the same content hash is not a new change. Re-detecting it
-- on every poll would turn an unchanged page into an endless change log.
CREATE UNIQUE INDEX source_changes_dedupe
    ON source_changes (source_id, external_id, payload_hash, change_type);
