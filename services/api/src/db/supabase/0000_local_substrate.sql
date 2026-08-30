-- ===========================================================================
-- Supabase 0000 — the local substrate, FOR TESTS ONLY
-- ===========================================================================
--
-- Authority: docs/22 §22.17 · M9 §62
--
-- ---------------------------------------------------------------------------
-- WHAT THIS IS, AND WHAT IT IS NOT
-- ---------------------------------------------------------------------------
--
-- Supabase provides `auth.users`, `auth.uid()` and the `anon`/`authenticated`/
-- `authenticator` roles as part of its platform. A plain PostgreSQL instance
-- has none of them, so `0001_student_cloud.sql` — which depends on all four —
-- cannot run against one.
--
-- This file creates just enough of that substrate for the authorization tests
-- to run against a REAL PostgreSQL with REAL row-level security, on a database
-- that needs no credentials nobody has.
--
-- **IT NEVER RUNS AGAINST SUPABASE.** Supabase already has all of this, and
-- applying it there would be an attempt to redefine the platform's own auth
-- schema.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS HONEST RATHER THAN A MOCK
-- ---------------------------------------------------------------------------
--
-- The thing being tested is the POLICY, and the policies are byte-identical to
-- the ones running in Supabase — same file, applied unchanged. What differs is
-- only where `auth.uid()` comes from, and in both cases it reads the same
-- `request.jwt.claims` setting that Express sets per request.
--
-- The policies were ALSO exercised directly against the live Supabase project
-- (docs/22 §22.17), so this file is a way to run those checks in CI, not a
-- substitute for having run them for real.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
--
-- Mirroring Supabase's own shape, including the parts that matter for
-- security: `authenticator` can log in and does NOT inherit, so it holds no
-- privileges of its own until it explicitly SET ROLEs. Neither role has
-- BYPASSRLS — which is the whole point, and is asserted by a test.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

GRANT anon, authenticated TO authenticator;
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- auth.users
-- ---------------------------------------------------------------------------
--
-- A stand-in carrying only the column the student schema references. **No
-- password column, and none may be added** — GradTools does not store
-- credentials anywhere, including in a test substrate (M9 §6, §66).

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id         uuid PRIMARY KEY,
  email      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- auth.uid()
-- ---------------------------------------------------------------------------
--
-- The same definition Supabase uses: the `sub` claim of the verified JWT,
-- which Express places into `request.jwt.claims` for the life of one
-- transaction.
--
-- `current_setting(..., true)` returns NULL rather than raising when the
-- setting is absent, which is what makes an unauthenticated connection see
-- nothing instead of erroring — a policy comparing against NULL matches no
-- rows.

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT nullif(
    current_setting('request.jwt.claims', true)::json ->> 'sub',
    ''
  )::uuid
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
GRANT SELECT ON auth.users TO authenticated;
