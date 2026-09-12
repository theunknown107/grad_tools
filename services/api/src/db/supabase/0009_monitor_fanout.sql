-- ===========================================================================
-- Supabase 0009 — how a notification reaches a student who is not here
-- ===========================================================================
--
-- Authority: Phase 7B.3.1 §2–§5, §14, §44–§49, §106 · M9 §15, §16, §44
--
-- Forward-only. 0001–0008 are released and are not edited.
--
-- ---------------------------------------------------------------------------
-- THE PROBLEM THIS SOLVES
-- ---------------------------------------------------------------------------
--
-- B.3 projected notifications inside the student's own session, which is
-- correct and RLS-safe and useless for the thing the product is for: a student
-- who is asleep when VTU postpones their examination cannot run a projection.
-- The fanout has to happen server-side, with nobody signed in.
--
-- The obvious way to do that is to give a worker `service_role` and stop
-- thinking about it. That would hand one background process the ability to read
-- every student's grades, attendance, timetable and USN in order to send them a
-- link to a public PDF, and it would make every policy in this schema
-- decoration. §46 forbids it and it is forbidden here.
--
-- ---------------------------------------------------------------------------
-- WHAT THE WORKER IS ALLOWED TO DO, IN FULL
-- ---------------------------------------------------------------------------
--
--   1. read six columns of matching context, through a view
--   2. read course codes, through a view
--   3. INSERT into source_notifications
--
-- That is the complete list. It has no SELECT on `source_notifications` — not
-- even on rows it wrote — no UPDATE, no DELETE, and no access of any kind to
-- `semester_results`, `result_subjects`, `attendance_records`,
-- `timetable_slots`, `backlog_records` or `student_profiles` itself.
--
-- ---------------------------------------------------------------------------
-- WHY A VIEW AND NOT A SECURITY DEFINER FUNCTION
-- ---------------------------------------------------------------------------
--
-- The matching rules live in `src/monitor/applicability.ts` and §139 forbids a
-- second copy of them, so the decision cannot move into SQL. A function that
-- returned "the profiles matching this notice" would therefore have to either
-- reimplement the engine here — two engines, drifting — or accept a filter and
-- hand back rows, which is a generic privileged query mechanism wearing a
-- narrow name (§45).
--
-- A view has a fixed column list and no parameters. It cannot be talked into
-- returning a column it does not have. That is the narrower object, so it is
-- the one used.
--
-- ---------------------------------------------------------------------------
-- DEDUPE WITHOUT READ ACCESS
-- ---------------------------------------------------------------------------
--
-- `INSERT ... ON CONFLICT DO NOTHING` needs no SELECT privilege, which is what
-- makes insert-only fanout possible at all: the worker cannot enumerate what a
-- student has already been told, and does not need to. The unique index from
-- 0007 decides, and a second run inserts zero rows. Measured, not assumed —
-- `INSERT 0 1` then `INSERT 0 0` under exactly these grants.
--
-- With one wrinkle worth writing down, because it cost a debugging session and
-- the next person will hit it too: naming the arbiter columns —
-- `ON CONFLICT (auth_user_id, external_id, content_hash)` — makes PostgreSQL
-- require SELECT on them, and the statement then fails with "permission denied"
-- under these very grants. The BARE form is the one that works here. The
-- privilege model chose the SQL, rather than the other way round.
--
-- ---------------------------------------------------------------------------
-- NO PASSWORD IN THIS FILE
-- ---------------------------------------------------------------------------
--
-- `gradtools_monitor` is NOLOGIN: a bag of privileges, not an account. A
-- deployment creates its own login role and GRANTs this one into it, then the
-- worker does `SET ROLE gradtools_monitor` — the same shape `authenticator` and
-- `authenticated` already use, and for the same reason. Nothing here has to be
-- rotated, because nothing here is a secret.
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gradtools_monitor') THEN
    CREATE ROLE gradtools_monitor NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO gradtools_monitor;

-- ---------------------------------------------------------------------------
-- monitor_applicability_context
-- ---------------------------------------------------------------------------
--
-- THE SIX COLUMNS THE ENGINE ACTUALLY READS, and not one more (§44).
--
-- Absent on purpose, and the list is the point: `display_name`, `usn`,
-- `id`, `revision`, `created_at`, `updated_at`. A worker deciding whether an
-- examination notice concerns semester 5 has no use for a student's name or
-- register number, so it cannot have them.
--
-- `auth_user_id` is here because a notification has to be addressed. It is an
-- opaque identifier that says nothing about the person.
--
-- NOT `security_invoker`. The view runs with its owner's rights, which is the
-- whole mechanism: it is the one narrow place where the student-owned tables
-- are read without a student session, and it is narrow because a view cannot
-- grow columns at the caller's request.

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

-- ---------------------------------------------------------------------------
-- monitor_course_context
-- ---------------------------------------------------------------------------
--
-- COURSE CODES, AND NOTHING THAT HAPPENED IN THEM. A notice naming BCS502 is
-- for the students sitting BCS502; whether they passed it is none of the
-- worker's business, so `marks`, `grade` and `status` are not here and neither
-- is the subject title a student may have typed themselves.
--
-- A backlog paper counts as the student's own (§17), so both sources appear,
-- labelled — and the label is what lets the engine keep them distinct without
-- a second query.

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

GRANT SELECT ON monitor_applicability_context TO gradtools_monitor;
GRANT SELECT ON monitor_course_context TO gradtools_monitor;

-- ---------------------------------------------------------------------------
-- The one write
-- ---------------------------------------------------------------------------
--
-- INSERT ONLY, and the omissions are load-bearing. No SELECT means the worker
-- cannot enumerate anybody's notifications, including the ones it created. No
-- UPDATE means it cannot mark anything read on a student's behalf. No DELETE
-- means it cannot make a notification it sent disappear.
--
-- `WITH CHECK (true)` is as permissive as this policy gets, and what bounds it
-- is that the role holds no other privilege on the table. The worker can
-- address a notification to any user id; it cannot discover one, read one back,
-- or alter one.

CREATE POLICY source_notifications_insert_by_monitor
  ON source_notifications FOR INSERT TO gradtools_monitor WITH CHECK (true);

GRANT INSERT ON source_notifications TO gradtools_monitor;

/*
 * Belt and braces. Nothing above granted these, but saying so explicitly means
 * a future `GRANT ALL ON ALL TABLES` — the kind of line that gets added in a
 * hurry — has to actively undo an instruction rather than quietly widen a gap.
 */
REVOKE SELECT, UPDATE, DELETE, TRUNCATE ON source_notifications FROM gradtools_monitor;
