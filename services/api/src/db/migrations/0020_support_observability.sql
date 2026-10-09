-- ===========================================================================
-- 0020 — support and observability (OBSERVABILITY-AND-SUPPORT-V1)
-- ===========================================================================
--
-- Forward-only. 0001–0019 are released and are not edited. The runner wraps
-- this file in a transaction, so it needs no BEGIN/COMMIT of its own.
--
-- ---------------------------------------------------------------------------
-- WHY THESE LIVE IN THE REFERENCE DATABASE, NOT THE STUDENT CLOUD
-- ---------------------------------------------------------------------------
--
-- This is server-only operational data. The browser never connects to this
-- database, and only the API (and the operator, through it) reads it. An
-- operator must see ACROSS users to answer "what is failing right now", which
-- the cloud's per-user RLS would forbid. So ownership on the student-facing
-- routes is enforced by an explicit `WHERE auth_user_id = <verified session>`
-- in the query — exactly as strong as RLS here, because there is no untrusted
-- direct connection to defend against.
--
-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT HERE
-- ---------------------------------------------------------------------------
--
-- No marks, timetable rows, document text, OCR output, AI responses, tokens,
-- cookies, authorization headers, passwords, full email, phone or USN. The
-- metadata columns are a small operational allowlist (route, status, error
-- code, platform, version), and the JSON blobs are size-capped so a bug that
-- tried to dump a request body would fail the CHECK rather than persist it.
--
-- `support_id` (GT-XXXXXXXX) is safe to show a student; `auth_user_id` is the
-- internal provider subject, kept for the operator only and never returned to
-- the student. `support_id` is derived from `auth_user_id` by the API, so the
-- two are consistent without this table ever learning the derivation.
--
-- RETENTION (Phase 14): support events and reports are kept 90 days. The
-- occurred_at / created_at indexes make a periodic range-delete cheap. Request-
-- level logs are NOT here — they stay in Pino/Render with the platform's own
-- short retention.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- support_events — one row per persisted operational/security event.
-- An event that represents a reportable problem also carries an incident_id.
-- ---------------------------------------------------------------------------

CREATE TABLE support_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- GT-ERR-XXXXXX for an incident; NULL for an ordinary event.
  incident_id   text UNIQUE,
  -- GT-XXXXXXXX, derived from the subject; safe to display.
  support_id    text NOT NULL,
  -- The internal provider subject. NULL only for a failure with no session yet
  -- (e.g. a rejected token). Operator-only; never returned to a student.
  auth_user_id  text,
  event_type    text NOT NULL,
  severity      text NOT NULL DEFAULT 'info',
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  -- Correlates with the Pino request log (`req.id`). NULL when not in a request.
  request_id    text,
  route         text,
  http_status   integer,
  error_code    text,
  platform      text,
  app_version   text,
  -- A small allowlisted JSON bag. Capped so it cannot become a body dump.
  metadata_safe jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT support_events_severity_valid
    CHECK (severity IN ('info', 'warning', 'error', 'security')),
  CONSTRAINT support_events_support_id_shape
    CHECK (support_id ~ '^GT-[0-9A-HJKMNP-TV-Z]{8}$'),
  CONSTRAINT support_events_incident_shape
    CHECK (incident_id IS NULL OR incident_id ~ '^GT-ERR-[0-9A-HJKMNP-TV-Z]{6}$'),
  CONSTRAINT support_events_metadata_small
    CHECK (pg_column_size(metadata_safe) <= 4096)
);

COMMENT ON TABLE support_events IS
  'Operational and security events, keyed by the safe Support ID and the '
  'internal subject. No academic content, tokens or free text. 90-day retention.';

CREATE INDEX support_events_support_id ON support_events (support_id, occurred_at DESC);
CREATE INDEX support_events_type_time ON support_events (event_type, occurred_at DESC);
CREATE INDEX support_events_severity_time ON support_events (severity, occurred_at DESC);
CREATE INDEX support_events_occurred ON support_events (occurred_at);
CREATE INDEX support_events_request ON support_events (request_id) WHERE request_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- support_reports — one row per student-submitted problem report.
-- Every report has an owner (auth_user_id) and an Incident ID.
-- ---------------------------------------------------------------------------

CREATE TABLE support_reports (
  incident_id   text PRIMARY KEY,
  support_id    text NOT NULL,
  auth_user_id  text NOT NULL,
  category      text NOT NULL,
  description   text,
  status        text NOT NULL DEFAULT 'open',
  context_safe  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_reports_incident_shape
    CHECK (incident_id ~ '^GT-ERR-[0-9A-HJKMNP-TV-Z]{6}$'),
  CONSTRAINT support_reports_support_id_shape
    CHECK (support_id ~ '^GT-[0-9A-HJKMNP-TV-Z]{8}$'),
  CONSTRAINT support_reports_status_valid
    CHECK (status IN ('open', 'acknowledged', 'investigating', 'resolved')),
  CONSTRAINT support_reports_description_len
    CHECK (description IS NULL OR length(description) <= 1000),
  CONSTRAINT support_reports_context_small
    CHECK (pg_column_size(context_safe) <= 4096)
);

COMMENT ON TABLE support_reports IS
  'Student-submitted problem reports. Owner is auth_user_id (from the verified '
  'session, never the body). Operator-updatable status. 90-day retention.';

CREATE INDEX support_reports_owner ON support_reports (auth_user_id, created_at DESC);
CREATE INDEX support_reports_support_id ON support_reports (support_id, created_at DESC);
CREATE INDEX support_reports_status ON support_reports (status, created_at DESC);
CREATE INDEX support_reports_created ON support_reports (created_at);
