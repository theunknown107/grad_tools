-- =============================================================================
-- ROLLBACK of 0012 — back to uuid owners referencing auth.users
-- =============================================================================
--
-- NOT A MIGRATION. This folder is not read by the migration loader (it applies
-- only `*.sql` files at the top level of db/supabase/). Run by hand, and only
-- when abandoning the Clerk cutover.
--
-- You usually do NOT need it: 0012 is provider-agnostic, so unsetting the Clerk
-- keys returns the API to Supabase Auth with 0012 still applied (a Supabase uuid
-- is a valid text subject). Use this only to restore the exact pre-0012 schema.
--
-- REFUSES, changing nothing, when any row belongs to a subject that is not a
-- Supabase user (a Clerk `user_…` id, or a uuid missing from auth.users): such
-- rows have no uuid owner to return to. Export or delete them first.
--
-- One multi-statement query = one implicit transaction: all or nothing.
-- Verified against a throwaway database by the CLERK-PRE-PRODUCTION dry run:
-- after 0012 then this file, the catalogue matches pre-0012 exactly.
-- =============================================================================

DO $$
DECLARE
  t text;
  stranded bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'student_profiles', 'semester_records', 'semester_subjects',
    'semester_results', 'result_subjects', 'attendance_records',
    'timetable_slots', 'backlog_records', 'source_notifications'
  ]
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I WHERE auth_user_id !~* %L OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id::text = auth_user_id)',
      t, '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      INTO stranded;
    IF stranded > 0 THEN
      RAISE EXCEPTION 'Rollback refused: % row(s) in % belong to a subject that is not a Supabase user.', stranded, t;
    END IF;
  END LOOP;
END
$$;

DROP VIEW monitor_applicability_context;
DROP VIEW monitor_course_context;

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
    EXECUTE format('ALTER TABLE %I ALTER COLUMN auth_user_id TYPE uuid USING auth_user_id::uuid', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN auth_user_id SET DEFAULT auth.uid()', t);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (auth_user_id) REFERENCES auth.users (id) ON DELETE CASCADE',
      t, t || '_auth_user_id_fkey');

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (auth_user_id = (SELECT auth.uid()))',
      t || '_select_own', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (auth_user_id = (SELECT auth.uid()))',
      t || '_insert_own', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (auth_user_id = (SELECT auth.uid())) WITH CHECK (auth_user_id = (SELECT auth.uid()))',
      t || '_update_own', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (auth_user_id = (SELECT auth.uid()))',
      t || '_delete_own', t);
  END LOOP;
END
$$;

ALTER TABLE result_subjects
  ADD CONSTRAINT result_subjects_belong_to_their_result
    FOREIGN KEY (result_id, auth_user_id)
    REFERENCES semester_results (id, auth_user_id)
    ON DELETE CASCADE;

DROP TABLE accounts;

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
