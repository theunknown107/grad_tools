-- ===========================================================================
-- 0011 — restrict the monitor views to gradtools_monitor only
-- ===========================================================================
--
-- `monitor_applicability_context` and `monitor_course_context` (0009) are
-- DELIBERATELY security-definer: owned by a role that bypasses RLS, they are
-- the one narrow place the student-owned tables are read without a student
-- session, so the background fanout can decide which public notice concerns
-- whom. That design is correct and is NOT changed here — do not convert them to
-- security_invoker.
--
-- THE GAP 0009 LEFT. A security-definer view is only as safe as the list of
-- roles allowed to SELECT it. On a plain PostgreSQL (the reference database and
-- the test harness) a freshly created view is readable by nobody but its owner,
-- so granting `gradtools_monitor` was enough and the omission was invisible.
-- On Supabase it is not: the platform's default privileges GRANT `anon` and
-- `authenticated` on every new object in `public`, and its Data API (PostgREST)
-- exposes exactly those roles. A security-definer view readable by `anon` is a
-- read of every student's context with RLS bypassed — the precise thing RLS is
-- there to prevent. (Staging's Data API is currently disabled, so this was a
-- latent exposure, not a live one; this closes it at the database level so it
-- cannot become live by flipping a project setting.)
--
-- THE FIX. Take the views back to their intended reader and nobody else. REVOKE
-- removes the Supabase-granted access (a no-op where it was never granted, so
-- this is safe on the reference/test databases too); the GRANT re-affirms the
-- one role that is meant to read them, so the file states the whole intended
-- access in one place. Student-table RLS, policies and the authenticator model
-- are untouched.

REVOKE ALL ON monitor_applicability_context FROM anon, authenticated, PUBLIC;
REVOKE ALL ON monitor_course_context        FROM anon, authenticated, PUBLIC;

GRANT SELECT ON monitor_applicability_context TO gradtools_monitor;
GRANT SELECT ON monitor_course_context        TO gradtools_monitor;
