-- 0006_ocr_pipeline.sql
--
-- Authority: docs/17 §17.15 · docs/23 §23.3.4 · M5A.3 §3, §4, §9
--
-- Forward-only. 0001–0005 are not edited.
--
-- OCR is a measured ~1.07 s/page workload (docs/23 §23.3.4), so it cannot run
-- in an HTTP request. This adds the two things that make it a background job:
-- a richer extraction lifecycle, and a PostgreSQL-backed queue.
--
-- NO REDIS, NO BULLMQ. PostgreSQL already gives us the two hard parts —
-- transactional claim and durable state — via `FOR UPDATE SKIP LOCKED`. Adding
-- a broker would add an operational dependency to solve a problem the database
-- solves in one query (docs/23 §23.10).

-- ---------------------------------------------------------------------------
-- 1. Extraction lifecycle
-- ---------------------------------------------------------------------------
--
-- TWO LIFECYCLES, DELIBERATELY SEPARATE (M5A.3 §3):
--
--   documents.state             the DOCUMENT: quarantined -> validated -> extracted
--                               "is this file safe, and have we processed it"
--   documents.extraction_status the TEXT: how we got it and how far we trust it
--
-- Collapsing them would make `extracted` mean both "we ran extraction" and "we
-- have usable text", which are different facts — a scan reaches `extracted`
-- with no text at all.

ALTER TYPE extraction_status ADD VALUE IF NOT EXISTS 'ocr_queued';
ALTER TYPE extraction_status ADD VALUE IF NOT EXISTS 'ocr_processing';
ALTER TYPE extraction_status ADD VALUE IF NOT EXISTS 'ocr_extracted';
ALTER TYPE extraction_status ADD VALUE IF NOT EXISTS 'ocr_needs_review';

-- Detected paper format. Drives the OCR configuration and nothing else in this
-- milestone: it is NOT a parser (M5A.3 §7).
CREATE TYPE paper_format AS ENUM ('descriptive', 'mcq', 'unknown');

CREATE TYPE job_status AS ENUM ('queued', 'processing', 'completed', 'failed');

-- ---------------------------------------------------------------------------
-- 2. OCR result metadata on the document
-- ---------------------------------------------------------------------------
--
-- Enough to explain what happened and reproduce it. Deliberately NO numeric
-- "accuracy percentage": there is no ground truth, so any number would be
-- invented rather than measured (M5A.3 §9). Qualitative state carries the
-- meaning instead.

ALTER TABLE documents
  ADD COLUMN paper_format      paper_format,
  ADD COLUMN ocr_engine        text,
  ADD COLUMN ocr_engine_version text,
  ADD COLUMN ocr_languages     text,
  ADD COLUMN ocr_psm           smallint CHECK (ocr_psm IS NULL OR ocr_psm BETWEEN 0 AND 13),
  ADD COLUMN ocr_dpi           smallint CHECK (ocr_dpi IS NULL OR ocr_dpi BETWEEN 72 AND 600),
  ADD COLUMN ocr_duration_ms   integer CHECK (ocr_duration_ms IS NULL OR ocr_duration_ms >= 0),
  ADD COLUMN ocr_char_count    integer CHECK (ocr_char_count IS NULL OR ocr_char_count >= 0),
  -- True when a human should look before anything downstream trusts this text:
  -- an UNKNOWN format, or substantial mathematics (docs/17 §17.11d).
  ADD COLUMN needs_review      boolean NOT NULL DEFAULT false,
  ADD COLUMN review_reason     text,

  -- A review flag with no reason tells an operator nothing.
  ADD CONSTRAINT document_review_has_reason CHECK (
    needs_review = false OR review_reason IS NOT NULL
  );

COMMENT ON COLUMN documents.needs_review IS
  'Set when the OCR result should not be trusted without a human look: unknown paper format, or mathematics that OCR cannot reconstruct.';

-- ---------------------------------------------------------------------------
-- 3. The job queue
-- ---------------------------------------------------------------------------

CREATE TABLE jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type      text NOT NULL CHECK (job_type IN ('ocr')),
  document_id   uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,

  status        job_status NOT NULL DEFAULT 'queued',
  attempts      integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts  integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),

  -- Claimed-by, for diagnosis. Never a hostname that leaks infrastructure
  -- detail into anything user-visible.
  worker_id     text,

  -- Backoff. A job is invisible to claimants until this moment.
  run_after     timestamptz NOT NULL DEFAULT now(),

  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  completed_at  timestamptz,
  error         text,

  CONSTRAINT job_failed_has_error CHECK (status <> 'failed' OR error IS NOT NULL),
  CONSTRAINT job_completed_has_time CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);

/*
 * IDEMPOTENCE, ENFORCED BY THE DATABASE (M5A.3 §4).
 *
 * At most one ACTIVE job per document per type. Enqueueing twice is a no-op
 * rather than a second worker doing the same seconds-long work — and because
 * it is a partial unique index, a completed or failed job does not block a
 * later re-run.
 */
CREATE UNIQUE INDEX jobs_one_active_per_document
    ON jobs (document_id, job_type)
 WHERE status IN ('queued', 'processing');

-- Serves the claim query's ORDER BY, so claiming stays an index scan as the
-- queue grows.
CREATE INDEX jobs_claimable ON jobs (job_type, run_after)
 WHERE status = 'queued';

COMMENT ON TABLE jobs IS
  'PostgreSQL-backed queue. Claimed with FOR UPDATE SKIP LOCKED; no Redis or external broker (docs/23 section 23.10).';
