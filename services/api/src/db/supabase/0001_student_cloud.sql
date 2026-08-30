-- ===========================================================================
-- Supabase 0001 — the student cloud
-- ===========================================================================
--
-- Authority: docs/09 §9.18 · docs/11 §11.13 · docs/13 §13.17 · M9 §13–§16, §59
--
-- A SEPARATE MIGRATION LINEAGE from services/api/src/db/migrations/. Those run
-- against the self-hosted database that holds REFERENCE data — schemes,
-- subjects, sources, documents, announcements — none of which belongs to any
-- student. This file runs against Supabase and holds STUDENT-OWNED data only.
--
-- The split is the point. Reference data is public and shared; student data is
-- private and per-owner, and the two have opposite authorization rules. Keeping
-- them in one database would mean one set of connection credentials guarding
-- both, and the weaker rule would win.
--
-- ---------------------------------------------------------------------------
-- HOW AUTHORIZATION WORKS HERE, AND WHY IT IS NOT THE APPLICATION'S JOB
-- ---------------------------------------------------------------------------
--
-- Every table below is RLS-enabled with four policies, all of the same shape:
--
--     auth_user_id = (SELECT auth.uid())
--
-- Express connects as `authenticator` — a role that can log in, has NO
-- `bypassrls`, and does NOT inherit privileges — and then, per request:
--
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<verified uid>", ...}';
--
-- so `auth.uid()` resolves to the user the JWT was issued to. The consequence
-- worth stating plainly: **a compromised Express cannot turn one student's id
-- into another student's academic records**, because the database refuses the
-- rows regardless of what the query asks for. Application checks are still
-- written, but they are the second line, not the only one (M9 §15, §16).
--
-- `postgres` and `service_role` both carry `bypassrls` and are therefore
-- NEVER used for student data. That is a deployment rule with teeth: the
-- connection string Express uses is an `authenticator` one.
--
-- ---------------------------------------------------------------------------
-- OWNERSHIP IS DENORMALISED ON PURPOSE
-- ---------------------------------------------------------------------------
--
-- Every student table carries `auth_user_id` directly rather than reaching the
-- owner through a join to `student_profiles`. A policy that has to join is a
-- policy someone can write subtly wrong, and it costs a lookup on every row.
-- `auth_user_id = auth.uid()` is a comparison nobody can misread.
--
-- The FK to `student_profiles` still exists for structure; the FK to
-- `auth.users` with ON DELETE CASCADE is what makes account deletion actually
-- delete things (M9 §34).

-- ---------------------------------------------------------------------------
-- Enums, mirroring the local domain exactly
-- ---------------------------------------------------------------------------

CREATE TYPE semester_status AS ENUM ('planned', 'in_progress', 'completed');
CREATE TYPE backlog_status  AS ENUM ('active', 'attempted', 'cleared');
CREATE TYPE weekday         AS ENUM ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat');

-- ---------------------------------------------------------------------------
-- student_profiles
-- ---------------------------------------------------------------------------
--
-- ONE PER ACCOUNT, and distinct from the Supabase user row (docs/11 §11.10a).
-- They are 1:1 and separate entities, which is what lets an email change, a
-- provider switch or a provider link happen without touching a single academic
-- record.
--
-- NO DATE OF BIRTH, and none may be added (DEC-008). USN is nullable and is
-- NOT an identity key — nothing joins on it (M9 §33).

CREATE TABLE student_profiles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The only identity key. Never email, never USN, never name (M9 §7, §12).
  auth_user_id  uuid NOT NULL UNIQUE DEFAULT auth.uid()
                  REFERENCES auth.users (id) ON DELETE CASCADE,

  display_name  text CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 100),
  -- Optional, and deliberately so: no feature requires it (M9 §33).
  usn           text CHECK (usn IS NULL OR length(usn) BETWEEN 1 AND 20),

  college_name  text CHECK (college_name IS NULL OR length(college_name) BETWEEN 1 AND 200),
  scheme_id     text NOT NULL CHECK (length(scheme_id) BETWEEN 1 AND 40),
  branch        text CHECK (branch IS NULL OR length(branch) BETWEEN 1 AND 120),
  current_semester smallint CHECK (current_semester IS NULL OR current_semester BETWEEN 1 AND 8),

  /*
   * SYNC METADATA (M9 §28).
   *
   * `revision` is bumped on every write and is what makes conflict detection
   * possible: a client sends the revision it read, and a mismatch is a
   * CONFLICT rather than a silent overwrite. Timestamps alone cannot do this —
   * two devices with skewed clocks produce a wrong winner, silently.
   */
  revision      integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- The academic records
-- ---------------------------------------------------------------------------
--
-- Every one of them carries the same four columns:
--
--   auth_user_id  the owner, for RLS
--   profile_id    the structural parent
--   revision      optimistic concurrency
--   deleted_at    a TOMBSTONE, not a row that vanished
--
-- Tombstones exist because sync needs them. A row deleted on one device must
-- become deleted on the other, and a row that simply disappears is
-- indistinguishable from a row the other device has not seen yet — which would
-- resurrect it on the next sync (M9 §68: never silently discard).

CREATE TABLE semester_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid NOT NULL DEFAULT auth.uid()
                  REFERENCES auth.users (id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL REFERENCES student_profiles (id) ON DELETE CASCADE,

  number        smallint NOT NULL CHECK (number BETWEEN 1 AND 8),
  status        semester_status NOT NULL DEFAULT 'planned',
  -- Student-entered, and never used to infer status (M6 §ED-71).
  started_on    date,
  completed_on  date,

  revision      integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,

  -- One row per semester per student. The degree has eight, not eight copies.
  UNIQUE (profile_id, number)
);

CREATE TABLE semester_subjects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid NOT NULL DEFAULT auth.uid()
                  REFERENCES auth.users (id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL REFERENCES student_profiles (id) ON DELETE CASCADE,

  semester      smallint NOT NULL CHECK (semester BETWEEN 1 AND 8),
  code          text NOT NULL CHECK (length(code) BETWEEN 1 AND 24),
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  credits       numeric(3, 1) NOT NULL CHECK (credits >= 0 AND credits <= 30),
  -- The student's own note. Stored as text and rendered as text.
  notes         text CHECK (notes IS NULL OR length(notes) <= 2000),

  revision      integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

/*
 * semester_results
 *
 * THE COMPUTED SGPA IS NOT STORED, and this is load-bearing (M9 §29, §30).
 * `sgpa_asserted` is what the grade card says — a fact the student read off a
 * document. The computed value is derived on read by @gradtools/academic-rules
 * from the subjects and the pinned rule set. Storing a client-supplied
 * "computed" number would mean trusting a device's arithmetic and creating a
 * second calculation engine, which is exactly what the rules package exists to
 * prevent.
 */
CREATE TABLE semester_results (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid NOT NULL DEFAULT auth.uid()
                  REFERENCES auth.users (id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL REFERENCES student_profiles (id) ON DELETE CASCADE,

  semester      smallint NOT NULL CHECK (semester BETWEEN 1 AND 8),
  scheme_id     text NOT NULL CHECK (length(scheme_id) BETWEEN 1 AND 40),
  -- Pinned at entry so a newer regulation never re-grades a completed
  -- semester (M6 §6). Null on records created before pinning existed.
  rule_set_id   text CHECK (rule_set_id IS NULL OR length(rule_set_id) BETWEEN 1 AND 64),
  sgpa_asserted numeric(4, 2) CHECK (sgpa_asserted IS NULL OR (sgpa_asserted >= 0 AND sgpa_asserted <= 10)),

  revision      integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE TABLE result_subjects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid NOT NULL DEFAULT auth.uid()
                  REFERENCES auth.users (id) ON DELETE CASCADE,
  result_id     uuid NOT NULL REFERENCES semester_results (id) ON DELETE CASCADE,

  subject_code  text NOT NULL CHECK (length(subject_code) BETWEEN 1 AND 24),
  subject_title text NOT NULL CHECK (length(subject_title) BETWEEN 1 AND 200),
  credits       numeric(3, 1) NOT NULL CHECK (credits >= 0 AND credits <= 30),
  grade_letter  text NOT NULL CHECK (length(grade_letter) BETWEEN 1 AND 4),
  ordinal       smallint NOT NULL DEFAULT 0
);

/*
 * attendance_records
 *
 * COUNTS, NOT EVENTS (docs/08 §8.9), and that decision has a sync consequence
 * worth writing down: two devices editing the same subject produce two
 * absolute states, not two increments. They CANNOT be added together — that
 * would double-count — and they cannot be silently reconciled by timestamp
 * either, because a stale device would erase a newer count.
 *
 * So attendance conflicts are DETECTED and shown to the student (M9 §28). The
 * `revision` column is what makes that possible.
 */
CREATE TABLE attendance_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid NOT NULL DEFAULT auth.uid()
                  REFERENCES auth.users (id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL REFERENCES student_profiles (id) ON DELETE CASCADE,

  semester      smallint NOT NULL CHECK (semester BETWEEN 1 AND 8),
  subject_code  text NOT NULL CHECK (length(subject_code) BETWEEN 1 AND 24),
  subject_title text NOT NULL CHECK (length(subject_title) BETWEEN 1 AND 200),
  attended      integer NOT NULL CHECK (attended >= 0),
  conducted     integer NOT NULL CHECK (conducted >= 0),

  revision      integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,

  -- Attending more classes than were held is a typo, not a state.
  CONSTRAINT attendance_attended_within_conducted CHECK (attended <= conducted)
);

CREATE TABLE timetable_slots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid NOT NULL DEFAULT auth.uid()
                  REFERENCES auth.users (id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL REFERENCES student_profiles (id) ON DELETE CASCADE,

  day           weekday NOT NULL,
  start_time    time NOT NULL,
  end_time      time NOT NULL,
  subject_code  text NOT NULL CHECK (length(subject_code) BETWEEN 1 AND 24),
  room          text CHECK (room IS NULL OR length(room) <= 40),
  faculty       text CHECK (faculty IS NULL OR length(faculty) <= 120),

  revision      integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,

  CONSTRAINT timetable_slot_ends_after_it_starts CHECK (end_time > start_time)
);

CREATE TABLE backlog_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid NOT NULL DEFAULT auth.uid()
                  REFERENCES auth.users (id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL REFERENCES student_profiles (id) ON DELETE CASCADE,

  subject_code  text NOT NULL CHECK (length(subject_code) BETWEEN 1 AND 24),
  subject_title text NOT NULL CHECK (length(subject_title) BETWEEN 1 AND 200),
  origin_semester smallint NOT NULL CHECK (origin_semester BETWEEN 1 AND 8),
  status        backlog_status NOT NULL DEFAULT 'active',
  attempts      smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 20),
  cleared_in_semester smallint CHECK (cleared_in_semester IS NULL OR cleared_in_semester BETWEEN 1 AND 8),

  revision      integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz

  -- NO EXAM DATE COLUMN, and none may be added (M6 §10).
  --
  -- And NO "cleared implies a semester" constraint either: a student may know
  -- they passed without remembering which sitting cleared it, and refusing
  -- that would force them to invent one.
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
--
-- Every read is "this student's rows", so every index leads with the owner.
-- Without them RLS turns each query into a sequential scan filtered per row.

CREATE INDEX semester_records_owner   ON semester_records   (auth_user_id) WHERE deleted_at IS NULL;
CREATE INDEX semester_subjects_owner  ON semester_subjects  (auth_user_id) WHERE deleted_at IS NULL;
CREATE INDEX semester_results_owner   ON semester_results   (auth_user_id) WHERE deleted_at IS NULL;
CREATE INDEX result_subjects_owner    ON result_subjects    (auth_user_id);
CREATE INDEX result_subjects_result   ON result_subjects    (result_id);
CREATE INDEX attendance_records_owner ON attendance_records (auth_user_id) WHERE deleted_at IS NULL;
CREATE INDEX timetable_slots_owner    ON timetable_slots    (auth_user_id) WHERE deleted_at IS NULL;
CREATE INDEX backlog_records_owner    ON backlog_records    (auth_user_id) WHERE deleted_at IS NULL;

-- Sync pulls "everything changed since X", tombstones included.
CREATE INDEX semester_records_changed   ON semester_records   (auth_user_id, updated_at);
CREATE INDEX semester_subjects_changed  ON semester_subjects  (auth_user_id, updated_at);
CREATE INDEX semester_results_changed   ON semester_results   (auth_user_id, updated_at);
CREATE INDEX attendance_records_changed ON attendance_records (auth_user_id, updated_at);
CREATE INDEX timetable_slots_changed    ON timetable_slots    (auth_user_id, updated_at);
CREATE INDEX backlog_records_changed    ON backlog_records    (auth_user_id, updated_at);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
--
-- Enabled on every table, with four explicit policies each. There is no
-- `USING (true)` anywhere in this file and there may never be one for a
-- student-owned table (M9 §16).
--
-- `(SELECT auth.uid())` rather than a bare `auth.uid()`: wrapping it lets the
-- planner evaluate it once per statement instead of once per row, which is the
-- difference between an index scan and a per-row function call.
--
-- FORCE ROW LEVEL SECURITY is set so that even the table's OWNER is subject to
-- the policies. Without it, whichever role owns the table quietly bypasses
-- every rule below — the most commonly missed half of enabling RLS.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'student_profiles', 'semester_records', 'semester_subjects',
    'semester_results', 'result_subjects', 'attendance_records',
    'timetable_slots', 'backlog_records'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (auth_user_id = (SELECT auth.uid()))',
      t || '_select_own', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (auth_user_id = (SELECT auth.uid()))',
      t || '_insert_own', t);
    -- USING decides which rows may be targeted; WITH CHECK decides what they
    -- may become. Both are required: without WITH CHECK a student could update
    -- their own row and hand it to somebody else by changing auth_user_id.
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (auth_user_id = (SELECT auth.uid())) WITH CHECK (auth_user_id = (SELECT auth.uid()))',
      t || '_update_own', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (auth_user_id = (SELECT auth.uid()))',
      t || '_delete_own', t);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
--
-- `anon` gets NOTHING. An unauthenticated caller has no business reaching a
-- student table at all, and the absence of a grant is a stronger statement
-- than a policy that happens to match no rows (M9 §18).

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'student_profiles', 'semester_records', 'semester_subjects',
    'semester_results', 'result_subjects', 'attendance_records',
    'timetable_slots', 'backlog_records'
  ]
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO authenticated', t);
    EXECUTE format('REVOKE ALL ON %I FROM anon', t);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- updated_at and revision, maintained by the database
-- ---------------------------------------------------------------------------
--
-- NOT BY THE APPLICATION. A client that forgets to bump `revision` would
-- defeat conflict detection for every record it touches, and a client that
-- sets `updated_at` itself is asserting a clock nobody can verify. Both are
-- the database's to decide.

CREATE OR REPLACE FUNCTION touch_row()
RETURNS trigger
LANGUAGE plpgsql
-- An empty search_path: this function runs on every write, so it must not be
-- resolvable to anything a caller can shadow.
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.revision := OLD.revision + 1;
  RETURN NEW;
END
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'student_profiles', 'semester_records', 'semester_subjects',
    'semester_results', 'attendance_records', 'timetable_slots',
    'backlog_records'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_row()',
      t || '_touch', t);
  END LOOP;
END
$$;
