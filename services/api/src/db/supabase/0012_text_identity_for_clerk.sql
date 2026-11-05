-- =============================================================================
-- 0012 — An account is a TEXT subject, owned by public.accounts
-- =============================================================================
--
-- WHY
--
-- Authentication moves from Supabase Auth to Clerk (phase CLERK-AUTH-MIGRATION-
-- V1). A Clerk user id is `user_...`, not a uuid, and a Clerk user has no row in
-- `auth.users`. Every student table was keyed by
--
--     auth_user_id uuid DEFAULT auth.uid() REFERENCES auth.users ON DELETE CASCADE
--
-- and every policy compared `auth_user_id = auth.uid()`. `auth.uid()` casts the
-- `sub` claim to uuid, so a Clerk subject would RAISE on every request, and an
-- insert would violate the foreign key. This migration makes identity what the
-- provider actually issues: the `sub` claim, as text — Supabase's documented
-- shape for third-party auth (`auth.jwt() ->> 'sub'`).
--
-- EVIDENCE THAT THE TYPE CHANGE IS SAFE (checked on production, 2026-10-08):
-- every one of the nine student-owned tables held ZERO rows. It is written to
-- preserve rows anyway: every existing owner becomes an account below, so a
-- database that does hold data keeps every row under the same owner string.
--
-- DELETION WITHOUT ELEVATED RIGHTS
--
-- Account deletion used to remove an `auth.users` row through an admin
-- connection and rely on the cascade. Now every student table cascades from
-- `public.accounts`, and a student deletes THEIR OWN account row under RLS —
-- `DELETE FROM accounts` as `authenticated` reaches nothing but their own row,
-- and referential cascades remove everything that hangs off it (M9 §34). The
-- identity provider's user is deleted separately by the API (Clerk's backend).
--
-- PROVIDER-AGNOSTIC
--
-- Nothing here names Clerk. A Supabase-issued uuid subject is a valid text
-- subject too, so this schema serves either authority during cutover and on
-- rollback; the API decides which one it trusts, never the client.
--
-- ATOMIC: like every file here it is sent as one multi-statement query, which
-- PostgreSQL runs as a single implicit transaction — a failure part-way
-- leaves the schema exactly as it was.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The account. One row per subject the API has authenticated.
-- ---------------------------------------------------------------------------

CREATE TABLE accounts (
  id         text PRIMARY KEY DEFAULT (auth.jwt() ->> 'sub'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_id_not_blank CHECK (btrim(id) <> '')
);

COMMENT ON TABLE accounts IS
  'One row per authenticated subject (the identity provider''s `sub`). Every '
  'student table cascades from it, so deleting it deletes the account''s data.';

-- The views read the column being retyped; they are recreated identically below.
DROP VIEW monitor_applicability_context;
DROP VIEW monitor_course_context;

-- The one composite reference carrying the owner; recreated after the retype.
ALTER TABLE result_subjects DROP CONSTRAINT result_subjects_belong_to_their_result;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'student_profiles', 'semester_records', 'semester_subjects',
    'semester_results', 'result_subjects', 'attendance_records',
    'timetable_slots', 'backlog_records', 'source_notifications'
  ]
  LOOP
    EXECUTE format('DROP POLICY %I ON %I', t || '_select_own', t);
    EXECUTE format('DROP POLICY %I ON %I', t || '_insert_own', t);
    EXECUTE format('DROP POLICY %I ON %I', t || '_update_own', t);
    EXECUTE format('DROP POLICY %I ON %I', t || '_delete_own', t);

    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t, t || '_auth_user_id_fkey');
    EXECUTE format('ALTER TABLE %I ALTER COLUMN auth_user_id DROP DEFAULT', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN auth_user_id TYPE text USING auth_user_id::text', t);

    -- Every existing owner keeps every row: their subject becomes an account.
    EXECUTE format(
      'INSERT INTO accounts (id) SELECT DISTINCT auth_user_id FROM %I ON CONFLICT (id) DO NOTHING', t);

    EXECUTE format('ALTER TABLE %I ALTER COLUMN auth_user_id SET DEFAULT (auth.jwt() ->> %L)', t, 'sub');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (auth_user_id) REFERENCES accounts (id) ON DELETE CASCADE',
      t, t || '_auth_user_id_fkey');

    -- `(SELECT ...)` so the planner evaluates the subject once per statement.
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (auth_user_id = (SELECT auth.jwt() ->> %L))',
      t || '_select_own', t, 'sub');
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (auth_user_id = (SELECT auth.jwt() ->> %L))',
      t || '_insert_own', t, 'sub');
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (auth_user_id = (SELECT auth.jwt() ->> %L)) WITH CHECK (auth_user_id = (SELECT auth.jwt() ->> %L))',
      t || '_update_own', t, 'sub', 'sub');
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (auth_user_id = (SELECT auth.jwt() ->> %L))',
      t || '_delete_own', t, 'sub');
  END LOOP;
END
$$;

ALTER TABLE result_subjects
  ADD CONSTRAINT result_subjects_belong_to_their_result
    FOREIGN KEY (result_id, auth_user_id)
    REFERENCES semester_results (id, auth_user_id)
    ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- The account's own rules — enabled only now, after the backfill above.
-- No UPDATE: a subject is never renamed, it is created or deleted.
-- ---------------------------------------------------------------------------

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_own ON accounts
  FOR SELECT TO authenticated USING (id = (SELECT auth.jwt() ->> 'sub'));
CREATE POLICY accounts_insert_own ON accounts
  FOR INSERT TO authenticated WITH CHECK (id = (SELECT auth.jwt() ->> 'sub'));
CREATE POLICY accounts_delete_own ON accounts
  FOR DELETE TO authenticated USING (id = (SELECT auth.jwt() ->> 'sub'));

REVOKE ALL ON accounts FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, DELETE ON accounts TO authenticated;

-- ---------------------------------------------------------------------------
-- The monitor's views, recreated exactly (0009), with 0011's grant hardening.
-- ---------------------------------------------------------------------------

CREATE VIEW monitor_applicability_context AS
  SELECT
    auth_user_id,
    scheme_id,
    programme,
    branch,
    college_name,
    current_semester
  FROM student_profiles;

COMMENT ON VIEW monitor_applicability_context IS
  'The minimum a background fanout needs to decide whether a public notice '
  'concerns a student. Deliberately excludes name, USN and every academic '
  'record (Phase 7B.3.1 §44).';

CREATE VIEW monitor_course_context AS
  SELECT auth_user_id, code, 'enrolled'::text AS kind
  FROM semester_subjects
  WHERE deleted_at IS NULL
  UNION ALL
  SELECT auth_user_id, subject_code AS code, 'backlog'::text AS kind
  FROM backlog_records
  WHERE deleted_at IS NULL AND status <> 'cleared';

COMMENT ON VIEW monitor_course_context IS
  'Course codes a student holds, enrolled or as a backlog. No marks, no grades, '
  'no titles (Phase 7B.3.1 §44, §76).';

REVOKE ALL ON monitor_applicability_context FROM anon, authenticated, PUBLIC;
REVOKE ALL ON monitor_course_context        FROM anon, authenticated, PUBLIC;
GRANT SELECT ON monitor_applicability_context TO gradtools_monitor;
GRANT SELECT ON monitor_course_context        TO gradtools_monitor;
